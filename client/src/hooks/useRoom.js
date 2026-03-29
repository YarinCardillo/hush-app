import { useState, useRef, useCallback, useEffect } from 'react';
import { Room, RoomEvent, Track, ExternalE2EEKeyProvider } from 'livekit-client';

// Import E2EE worker for LiveKit encryption
// @ts-ignore - Vite will resolve this URL correctly
import E2EEWorker from 'livekit-client/e2ee-worker?worker';

import * as mlsGroupLib from '../lib/mlsGroup';
import * as mlsStoreLib from '../lib/mlsStore';
import * as hushCryptoLib from '../lib/hushCrypto';
import * as apiLib from '../lib/api';
import { applyMicFilterSettingsToNode } from '../lib/micProcessing';

import {
  attachRemoteTrackListeners,
  preloadNoiseGateWorklet,
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
 * Decode a base64 string to a Uint8Array.
 * @param {string} b64
 * @returns {Uint8Array}
 */
function fromBase64(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/**
 * LiveKit-based room connection hook.
 * Voice E2EE is fully MLS-based: frame keys are derived via MLS export_secret
 * (RFC 9420 §8.4) and applied to LiveKit ExternalE2EEKeyProvider.
 *
 * @param {{ wsClient: object, getToken: () => string|null, currentUserId: string, getStore: () => Promise<IDBDatabase>, voiceKeyRotationHours?: number }} deps
 * @returns {Object} Room state and media controls
 */
export function useRoom({ wsClient, getToken, currentUserId, getStore, voiceKeyRotationHours }) {
  // ─── Connection State ─────────────────────────────────
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);
  const [localTracks, setLocalTracks] = useState(new Map());
  const [remoteTracks, setRemoteTracks] = useState(new Map());
  const [participants, setParticipants] = useState([]);
  const [isE2EEEnabled, setIsE2EEEnabled] = useState(false);
  const [voiceEpoch, setVoiceEpoch] = useState(null);
  const [isVoiceReconnecting, setIsVoiceReconnecting] = useState(false);
  const [voiceReconnectFailed, setVoiceReconnectFailed] = useState(false);
  const [activeSpeakerIds, setActiveSpeakerIds] = useState([]);

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
  const voiceEpochRef = useRef(null);
  const voiceSelfUpdateTimerRef = useRef(null);
  const voiceWsUnsubscribeRef = useRef(null);
  const roomNameRef = useRef(null);
  const channelIdRef = useRef(null);
  const connectionEpochRef = useRef(0);
  const reconnectAttemptCountRef = useRef(0);

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

  const syncParticipantsFromRoom = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const next = Array.from(room.remoteParticipants.values()).map((p) => ({
      id: p.identity,
      displayName: p.name || p.identity,
    }));
    setParticipants((prev) => {
      if (
        prev.length === next.length
        && prev.every((p, i) => p.id === next[i]?.id && p.displayName === next[i]?.displayName)
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  // ─── Connect to LiveKit Room ──────────────────────────
  const connectRoom = useCallback(
    async (roomName, displayName, channelId) => {
      const epoch = ++connectionEpochRef.current;
      const isStale = () => epoch !== connectionEpochRef.current;
      if (!wsClient) {
        setError('WebSocket not connected. Please try again.');
        return;
      }
      setError(null);
      try {
        if (roomRef.current) {
          roomRef.current.disconnect();
          roomRef.current = null;
        }
        // Cancel any in-flight voice WS listeners from a previous session
        if (voiceWsUnsubscribeRef.current) {
          voiceWsUnsubscribeRef.current();
          voiceWsUnsubscribeRef.current = null;
        }
        if (voiceSelfUpdateTimerRef.current) {
          clearInterval(voiceSelfUpdateTimerRef.current);
          voiceSelfUpdateTimerRef.current = null;
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
        setActiveSpeakerIds([]);
        setIsReady(false);
        setIsE2EEEnabled(false);
        setVoiceEpoch(null);
        setVoiceReconnectFailed(false);
        voiceEpochRef.current = null;
        reconnectAttemptCountRef.current = 0;
        roomNameRef.current = roomName;
        channelIdRef.current = channelId || null;

        const accessToken = getToken?.();
        if (!accessToken) {
          throw new Error('Session required. Please sign in again.');
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
          if (response.status === 403 && errorData.code === 'muted') {
            throw new Error(msg);
          }
          throw new Error(msg);
        }

        const { token } = await response.json();
        if (isStale()) return;

        // ─── MLS Voice Group Setup ────────────────────────────────────────────
        // Signal state: "Reconnecting..." indicator is shown during the async
        // MLS group join/create flow. Audio is blocked until a valid frame key
        // is derived and applied. No unencrypted audio ever flows.
        setIsVoiceReconnecting(true);

        let keyProvider = null;
        let worker = null;

        try {
          keyProvider = new ExternalE2EEKeyProvider();
          e2eeKeyProviderRef.current = keyProvider;
          worker = new E2EEWorker();

          // Build MLS dependency bundle for this session
          const db = await getStore();
          const credential = await mlsStoreLib.getCredential(db);
          const mlsDeps = {
            db,
            token: accessToken,
            credential,
            mlsStore: mlsStoreLib,
            hushCrypto: hushCryptoLib,
            api: apiLib,
          };

          // Determine whether to create or join: 404 from server = first participant.
          // Catch GroupAlreadyExists to handle React StrictMode double-fire in dev.
          const existingGroup = await apiLib.getMLSVoiceGroupInfo(accessToken, channelId).catch(() => null);
          if (existingGroup) {
            await mlsGroupLib.joinVoiceGroup(mlsDeps, channelId);
          } else {
            try {
              await mlsGroupLib.createVoiceGroup(mlsDeps, channelId);
            } catch (createErr) {
              const msg = String(createErr?.message ?? createErr);
              if (msg.includes('GroupAlreadyExists') || msg.includes('already exists')) {
                console.warn('[livekit] Voice group already exists locally (StrictMode re-fire), continuing');
              } else {
                throw createErr;
              }
            }
          }

          // Derive frame key from MLS export_secret and apply to LiveKit key provider
          const { frameKeyBytes, epoch: initialEpoch } = await mlsGroupLib.exportVoiceFrameKey(mlsDeps, channelId);
          await keyProvider.setKey(new Uint8Array(frameKeyBytes), initialEpoch % 256);

          setVoiceEpoch(initialEpoch);
          voiceEpochRef.current = initialEpoch;
          setIsE2EEEnabled(true);
          setIsVoiceReconnecting(false);
        } catch (mlsErr) {
          console.error('[livekit] MLS voice group setup failed:', mlsErr);
          setIsVoiceReconnecting(false);
          keyProvider = null;
          worker = null;
        }

        if (!keyProvider || !worker) {
          throw new Error('Could not establish encrypted voice — E2EE is required.');
        }
        if (isStale()) return;

        // ─── LiveKit Room Options ─────────────────────────────────────────────
        const roomOptions = {
          dynacast: true,
          adaptiveStream: true,
          e2ee: {
            keyProvider,
            worker,
          },
        };

        const room = new Room(roomOptions);

        // ParticipantConnected: update participant list.
        // In MLS, no per-user key exchange is needed. The new participant joins
        // the MLS group independently via External Commit. The mls.commit WS
        // event (handled below) triggers frame key re-derivation.
        room.on(RoomEvent.ParticipantConnected, (participant) => {
          if (isStale()) return;
          console.log(`[livekit] Participant connected: ${participant.identity}`);
          setParticipants((prev) => {
            if (prev.some((p) => p.id === participant.identity)) return prev;
            return [
              ...prev,
              {
                id: participant.identity,
                displayName: participant.name || participant.identity,
              },
            ];
          });
          queueMicrotask(syncParticipantsFromRoom);
        });

        // ParticipantDisconnected: update list and clean tracks/screens.
        // Frame key rotates automatically via epoch advancement on leave
        // (triggered by the mls.commit from remaining participants).
        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
          if (isStale()) return;
          console.log(`[livekit] Participant disconnected: ${participant.identity}`);
          setParticipants((prev) =>
            prev.filter((p) => p.id !== participant.identity),
          );
          queueMicrotask(syncParticipantsFromRoom);
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
        });

        const trackRefs = {
          remoteTracksRef,
          availableScreensRef,
          watchedScreensRef,
        };
        attachRemoteTrackListeners(room, trackRefs, scheduleRemoteTracksUpdate, scheduleScreensUpdate);

        // Connected: E2EE key is already applied before room.connect() — no
        // additional setKey call needed here. setIsE2EEEnabled was already set
        // above after MLS key derivation succeeded.
        room.on(RoomEvent.Connected, () => {
          if (isStale()) return;
        });

        // Reconnecting: LiveKit is attempting to re-establish the WebSocket
        // connection (e.g. page refresh, network interruption). Show the
        // overlay and count the attempt so we can surface a Rejoin prompt
        // after 3 failures.
        room.on(RoomEvent.Reconnecting, () => {
          if (isStale()) return;
          reconnectAttemptCountRef.current += 1;
          setIsVoiceReconnecting(true);
          console.log(`[livekit] Reconnecting... (attempt ${reconnectAttemptCountRef.current})`);
        });

        // Reconnected: re-derive the MLS frame key from the current epoch so
        // the E2EE key provider is fresh after the socket was re-established.
        // Re-setting the same key if the epoch is unchanged is idempotent.
        room.on(RoomEvent.Reconnected, async () => {
          if (isStale()) return;
          reconnectAttemptCountRef.current = 0;
          try {
            const db = await getStore();
            const credential = await mlsStoreLib.getCredential(db);
            const tok = getToken();
            const mlsDeps = {
              db,
              token: tok,
              credential,
              mlsStore: mlsStoreLib,
              hushCrypto: hushCryptoLib,
              api: apiLib,
            };
            const { frameKeyBytes, epoch } = await mlsGroupLib.exportVoiceFrameKey(mlsDeps, channelIdRef.current);
            if (e2eeKeyProviderRef.current) {
              await e2eeKeyProviderRef.current.setKey(new Uint8Array(frameKeyBytes), epoch % 256);
            }
            setVoiceEpoch(epoch);
            voiceEpochRef.current = epoch;
            console.log(`[livekit] Reconnected — frame key re-derived (epoch ${epoch})`);
          } catch (err) {
            console.error('[livekit] Frame key re-derivation after reconnect failed:', err);
          }
          setIsVoiceReconnecting(false);
        });

        room.on(RoomEvent.Disconnected, () => {
          if (isStale()) return;
          console.log('[livekit] Disconnected from room');
          setIsReady(false);
          // If 3 or more reconnect attempts preceded this disconnect, surface the
          // manual "Rejoin" prompt instead of a generic error.
          if (reconnectAttemptCountRef.current >= 3) {
            setVoiceReconnectFailed(true);
            setIsVoiceReconnecting(false);
          } else {
            setError('Disconnected from room');
          }
        });

        room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          if (isStale()) return;
          setActiveSpeakerIds(speakers.map((s) => s.identity));
        });

        // Derive LiveKit URL from the current page origin so it works
        // through the nginx /livekit/ reverse proxy (both local and remote).
        const livekitUrl =
          import.meta.env.VITE_LIVEKIT_URL ||
          `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/livekit/`;
        await room.connect(livekitUrl, token, { autoSubscribe: false });

        if (isStale()) {
          room.disconnect();
          return;
        }

        roomRef.current = room;

        // ─── Voice MLS WS Listeners ──────────────────────────────────────────
        // Re-derive frame key when a voice commit advances the epoch.
        const handleVoiceCommit = async (data) => {
          if (data.group_type !== 'voice' || data.channel_id !== channelIdRef.current) return;
          // Own commits are already applied locally when we sent them
          if (data.sender_id === currentUserId) return;
          try {
            const db = await getStore();
            const credential = await mlsStoreLib.getCredential(db);
            const tok = getToken();
            const mlsDeps = {
              db,
              token: tok,
              credential,
              mlsStore: mlsStoreLib,
              hushCrypto: hushCryptoLib,
              api: apiLib,
            };
            const commitBytes = fromBase64(data.commit_bytes);
            await mlsGroupLib.processVoiceCommit(mlsDeps, data.channel_id, commitBytes);
            const { frameKeyBytes, epoch } = await mlsGroupLib.exportVoiceFrameKey(mlsDeps, data.channel_id);
            if (e2eeKeyProviderRef.current) {
              await e2eeKeyProviderRef.current.setKey(new Uint8Array(frameKeyBytes), epoch % 256);
            }
            setVoiceEpoch(epoch);
            voiceEpochRef.current = epoch;
          } catch (err) {
            console.error('[livekit] Failed to process voice MLS commit:', err);
          }
        };

        // Clean up local state when the server signals the voice group is gone
        // (last participant left and webhook fired DeleteMLSGroupInfo).
        const handleVoiceGroupDestroyed = async (data) => {
          if (data.channel_id !== channelIdRef.current) return;
          try {
            const db = await getStore();
            const credential = await mlsStoreLib.getCredential(db);
            const mlsDeps = {
              db,
              token: getToken(),
              credential,
              mlsStore: mlsStoreLib,
              hushCrypto: hushCryptoLib,
              api: apiLib,
            };
            await mlsGroupLib.destroyVoiceGroup(mlsDeps, data.channel_id);
          } catch (err) {
            console.warn('[livekit] voice_group_destroyed cleanup failed:', err);
          }
        };

        wsClient.on('mls.commit', handleVoiceCommit);
        wsClient.on('voice_group_destroyed', handleVoiceGroupDestroyed);
        voiceWsUnsubscribeRef.current = () => {
          wsClient.off('mls.commit', handleVoiceCommit);
          wsClient.off('voice_group_destroyed', handleVoiceGroupDestroyed);
        };

        // ─── Periodic Self-Update (key rotation) ─────────────────────────────
        const rotationMs = (voiceKeyRotationHours ?? 2) * 3600000;
        voiceSelfUpdateTimerRef.current = setInterval(async () => {
          try {
            const db = await getStore();
            const credential = await mlsStoreLib.getCredential(db);
            const tok = getToken();
            const mlsDeps = {
              db,
              token: tok,
              credential,
              mlsStore: mlsStoreLib,
              hushCrypto: hushCryptoLib,
              api: apiLib,
            };
            await mlsGroupLib.performVoiceSelfUpdate(mlsDeps, channelIdRef.current);
            const { frameKeyBytes, epoch } = await mlsGroupLib.exportVoiceFrameKey(mlsDeps, channelIdRef.current);
            if (e2eeKeyProviderRef.current) {
              await e2eeKeyProviderRef.current.setKey(new Uint8Array(frameKeyBytes), epoch % 256);
            }
            setVoiceEpoch(epoch);
            voiceEpochRef.current = epoch;
          } catch (err) {
            console.warn('[livekit] Periodic voice key rotation failed:', err);
          }
        }, rotationMs);

        // ─── Initial Participants ─────────────────────────────────────────────
        const initialParticipants = [];
        for (const p of room.remoteParticipants.values()) {
          initialParticipants.push({
            id: p.identity,
            displayName: p.name || p.identity,
          });
          for (const [, pub] of p.trackPublications) {
            if (!pub.trackSid) continue;
            if (pub.source === Track.Source.ScreenShare && pub.kind === Track.Kind.Video) {
              availableScreensRef.current.set(pub.trackSid, {
                trackSid: pub.trackSid,
                participantId: p.identity,
                participantName: p.name || p.identity,
                kind: pub.kind,
                source: pub.source,
                publication: pub,
              });
            } else if (pub.source !== Track.Source.ScreenShareAudio) {
              pub.setSubscribed(true);
            }
          }
        }
        scheduleScreensUpdate();
        setParticipants(initialParticipants);

        setIsReady(true);
        preloadNoiseGateWorklet();
        console.log('[livekit] Connected to room:', roomName);
      } catch (err) {
        if (isStale()) return;
        console.error('[livekit] Connection error:', err);
        setError(err.message);
      }
    },
    [scheduleRemoteTracksUpdate, scheduleScreensUpdate, syncParticipantsFromRoom, wsClient, currentUserId, getToken, getStore, voiceKeyRotationHours],
  );

  // ─── Disconnect from Room ─────────────────────────────
  const disconnectRoom = useCallback(async () => {
    connectionEpochRef.current++;
    setError(null);

    // Stop periodic key rotation
    if (voiceSelfUpdateTimerRef.current) {
      clearInterval(voiceSelfUpdateTimerRef.current);
      voiceSelfUpdateTimerRef.current = null;
    }

    // Remove voice MLS WS listeners
    if (voiceWsUnsubscribeRef.current) {
      voiceWsUnsubscribeRef.current();
      voiceWsUnsubscribeRef.current = null;
    }

    if (!roomRef.current) {
      // Still clean up MLS state even if room already gone
      const chId = channelIdRef.current;
      if (chId) {
        try {
          const db = await getStore();
          const credential = await mlsStoreLib.getCredential(db);
          const mlsDeps = {
            db,
            token: getToken(),
            credential,
            mlsStore: mlsStoreLib,
            hushCrypto: hushCryptoLib,
            api: apiLib,
          };
          await mlsGroupLib.destroyVoiceGroup(mlsDeps, chId);
        } catch { /* fire-and-forget */ }
      }
      voiceEpochRef.current = null;
      reconnectAttemptCountRef.current = 0;
      setVoiceEpoch(null);
      setIsVoiceReconnecting(false);
      setVoiceReconnectFailed(false);
      return;
    }

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

      // Destroy local voice group state (fire-and-forget — server handles group
      // deletion when the last participant leaves via the LiveKit webhook)
      const chId = channelIdRef.current;
      if (chId) {
        try {
          const db = await getStore();
          const credential = await mlsStoreLib.getCredential(db);
          const mlsDeps = {
            db,
            token: getToken(),
            credential,
            mlsStore: mlsStoreLib,
            hushCrypto: hushCryptoLib,
            api: apiLib,
          };
          await mlsGroupLib.destroyVoiceGroup(mlsDeps, chId);
        } catch { /* fire-and-forget */ }
      }

      await roomRef.current.disconnect();
      roomRef.current = null;
      e2eeKeyProviderRef.current = null;
      voiceEpochRef.current = null;
      roomNameRef.current = null;
      channelIdRef.current = null;

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
      setVoiceEpoch(null);
      setIsVoiceReconnecting(false);
      setVoiceReconnectFailed(false);
      reconnectAttemptCountRef.current = 0;

      console.log('[livekit] Disconnected from room');
    } catch (err) {
      console.error('[livekit] Disconnect error:', err);
    }
  }, [cleanupMicPipeline, getStore, getToken]);

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
      await trackChangeQuality(roomRef.current, { localTracksRef }, qualityKey, {
        onTrackEnded: unpublishScreen,
      });
      scheduleLocalTracksUpdate();
    },
    [unpublishScreen, scheduleLocalTracksUpdate],
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

  // ─── Mute/Unmute Microphone (keeps track published) ──
  const muteMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    for (const [, info] of localTracksRef.current.entries()) {
      if (info.source === 'microphone' && info.track) {
        await info.track.mute();
      }
    }
  }, []);

  const unmuteMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    for (const [, info] of localTracksRef.current.entries()) {
      if (info.source === 'microphone' && info.track) {
        await info.track.unmute();
      }
    }
  }, []);

  /**
   * Applies updated mic filter settings to the active published microphone
   * without forcing the user to leave and rejoin the room.
   *
   * @param {Partial<{ noiseGateEnabled: boolean, noiseGateThresholdDb: number }>} settings
   */
  const updateMicFilterSettings = useCallback((settings) => {
    applyMicFilterSettingsToNode(noiseGateNodeRef.current, settings);
  }, []);

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
      remoteTracksRef.current.delete(trackSid);
      watchedScreensRef.current.delete(trackSid);
      scheduleRemoteTracksUpdate();
      scheduleScreensUpdate();
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

  // ─── Periodic + visibility sync for participants ──────
  // Safety net for missed SDK events (browser throttling/background tabs).
  useEffect(() => {
    const intervalId = setInterval(() => {
      syncParticipantsFromRoom();
    }, 1500);
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      syncParticipantsFromRoom();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [syncParticipantsFromRoom]);

  // ─── Cleanup on Unmount ───────────────────────────────
  useEffect(() => {
    return () => {
      if (voiceWsUnsubscribeRef.current) {
        voiceWsUnsubscribeRef.current();
        voiceWsUnsubscribeRef.current = null;
      }
      if (voiceSelfUpdateTimerRef.current) {
        clearInterval(voiceSelfUpdateTimerRef.current);
        voiceSelfUpdateTimerRef.current = null;
      }
      const room = roomRef.current;
      const localTracksMap = localTracksRef.current;
      if (room) {
        connectionEpochRef.current++;
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
    voiceEpoch,
    isVoiceReconnecting,
    voiceReconnectFailed,
    activeSpeakerIds,
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
    // Microphone
    publishMic,
    unpublishMic,
    muteMic,
    unmuteMic,
    updateMicFilterSettings,
    // Click-to-watch
    availableScreens,
    watchedScreens,
    loadingScreens,
    watchScreen,
    unwatchScreen,
  };
}
