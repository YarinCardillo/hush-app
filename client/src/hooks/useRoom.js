import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  LocalVideoTrack,
  LocalAudioTrack,
  createLocalTracks,
  ExternalE2EEKeyProvider,
} from 'livekit-client';
import { getMatrixClient } from '../lib/matrixClient';
import { ClientEvent } from 'matrix-js-sdk';

// Import E2EE worker for LiveKit encryption
// @ts-ignore - Vite will resolve this URL correctly
import E2EEWorker from 'livekit-client/e2ee-worker?worker';
import {
  QUALITY_PRESETS,
  DEFAULT_QUALITY,
  MEDIA_SOURCES,
  isScreenShareSource,
} from '../utils/constants';

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
  const roomPasswordRef = useRef(null);
  const roomNameRef = useRef(null);
  const matrixRoomIdRef = useRef(null);
  const currentKeyIndexRef = useRef(0);
  const toDeviceUnsubscribeRef = useRef(null);

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

  // ─── Password-Derived E2EE Key (PBKDF2) ────────────────
  /**
   * Derives a 256-bit AES key from room password + room name using PBKDF2.
   * All participants who know the password derive the same key deterministically.
   * Zero server involvement — true E2EE by construction.
   * @param {string} password - Room password
   * @param {string} roomName - Room name (used as salt)
   * @param {number} rotationCounter - Key rotation counter (incremented on participant leave)
   */
  const deriveE2EEKey = useCallback(async (password, roomName, rotationCounter = 0) => {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: encoder.encode(`hush:e2ee:${roomName}:${rotationCounter}`),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256,
    );
    return new Uint8Array(derivedBits);
  }, []);

  // ─── Connect to LiveKit Room ──────────────────────────
  const connectRoom = useCallback(
    async (roomName, displayName, roomPassword, matrixRoomId) => {
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
        roomPasswordRef.current = roomPassword || null;
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

        // ─── E2EE: keyProvider + worker for all; creator sets random key, joiners get key via to-device ───
        let keyProvider = null;
        let worker = null;
        let keyBytes = null;
        let isCreator = false;

        try {
          keyProvider = new ExternalE2EEKeyProvider();
          e2eeKeyProviderRef.current = keyProvider;
          worker = new E2EEWorker();

          // To-device listener: receive E2EE key (joiners and rekey)
          const handleToDeviceE2EEKey = async (event) => {
            if (event.getType() !== 'io.hush.e2ee_key') return;
            const content = event.getContent();
            const roomId = content?.roomId;
            const keyB64 = content?.key;
            const keyIndex = content?.keyIndex ?? 0;
            if (!roomId || !keyB64 || matrixRoomIdRef.current !== roomId || !e2eeKeyProviderRef.current) return;
            try {
              const binary = atob(keyB64);
              const keyBytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) keyBytes[i] = binary.charCodeAt(i);
              await e2eeKeyProviderRef.current.setKey(keyBytes, keyIndex);
              currentKeyIndexRef.current = keyIndex;
              keyBytesRef.current = keyBytes;
              setE2eeKey(keyBytes);
              console.log('[livekit] E2EE key applied from to-device, keyIndex:', keyIndex);
            } catch (e) {
              console.error('[livekit] Failed to apply E2EE key from to-device:', e);
            }
          };

          matrixClient.on(ClientEvent.ToDeviceEvent, handleToDeviceE2EEKey);
          toDeviceUnsubscribeRef.current = () => {
            matrixClient.off(ClientEvent.ToDeviceEvent, handleToDeviceE2EEKey);
          };

          // Creator: first in room → generate random key. We don't know if we're first until after connect;
          // we'll set key after connect when remoteParticipants.size === 0.
          // So for now create keyProvider/worker only; key set after connect for creator.
          // Actually we need key before connect for creator so that our outbound stream is encrypted.
          // So: we don't know if we're creator until we connect. Option A: always connect without key, then
          // if we're first (remoteParticipants.size === 0), generate key, setKey, and... we'd need to reconnect
          // or LiveKit allows setKey mid-call. Option B: assume we're creator if we have roomPassword (room creator
          // flow) and generate key; joiners don't have "creator" role so they wait for to-device. So creator =
          // the one who created the Matrix room. We can't know that in useRoom without passing a flag. Simpler:
          // first participant to connect is creator (remoteParticipants.size === 0 after connect). So we connect
          // without key first, then if we're first we generate key and setKey. But then our media might already
          // be going out unencrypted. So the clean approach: creator generates key before connect and sets it;
          // we need a way to know we're creator. Pass isCreator from Room.jsx? Room doesn't know either.
          // Alternative: everyone connects with keyProvider/worker. Creator generates random key and sets it
          // before connect. Who is creator? The first to connect. So we can't know before connect. So we have to
          // connect, then immediately if no remote participants, generate key and setKey. For LiveKit, if we
          // setKey after connection, does it encrypt from that point? I'll assume yes. So flow: connect without
          // key (keyProvider exists but no key - might need to set a dummy to avoid errors). Actually ExternalE2EEKeyProvider
          // might require setKey before use. Let me try: creator connects, then in the same tick we check
          // room.remoteParticipants.size === 0, generate key, setKey(key, 0), and send to no one (we're alone).
          // When someone joins, ParticipantConnected fires, we send key. So we need key set before we publish
          // tracks. So set key as soon as we know we're creator (right after connect). That works.
          // Joiner: connect without key; when to-device arrives, setKey. So we need to allow keyProvider with
          // no key - does LiveKit support that? I'll set a placeholder zero key for joiner so the room connects,
          // then replace when real key arrives.
          const placeholderKey = new Uint8Array(16);
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
          keyBytes = null;
        }

        // Create LiveKit room with dynacast, adaptive streaming, and E2EE
        const roomOptions = {
          dynacast: true,
          adaptiveStream: true,
          // Disable auto-subscribe for video to enable click-to-watch
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

        // ParticipantConnected: creator sends E2EE key via Matrix to-device
        room.on(RoomEvent.ParticipantConnected, async (participant) => {
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

          if (
            e2eeKeyProviderRef.current &&
            keyBytesRef.current &&
            matrixRoomIdRef.current &&
            matrixClient.getCrypto()
          ) {
            const roomId = matrixRoomIdRef.current;
            const keyBytes = keyBytesRef.current;
            const keyIndex = currentKeyIndexRef.current;
            const keyB64 = btoa(String.fromCharCode(...keyBytes));
            try {
              const deviceMap = await matrixClient.getCrypto().getUserDeviceInfo([participant.identity], true);
              const devicesForUser = deviceMap?.get(participant.identity);
              const devices = devicesForUser
                ? Array.from(devicesForUser.keys()).map((deviceId) => ({
                    userId: participant.identity,
                    deviceId,
                  }))
                : [];
              if (devices.length > 0) {
                await matrixClient.encryptAndSendToDevice('io.hush.e2ee_key', devices, {
                  roomId,
                  key: keyB64,
                  keyIndex,
                });
                console.log('[livekit] E2EE key sent to', participant.identity);
              }
            } catch (err) {
              console.error('[livekit] Failed to send E2EE key to participant:', err);
            }
          }
        });

        // ParticipantDisconnected
        room.on(RoomEvent.ParticipantDisconnected, async (participant) => {
          console.log(
            `[livekit] Participant disconnected: ${participant.identity}`,
          );
          setParticipants((prev) =>
            prev.filter((p) => p.id !== participant.identity),
          );

          // Clean up their available/watched screens
          for (const [trackSid, info] of availableScreensRef.current.entries()) {
            if (info.participantId === participant.identity) {
              availableScreensRef.current.delete(trackSid);
              watchedScreensRef.current.delete(trackSid);
            }
          }
          scheduleScreensUpdate();

          // Clean up their remote tracks
          for (const [trackSid, info] of remoteTracksRef.current.entries()) {
            if (info.participant.identity === participant.identity) {
              remoteTracksRef.current.delete(trackSid);
            }
          }
          scheduleRemoteTracksUpdate();

          // Rekey: only leader (smallest Matrix user ID among remaining) generates and distributes new key
          if (
            e2eeKeyProviderRef.current &&
            matrixRoomIdRef.current &&
            matrixClient.getCrypto()
          ) {
            const room = roomRef.current;
            if (!room) return;

            const remaining = [
              room.localParticipant.identity,
              ...Array.from(room.remoteParticipants.values()).map((p) => p.identity),
            ].filter(Boolean);
            remaining.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
            const leader = remaining[0];
            const myIdentity = matrixClient.getUserId();
            if (myIdentity !== leader) return;

            const newKey = new Uint8Array(16);
            crypto.getRandomValues(newKey);
            const newKeyIndex = currentKeyIndexRef.current + 1;
            currentKeyIndexRef.current = newKeyIndex;
            keyBytesRef.current = newKey;
            await e2eeKeyProviderRef.current.setKey(newKey, newKeyIndex);
            setE2eeKey(newKey);

            const roomId = matrixRoomIdRef.current;
            const keyB64 = btoa(String.fromCharCode(...newKey));
            const targets = remaining.slice(1);
            for (const userId of targets) {
              try {
                const deviceMap = await matrixClient.getCrypto().getUserDeviceInfo([userId], true);
                const devicesForUser = deviceMap?.get(userId);
                const devices = devicesForUser
                  ? Array.from(devicesForUser.keys()).map((deviceId) => ({ userId, deviceId }))
                  : [];
                if (devices.length > 0) {
                  await matrixClient.encryptAndSendToDevice('io.hush.e2ee_key', devices, {
                    roomId,
                    key: keyB64,
                    keyIndex: newKeyIndex,
                  });
                }
              } catch (err) {
                console.error('[livekit] Rekey: failed to send to', userId, err);
              }
            }
            console.log('[livekit] E2EE rekey: new key distributed by leader');
          }
        });

        // TrackSubscribed
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          console.log(
            `[livekit] Track subscribed: ${track.kind} from ${participant.identity}`,
          );

          remoteTracksRef.current.set(track.sid, {
            track,
            participant,
            kind: track.kind,
            source: publication.source,
          });
          scheduleRemoteTracksUpdate();
        });

        // TrackUnsubscribed
        room.on(
          RoomEvent.TrackUnsubscribed,
          (track, publication, participant) => {
            console.log(
              `[livekit] Track unsubscribed: ${track.kind} from ${participant.identity}`,
            );

            remoteTracksRef.current.delete(track.sid);
            scheduleRemoteTracksUpdate();
          },
        );

        // TrackPublished - for click-to-watch screen shares
        room.on(RoomEvent.TrackPublished, (publication, participant) => {
          console.log(
            `[livekit] Track published: ${publication.kind} (${publication.source}) from ${participant.identity}`,
          );

          // Add screen shares to availableScreens for click-to-watch
          if (
            publication.source === Track.Source.ScreenShare &&
            publication.kind === Track.Kind.Video
          ) {
            availableScreensRef.current.set(publication.trackSid, {
              trackSid: publication.trackSid,
              participantId: participant.identity,
              participantName: participant.name || participant.identity,
              kind: publication.kind,
              source: publication.source,
              publication,
            });
            scheduleScreensUpdate();
          }

          // Auto-subscribe to audio tracks (mics, screen audio)
          if (publication.kind === Track.Kind.Audio) {
            publication.setSubscribed(true);
          }
        });

        // TrackUnpublished
        room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
          console.log(
            `[livekit] Track unpublished: ${publication.kind} from ${participant.identity}`,
          );

          if (publication.source === Track.Source.ScreenShare) {
            availableScreensRef.current.delete(publication.trackSid);
            watchedScreensRef.current.delete(publication.trackSid);
            scheduleScreensUpdate();
          }

          // Remove from remote tracks if it was subscribed
          remoteTracksRef.current.delete(publication.trackSid);
          scheduleRemoteTracksUpdate();
        });

        // Disconnected
        room.on(RoomEvent.Disconnected, () => {
          console.log('[livekit] Disconnected from room');
          setIsReady(false);
          setError('Disconnected from room');
        });

        const livekitUrl =
          import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';
        await room.connect(livekitUrl, token);

        roomRef.current = room;

        // Creator: first in room → replace placeholder with random key and broadcast to future joiners
        if (keyProvider && matrixRoomIdRef.current && room.remoteParticipants.size === 0) {
          const randomKey = new Uint8Array(16);
          crypto.getRandomValues(randomKey);
          await keyProvider.setKey(randomKey, 0);
          keyBytesRef.current = randomKey;
          currentKeyIndexRef.current = 0;
          setIsE2EEEnabled(true);
          setE2eeKey(randomKey);
          console.log('[livekit] E2EE creator: random key set');
        } else if (keyProvider) {
          setIsE2EEEnabled(true);
          setE2eeKey(keyBytesRef.current);
        } else {
          setIsE2EEEnabled(false);
        }

        // Populate initial participants
        const initialParticipants = Array.from(
          room.remoteParticipants.values(),
        ).map((p) => ({
          id: p.identity,
          displayName: p.name || p.identity,
        }));
        setParticipants(initialParticipants);

        setIsReady(true);
        console.log('[livekit] Connected to room:', roomName);
      } catch (err) {
        console.error('[livekit] Connection error:', err);
        setError(err.message);
      }
    },
    [scheduleRemoteTracksUpdate, scheduleScreensUpdate, deriveE2EEKey],
  );

  // ─── Disconnect from Room ─────────────────────────────
  const disconnectRoom = useCallback(async () => {
    if (toDeviceUnsubscribeRef.current) {
      toDeviceUnsubscribeRef.current();
      toDeviceUnsubscribeRef.current = null;
    }
    if (!roomRef.current) return;

    try {
      for (const [, track] of localTracksRef.current.values()) {
        track.stop();
      }

      cleanupMicPipeline();

      roomRef.current.disconnect();
      roomRef.current = null;
      e2eeKeyProviderRef.current = null;
      keyBytesRef.current = null;
      keyRotationCounterRef.current = 0;
      currentKeyIndexRef.current = 0;
      roomPasswordRef.current = null;
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

  // ─── Publish Screen Share ─────────────────────────────
  const publishScreen = useCallback(
    async (qualityKey = DEFAULT_QUALITY) => {
      if (!roomRef.current) throw new Error('Room not connected');

      const quality = QUALITY_PRESETS[qualityKey];

      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            cursor: 'always',
            frameRate: { ideal: quality.frameRate },
          },
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];

        if (!videoTrack || videoTrack.readyState !== 'live') {
          console.error('[livekit] Video track not live');
          stream.getTracks().forEach((t) => t.stop());
          return null;
        }

        // Apply quality constraints for 'lite' mode
        if (quality.width && quality.height) {
          try {
            await videoTrack.applyConstraints({
              width: { ideal: quality.width },
              height: { ideal: quality.height },
              frameRate: { ideal: quality.frameRate },
            });
          } catch (err) {
            console.warn('[livekit] Could not apply track constraints:', err);
          }
        }

        // Create LocalVideoTrack for screen
        const localVideoTrack = new LocalVideoTrack(videoTrack);

        // Publish screen track with source metadata
        const videoPublication = await roomRef.current.localParticipant.publishTrack(
          localVideoTrack,
          {
            source: Track.Source.ScreenShare,
            videoEncoding: {
              maxBitrate: quality.bitrate,
            },
          },
        );

        localTracksRef.current.set(localVideoTrack.sid, {
          track: localVideoTrack,
          source: MEDIA_SOURCES.SCREEN,
        });

        // Handle track ended (user clicks "Stop sharing" in browser)
        videoTrack.addEventListener('ended', () => {
          unpublishScreen();
        });

        // Publish screen audio if available (best-effort)
        if (audioTrack && audioTrack.readyState === 'live') {
          try {
            const localAudioTrack = new LocalAudioTrack(audioTrack);
            await roomRef.current.localParticipant.publishTrack(
              localAudioTrack,
              {
                source: Track.Source.ScreenShareAudio,
              },
            );

            localTracksRef.current.set(localAudioTrack.sid, {
              track: localAudioTrack,
              source: MEDIA_SOURCES.SCREEN_AUDIO,
            });

            console.log('[livekit] Screen audio published');
          } catch (audioErr) {
            console.warn(
              '[livekit] Screen audio publish failed (non-fatal):',
              audioErr.message,
            );
          }
        }

        scheduleLocalTracksUpdate();

        console.log('[livekit] Screen share published');
        return stream;
      } catch (err) {
        if (err.name === 'NotAllowedError') return null;
        console.error('[livekit] Screen share error:', err);
        throw err;
      }
    },
    [scheduleLocalTracksUpdate],
  );

  // ─── Unpublish Screen Share ───────────────────────────
  const unpublishScreen = useCallback(async () => {
    if (!roomRef.current) return;

    try {
      // Find and unpublish screen tracks
      for (const [trackSid, info] of localTracksRef.current.entries()) {
        if (
          info.source === MEDIA_SOURCES.SCREEN ||
          info.source === MEDIA_SOURCES.SCREEN_AUDIO
        ) {
          info.track.stop();
          await roomRef.current.localParticipant.unpublishTrack(info.track);
          localTracksRef.current.delete(trackSid);
        }
      }

      scheduleLocalTracksUpdate();
      console.log('[livekit] Screen share unpublished');
    } catch (err) {
      console.error('[livekit] Unpublish screen error:', err);
    }
  }, [scheduleLocalTracksUpdate]);

  // ─── Switch Screen Source ─────────────────────────────
  const switchScreenSource = useCallback(
    async (qualityKey = DEFAULT_QUALITY) => {
      const quality = QUALITY_PRESETS[qualityKey];

      // Find existing screen track
      const screenEntry = Array.from(localTracksRef.current.entries()).find(
        ([, info]) => info.source === MEDIA_SOURCES.SCREEN,
      );

      if (!screenEntry) throw new Error('No active screen share');
      const [, info] = screenEntry;

      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            cursor: 'always',
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
            console.warn('[livekit] Could not apply track constraints:', err);
          }
        }

        // Replace the track in the existing LocalVideoTrack
        await info.track.replaceTrack(newTrack);

        // Handle track ended
        newTrack.addEventListener('ended', () => {
          unpublishScreen();
        });

        console.log('[livekit] Screen source switched');
        return stream;
      } catch (err) {
        console.error('[livekit] Switch screen source error:', err);
        throw err;
      }
    },
    [unpublishScreen],
  );

  // ─── Change Quality ───────────────────────────────────
  const changeQuality = useCallback(async (qualityKey) => {
    const quality = QUALITY_PRESETS[qualityKey];
    if (!quality) return;

    // Find existing screen track
    const screenEntry = Array.from(localTracksRef.current.entries()).find(
      ([, info]) => info.source === MEDIA_SOURCES.SCREEN,
    );

    if (!screenEntry) return;
    const [, info] = screenEntry;

    try {
      // Apply track constraints (resolution/framerate)
      const track = info.track.mediaStreamTrack;
      if (track && track.readyState === 'live') {
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
      }

      console.log(`[livekit] Quality changed to ${qualityKey}`);
    } catch (err) {
      console.warn('[livekit] Could not change quality:', err);
    }
  }, []);

  // ─── Publish Webcam ───────────────────────────────────
  const publishWebcam = useCallback(
    async (deviceId = null) => {
      if (!roomRef.current) throw new Error('Room not connected');

      try {
        const videoConstraints = { width: 640, height: 480, frameRate: 30 };
        if (deviceId) videoConstraints.deviceId = { exact: deviceId };

        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
        });

        const videoTrack = stream.getVideoTracks()[0];
        const localVideoTrack = new LocalVideoTrack(videoTrack);

        await roomRef.current.localParticipant.publishTrack(localVideoTrack, {
          source: Track.Source.Camera,
          videoEncoding: {
            maxBitrate: 500000,
          },
        });

        localTracksRef.current.set(localVideoTrack.sid, {
          track: localVideoTrack,
          source: MEDIA_SOURCES.WEBCAM,
        });

        scheduleLocalTracksUpdate();

        console.log('[livekit] Webcam published');
      } catch (err) {
        console.error('[livekit] Webcam publish error:', err);
        throw err;
      }
    },
    [scheduleLocalTracksUpdate],
  );

  // ─── Unpublish Webcam ─────────────────────────────────
  const unpublishWebcam = useCallback(async () => {
    if (!roomRef.current) return;

    try {
      // Find and unpublish webcam track
      for (const [trackSid, info] of localTracksRef.current.entries()) {
        if (info.source === MEDIA_SOURCES.WEBCAM) {
          info.track.stop();
          await roomRef.current.localParticipant.unpublishTrack(info.track);
          localTracksRef.current.delete(trackSid);
        }
      }

      scheduleLocalTracksUpdate();
      console.log('[livekit] Webcam unpublished');
    } catch (err) {
      console.error('[livekit] Unpublish webcam error:', err);
    }
  }, [scheduleLocalTracksUpdate]);

  // ─── Publish Microphone ───────────────────────────────
  const publishMic = useCallback(
    async (deviceId = null) => {
      if (!roomRef.current) throw new Error('Room not connected');

      try {
        const audioConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };
        if (deviceId) audioConstraints.deviceId = { exact: deviceId };

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        });

        // Store raw stream for cleanup
        rawMicStreamRef.current = stream;

        // Create AudioContext for noise gate processing
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;

        const source = audioContext.createMediaStreamSource(stream);

        // Try to use AudioWorklet for noise gate
        const hasWorklet = typeof audioContext.audioWorklet !== 'undefined';
        let destination;

        if (hasWorklet) {
          try {
            // Load noise gate worklet
            await audioContext.audioWorklet.addModule(
              new URL('./noiseGateWorklet.js', import.meta.url),
            );

            // Create noise gate processor node
            const workletNode = new AudioWorkletNode(
              audioContext,
              'noise-gate-processor',
            );
            noiseGateNodeRef.current = workletNode;

            // Create destination for processed audio
            destination = audioContext.createMediaStreamDestination();

            // Connect: Source → NoiseGate → Destination
            source.connect(workletNode);
            workletNode.connect(destination);

            // Send initial parameters to worklet
            workletNode.port.postMessage({
              type: 'updateParams',
              enabled: true,
              threshold: -50,
            });

            console.log('[livekit] Noise gate enabled (AudioWorklet)');
          } catch (err) {
            console.warn(
              '[livekit] AudioWorklet failed, publishing raw audio:',
              err,
            );
            // Fallback: use raw audio if worklet fails
            destination = audioContext.createMediaStreamDestination();
            source.connect(destination);
          }
        } else {
          // No AudioWorklet support, use raw audio
          console.warn('[livekit] AudioWorklet not supported, using raw audio');
          destination = audioContext.createMediaStreamDestination();
          source.connect(destination);
        }

        // Get processed audio track from destination
        const processedTrack = destination.stream.getAudioTracks()[0];

        // Publish the processed track to LiveKit
        const localAudioTrack = new LocalAudioTrack(processedTrack);

        await roomRef.current.localParticipant.publishTrack(localAudioTrack, {
          source: Track.Source.Microphone,
        });

        localTracksRef.current.set(localAudioTrack.sid, {
          track: localAudioTrack,
          source: MEDIA_SOURCES.MIC,
        });

        scheduleLocalTracksUpdate();

        console.log('[livekit] Microphone published with noise gate');
      } catch (err) {
        console.error('[livekit] Microphone publish error:', err);
        // Cleanup on error
        cleanupMicPipeline();
        throw err;
      }
    },
    [scheduleLocalTracksUpdate, cleanupMicPipeline],
  );

  // ─── Unpublish Microphone ─────────────────────────────
  const unpublishMic = useCallback(async () => {
    if (!roomRef.current) return;

    try {
      // Find and unpublish mic track
      for (const [trackSid, info] of localTracksRef.current.entries()) {
        if (info.source === MEDIA_SOURCES.MIC) {
          info.track.stop();
          await roomRef.current.localParticipant.unpublishTrack(info.track);
          localTracksRef.current.delete(trackSid);
        }
      }

      // Cleanup mic audio pipeline
      cleanupMicPipeline();

      scheduleLocalTracksUpdate();
      console.log('[livekit] Microphone unpublished');
    } catch (err) {
      console.error('[livekit] Unpublish mic error:', err);
    }
  }, [scheduleLocalTracksUpdate, cleanupMicPipeline]);

  // ─── Watch Screen Share ───────────────────────────────
  const watchScreen = useCallback(
    async (trackSid) => {
      const screenInfo = availableScreensRef.current.get(trackSid);
      if (!screenInfo) return;

      // Mark as loading for UI feedback
      loadingScreensRef.current.add(trackSid);
      scheduleScreensUpdate();

      try {
        const { publication } = screenInfo;

        // Subscribe to the screen share
        await publication.setSubscribed(true);

        // Also subscribe to screen audio from same participant
        if (roomRef.current) {
          const participant = Array.from(
            roomRef.current.remoteParticipants.values(),
          ).find((p) => p.identity === screenInfo.participantId);

          if (participant) {
            for (const [, pub] of participant.audioTrackPublications) {
              if (pub.source === Track.Source.ScreenShareAudio) {
                await pub.setSubscribed(true);
                break;
              }
            }
          }
        }

        // Mark as watched
        watchedScreensRef.current.add(trackSid);

        console.log('[livekit] Screen share subscribed:', trackSid);
      } catch (err) {
        console.error('[livekit] Watch screen error:', err);
      } finally {
        loadingScreensRef.current.delete(trackSid);
        scheduleScreensUpdate();
      }
    },
    [scheduleScreensUpdate],
  );

  // ─── Unwatch Screen Share ─────────────────────────────
  const unwatchScreen = useCallback(
    async (trackSid) => {
      const screenInfo = availableScreensRef.current.get(trackSid);
      if (!screenInfo) return;

      try {
        const { publication } = screenInfo;

        // Unsubscribe from screen share
        await publication.setSubscribed(false);

        // Also unsubscribe from screen audio from same participant
        if (roomRef.current) {
          const participant = Array.from(
            roomRef.current.remoteParticipants.values(),
          ).find((p) => p.identity === screenInfo.participantId);

          if (participant) {
            for (const [, pub] of participant.audioTrackPublications) {
              if (pub.source === Track.Source.ScreenShareAudio) {
                await pub.setSubscribed(false);
                break;
              }
            }
          }
        }

        watchedScreensRef.current.delete(trackSid);
        scheduleScreensUpdate();

        console.log('[livekit] Screen share unsubscribed:', trackSid);
      } catch (err) {
        console.error('[livekit] Unwatch screen error:', err);
      }
    },
    [scheduleScreensUpdate],
  );

  // ─── Cleanup on Unmount ───────────────────────────────
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        // Stop all local tracks
        for (const [, info] of localTracksRef.current.values()) {
          info.track.stop();
        }

        roomRef.current.disconnect();
        roomRef.current = null;
      }

      // Cleanup mic audio pipeline
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
