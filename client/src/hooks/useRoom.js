import { useState, useRef, useCallback, useEffect } from 'react';
import { Room, RoomEvent, Track, ExternalE2EEKeyProvider } from 'livekit-client';
import { getMatrixClient } from '../lib/matrixClient';

// Import E2EE worker for LiveKit encryption
// @ts-ignore - Vite will resolve this URL correctly
import E2EEWorker from 'livekit-client/e2ee-worker?worker';
import {
  getPlaceholderKey,
  setupToDeviceListener,
  handleParticipantConnected as e2eeOnParticipantConnected,
  handleParticipantDisconnected as e2eeOnParticipantDisconnected,
  setCreatorKey,
} from '../lib/e2eeKeyManager';
import {
  attachRemoteTrackListeners,
  publishScreen as trackPublishScreen,
  unpublishScreen as trackUnpublishScreen,
  switchScreenSource as trackSwitchScreenSource,
  changeQuality as trackChangeQuality,
  publishWebcam as trackPublishWebcam,
  unpublishWebcam as trackUnpublishWebcam,
  publishMic as trackPublishMic,
  unpublishMic as trackUnpublishMic,
  watchScreen as trackWatchScreen,
  unwatchScreen as trackUnwatchScreen,
} from '../lib/trackManager';
import { DEFAULT_QUALITY } from '../utils/constants';

/**
 * LiveKit-based room connection hook.
 * Replaces mediasoup-based useMediasoup hook with LiveKit SFU.
 *
 * @returns {Object} Room state and media controls
 */
export function useRoom() {
  // ─── Connection State ─────────────────────────────────
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);
  const [localTracks, setLocalTracks] = useState(new Map());
  const [remoteTracks, setRemoteTracks] = useState(new Map());
  const [participants, setParticipants] = useState([]);
  const [isE2EEEnabled, setIsE2EEEnabled] = useState(false);
  const [e2eeKey, setE2eeKey] = useState(null);
  const [mediaE2EEUnavailable, setMediaE2EEUnavailable] = useState(false);
  const [keyExchangeMessage, setKeyExchangeMessage] = useState(null);

  // ─── Click-to-Watch Screen Shares ─────────────────────
  const [availableScreens, setAvailableScreens] = useState(new Map());
  const [watchedScreens, setWatchedScreens] = useState(new Set());
  const [loadingScreens, setLoadingScreens] = useState(new Set());

  // ─── Refs ─────────────────────────────────────────────
  const roomRef = useRef(null);
  const localTracksRef = useRef(new Map());
  const remoteTracksRef = useRef(new Map());
  const availableScreensRef = useRef(new Map());
  const watchedScreensRef = useRef(new Set());
  const loadingScreensRef = useRef(new Set());
  const e2eeKeyProviderRef = useRef(null);
  const keyBytesRef = useRef(null);
  const keyRotationCounterRef = useRef(0);
  const roomNameRef = useRef(null);
  const matrixRoomIdRef = useRef(null);
  const currentKeyIndexRef = useRef(0);
  const toDeviceUnsubscribeRef = useRef(null);
  const connectionEpochRef = useRef(0);

  // ─── Noise Gate Refs ──────────────────────────────────
  const audioContextRef = useRef(null);
  const noiseGateNodeRef = useRef(null);
  const rawMicStreamRef = useRef(null);

  // ─── Debounced State Updates ──────────────────────────
  const pendingLocalTracksUpdateRef = useRef(false);
  const pendingRemoteTracksUpdateRef = useRef(false);
  const pendingScreensUpdateRef = useRef(false);

  const scheduleLocalTracksUpdate = useCallback(() => {
    if (pendingLocalTracksUpdateRef.current) return;
    pendingLocalTracksUpdateRef.current = true;
    requestAnimationFrame(() => {
      setLocalTracks(new Map(localTracksRef.current));
      pendingLocalTracksUpdateRef.current = false;
    });
  }, []);

  const scheduleRemoteTracksUpdate = useCallback(() => {
    if (pendingRemoteTracksUpdateRef.current) return;
    pendingRemoteTracksUpdateRef.current = true;
    requestAnimationFrame(() => {
      setRemoteTracks(new Map(remoteTracksRef.current));
      pendingRemoteTracksUpdateRef.current = false;
    });
  }, []);

  const scheduleScreensUpdate = useCallback(() => {
    if (pendingScreensUpdateRef.current) return;
    pendingScreensUpdateRef.current = true;
    requestAnimationFrame(() => {
      setAvailableScreens(new Map(availableScreensRef.current));
      setWatchedScreens(new Set(watchedScreensRef.current));
      setLoadingScreens(new Set(loadingScreensRef.current));
      pendingScreensUpdateRef.current = false;
    });
  }, []);

  // ─── Cleanup Mic Audio Pipeline ───────────────────────
  const cleanupMicPipeline = useCallback(() => {
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (noiseGateNodeRef.current) {
      noiseGateNodeRef.current.disconnect();
      noiseGateNodeRef.current = null;
    }
    if (rawMicStreamRef.current) {
      rawMicStreamRef.current.getTracks().forEach((t) => t.stop());
      rawMicStreamRef.current = null;
    }
  }, []);

  // ─── Connect to LiveKit Room ──────────────────────────
  const connectRoom = useCallback(
    async (roomName, displayName, matrixRoomId) => {
      const epoch = ++connectionEpochRef.current;
      const isStale = () => epoch !== connectionEpochRef.current;
      try {
        if (roomRef.current) {
          roomRef.current.disconnect();
          roomRef.current = null;
        }
        if (toDeviceUnsubscribeRef.current) {
          toDeviceUnsubscribeRef.current();
          toDeviceUnsubscribeRef.current = null;
        }
        localTracksRef.current.clear();
        remoteTracksRef.current.clear();
        availableScreensRef.current.clear();
        watchedScreensRef.current.clear();
        setLocalTracks(new Map());
        setRemoteTracks(new Map());
        setAvailableScreens(new Map());
        setWatchedScreens(new Set());
        setParticipants([]);
        setIsReady(false);
        setIsE2EEEnabled(false);
        setE2eeKey(null);
        keyBytesRef.current = null;
        keyRotationCounterRef.current = 0;
        currentKeyIndexRef.current = 0;
        roomNameRef.current = roomName;
        matrixRoomIdRef.current = matrixRoomId || null;
        setMediaE2EEUnavailable(false);

        const matrixClient = getMatrixClient();
        const accessToken = matrixClient?.getAccessToken?.();
        if (!matrixClient || !accessToken) {
          throw new Error('Matrix session required. Please sign in again.');
        }

        const response = await fetch('/api/livekit/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            roomName,
            participantName: displayName,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const msg = errorData.error || 'Failed to get LiveKit token';
          if (response.status === 401) {
            throw new Error('Session invalid. Please sign in again.');
          }
          throw new Error(msg);
        }

        const { token } = await response.json();
        if (isStale()) return;

        // ─── E2EE: keyProvider + worker; key distribution via e2eeKeyManager ───
        let keyProvider = null;
        let worker = null;

        try {
          keyProvider = new ExternalE2EEKeyProvider();
          e2eeKeyProviderRef.current = keyProvider;
          worker = new E2EEWorker();

          const e2eeRefs = {
            matrixRoomIdRef,
            e2eeKeyProviderRef,
            keyBytesRef,
            currentKeyIndexRef,
          };
          setupToDeviceListener(matrixClient, e2eeRefs, setE2eeKey, (fn) => {
            toDeviceUnsubscribeRef.current = fn;
          });
          const placeholderKey = getPlaceholderKey();
          await keyProvider.setKey(placeholderKey, 0);
          keyBytesRef.current = placeholderKey;
        } catch (e2eeErr) {
          console.error('[livekit] E2EE initialization failed:', e2eeErr);
          setMediaE2EEUnavailable(true);
          if (toDeviceUnsubscribeRef.current) {
            toDeviceUnsubscribeRef.current();
            toDeviceUnsubscribeRef.current = null;
          }
          keyProvider = null;
          worker = null;
        }

        if (!keyProvider || !worker) {
          throw new Error('Media encryption unavailable. Cannot join voice channel.');
        }
        if (isStale()) return;

        // Create LiveKit room with dynacast, adaptive streaming, and E2EE
        const roomOptions = {
          dynacast: true,
          adaptiveStream: true,
          videoCaptureDefaults: {
            resolution: {
              width: 1920,
              height: 1080,
              frameRate: 60,
            },
          },
        };

        // Add E2EE options if initialized successfully
        if (keyProvider && worker) {
          roomOptions.e2ee = {
            keyProvider,
            worker,
          };
        }

        const room = new Room(roomOptions);

        // ─── Event Listeners ──────────────────────────────

        // ParticipantConnected: update list and send E2EE key via e2eeKeyManager
        room.on(RoomEvent.ParticipantConnected, async (participant) => {
          if (isStale()) return;
          console.log(
            `[livekit] Participant connected: ${participant.identity}`,
          );
          setParticipants((prev) => [
            ...prev,
            {
              id: participant.identity,
              displayName: participant.name || participant.identity,
            },
          ]);
          const e2eeRefs = {
            matrixRoomIdRef,
            e2eeKeyProviderRef,
            keyBytesRef,
            currentKeyIndexRef,
          };
          await e2eeOnParticipantConnected(participant, matrixClient, e2eeRefs, setKeyExchangeMessage);
        });

        // ParticipantDisconnected: update list, clean tracks/screens, rekey via e2eeKeyManager
        room.on(RoomEvent.ParticipantDisconnected, async (participant) => {
          if (isStale()) return;
          console.log(
            `[livekit] Participant disconnected: ${participant.identity}`,
          );
          setParticipants((prev) =>
            prev.filter((p) => p.id !== participant.identity),
          );
          for (const [trackSid, info] of availableScreensRef.current.entries()) {
            if (info.participantId === participant.identity) {
              availableScreensRef.current.delete(trackSid);
              watchedScreensRef.current.delete(trackSid);
            }
          }
          scheduleScreensUpdate();
          for (const [trackSid, info] of remoteTracksRef.current.entries()) {
            if (info.participant.identity === participant.identity) {
              remoteTracksRef.current.delete(trackSid);
            }
          }
          scheduleRemoteTracksUpdate();
          const r = roomRef.current;
          if (r) {
            const e2eeRefs = {
              matrixRoomIdRef,
              e2eeKeyProviderRef,
              keyBytesRef,
              currentKeyIndexRef,
            };
            await e2eeOnParticipantDisconnected(participant, r, matrixClient, e2eeRefs, setE2eeKey, setKeyExchangeMessage);
          }
        });

        const trackRefs = {
          remoteTracksRef,
          availableScreensRef,
          watchedScreensRef,
        };
        attachRemoteTrackListeners(room, trackRefs, scheduleRemoteTracksUpdate, scheduleScreensUpdate);

        // Connected: set creator E2EE key only after connection is fully established,
        // so setKey does not trigger renegotiation on a not-yet-ready peer connection.
        // Connected fires synchronously during room.connect(), before roomRef is set.
        // Use the local `room` variable from the closure, not roomRef.current.
        room.on(RoomEvent.Connected, async () => {
          if (isStale()) return;
          if (!keyProvider || !matrixRoomIdRef.current) return;
          if (room.remoteParticipants.size === 0) {
            await setCreatorKey(keyProvider, { keyBytesRef, currentKeyIndexRef }, setE2eeKey);
          }
          setIsE2EEEnabled(true);
          if (keyBytesRef.current) setE2eeKey(keyBytesRef.current);
        });

        // Disconnected
        room.on(RoomEvent.Disconnected, () => {
          if (isStale()) return;
          console.log('[livekit] Disconnected from room');
          setIsReady(false);
          setError('Disconnected from room');
        });

        const livekitUrl =
          import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';
        // autoSubscribe:false so screen shares go through click-to-watch.
        // Non-screen tracks are manually subscribed in TrackPublished handler.
        await room.connect(livekitUrl, token, { autoSubscribe: false });

        // If superseded during connect (e.g. StrictMode remount), discard this room
        if (isStale()) {
          room.disconnect();
          return;
        }

        roomRef.current = room;

        if (keyProvider) {
          if (room.remoteParticipants.size > 0) {
            setIsE2EEEnabled(true);
            setE2eeKey(keyBytesRef.current);
          }
          // Creator path: E2EE key is set in RoomEvent.Connected handler
        } else {
          setIsE2EEEnabled(false);
        }

        // Populate initial participants and subscribe to their existing tracks
        const initialParticipants = [];
        for (const p of room.remoteParticipants.values()) {
          initialParticipants.push({
            id: p.identity,
            displayName: p.name || p.identity,
          });
          // With autoSubscribe:false, manually handle existing publications
          for (const [, pub] of p.trackPublications) {
            if (!pub.trackSid) continue;
            if (pub.source === Track.Source.ScreenShare && pub.kind === Track.Kind.Video) {
              // Screen share → click-to-watch
              availableScreensRef.current.set(pub.trackSid, {
                trackSid: pub.trackSid,
                participantId: p.identity,
                participantName: p.name || p.identity,
                kind: pub.kind,
                source: pub.source,
                publication: pub,
              });
            } else if (pub.source !== Track.Source.ScreenShareAudio) {
              // Webcam, mic → auto-subscribe
              pub.setSubscribed(true);
            }
          }
        }
        scheduleScreensUpdate();
        setParticipants(initialParticipants);

        setIsReady(true);
        console.log('[livekit] Connected to room:', roomName);
      } catch (err) {
        if (isStale()) return;
        console.error('[livekit] Connection error:', err);
        setError(err.message);
      }
    },
    [scheduleRemoteTracksUpdate, scheduleScreensUpdate],
  );

  // ─── Disconnect from Room ─────────────────────────────
  const disconnectRoom = useCallback(async () => {
    connectionEpochRef.current++;
    setError(null);
    setKeyExchangeMessage(null);
    if (toDeviceUnsubscribeRef.current) {
      toDeviceUnsubscribeRef.current();
      toDeviceUnsubscribeRef.current = null;
    }
    if (!roomRef.current) return;

    try {
      const localTracksMap = localTracksRef.current;
      if (localTracksMap && typeof localTracksMap.forEach === 'function') {
        localTracksMap.forEach((info) => {
          if (info?.track && typeof info.track.stop === 'function') {
            info.track.stop();
          }
        });
      }

      cleanupMicPipeline();

      roomRef.current.disconnect();
      roomRef.current = null;
      e2eeKeyProviderRef.current = null;
      keyBytesRef.current = null;
      keyRotationCounterRef.current = 0;
      currentKeyIndexRef.current = 0;
      roomNameRef.current = null;
      matrixRoomIdRef.current = null;

      localTracksRef.current.clear();
      remoteTracksRef.current.clear();
      availableScreensRef.current.clear();
      watchedScreensRef.current.clear();

      setLocalTracks(new Map());
      setRemoteTracks(new Map());
      setAvailableScreens(new Map());
      setWatchedScreens(new Set());
      setParticipants([]);
      setIsReady(false);
      setIsE2EEEnabled(false);
      setE2eeKey(null);

      console.log('[livekit] Disconnected from room');
    } catch (err) {
      console.error('[livekit] Disconnect error:', err);
    }
  }, [cleanupMicPipeline]);

  // ─── Unpublish Screen Share ───────────────────────────
  const unpublishScreen = useCallback(async () => {
    if (!roomRef.current) return;
    try {
      await trackUnpublishScreen(roomRef.current, { localTracksRef });
      scheduleLocalTracksUpdate();
    } catch (err) {
      console.error('[livekit] Unpublish screen error:', err);
    }
  }, [scheduleLocalTracksUpdate]);

  // ─── Publish Screen Share ─────────────────────────────
  const publishScreen = useCallback(
    async (qualityKey = DEFAULT_QUALITY) => {
      if (!roomRef.current) throw new Error('Room not connected');
      try {
        const stream = await trackPublishScreen(roomRef.current, { localTracksRef }, {
          qualityKey,
          onTrackEnded: unpublishScreen,
        });
        scheduleLocalTracksUpdate();
        return stream ?? null;
      } catch (err) {
        if (err.name === 'NotAllowedError') return null;
        throw err;
      }
    },
    [unpublishScreen, scheduleLocalTracksUpdate],
  );

  // ─── Switch Screen Source ─────────────────────────────
  const switchScreenSource = useCallback(
    async (qualityKey = DEFAULT_QUALITY) => {
      if (!roomRef.current) throw new Error('Room not connected');
      const result = await trackSwitchScreenSource(
        roomRef.current,
        { localTracksRef },
        qualityKey,
        unpublishScreen,
      );
      scheduleLocalTracksUpdate();
      return result;
    },
    [unpublishScreen, scheduleLocalTracksUpdate],
  );

  // ─── Change Quality ───────────────────────────────────
  const changeQuality = useCallback(
    async (qualityKey) => {
      if (!roomRef.current) return;
      await trackChangeQuality(roomRef.current, { localTracksRef }, qualityKey);
      scheduleLocalTracksUpdate();
    },
    [scheduleLocalTracksUpdate],
  );

  // ─── Publish Webcam ───────────────────────────────────
  const publishWebcam = useCallback(
    async (deviceId = null) => {
      if (!roomRef.current) throw new Error('Room not connected');
      await trackPublishWebcam(roomRef.current, { localTracksRef }, deviceId);
      scheduleLocalTracksUpdate();
    },
    [scheduleLocalTracksUpdate],
  );

  // ─── Unpublish Webcam ─────────────────────────────────
  const unpublishWebcam = useCallback(async () => {
    if (!roomRef.current) return;
    await trackUnpublishWebcam(roomRef.current, { localTracksRef });
    scheduleLocalTracksUpdate();
  }, [scheduleLocalTracksUpdate]);

  // ─── Publish Microphone ───────────────────────────────
  const publishMic = useCallback(
    async (deviceId = null) => {
      if (!roomRef.current) throw new Error('Room not connected');
      try {
        await trackPublishMic(roomRef.current, {
          localTracksRef,
          audioContextRef,
          noiseGateNodeRef,
          rawMicStreamRef,
          cleanupMicPipeline,
        }, deviceId);
        scheduleLocalTracksUpdate();
      } catch (err) {
        cleanupMicPipeline();
        throw err;
      }
    },
    [scheduleLocalTracksUpdate, cleanupMicPipeline],
  );

  // ─── Unpublish Microphone ─────────────────────────────
  const unpublishMic = useCallback(async () => {
    if (!roomRef.current) return;
    await trackUnpublishMic(roomRef.current, {
      localTracksRef,
      rawMicStreamRef,
      cleanupMicPipeline,
    });
    scheduleLocalTracksUpdate();
  }, [scheduleLocalTracksUpdate, cleanupMicPipeline]);

  // ─── Watch Screen Share ───────────────────────────────
  const watchScreen = useCallback(
    async (trackSid) => {
      if (!roomRef.current) return;
      try {
        await trackWatchScreen(roomRef.current, {
          availableScreensRef,
          watchedScreensRef,
          loadingScreensRef,
        }, trackSid, scheduleScreensUpdate);
      } catch (err) {
        console.error('[livekit] Watch screen error:', err);
      }
    },
    [scheduleScreensUpdate],
  );

  // ─── Unwatch Screen Share ─────────────────────────────
  const unwatchScreen = useCallback(
    async (trackSid) => {
      if (!roomRef.current) return;
      // Immediately remove from UI so the stream disappears without a resize flash
      remoteTracksRef.current.delete(trackSid);
      watchedScreensRef.current.delete(trackSid);
      scheduleRemoteTracksUpdate();
      scheduleScreensUpdate();
      // Then async unsubscribe in the background
      try {
        await trackUnwatchScreen(roomRef.current, {
          availableScreensRef,
          watchedScreensRef,
        }, trackSid, scheduleScreensUpdate);
      } catch (err) {
        console.error('[livekit] Unwatch screen error:', err);
      }
    },
    [scheduleRemoteTracksUpdate, scheduleScreensUpdate],
  );

  // ─── Cleanup on Unmount ───────────────────────────────
  useEffect(() => {
    return () => {
      const room = roomRef.current;
      const localTracksMap = localTracksRef.current;
      if (room) {
        if (localTracksMap && typeof localTracksMap.forEach === 'function') {
          localTracksMap.forEach((info) => {
            if (info?.track && typeof info.track.stop === 'function') {
              info.track.stop();
            }
          });
        }
        room.disconnect();
        roomRef.current = null;
      }
      cleanupMicPipeline();
    };
  }, [cleanupMicPipeline]);

  return {
    // Connection state
    isReady,
    error,
    localTracks,
    remoteTracks,
    participants,
    isE2EEEnabled,
    e2eeKey,
    mediaE2EEUnavailable,
    keyExchangeMessage,
    // Room connection
    connectRoom,
    disconnectRoom,
    // Screen sharing
    publishScreen,
    unpublishScreen,
    switchScreenSource,
    changeQuality,
    // Webcam
    publishWebcam,
    unpublishWebcam,
    // Microphone (raw audio - noise gate in B2.2)
    publishMic,
    unpublishMic,
    // Click-to-watch
    availableScreens,
    watchedScreens,
    loadingScreens,
    watchScreen,
    unwatchScreen,
  };
}
