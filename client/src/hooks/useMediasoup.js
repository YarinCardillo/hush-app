import { useState, useRef, useCallback, useEffect } from "react";
import { Device } from "mediasoup-client";
import { getSocket, socketRequest } from "../lib/socket";
import {
  QUALITY_PRESETS,
  DEFAULT_QUALITY,
  MEDIA_SOURCES,
  isScreenShareSource,
} from "../utils/constants";
import {
  isE2ESupported,
  hasScriptTransform,
  applyEncryptionTransform,
  applyDecryptionTransform,
  importCryptoKey,
  terminateE2EWorker,
  monitorFrameDrops,
} from "../lib/encryption";

export function useMediasoup() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);
  const [producers, setProducers] = useState(new Map()); // our outgoing streams
  const [consumers, setConsumers] = useState(new Map()); // incoming streams from others
  const [peers, setPeers] = useState([]);

  // ─── Noise Gate State ─────────────────────────────
  const [noiseGateEnabled, setNoiseGateEnabled] = useState(true);
  const [noiseGateThreshold, setNoiseGateThreshold] = useState(-50);
  const [micLevel, setMicLevel] = useState(0);

  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const producersRef = useRef(new Map());
  const consumersRef = useRef(new Map());

  // ─── E2E Encryption ─────────────────────────────────
  const e2eKeyBytesRef = useRef(null);
  const [isE2EActive, setIsE2EActive] = useState(false);

  // ─── Click-to-Watch Screen Shares ──────────────────
  const [availableScreens, setAvailableScreens] = useState(new Map());
  const [watchedScreens, setWatchedScreens] = useState(new Set());
  const availableScreensRef = useRef(new Map());
  const watchedScreensRef = useRef(new Set());

  // ─── Noise Gate Refs ──────────────────────────────
  const micPipelineRef = useRef(null);
  const noiseGateEnabledRef = useRef(true);
  const noiseGateThresholdRef = useRef(-50);

  // ─── Adaptive Quality Refs ────────────────────────
  const frameDropMonitorRef = useRef(null);
  const currentQualityRef = useRef(DEFAULT_QUALITY);
  const qualityDowngradedRef = useRef(false);

  // ─── Debounced State Updates ──────────────────────
  const pendingProducersUpdateRef = useRef(false);
  const pendingConsumersUpdateRef = useRef(false);
  const pendingScreensUpdateRef = useRef(false);

  // ─── Noise Gate Controls ──────────────────────────
  const updateNoiseGateEnabled = useCallback((enabled) => {
    noiseGateEnabledRef.current = enabled;
    setNoiseGateEnabled(enabled);

    const pipeline = micPipelineRef.current;
    if (!pipeline) return;

    // Update worklet if using AudioWorklet
    if (pipeline.workletNode) {
      pipeline.workletNode.port.postMessage({
        type: "updateParams",
        enabled,
      });
    } else if (!enabled && pipeline.gainNode) {
      // Legacy fallback: open gate immediately
      const { gainNode, audioContext } = pipeline;
      gainNode.gain.setTargetAtTime(1, audioContext.currentTime, 0.01);
    }
  }, []);

  const updateNoiseGateThreshold = useCallback((threshold) => {
    const clamped = Math.max(-60, Math.min(-30, threshold));
    noiseGateThresholdRef.current = clamped;
    setNoiseGateThreshold(clamped);

    const pipeline = micPipelineRef.current;
    if (!pipeline) return;

    // Update worklet if using AudioWorklet
    if (pipeline.workletNode) {
      pipeline.workletNode.port.postMessage({
        type: "updateParams",
        threshold: clamped,
      });
    }
  }, []);

  const setE2EKey = useCallback((keyBytes) => {
    e2eKeyBytesRef.current = keyBytes;
    setIsE2EActive(!!keyBytes);
    if (keyBytes) console.log("[e2e] Key set for encryption");
  }, []);

  // ─── Debounced State Updates ──────────────────────
  const scheduleProducersUpdate = useCallback(() => {
    if (pendingProducersUpdateRef.current) return;
    pendingProducersUpdateRef.current = true;
    requestAnimationFrame(() => {
      setProducers(new Map(producersRef.current));
      pendingProducersUpdateRef.current = false;
    });
  }, []);

  const scheduleConsumersUpdate = useCallback(() => {
    if (pendingConsumersUpdateRef.current) return;
    pendingConsumersUpdateRef.current = true;
    requestAnimationFrame(() => {
      setConsumers(new Map(consumersRef.current));
      pendingConsumersUpdateRef.current = false;
    });
  }, []);

  const scheduleScreensUpdate = useCallback(() => {
    if (pendingScreensUpdateRef.current) return;
    pendingScreensUpdateRef.current = true;
    requestAnimationFrame(() => {
      setAvailableScreens(new Map(availableScreensRef.current));
      setWatchedScreens(new Set(watchedScreensRef.current));
      pendingScreensUpdateRef.current = false;
    });
  }, []);

  const cleanupMicPipeline = useCallback(() => {
    const pipeline = micPipelineRef.current;
    if (!pipeline) return;

    // Cleanup legacy interval if present
    if (pipeline.monitorInterval) {
      clearInterval(pipeline.monitorInterval);
    }

    // Disconnect nodes
    pipeline.source.disconnect();

    if (pipeline.workletNode) {
      // AudioWorklet path
      pipeline.workletNode.disconnect();
    } else if (pipeline.analyser && pipeline.gainNode) {
      // Legacy path
      pipeline.analyser.disconnect();
      pipeline.gainNode.disconnect();
    }

    pipeline.audioContext.close();
    pipeline.rawStream.getTracks().forEach((t) => t.stop());
    micPipelineRef.current = null;
    setMicLevel(0);
  }, []);

  // ─── Initialize Device ──────────────────────────────
  const initDevice = useCallback(async () => {
    try {
      // Close stale state from previous session (handles page reload)
      if (sendTransportRef.current) {
        sendTransportRef.current.close();
        sendTransportRef.current = null;
      }
      if (recvTransportRef.current) {
        recvTransportRef.current.close();
        recvTransportRef.current = null;
      }
      producersRef.current.clear();
      consumersRef.current.clear();
      availableScreensRef.current.clear();
      watchedScreensRef.current.clear();
      setProducers(new Map());
      setConsumers(new Map());
      setAvailableScreens(new Map());
      setWatchedScreens(new Set());
      setIsReady(false);
      cleanupMicPipeline();

      const { rtpCapabilities } = await socketRequest(
        "getRouterRtpCapabilities",
      );

      const device = new Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities });
      deviceRef.current = device;

      // E2E: legacy createEncodedStreams needs this flag on the PeerConnection
      const needsLegacyE2E =
        e2eKeyBytesRef.current && !hasScriptTransform() && isE2ESupported();
      const additionalSettings = needsLegacyE2E
        ? { encodedInsertableStreams: true }
        : {};

      // Create send transport
      const sendData = await socketRequest("createWebRtcTransport", {
        direction: "send",
      });
      const sendTransport = device.createSendTransport({
        ...sendData.params,
        additionalSettings,
      });

      sendTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            await socketRequest("connectTransport", {
              transportId: sendTransport.id,
              dtlsParameters,
            });
            callback();
          } catch (err) {
            errback(err);
          }
        },
      );

      sendTransport.on("connectionstatechange", (state) => {
        console.log(`[mediasoup] Send transport state: ${state}`);
        if (state === "failed") {
          console.error(
            "[mediasoup] Send transport ICE failed — check firewall (ports 40000-40100 UDP/TCP)",
          );
          setError("Media upload failed: cannot reach server media ports.");
        }
      });

      sendTransport.on(
        "produce",
        async ({ kind, rtpParameters, appData }, callback, errback) => {
          try {
            const { producerId } = await socketRequest("produce", {
              transportId: sendTransport.id,
              kind,
              rtpParameters,
              appData,
            });
            callback({ id: producerId });
          } catch (err) {
            errback(err);
          }
        },
      );

      sendTransportRef.current = sendTransport;

      // Create receive transport
      const recvData = await socketRequest("createWebRtcTransport", {
        direction: "recv",
      });
      const recvTransport = device.createRecvTransport({
        ...recvData.params,
        additionalSettings,
      });

      recvTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            await socketRequest("connectTransport", {
              transportId: recvTransport.id,
              dtlsParameters,
            });
            callback();
          } catch (err) {
            errback(err);
          }
        },
      );

      recvTransport.on("connectionstatechange", (state) => {
        console.log(`[mediasoup] Recv transport state: ${state}`);
        if (state === "failed") {
          console.error(
            "[mediasoup] Recv transport ICE failed — check firewall (ports 40000-40100 UDP/TCP)",
          );
          setError("Media download failed: cannot reach server media ports.");
        }
      });

      recvTransportRef.current = recvTransport;

      // Pre-warm send transport: trigger DTLS handshake eagerly.
      // Without this, the first produce() call (e.g., screen share) triggers
      // a cold DTLS handshake, during which getDisplayMedia tracks can die
      // with "InvalidStateError: track ended".
      try {
        const warmupCtx = new AudioContext();
        const osc = warmupCtx.createOscillator();
        osc.frequency.value = 0;
        const warmupDest = warmupCtx.createMediaStreamDestination();
        osc.connect(warmupDest);
        osc.start();
        const silentTrack = warmupDest.stream.getAudioTracks()[0];

        const warmupProducer = await sendTransport.produce({
          track: silentTrack,
          appData: { source: "_warmup" },
        });

        // Wait for DTLS to complete
        if (sendTransport.connectionState !== "connected") {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("warmup timeout")),
              15000,
            );
            const onState = (state) => {
              if (state === "connected" || state === "failed") {
                clearTimeout(timeout);
                sendTransport.off("connectionstatechange", onState);
                if (state === "connected") resolve();
                else reject(new Error("DTLS failed"));
              }
            };
            sendTransport.on("connectionstatechange", onState);
          });
        }

        warmupProducer.close();
        silentTrack.stop();
        warmupCtx.close();
        try {
          await socketRequest("closeProducer", {
            producerId: warmupProducer.id,
          });
        } catch {
          /* server may already know */
        }

        // Let the internal SDP renegotiation from producer close settle.
        // producer.close() triggers handler.stopSending() as fire-and-forget,
        // which renegotiates the PeerConnection's SDP asynchronously.
        await new Promise((r) => setTimeout(r, 100));

        console.log(
          "[mediasoup] Send transport pre-warmed, state:",
          sendTransport.connectionState,
        );
      } catch (warmupErr) {
        console.warn(
          "[mediasoup] Send transport warmup failed:",
          warmupErr.message,
        );
      }

      setIsReady(true);
      console.log("[mediasoup] Device initialized");
    } catch (err) {
      console.error("[mediasoup] Init error:", err);
      setError(err.message);
    }
  }, []);

  // ─── Capture Screen (step 1: get stream, no produce) ─
  const captureScreen = useCallback(async () => {
    if (!sendTransportRef.current) throw new Error("Transport not ready");

    console.log(
      "[screen] captureScreen called, transport state:",
      sendTransportRef.current.connectionState,
    );

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: "always",
          frameRate: { ideal: 60 },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const videoTrack = stream.getVideoTracks()[0];
      const audioTracks = stream.getAudioTracks();
      console.log("[screen] Captured tracks:", {
        video: {
          readyState: videoTrack?.readyState,
          muted: videoTrack?.muted,
          enabled: videoTrack?.enabled,
          settings: videoTrack?.getSettings(),
        },
        audioCount: audioTracks.length,
        audio: audioTracks[0]
          ? {
              readyState: audioTracks[0].readyState,
              muted: audioTracks[0].muted,
              enabled: audioTracks[0].enabled,
              label: audioTracks[0].label,
            }
          : 'NO AUDIO TRACK - user may not have checked "Share audio"',
      });

      if (!videoTrack || videoTrack.readyState !== "live") {
        console.error("[screen] Video track not live:", videoTrack?.readyState);
        stream.getTracks().forEach((t) => t.stop());
        return null;
      }

      const settings = videoTrack.getSettings();

      return {
        stream,
        nativeWidth: settings.width || 0,
        nativeHeight: settings.height || 0,
      };
    } catch (err) {
      if (err.name === "NotAllowedError") return null;
      console.error("[screen] captureScreen error:", err);
      return null;
    }
  }, []);

  // ─── Produce Screen (step 2: produce with chosen quality) ─
  const produceScreen = useCallback(
    async (stream, qualityKey = DEFAULT_QUALITY) => {
      if (!sendTransportRef.current) throw new Error("Transport not ready");

      const quality = QUALITY_PRESETS[qualityKey];
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      console.log("[screen] produceScreen called:", {
        qualityKey,
        transportState: sendTransportRef.current.connectionState,
        trackState: videoTrack?.readyState,
      });

      // For "lite": downscale the track to 720p/30fps
      if (quality.width && quality.height) {
        try {
          await videoTrack.applyConstraints({
            width: { ideal: quality.width },
            height: { ideal: quality.height },
            frameRate: { ideal: quality.frameRate },
          });
        } catch (err) {
          console.warn("[screen] Could not apply track constraints:", err);
        }
      }

      // Guard: verify the track is still usable
      if (!videoTrack || videoTrack.readyState !== "live") {
        console.error(
          "[screen] Video track not live after constraints:",
          videoTrack?.readyState,
        );
        stream.getTracks().forEach((t) => t.stop());
        return null;
      }

      // Diagnostic: detect if the track dies during the async produce call
      const onTrackEnded = () => {
        console.error(
          "[screen] Video track ended DURING produce — possible OS permission issue",
        );
      };
      videoTrack.addEventListener("ended", onTrackEnded);

      // Pre-import E2E key to avoid race condition with produce()
      const encryptKey = e2eKeyBytesRef.current
        ? await importCryptoKey(e2eKeyBytesRef.current, ["encrypt"])
        : null;

      // Pause track to prevent unencrypted frames during produce() -> transform window
      const wasVideoEnabled = videoTrack.enabled;
      videoTrack.enabled = false;

      let videoProducer;
      try {
        videoProducer = await sendTransportRef.current.produce({
          track: videoTrack,
          encodings: [{ maxBitrate: quality.bitrate }],
          codecOptions: { videoGoogleStartBitrate: 1000 },
          appData: { source: MEDIA_SOURCES.SCREEN },
        });
      } catch (produceErr) {
        videoTrack.removeEventListener("ended", onTrackEnded);
        videoTrack.enabled = wasVideoEnabled;
        console.error(
          "[screen] produce() threw:",
          produceErr.name,
          produceErr.message,
        );
        if (produceErr.name === "InvalidStateError") {
          console.error(
            "[screen] Track state at failure:",
            videoTrack?.readyState,
          );
          stream.getTracks().forEach((t) => t.stop());
          return null;
        }
        throw produceErr;
      }

      console.log("[screen] produce() succeeded:", {
        producerId: videoProducer.id,
        trackState: videoProducer.track?.readyState,
      });

      videoTrack.removeEventListener("ended", onTrackEnded);
      producersRef.current.set(videoProducer.id, videoProducer);
      applyEncryptionTransform(
        videoProducer.rtpSender,
        e2eKeyBytesRef.current,
        "video",
        encryptKey,
      );

      // Re-enable track after transform is applied
      videoTrack.enabled = wasVideoEnabled;

      // When user clicks "Stop sharing" in browser UI
      videoTrack.addEventListener("ended", () => {
        stopProducer(videoProducer.id);
        if (audioTrack) {
          const audioProducerId = Array.from(
            producersRef.current.entries(),
          ).find(
            ([, p]) => p.appData.source === MEDIA_SOURCES.SCREEN_AUDIO,
          )?.[0];
          if (audioProducerId) stopProducer(audioProducerId);
        }
      });

      // Produce system audio if available (best-effort — don't tear down video on failure)
      console.log("[screen] Audio track status:", {
        exists: !!audioTrack,
        readyState: audioTrack?.readyState,
        label: audioTrack?.label,
      });
      if (audioTrack && audioTrack.readyState === "live") {
        try {
          // Pre-import E2E key to avoid race condition with produce()
          const encryptKey = e2eKeyBytesRef.current
            ? await importCryptoKey(e2eKeyBytesRef.current, ["encrypt"])
            : null;

          // Pause track to prevent unencrypted frames during produce() -> transform window
          const wasAudioEnabled = audioTrack.enabled;
          audioTrack.enabled = false;

          const audioProducer = await sendTransportRef.current.produce({
            track: audioTrack,
            appData: { source: MEDIA_SOURCES.SCREEN_AUDIO },
          });
          producersRef.current.set(audioProducer.id, audioProducer);

          applyEncryptionTransform(
            audioProducer.rtpSender,
            e2eKeyBytesRef.current,
            "audio",
            encryptKey,
          );

          // Re-enable track after transform is applied
          audioTrack.enabled = wasAudioEnabled;

          console.log("[screen] Audio producer created:", audioProducer.id);
        } catch (audioErr) {
          console.warn(
            "[screen] Audio produce failed (non-fatal):",
            audioErr.message,
          );
        }
      } else {
        console.log("[screen] No audio track to produce");
      }

      scheduleProducersUpdate();
      return { videoProducer, stream };
    },
    [scheduleProducersUpdate],
  );

  // ─── Switch Screen/Window On The Fly ────────────────
  const switchScreenSource = useCallback(async (qualityKey) => {
    const quality = QUALITY_PRESETS[qualityKey || DEFAULT_QUALITY];

    const screenEntry = Array.from(producersRef.current.entries()).find(
      ([, p]) => p.appData.source === MEDIA_SOURCES.SCREEN,
    );

    if (!screenEntry) throw new Error("No active screen share");
    const [producerId, producer] = screenEntry;

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: "always",
        frameRate: { ideal: quality.frameRate },
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const newTrack = stream.getVideoTracks()[0];

    // Apply constraints for "lite" preset
    if (quality.width && quality.height) {
      try {
        await newTrack.applyConstraints({
          width: { ideal: quality.width },
          height: { ideal: quality.height },
          frameRate: { ideal: quality.frameRate },
        });
      } catch (err) {
        console.warn("[screen] Could not apply track constraints:", err);
      }
    }

    await producer.replaceTrack({ track: newTrack });

    await socketRequest("updateProducerAppData", {
      producerId,
      appData: { source: MEDIA_SOURCES.SCREEN, switchedAt: Date.now() },
    });

    newTrack.addEventListener("ended", () => {
      stopProducer(producerId);
    });

    return stream;
  }, []);

  // ─── Change Quality On The Fly ──────────────────────
  const changeQuality = useCallback(async (qualityKey) => {
    const quality = QUALITY_PRESETS[qualityKey];
    if (!quality) return;

    const screenEntry = Array.from(producersRef.current.entries()).find(
      ([, p]) => p.appData.source === MEDIA_SOURCES.SCREEN,
    );

    if (!screenEntry) return;
    const [, producer] = screenEntry;

    // Apply track constraints (resolution/framerate)
    const track = producer.track;
    if (track && track.readyState === "live") {
      try {
        if (quality.width && quality.height) {
          await track.applyConstraints({
            width: { ideal: quality.width },
            height: { ideal: quality.height },
            frameRate: { ideal: quality.frameRate },
          });
        } else {
          // Source: remove resolution constraints, set 60fps
          await track.applyConstraints({
            frameRate: { ideal: quality.frameRate },
          });
        }
      } catch (err) {
        console.warn("[quality] Could not apply track constraints:", err);
      }
    }

    // Update encoding bitrate
    await producer.setMaxSpatialLayer(0);
    const params = producer.rtpSender?.getParameters();
    if (params?.encodings?.[0]) {
      params.encodings[0].maxBitrate = quality.bitrate;
      await producer.rtpSender.setParameters(params);
    }

    console.log(`[quality] Switched to ${qualityKey}`);
  }, []);

  // ─── Webcam ─────────────────────────────────────────
  const startWebcam = useCallback(
    async (deviceId = null) => {
      if (!sendTransportRef.current) throw new Error("Transport not ready");

      const videoConstraints = { width: 640, height: 480, frameRate: 30 };
      if (deviceId) videoConstraints.deviceId = { exact: deviceId };

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
      });

      const track = stream.getVideoTracks()[0];

      // Pre-import E2E key to avoid race condition with produce()
      const encryptKey = e2eKeyBytesRef.current
        ? await importCryptoKey(e2eKeyBytesRef.current, ["encrypt"])
        : null;

      // Pause track to prevent unencrypted frames during produce() -> transform window
      const wasTrackEnabled = track.enabled;
      track.enabled = false;

      const producer = await sendTransportRef.current.produce({
        track,
        encodings: [{ maxBitrate: 500000 }],
        appData: { source: MEDIA_SOURCES.WEBCAM },
      });

      producersRef.current.set(producer.id, producer);
      applyEncryptionTransform(
        producer.rtpSender,
        e2eKeyBytesRef.current,
        "video",
        encryptKey,
      );

      // Re-enable track after transform is applied
      track.enabled = wasTrackEnabled;
      scheduleProducersUpdate();

      return producer;
    },
    [scheduleProducersUpdate],
  );

  // ─── Microphone ─────────────────────────────────────
  const startMic = useCallback(
    async (deviceId = null) => {
      if (!sendTransportRef.current) throw new Error("Transport not ready");

      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      if (deviceId) audioConstraints.deviceId = { exact: deviceId };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);

      // Try to use AudioWorklet (preferred — runs in audio thread)
      const hasWorklet = typeof audioContext.audioWorklet !== "undefined";
      let destination;
      let workletNode = null;
      let legacyMonitorInterval = null;

      if (hasWorklet) {
        try {
          // Load noise gate worklet
          await audioContext.audioWorklet.addModule(
            new URL("./noiseGateWorklet.js", import.meta.url),
          );

          workletNode = new AudioWorkletNode(
            audioContext,
            "noise-gate-processor",
          );
          destination = audioContext.createMediaStreamDestination();

          // Connect: Source → NoiseGate → Destination
          source.connect(workletNode);
          workletNode.connect(destination);

          // Receive level updates from worklet
          workletNode.port.onmessage = (event) => {
            const { type, level } = event.data;
            if (type === "level") {
              setMicLevel(level);
            }
          };

          // Send initial parameters to worklet
          workletNode.port.postMessage({
            type: "updateParams",
            enabled: noiseGateEnabledRef.current,
            threshold: noiseGateThresholdRef.current,
          });

          console.log("[noise-gate] Using AudioWorklet (runs in audio thread)");
        } catch (err) {
          console.warn(
            "[noise-gate] AudioWorklet failed, falling back to main thread:",
            err,
          );
          workletNode = null;
        }
      }

      // Fallback: Use old approach with setInterval (main thread)
      if (!workletNode) {
        const analyser = audioContext.createAnalyser();
        const gainNode = audioContext.createGain();
        destination = audioContext.createMediaStreamDestination();

        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.3;

        source.connect(analyser);
        analyser.connect(gainNode);
        gainNode.connect(destination);

        // Noise gate monitoring loop (20ms interval)
        const dataArray = new Float32Array(analyser.fftSize);
        let gateOpen = false;
        let holdTimer = null;
        let tickCount = 0;

        legacyMonitorInterval = setInterval(() => {
          analyser.getFloatTimeDomainData(dataArray);

          // Calculate RMS
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i];
          }
          const rms = Math.sqrt(sum / dataArray.length);
          const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

          // Update mic level for UI meter (every 3rd tick = ~60ms)
          tickCount++;
          if (tickCount % 3 === 0) {
            const normalized = Math.max(
              0,
              Math.min(100, ((rmsDb + 60) / 60) * 100),
            );
            setMicLevel(Math.round(normalized));
          }

          // Gate logic
          const enabled = noiseGateEnabledRef.current;
          const threshold = noiseGateThresholdRef.current;

          if (!enabled) {
            if (!gateOpen) {
              gainNode.gain.setTargetAtTime(1, audioContext.currentTime, 0.01);
              gateOpen = true;
            }
            if (holdTimer) {
              clearTimeout(holdTimer);
              holdTimer = null;
            }
            return;
          }

          if (rmsDb > threshold) {
            if (!gateOpen) {
              gainNode.gain.setTargetAtTime(1, audioContext.currentTime, 0.01);
              gateOpen = true;
            }
            if (holdTimer) {
              clearTimeout(holdTimer);
              holdTimer = null;
            }
          } else if (gateOpen && !holdTimer) {
            holdTimer = setTimeout(() => {
              gainNode.gain.setTargetAtTime(0, audioContext.currentTime, 0.05);
              gateOpen = false;
              holdTimer = null;
            }, 150);
          }
        }, 20);

        console.log("[noise-gate] Using legacy main thread implementation");

        micPipelineRef.current = {
          audioContext,
          source,
          analyser,
          gainNode,
          destination,
          monitorInterval: legacyMonitorInterval,
          rawStream: stream,
        };
      } else {
        // AudioWorklet path
        micPipelineRef.current = {
          audioContext,
          source,
          workletNode,
          destination,
          rawStream: stream,
        };
      }

      // Send the processed stream to mediasoup (not the raw mic stream)
      const processedTrack = destination.stream.getAudioTracks()[0];

      // Pre-import E2E key to avoid race condition with produce()
      const encryptKey = e2eKeyBytesRef.current
        ? await importCryptoKey(e2eKeyBytesRef.current, ["encrypt"])
        : null;

      // Pause track to prevent unencrypted frames during produce() -> transform window
      const wasTrackEnabled = processedTrack.enabled;
      processedTrack.enabled = false;

      const producer = await sendTransportRef.current.produce({
        track: processedTrack,
        appData: { source: MEDIA_SOURCES.MIC },
      });

      producersRef.current.set(producer.id, producer);
      applyEncryptionTransform(
        producer.rtpSender,
        e2eKeyBytesRef.current,
        "audio",
        encryptKey,
      );

      // Re-enable track after transform is applied
      processedTrack.enabled = wasTrackEnabled;
      scheduleProducersUpdate();

      return producer;
    },
    [scheduleProducersUpdate],
  );

  // ─── Stop Producer ──────────────────────────────────
  const stopProducer = useCallback(
    async (producerId) => {
      const producer = producersRef.current.get(producerId);
      if (!producer) return;

      // Clean up mic audio pipeline when stopping mic producer
      if (producer.appData?.source === MEDIA_SOURCES.MIC) {
        cleanupMicPipeline();
      }

      producer.close();
      producersRef.current.delete(producerId);
      scheduleProducersUpdate();

      try {
        await socketRequest("closeProducer", { producerId });
      } catch {
        // Server might already know
      }
    },
    [cleanupMicPipeline, scheduleProducersUpdate],
  );

  // ─── Consume a remote producer ──────────────────────
  const consumeProducer = useCallback(
    async (producerId, producerPeerId) => {
      if (!recvTransportRef.current || !deviceRef.current) return;

      try {
        const response = await socketRequest("consume", {
          producerId,
          rtpCapabilities: deviceRef.current.rtpCapabilities,
        });

        const consumer = await recvTransportRef.current.consume({
          id: response.consumerId,
          producerId: response.producerId,
          kind: response.kind,
          rtpParameters: response.rtpParameters,
        });

        // Resume consumer (was created paused on server)
        await socketRequest("resumeConsumer", { consumerId: consumer.id });
        await applyDecryptionTransform(
          consumer.rtpReceiver,
          e2eKeyBytesRef.current,
          response.kind,
        );

        console.log(`[mediasoup] Consumer ${consumer.id} ready:`, {
          kind: response.kind,
          trackState: consumer.track?.readyState,
          paused: consumer.paused,
          source: response.appData?.source,
        });

        consumersRef.current.set(consumer.id, {
          consumer,
          peerId: producerPeerId || null,
          kind: response.kind,
          appData: response.appData,
        });

        scheduleConsumersUpdate();

        return consumer;
      } catch (err) {
        console.error("[mediasoup] Consume error:", err);
      }
    },
    [scheduleConsumersUpdate],
  );

  // ─── Socket event listeners ─────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleNewProducer = ({ producerId, peerId, kind, appData }) => {
      console.log(
        `[mediasoup] New producer from ${peerId}: ${kind} (${appData?.source})`,
      );

      if (isScreenShareSource(appData?.source)) {
        availableScreensRef.current.set(producerId, {
          producerId,
          peerId,
          kind,
          appData,
        });
        scheduleScreensUpdate();

        // Auto-consume screen-audio if user is already watching this peer's screen
        if (appData?.source === MEDIA_SOURCES.SCREEN_AUDIO) {
          for (const [videoId, info] of availableScreensRef.current.entries()) {
            if (
              info.peerId === peerId &&
              info.appData?.source === MEDIA_SOURCES.SCREEN &&
              watchedScreensRef.current.has(videoId)
            ) {
              consumeProducer(producerId, peerId);
              break;
            }
          }
        }
      } else {
        consumeProducer(producerId, peerId);
      }
    };

    const handleProducerClosed = ({ producerId }) => {
      if (availableScreensRef.current.has(producerId)) {
        availableScreensRef.current.delete(producerId);
      }
      if (watchedScreensRef.current.has(producerId)) {
        watchedScreensRef.current.delete(producerId);
      }
      scheduleScreensUpdate();

      for (const [consumerId, data] of consumersRef.current.entries()) {
        if (data.consumer.producerId === producerId) {
          data.consumer.close();
          consumersRef.current.delete(consumerId);
        }
      }
      scheduleConsumersUpdate();
    };

    const handleConsumerClosed = ({ consumerId }) => {
      const data = consumersRef.current.get(consumerId);
      if (data) {
        data.consumer.close();
        consumersRef.current.delete(consumerId);
        scheduleConsumersUpdate();
      }
    };

    const handlePeerJoined = ({ peerId, displayName }) => {
      console.log(`[room] ${displayName} joined`);
      setPeers((prev) => [...prev, { id: peerId, displayName }]);
    };

    const handlePeerLeft = ({ peerId, displayName }) => {
      console.log(`[room] ${displayName} left`);
      setPeers((prev) => prev.filter((p) => p.id !== peerId));

      // Clean up their available/watched screens
      for (const [producerId, info] of availableScreensRef.current.entries()) {
        if (info.peerId === peerId) {
          availableScreensRef.current.delete(producerId);
          watchedScreensRef.current.delete(producerId);
        }
      }
      scheduleScreensUpdate();

      // Clean up their consumers
      for (const [consumerId, data] of consumersRef.current.entries()) {
        if (data.peerId === peerId) {
          data.consumer.close();
          consumersRef.current.delete(consumerId);
        }
      }
      scheduleConsumersUpdate();
    };

    socket.on("newProducer", handleNewProducer);
    socket.on("producerClosed", handleProducerClosed);
    socket.on("consumerClosed", handleConsumerClosed);
    socket.on("peerJoined", handlePeerJoined);
    socket.on("peerLeft", handlePeerLeft);

    return () => {
      socket.off("newProducer", handleNewProducer);
      socket.off("producerClosed", handleProducerClosed);
      socket.off("consumerClosed", handleConsumerClosed);
      socket.off("peerJoined", handlePeerJoined);
      socket.off("peerLeft", handlePeerLeft);
    };
  }, [
    consumeProducer,
    isReady,
    scheduleConsumersUpdate,
    scheduleScreensUpdate,
  ]);

  // ─── Adaptive Quality: Monitor Frame Drops ──────────
  useEffect(() => {
    // Only monitor when E2E encryption is active (CPU-intensive)
    if (!isE2EActive || !isReady) return;

    // Find active screen producer
    const screenEntry = Array.from(producersRef.current.entries()).find(
      ([, p]) => p.appData?.source === MEDIA_SOURCES.SCREEN,
    );

    if (!screenEntry) return;

    const [, producer] = screenEntry;
    const sender = producer.rtpSender;
    if (!sender) return;

    console.log("[adaptive] Starting frame drop monitoring for screen share");
    currentQualityRef.current = DEFAULT_QUALITY;
    qualityDowngradedRef.current = false;

    const stopMonitoring = monitorFrameDrops(sender, {
      threshold: 0.05, // 5% drop rate
      intervalMs: 5000,
      onHighDropRate: async ({ dropRate }) => {
        // Downgrade quality if still on source preset
        if (
          !qualityDowngradedRef.current &&
          currentQualityRef.current === "source"
        ) {
          console.warn(
            `[adaptive] High frame drop rate (${(dropRate * 100).toFixed(1)}%) - downgrading to lite quality`,
          );
          qualityDowngradedRef.current = true;
          currentQualityRef.current = "lite";
          await changeQuality("lite");
        }
      },
    });

    frameDropMonitorRef.current = stopMonitoring;

    return () => {
      if (frameDropMonitorRef.current) {
        frameDropMonitorRef.current();
        frameDropMonitorRef.current = null;
      }
    };
  }, [isE2EActive, isReady, producers, changeQuality]);

  // ─── Cleanup on unmount ─────────────────────────────
  useEffect(() => {
    return () => {
      cleanupMicPipeline();
      if (frameDropMonitorRef.current) {
        frameDropMonitorRef.current();
      }
      for (const producer of producersRef.current.values()) {
        producer.close();
      }
      for (const { consumer } of consumersRef.current.values()) {
        consumer.close();
      }
      sendTransportRef.current?.close();
      recvTransportRef.current?.close();
      terminateE2EWorker();
    };
  }, []);

  // ─── Click-to-Watch Functions ──────────────────────
  const addAvailableScreen = useCallback(
    (producerId, peerId, kind, appData) => {
      availableScreensRef.current.set(producerId, {
        producerId,
        peerId,
        kind,
        appData,
      });
      scheduleScreensUpdate();
    },
    [scheduleScreensUpdate],
  );

  const watchScreen = useCallback(
    async (producerId) => {
      const screenInfo = availableScreensRef.current.get(producerId);
      if (!screenInfo || screenInfo.appData?.source !== MEDIA_SOURCES.SCREEN)
        return;

      const { peerId } = screenInfo;

      await consumeProducer(producerId, peerId);

      // Consume paired screen-audio from the same peer
      for (const [audioId, info] of availableScreensRef.current.entries()) {
        if (
          info.peerId === peerId &&
          info.appData?.source === MEDIA_SOURCES.SCREEN_AUDIO
        ) {
          await consumeProducer(audioId, peerId);
          break;
        }
      }

      watchedScreensRef.current.add(producerId);
      scheduleScreensUpdate();
    },
    [consumeProducer, scheduleScreensUpdate],
  );

  const unwatchScreen = useCallback(
    (producerId) => {
      const screenInfo = availableScreensRef.current.get(producerId);
      if (!screenInfo) return;

      const { peerId } = screenInfo;

      // Close screen video consumer
      for (const [consumerId, data] of consumersRef.current.entries()) {
        if (data.consumer.producerId === producerId) {
          data.consumer.close();
          consumersRef.current.delete(consumerId);
        }
      }

      // Close paired screen-audio consumer from same peer
      for (const [consumerId, data] of consumersRef.current.entries()) {
        if (
          data.peerId === peerId &&
          data.appData?.source === MEDIA_SOURCES.SCREEN_AUDIO
        ) {
          data.consumer.close();
          consumersRef.current.delete(consumerId);
        }
      }

      scheduleConsumersUpdate();
      watchedScreensRef.current.delete(producerId);
      scheduleScreensUpdate();
    },
    [scheduleConsumersUpdate, scheduleScreensUpdate],
  );

  return {
    isReady,
    error,
    producers,
    consumers,
    peers,
    initDevice,
    captureScreen,
    produceScreen,
    switchScreenSource,
    changeQuality,
    startWebcam,
    startMic,
    stopProducer,
    consumeProducer,
    setPeers,
    sendTransport: sendTransportRef.current,
    // Click-to-watch
    availableScreens,
    watchedScreens,
    addAvailableScreen,
    watchScreen,
    unwatchScreen,
    // E2E encryption
    setE2EKey,
    isE2EActive,
    // Noise gate
    noiseGateEnabled,
    noiseGateThreshold,
    micLevel,
    setNoiseGateEnabled: updateNoiseGateEnabled,
    setNoiseGateThreshold: updateNoiseGateThreshold,
  };
}
