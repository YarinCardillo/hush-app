import { useState, useRef, useCallback, useEffect } from 'react';
import { Device } from 'mediasoup-client';
import { getSocket, socketRequest } from '../lib/socket';
import { QUALITY_PRESETS, DEFAULT_QUALITY, MEDIA_SOURCES } from '../utils/constants';

export function useMediasoup() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);
  const [producers, setProducers] = useState(new Map()); // our outgoing streams
  const [consumers, setConsumers] = useState(new Map()); // incoming streams from others
  const [peers, setPeers] = useState([]);

  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const producersRef = useRef(new Map());
  const consumersRef = useRef(new Map());

  // ─── Initialize Device ──────────────────────────────
  const initDevice = useCallback(async () => {
    try {
      const { rtpCapabilities } = await socketRequest('getRouterRtpCapabilities');

      const device = new Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities });
      deviceRef.current = device;

      // Create send transport
      const sendData = await socketRequest('createWebRtcTransport', { direction: 'send' });
      const sendTransport = device.createSendTransport(sendData.params);

      sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await socketRequest('connectTransport', {
            transportId: sendTransport.id,
            dtlsParameters,
          });
          callback();
        } catch (err) {
          errback(err);
        }
      });

      sendTransport.on('connectionstatechange', (state) => {
        console.log(`[mediasoup] Send transport state: ${state}`);
        if (state === 'failed') {
          console.error('[mediasoup] Send transport ICE failed — check firewall (ports 40000-40100 UDP/TCP)');
          setError('Media upload failed: cannot reach server media ports.');
        }
      });

      sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
        try {
          const { producerId } = await socketRequest('produce', {
            transportId: sendTransport.id,
            kind,
            rtpParameters,
            appData,
          });
          callback({ id: producerId });
        } catch (err) {
          errback(err);
        }
      });

      sendTransportRef.current = sendTransport;

      // Create receive transport
      const recvData = await socketRequest('createWebRtcTransport', { direction: 'recv' });
      const recvTransport = device.createRecvTransport(recvData.params);

      recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await socketRequest('connectTransport', {
            transportId: recvTransport.id,
            dtlsParameters,
          });
          callback();
        } catch (err) {
          errback(err);
        }
      });

      recvTransport.on('connectionstatechange', (state) => {
        console.log(`[mediasoup] Recv transport state: ${state}`);
        if (state === 'failed') {
          console.error('[mediasoup] Recv transport ICE failed — check firewall (ports 40000-40100 UDP/TCP)');
          setError('Media download failed: cannot reach server media ports.');
        }
      });

      recvTransportRef.current = recvTransport;

      setIsReady(true);
      console.log('[mediasoup] Device initialized');
    } catch (err) {
      console.error('[mediasoup] Init error:', err);
      setError(err.message);
    }
  }, []);

  // ─── Share Screen ───────────────────────────────────
  const startScreenShare = useCallback(async (qualityKey = DEFAULT_QUALITY) => {
    if (!sendTransportRef.current) throw new Error('Transport not ready');

    const quality = QUALITY_PRESETS[qualityKey];

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: quality.width },
          height: { ideal: quality.height },
          frameRate: { ideal: quality.frameRate },
          cursor: 'always',
        },
        audio: true, // Request system audio
      });

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0]; // May be null

      // Produce video
      const videoProducer = await sendTransportRef.current.produce({
        track: videoTrack,
        encodings: [
          { maxBitrate: quality.bitrate },
        ],
        codecOptions: {
          videoGoogleStartBitrate: 1000,
        },
        appData: { source: MEDIA_SOURCES.SCREEN },
      });

      producersRef.current.set(videoProducer.id, videoProducer);

      // When user clicks "Stop sharing" in browser UI
      videoTrack.addEventListener('ended', () => {
        stopProducer(videoProducer.id);
        if (audioTrack) {
          const audioProducerId = Array.from(producersRef.current.entries())
            .find(([, p]) => p.appData.source === MEDIA_SOURCES.SCREEN_AUDIO)?.[0];
          if (audioProducerId) stopProducer(audioProducerId);
        }
      });

      // Produce system audio if available
      if (audioTrack) {
        const audioProducer = await sendTransportRef.current.produce({
          track: audioTrack,
          appData: { source: MEDIA_SOURCES.SCREEN_AUDIO },
        });
        producersRef.current.set(audioProducer.id, audioProducer);
      }

      setProducers(new Map(producersRef.current));

      return { videoProducer, stream };
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        // User cancelled the screen picker
        return null;
      }
      throw err;
    }
  }, []);

  // ─── Switch Screen/Window On The Fly ────────────────
  const switchScreenSource = useCallback(async (qualityKey) => {
    const quality = QUALITY_PRESETS[qualityKey || DEFAULT_QUALITY];

    // Find current screen producer
    const screenEntry = Array.from(producersRef.current.entries())
      .find(([, p]) => p.appData.source === MEDIA_SOURCES.SCREEN);

    if (!screenEntry) throw new Error('No active screen share');

    const [producerId, producer] = screenEntry;

    // Get new screen/window
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: quality.width },
        height: { ideal: quality.height },
        frameRate: { ideal: quality.frameRate },
      },
      audio: true,
    });

    const newTrack = stream.getVideoTracks()[0];

    // Replace track without closing the producer
    await producer.replaceTrack({ track: newTrack });

    // Notify server about the change
    await socketRequest('updateProducerAppData', {
      producerId,
      appData: { source: MEDIA_SOURCES.SCREEN, switchedAt: Date.now() },
    });

    newTrack.addEventListener('ended', () => {
      stopProducer(producerId);
    });

    return stream;
  }, []);

  // ─── Change Quality On The Fly ──────────────────────
  const changeQuality = useCallback(async (qualityKey) => {
    const quality = QUALITY_PRESETS[qualityKey];
    if (!quality) return;

    const screenEntry = Array.from(producersRef.current.entries())
      .find(([, p]) => p.appData.source === MEDIA_SOURCES.SCREEN);

    if (!screenEntry) return;
    const [, producer] = screenEntry;

    // Update encoding parameters live
    await producer.setMaxSpatialLayer(0);
    const params = producer.rtpSender?.getParameters();
    if (params?.encodings?.[0]) {
      params.encodings[0].maxBitrate = quality.bitrate;
      await producer.rtpSender.setParameters(params);
    }

    console.log(`[quality] Switched to ${qualityKey}`);
  }, []);

  // ─── Webcam ─────────────────────────────────────────
  const startWebcam = useCallback(async () => {
    if (!sendTransportRef.current) throw new Error('Transport not ready');

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, frameRate: 30 },
    });

    const track = stream.getVideoTracks()[0];

    const producer = await sendTransportRef.current.produce({
      track,
      encodings: [{ maxBitrate: 500000 }],
      appData: { source: MEDIA_SOURCES.WEBCAM },
    });

    producersRef.current.set(producer.id, producer);
    setProducers(new Map(producersRef.current));

    return producer;
  }, []);

  // ─── Microphone ─────────────────────────────────────
  const startMic = useCallback(async () => {
    if (!sendTransportRef.current) throw new Error('Transport not ready');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const track = stream.getAudioTracks()[0];

    const producer = await sendTransportRef.current.produce({
      track,
      appData: { source: MEDIA_SOURCES.MIC },
    });

    producersRef.current.set(producer.id, producer);
    setProducers(new Map(producersRef.current));

    return producer;
  }, []);

  // ─── Stop Producer ──────────────────────────────────
  const stopProducer = useCallback(async (producerId) => {
    const producer = producersRef.current.get(producerId);
    if (!producer) return;

    producer.close();
    producersRef.current.delete(producerId);
    setProducers(new Map(producersRef.current));

    try {
      await socketRequest('closeProducer', { producerId });
    } catch {
      // Server might already know
    }
  }, []);

  // ─── Consume a remote producer ──────────────────────
  const consumeProducer = useCallback(async (producerId) => {
    if (!recvTransportRef.current || !deviceRef.current) return;

    try {
      const response = await socketRequest('consume', {
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
      await socketRequest('resumeConsumer', { consumerId: consumer.id });

      console.log(`[mediasoup] Consumer ${consumer.id} ready:`, {
        kind: response.kind,
        trackState: consumer.track?.readyState,
        paused: consumer.paused,
        source: response.appData?.source,
      });

      consumersRef.current.set(consumer.id, {
        consumer,
        peerId: null, // Will be matched by producerId
        kind: response.kind,
        appData: response.appData,
      });

      setConsumers(new Map(consumersRef.current));

      return consumer;
    } catch (err) {
      console.error('[mediasoup] Consume error:', err);
    }
  }, []);

  // ─── Socket event listeners ─────────────────────────
  // Depends on isReady so this re-runs after initDevice() completes,
  // which guarantees the socket exists (initDevice is called from the
  // socket's connect handler in Room.jsx).
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleNewProducer = ({ producerId, peerId, kind, appData }) => {
      console.log(`[mediasoup] New producer from ${peerId}: ${kind} (${appData?.source})`);
      consumeProducer(producerId);
    };

    const handleProducerClosed = ({ producerId, peerId }) => {
      // Find and close matching consumer
      for (const [consumerId, data] of consumersRef.current.entries()) {
        if (data.consumer.producerId === producerId) {
          data.consumer.close();
          consumersRef.current.delete(consumerId);
        }
      }
      setConsumers(new Map(consumersRef.current));
    };

    const handleConsumerClosed = ({ consumerId }) => {
      const data = consumersRef.current.get(consumerId);
      if (data) {
        data.consumer.close();
        consumersRef.current.delete(consumerId);
        setConsumers(new Map(consumersRef.current));
      }
    };

    const handlePeerJoined = ({ peerId, displayName }) => {
      console.log(`[room] ${displayName} joined`);
      setPeers((prev) => [...prev, { id: peerId, displayName }]);
    };

    const handlePeerLeft = ({ peerId, displayName }) => {
      console.log(`[room] ${displayName} left`);
      setPeers((prev) => prev.filter((p) => p.id !== peerId));

      // Clean up their consumers
      for (const [consumerId, data] of consumersRef.current.entries()) {
        if (data.peerId === peerId) {
          data.consumer.close();
          consumersRef.current.delete(consumerId);
        }
      }
      setConsumers(new Map(consumersRef.current));
    };

    socket.on('newProducer', handleNewProducer);
    socket.on('producerClosed', handleProducerClosed);
    socket.on('consumerClosed', handleConsumerClosed);
    socket.on('peerJoined', handlePeerJoined);
    socket.on('peerLeft', handlePeerLeft);

    return () => {
      socket.off('newProducer', handleNewProducer);
      socket.off('producerClosed', handleProducerClosed);
      socket.off('consumerClosed', handleConsumerClosed);
      socket.off('peerJoined', handlePeerJoined);
      socket.off('peerLeft', handlePeerLeft);
    };
  }, [consumeProducer, isReady]);

  // ─── Cleanup on unmount ─────────────────────────────
  useEffect(() => {
    return () => {
      for (const producer of producersRef.current.values()) {
        producer.close();
      }
      for (const { consumer } of consumersRef.current.values()) {
        consumer.close();
      }
      sendTransportRef.current?.close();
      recvTransportRef.current?.close();
    };
  }, []);

  return {
    isReady,
    error,
    producers,
    consumers,
    peers,
    initDevice,
    startScreenShare,
    switchScreenSource,
    changeQuality,
    startWebcam,
    startMic,
    stopProducer,
    consumeProducer,
    setPeers,
    sendTransport: sendTransportRef.current,
  };
}
