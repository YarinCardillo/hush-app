import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Track } from 'livekit-client';
import { useAuth } from '../contexts/AuthContext';
import { GUEST_SESSION_KEY } from '../lib/authStorage';
import { createWsClient } from '../lib/ws';
import { useSignal } from '../hooks/useSignal';
import * as signalStore from '../lib/signalStore';
import { useRoom } from '../hooks/useRoom';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useDevices } from '../hooks/useDevices';
import { DEFAULT_QUALITY, MEDIA_SOURCES, STANDBY_AFTER_MS, isScreenShareSource } from '../utils/constants';
import {
  estimateUploadSpeed,
  getRecommendedQuality,
  measureLiveUploadMbps,
} from '../lib/bandwidthEstimator';
import StreamView from '../components/StreamView';
import ScreenShareCard from '../components/ScreenShareCard';
import Controls from '../components/Controls';
import QualityPickerModal from '../components/QualityPickerModal';
import DevicePickerModal from '../components/DevicePickerModal';
import Chat from '../components/Chat';

const styles = {
  page: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    height: '48px',
    background: 'var(--hush-surface)',
    borderBottom: '1px solid var(--hush-border)',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
  },
  roomTitle: {
    fontSize: '0.8rem',
    fontWeight: 500,
    color: 'var(--hush-text-secondary)',
    padding: '4px 8px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '200px',
  },
  headerBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 8px',
    fontSize: '0.8rem',
    fontWeight: 500,
    background: 'var(--hush-badge-live-bg)',
    color: 'var(--hush-live)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    flexShrink: 0,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  participantCount: {
    fontSize: '0.8rem',
    fontWeight: 500,
    color: 'var(--hush-text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    padding: '4px 8px',
    borderRadius: 'var(--radius-sm)',
  },
  main: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    position: 'relative',
  },
  streamsArea: (isMobile, count) => ({
    flex: 1,
    display: 'grid',
    gap: '6px',
    padding: '6px',
    overflow: isMobile && count !== 2 ? 'auto' : 'hidden',
    alignItems: isMobile && count !== 2 ? 'start' : 'stretch',
    alignContent: isMobile && count !== 2 ? 'start' : undefined,
    justifyItems: 'stretch',
    minHeight: 0,
  }),
  sidebar: (isMobile) => ({
    ...(isMobile
      ? {
          position: 'fixed',
          top: '48px',
          right: 0,
          bottom: 0,
          width: '280px',
          zIndex: 50,
          boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
        }
      : {
          width: '260px',
          flexShrink: 0,
          borderLeft: '1px solid var(--hush-border)',
        }),
    background: 'var(--hush-surface)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
    padding: '16px',
  }),
  sidebarOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 49,
  },
  sidebarSection: {
    marginBottom: '20px',
  },
  sidebarLabel: {
    fontSize: '0.7rem',
    fontWeight: 600,
    color: 'var(--hush-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '8px',
  },
  peerItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 0',
    fontSize: '0.85rem',
  },
  peerDot: (isStreaming) => ({
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: isStreaming ? 'var(--hush-live)' : 'var(--hush-text-muted)',
    boxShadow: isStreaming ? '0 0 6px var(--hush-live-glow)' : 'none',
  }),
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: 'var(--hush-text-muted)',
    gap: '16px',
    textAlign: 'center',
    padding: '40px',
  },
  emptyIcon: {
    width: '56px',
    height: '56px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-lg)',
    background: 'var(--hush-surface)',
    border: '1px solid transparent',
  },
  emptyTitle: {
    fontSize: '1rem',
    fontWeight: 500,
    color: 'var(--hush-text-secondary)',
  },
  emptyDescription: {
    fontSize: '0.85rem',
    color: 'var(--hush-text-muted)',
    maxWidth: '280px',
  },
};

function formatCountdown(remainingMs) {
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getColumnCount(count) {
  if (count <= 1) return 1;
  if (count <= 5) return 2;
  return 3;
}

function getGridStyle(count, breakpoint) {
  if (count === 0) return {};
  if (breakpoint === 'mobile') {
    if (count === 1) return { gridTemplateColumns: '1fr' };
    if (count === 2) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr 1fr' };
    return { gridTemplateColumns: '1fr 1fr' };
  }
  const cols = getColumnCount(count);
  const rows = Math.ceil(count / cols);
  if (cols === 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
  return {
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
  };
}

/** Returns the id of the tile that should be the "hero" (placed last, bigger when alone). Priority:
 *  1. Exactly one screen share in the room → that screen share
 *  2. Otherwise → local webcam
 *  3. Fallback → first stream */
function pickHeroId(streams) {
  if (streams.length === 0) return null;
  const screenShares = streams.filter((s) => isScreenShareSource(s.source));
  if (screenShares.length === 1) return screenShares[0].id;
  const localWebcam = streams.find((s) => s.type === 'local' && !isScreenShareSource(s.source));
  if (localWebcam) return localWebcam.id;
  return streams[0].id;
}

function orderWithHeroLast(streams, heroId) {
  if (!heroId) return streams;
  const hero = streams.find((s) => s.id === heroId);
  if (!hero) return streams;
  return [...streams.filter((s) => s.id !== heroId), hero];
}

/** Maps raw room/connection errors to short, user-facing messages. Avoids exposing URLs and stack traces. */
function getFriendlyRoomError(errorMessage) {
  if (!errorMessage || typeof errorMessage !== 'string') return 'Something went wrong. Please try again.';
  const short = errorMessage.trim();
  if (short.length <= 80 && !short.includes('http') && !/^[A-Za-z]+Error:/i.test(short)) return short;
  if (/room not found|not found/i.test(short)) return 'Room not found.';
  if (/disconnected|disconnect/i.test(short)) return short;
  return 'Something went wrong. Please try again.';
}

export default function Room() {
  const navigate = useNavigate();
  const { roomName } = useParams();
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const [connected, setConnected] = useState(false);
  // Track whether the user ever had a valid session in this room.
  // If false when auth guard fires, the user opened a direct link → redirect to /?join=
  // If true, the user was in the room and left/lost session → redirect to /
  const hadSessionRef = useRef(!!sessionStorage.getItem('hush_channelId'));
  const [roomDisplayName, setRoomDisplayName] = useState(() => decodeURIComponent(roomName));
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [recommendedQualityKey, setRecommendedQualityKey] = useState(null);
  const [recommendedUploadMbps, setRecommendedUploadMbps] = useState(null);
  const [liveUploadMbps, setLiveUploadMbps] = useState(null);
  const liveUploadPrevRef = useRef({ bytesSent: null, timestamp: null });
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isWebcamOn, setIsWebcamOn] = useState(false);
  const [showQualityPanel, setShowQualityPanel] = useState(false);
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  const [qualityChangeError, setQualityChangeError] = useState(null);
  const [localScreenWatched, setLocalScreenWatched] = useState(false);
  const [showMicPicker, setShowMicPicker] = useState(false);
  const [showWebcamPicker, setShowWebcamPicker] = useState(false);
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [roomEndTimeMs, setRoomEndTimeMs] = useState(null);
  const [countdownRemainingMs, setCountdownRemainingMs] = useState(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [participantsBadge, setParticipantsBadge] = useState(false);
  const showChatPanelRef = useRef(false);
  const showQualityPanelRef = useRef(false);
  const [wsClient, setWsClient] = useState(null);
  const wsClientRef = useRef(null);
  const seenParticipantIdsRef = useRef(null);

  const getToken = useCallback(
    () => sessionStorage.getItem('hush_jwt') ?? sessionStorage.getItem('hush_token') ?? null,
    [],
  );

  // WebSocket client for Chat (Phase C). Connect when we have channel and Go JWT.
  useEffect(() => {
    const channelId = sessionStorage.getItem('hush_channelId');
    if (!channelId) return;
    const base = typeof location !== 'undefined' ? location.origin.replace(/^http/, 'ws') : '';
    const url = base ? `${base}/ws` : undefined;
    if (!url) return;
    const client = createWsClient({ url, getToken });
    wsClientRef.current = client;
    client.connect();
    setWsClient(client);
    return () => {
      client.disconnect();
      wsClientRef.current = null;
      setWsClient(null);
    };
  }, []);

  const { user } = useAuth();

  const { encryptForUser, decryptFromUser } = useSignal({
    getStore: () => signalStore.openStore(user?.id ?? '', 'default'),
    getToken,
  });

  const {
    isReady,
    error,
    localTracks,
    remoteTracks,
    participants,
    connectRoom,
    disconnectRoom,
    publishScreen,
    unpublishScreen,
    changeQuality,
    publishWebcam,
    unpublishWebcam,
    publishMic,
    unpublishMic,
    availableScreens,
    watchedScreens,
    loadingScreens,
    watchScreen,
    unwatchScreen,
    mediaE2EEUnavailable,
    keyExchangeMessage,
  } = useRoom({
    wsClient,
    getToken,
    currentUserId: user?.id ?? '',
    encryptForUser,
    decryptFromUser,
  });

  const { isAuthenticated, rehydrationAttempted, logout } = useAuth();

  const {
    audioDevices,
    videoDevices,
    selectedMicId,
    selectedWebcamId,
    selectMic,
    selectWebcam,
    hasSavedMic,
    hasSavedWebcam,
    requestPermission,
  } = useDevices();

  // Require Matrix auth (and optional room session data)
  useEffect(() => {
    if (!rehydrationAttempted) return;
    // Only redirect to /?join= if user opened a direct link (never had a session).
    // If they had a session (left room, expired, etc.) go to / instead.
    const joinRedirect = !hadSessionRef.current
      ? '/?join=' + encodeURIComponent(roomName)
      : '/';
    if (!isAuthenticated) {
      navigate(joinRedirect, { replace: true });
      return;
    }
    const channelId = sessionStorage.getItem('hush_channelId');
    const roomNameStored = sessionStorage.getItem('hush_roomName');
    if (!channelId || !roomNameStored) {
      if (sessionStorage.getItem(GUEST_SESSION_KEY) === '1') {
        logout().then(() => navigate(joinRedirect, { replace: true }));
      } else {
        navigate(joinRedirect, { replace: true });
      }
      return;
    }
    hadSessionRef.current = true;
  }, [rehydrationAttempted, isAuthenticated, navigate, logout, roomName]);

  useEffect(() => {
    if (!rehydrationAttempted || !isAuthenticated) return;

    const channelId = sessionStorage.getItem('hush_channelId');
    const roomNameStored = sessionStorage.getItem('hush_roomName');
    if (!channelId || !roomNameStored) return;

    const displayName = sessionStorage.getItem('hush_displayName') || 'Anonymous';

    connectRoom(roomName, displayName, channelId).then(() => {
      setConnected(true);
      console.log('[room] Connected to LiveKit room');
    }).catch((err) => {
      console.error('[room] Connection failed:', err);
      if (err.message === 'Room not found') {
        if (sessionStorage.getItem(GUEST_SESSION_KEY) === '1') {
          logout().then(() => navigate('/', { replace: true }));
        } else {
          navigate('/', { replace: true });
        }
      }
    });

    // Estimate upload speed for quality recommendation (skip on localhost: assume high bandwidth)
    const isLocalhost =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    if (isLocalhost) {
      setRecommendedQualityKey('source');
      setRecommendedUploadMbps(100);
      setQuality('source');
    } else {
      estimateUploadSpeed().then((speed) => {
        const rec = getRecommendedQuality(speed);
        setRecommendedQualityKey(rec.key);
        setRecommendedUploadMbps(rec.uploadMbps);
        setQuality(rec.key);
      });
    }

    return () => {
      disconnectRoom();
    };
  }, [rehydrationAttempted, isAuthenticated, navigate, connectRoom, disconnectRoom, roomName]);


  // Live upload bitrate: poll outbound video stats when streaming (screen or webcam)
  useEffect(() => {
    const videoEntries = Array.from(localTracks.entries()).filter(
      ([, info]) => info.source === MEDIA_SOURCES.SCREEN || info.source === MEDIA_SOURCES.WEBCAM,
    );
    const videoTracks = videoEntries.map(([, info]) => info.track);
    if (videoTracks.length === 0) {
      setLiveUploadMbps(null);
      liveUploadPrevRef.current = { bytesSent: null, timestamp: null };
      return;
    }
    const intervalId = setInterval(async () => {
      const { bytesSent, timestamp } = liveUploadPrevRef.current;
      const result = await measureLiveUploadMbps(videoTracks, bytesSent, timestamp);
      liveUploadPrevRef.current = { bytesSent: result.bytesSent, timestamp: result.timestamp };
      setLiveUploadMbps(result.mbps > 0 ? Math.round(result.mbps * 10) / 10 : null);
    }, 2000);
    return () => clearInterval(intervalId);
  }, [localTracks]);

  // Ensure only one sidebar is open at a time
  useEffect(() => {
    if (showChatPanel && showQualityPanel) {
      setShowQualityPanel(false);
    }
  }, [showChatPanel, showQualityPanel]);

  useEffect(() => {
    if (showQualityPanel && showChatPanel) {
      setShowChatPanel(false);
    }
  }, [showQualityPanel, showChatPanel]);

  // Chat unread badge: track panel open state in a ref to avoid stale closure in callback
  useEffect(() => {
    showChatPanelRef.current = showChatPanel;
    if (showChatPanel) setUnreadChatCount(0);
  }, [showChatPanel]);

  const handleNewChatMessage = useCallback(() => {
    if (!showChatPanelRef.current) setUnreadChatCount((c) => c + 1);
  }, []);

  // Participants badge: track panel open state and watch for new joins after initial load
  useEffect(() => {
    showQualityPanelRef.current = showQualityPanel;
    if (showQualityPanel) setParticipantsBadge(false);
  }, [showQualityPanel]);

  useEffect(() => {
    if (!isScreenSharing) setLocalScreenWatched(false);
  }, [isScreenSharing]);

  // Auto-clear quality change error toast after 4s
  useEffect(() => {
    if (!qualityChangeError) return;
    const t = setTimeout(() => setQualityChangeError(null), 4000);
    return () => clearTimeout(t);
  }, [qualityChangeError]);

  useEffect(() => {
    if (!isReady) return;
    if (seenParticipantIdsRef.current === null) {
      seenParticipantIdsRef.current = new Set(participants.map((p) => p.id));
      return;
    }
    const hasNew = participants.some((p) => !seenParticipantIdsRef.current.has(p.id));
    if (hasNew && !showQualityPanelRef.current) setParticipantsBadge(true);
    participants.forEach((p) => seenParticipantIdsRef.current.add(p.id));
  }, [participants, isReady]);

  // TODO(Yarin, 2026-02-25): Guest room countdown — reimplemented in Phase E with Go backend room limits

  // Countdown tick: update remaining every second; redirect when expired
  useEffect(() => {
    if (roomEndTimeMs == null) return;
    const tick = () => {
      const remaining = Math.max(0, roomEndTimeMs - Date.now());
      setCountdownRemainingMs(remaining);
      if (remaining <= 0) {
        sessionStorage.removeItem('hush_token');
        sessionStorage.removeItem('hush_peerId');
        sessionStorage.removeItem('hush_roomName');
        sessionStorage.removeItem('hush_channelId');
        sessionStorage.removeItem('hush_actualRoomName');
        if (sessionStorage.getItem(GUEST_SESSION_KEY) === '1') {
          logout().catch(() => {});
        }
        navigate('/', { replace: true, state: { message: 'This room has ended.' } });
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [roomEndTimeMs, navigate, logout]);


  const handleScreenShare = async () => {
    if (isScreenSharing) {
      await unpublishScreen();
      setIsScreenSharing(false);
    } else {
      setShowQualityPicker(true);
    }
  };

  const handleQualityPick = async (qualityKey) => {
    setShowQualityPicker(false);
    setQuality(qualityKey);

    try {
      const stream = await publishScreen(qualityKey);
      if (!stream) return;

      setIsScreenSharing(true);
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setIsScreenSharing(false);
      });
    } catch (err) {
      console.error('[room] Screen share failed:', err);
    }
  };

  /** Unified: start share (picker) or change quality/window (re-publish). Same flow as "not streaming → share". */
  const handleScreenShareQualitySelect = async (qualityKey) => {
    if (isScreenSharing) {
      try {
        await handleQualityChange(qualityKey);
        setShowQualityPicker(false);
      } catch {
        // Toast and state revert handled in handleQualityChange
      }
    } else {
      await handleQualityPick(qualityKey);
    }
  };

  const handleMic = async () => {
    if (isMicOn) {
      await unpublishMic();
      setIsMicOn(false);
    } else if (!hasSavedMic) {
      // First time: request permission to get device labels, then show picker
      await requestPermission('audio');
      setShowMicPicker(true);
    } else {
      await publishMic(selectedMicId);
      setIsMicOn(true);
    }
  };

  const handleMicDevicePick = async (deviceId) => {
    setShowMicPicker(false);
    selectMic(deviceId);
    if (isMicOn) await unpublishMic();
    await publishMic(deviceId);
    setIsMicOn(true);
  };

  const handleWebcam = async () => {
    if (isWebcamOn) {
      await unpublishWebcam();
      setIsWebcamOn(false);
    } else if (!hasSavedWebcam) {
      await requestPermission('video');
      setShowWebcamPicker(true);
    } else {
      await publishWebcam(selectedWebcamId);
      setIsWebcamOn(true);
    }
  };

  const handleWebcamDevicePick = async (deviceId) => {
    setShowWebcamPicker(false);
    selectWebcam(deviceId);
    if (isWebcamOn) await unpublishWebcam();
    await publishWebcam(deviceId);
    setIsWebcamOn(true);
  };

  const handleMicDeviceSwitch = async () => {
    await requestPermission('audio');
    setShowMicPicker(true);
  };

  const handleWebcamDeviceSwitch = async () => {
    await requestPermission('video');
    setShowWebcamPicker(true);
  };

  const handleQualityChange = async (newQuality) => {
    const previousQuality = quality;
    setQualityChangeError(null);
    try {
      if (isScreenSharing) {
        await changeQuality(newQuality);
      }
      setQuality(newQuality);
      setShowQualityPanel(false);
    } catch (err) {
      setQuality(previousQuality);
      setQualityChangeError(err?.message || 'Quality change failed');
      throw err;
    }
  };

  const handleLeave = async () => {
    const LEAVE_TIMEOUT_MS = 5000;
    const cleanupAndNavigate = async () => {
      sessionStorage.removeItem('hush_token');
      sessionStorage.removeItem('hush_peerId');
      sessionStorage.removeItem('hush_roomName');
      sessionStorage.removeItem('hush_channelId');
      sessionStorage.removeItem('hush_actualRoomName');
      if (sessionStorage.getItem(GUEST_SESSION_KEY) === '1') {
        await logout().catch(() => {});
      }
      navigate('/');
    };

    try {
      await Promise.race([
        disconnectRoom(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Leave timeout')), LEAVE_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      console.error('[Room] Leave/disconnect error:', err);
    } finally {
      await cleanupAndNavigate();
    }
  };

  const allStreams = [];
  const pairedAudioTracks = new Set();

  // Render local tracks (screen share, webcam). Local screen only in grid when user chose "watch".
  for (const [trackSid, info] of localTracks.entries()) {
    if (info.track.kind === 'video') {
      if (info.source === MEDIA_SOURCES.SCREEN && !localScreenWatched) continue;

      let audioTrack = null;
      if (info.source === MEDIA_SOURCES.SCREEN) {
        for (const [, localInfo] of localTracks.entries()) {
          if (localInfo.source === MEDIA_SOURCES.SCREEN_AUDIO) {
            audioTrack = localInfo.track.mediaStreamTrack;
            break;
          }
        }
      }

      allStreams.push({
        id: trackSid,
        type: 'local',
        track: info.track.mediaStreamTrack,
        audioTrack,
        label: info.source === MEDIA_SOURCES.SCREEN ? 'Your Screen' : 'Your Webcam',
        source: info.source,
      });
    }
  }

  // Render remote tracks
  for (const [trackSid, info] of remoteTracks.entries()) {
    if (info.kind === 'video') {
      const participantId = info.participant.identity;
      const videoSource = info.source;

      // Determine paired audio source
      const pairedAudioSource = videoSource === Track.Source.ScreenShare
        ? Track.Source.ScreenShareAudio
        : Track.Source.Microphone;

      let audioTrack = null;
      for (const [audioSid, audioInfo] of remoteTracks.entries()) {
        if (
          audioInfo.kind === 'audio' &&
          audioInfo.source === pairedAudioSource &&
          audioInfo.participant.identity === participantId
        ) {
          audioTrack = audioInfo.track.mediaStreamTrack;
          pairedAudioTracks.add(audioSid);
          break;
        }
      }
      allStreams.push({
        id: trackSid,
        type: 'remote',
        track: info.track.mediaStreamTrack,
        audioTrack,
        label: info.participant.name || info.participant.identity,
        source: videoSource === Track.Source.ScreenShare ? MEDIA_SOURCES.SCREEN : MEDIA_SOURCES.WEBCAM,
      });
    }
  }

  const orphanAudioConsumers = [];
  for (const [trackSid, info] of remoteTracks.entries()) {
    if (info.kind === 'audio' && !pairedAudioTracks.has(trackSid)) {
      orphanAudioConsumers.push({ id: trackSid, track: info.track.mediaStreamTrack });
    }
  }

  // Derive unwatched remote screen shares
  const unwatchedScreens = [];
  for (const [trackSid, info] of availableScreens.entries()) {
    if (info.source === Track.Source.ScreenShare && !watchedScreens.has(trackSid)) {
      unwatchedScreens.push({
        producerId: trackSid,
        peerId: info.participantId,
        peerName: info.participantName,
      });
    }
  }

  const localScreenCard = isScreenSharing && !localScreenWatched;
  const totalCards = allStreams.length + unwatchedScreens.length + (localScreenCard ? 1 : 0);
  const gridStyle = getGridStyle(totalCards, breakpoint);

  const heroId = pickHeroId(allStreams);
  const cols = isMobile ? 2 : getColumnCount(totalCards);
  const heroIsAlone = totalCards > 1 && totalCards % cols === 1;
  const orderedStreams = orderWithHeroLast(allStreams, heroId);

  const normalTileStyle = isMobile && totalCards !== 2 ? { aspectRatio: '1', width: '100%', minWidth: 0 } : { display: 'contents' };
  const heroAloneStyle = () => {
    if (isMobile) return { gridColumn: '1 / -1', aspectRatio: '1', width: '100%', minWidth: 0 };
    const widthPct = cols === 2 ? 'calc(50% - 3px)' : 'calc(33.33% - 4px)';
    return { gridColumn: '1 / -1', justifySelf: 'center', width: widthPct, display: 'block', minHeight: 0 };
  };
  // Stream tile: hero style only when it's the last card overall (no unwatched screens after it)
  const getTileStyle = (streamId) =>
    heroIsAlone && unwatchedScreens.length === 0 && streamId === heroId
      ? heroAloneStyle()
      : normalTileStyle;
  // Unwatched screen tile: hero style only for the last one in the list
  const getUnwatchedStyle = (index) =>
    heroIsAlone && index === unwatchedScreens.length - 1
      ? heroAloneStyle()
      : normalTileStyle;
  // Local "You're sharing" card: hero when it's the last card (no unwatched after it)
  const getLocalScreenCardStyle = () =>
    heroIsAlone && unwatchedScreens.length === 0 ? heroAloneStyle() : normalTileStyle;

  if (!rehydrationAttempted) {
    return (
      <div style={{ ...styles.page, alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--hush-text-muted)' }}>Loading…</span>
      </div>
    );
  }

  if (rehydrationAttempted && !isAuthenticated) {
    return null; // useEffect will redirect to /?join=<roomName>
  }

  if (error) {
    const displayError = getFriendlyRoomError(error);
    return (
      <div style={styles.page}>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '24px',
          padding: '24px',
        }}>
          <p style={{
            color: 'var(--hush-danger)',
            fontSize: '1rem',
            fontWeight: 500,
            textAlign: 'center',
            maxWidth: '360px',
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
          }}>
            {displayError}
          </p>
          <button
            type="button"
            onClick={handleLeave}
            style={{
              padding: '10px 20px',
              background: 'var(--hush-amber)',
              color: 'var(--hush-black)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.9rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Leave
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.roomTitle}>{roomDisplayName}</span>
          <span style={styles.headerBadge}>
            <span className="live-dot" />
            Live
          </span>
        </div>
        <div style={styles.headerRight}>
          <button
            style={styles.participantCount}
            title="Copy room link"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href);
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 2000);
              } catch {
                console.warn('[room] Clipboard write failed');
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            {linkCopied ? 'copied!' : 'Link'}
          </button>
          <button
            style={{ ...styles.participantCount, position: 'relative' }}
            title="Chat"
            onClick={() => {
              setShowQualityPanel(false);
              setShowChatPanel((prev) => !prev);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Chat
            {unreadChatCount > 0 && (
              <span style={{ position: 'absolute', top: '3px', right: '3px', width: '7px', height: '7px', background: 'var(--hush-amber)', borderRadius: '50%', pointerEvents: 'none' }} />
            )}
          </button>
          <button
            style={{ ...styles.participantCount, position: 'relative' }}
            title="Room panel"
            onClick={() => {
              setShowChatPanel(false);
              setShowQualityPanel((prev) => !prev);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {participants.length + 1}
            {participantsBadge && (
              <span style={{ position: 'absolute', top: '3px', right: '3px', width: '7px', height: '7px', background: 'var(--hush-amber)', borderRadius: '50%', pointerEvents: 'none' }} />
            )}
          </button>
        </div>
      </div>

      <div style={styles.main}>
        {countdownRemainingMs != null && countdownRemainingMs > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: '12px',
              right: '12px',
              fontSize: '0.75rem',
              fontWeight: 500,
              color: 'var(--hush-text-muted)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.02em',
              zIndex: 10,
            }}
            aria-live="polite"
          >
            {formatCountdown(countdownRemainingMs)}
          </div>
        )}
        <div style={{ ...styles.streamsArea(isMobile, totalCards), ...gridStyle }}>
          {totalCards === 0 ? (
            <div style={styles.empty}>
              <div style={styles.emptyIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--hush-text-ghost)" strokeWidth="1.5">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <div style={styles.emptyTitle}>no active streams</div>
              <div style={styles.emptyDescription}>
                click share to start streaming
              </div>
            </div>
          ) : (
            <>
              {orderedStreams.map((stream) => (
                <div key={stream.id} style={getTileStyle(stream.id)}>
                  <StreamView
                    track={stream.track}
                    audioTrack={stream.audioTrack}
                    label={stream.label}
                    source={stream.source}
                    isLocal={stream.type === 'local'}
                    objectFit={isMobile ? 'cover' : 'contain'}
                    onUnwatch={
                      stream.type === 'remote' && stream.source === MEDIA_SOURCES.SCREEN
                        ? () => unwatchScreen(stream.id)
                        : stream.type === 'local' && stream.source === MEDIA_SOURCES.SCREEN
                          ? () => setLocalScreenWatched(false)
                          : undefined
                    }
                    standByAfterMs={stream.source === MEDIA_SOURCES.SCREEN ? STANDBY_AFTER_MS : undefined}
                  />
                </div>
              ))}
              {localScreenCard && (
                <div key="local-screen-card" style={getLocalScreenCardStyle()}>
                  <ScreenShareCard isSelf onWatch={() => setLocalScreenWatched(true)} />
                </div>
              )}
              {unwatchedScreens.map((screen, index) => (
                <div key={screen.producerId} style={getUnwatchedStyle(index)}>
                  <ScreenShareCard
                    peerName={screen.peerName}
                    isLoading={loadingScreens.has(screen.producerId)}
                    onWatch={() => watchScreen(screen.producerId)}
                  />
                </div>
              ))}
            </>
          )}
        </div>

        {isMobile ? (
          <>
            <div
              className={`sidebar-overlay ${showQualityPanel ? 'sidebar-overlay-open' : ''}`}
              onClick={() => setShowQualityPanel(false)}
              aria-hidden={!showQualityPanel}
            />
            <div
              className={`sidebar-panel-right ${showQualityPanel ? 'sidebar-panel-open' : ''}`}
            >
              <div style={styles.sidebarSection}>
                <div style={styles.sidebarLabel}>Participants ({participants.length + 1})</div>
                <div style={styles.peerItem}>
                  <div style={styles.peerDot(isScreenSharing)} />
                  <span>You</span>
                </div>
                {participants.map((participant) => (
                  <div key={participant.id} style={styles.peerItem}>
                    <div style={styles.peerDot(true)} />
                    <span>{participant.displayName}</span>
                  </div>
                ))}
              </div>
            </div>
            <div
              className={`sidebar-overlay ${showChatPanel ? 'sidebar-overlay-open' : ''}`}
              onClick={() => setShowChatPanel(false)}
              aria-hidden={!showChatPanel}
            />
            <div
              className={`sidebar-panel-right ${showChatPanel ? 'sidebar-panel-open' : ''}`}
            >
              <div style={styles.sidebarSection}>
                <div style={styles.sidebarLabel}>Chat</div>
                <Chat
                  channelId={sessionStorage.getItem('hush_channelId')}
                  currentUserId={user?.id ?? ''}
                  getToken={() => sessionStorage.getItem('hush_jwt') ?? sessionStorage.getItem('hush_token') ?? null}
                  getStore={() => {
                    const uid = sessionStorage.getItem('hush_userId');
                    if (!uid) return Promise.resolve(null);
                    return signalStore.openStore(uid, 'default');
                  }}
                  wsClient={wsClient}
                  recipientUserIds={sessionStorage.getItem('hush_peerId') ? [sessionStorage.getItem('hush_peerId')] : []}
                  onNewMessage={handleNewChatMessage}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div
              className={`sidebar-overlay ${showQualityPanel || showChatPanel ? 'sidebar-overlay-open' : ''}`}
              onClick={() => {
                setShowQualityPanel(false);
                setShowChatPanel(false);
              }}
              aria-hidden={!showQualityPanel && !showChatPanel}
            />
            <div
              className={`sidebar-desktop ${showQualityPanel ? 'sidebar-desktop-open' : ''}`}
            >
              <div className="sidebar-desktop-inner" style={styles.sidebar(false)}>
                <div style={styles.sidebarSection}>
                  <div style={styles.sidebarLabel}>Participants ({participants.length + 1})</div>
                  <div style={styles.peerItem}>
                    <div style={styles.peerDot(isScreenSharing)} />
                    <span>You</span>
                  </div>
                  {participants.map((participant) => (
                    <div key={participant.id} style={styles.peerItem}>
                      <div style={styles.peerDot(true)} />
                      <span>{participant.displayName}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div
              className={`sidebar-desktop ${showChatPanel ? 'sidebar-desktop-open' : ''}`}
            >
              <div className="sidebar-desktop-inner" style={styles.sidebar(false)}>
                <div style={styles.sidebarSection}>
                  <div style={styles.sidebarLabel}>Chat</div>
                  <Chat
                    channelId={sessionStorage.getItem('hush_channelId')}
                    currentUserId={user?.id ?? ''}
                    getToken={() => sessionStorage.getItem('hush_jwt') ?? sessionStorage.getItem('hush_token') ?? null}
                    getStore={() => {
                      const uid = sessionStorage.getItem('hush_userId');
                      if (!uid) return Promise.resolve(null);
                      return signalStore.openStore(uid, 'default');
                    }}
                    wsClient={wsClient}
                    recipientUserIds={sessionStorage.getItem('hush_peerId') ? [sessionStorage.getItem('hush_peerId')] : []}
                    onNewMessage={handleNewChatMessage}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {orphanAudioConsumers.map((oa) => (
        <OrphanAudio key={oa.id} track={oa.track} />
      ))}

      {showQualityPicker && (
        <QualityPickerModal
          recommendedQualityKey={recommendedQualityKey}
          recommendedUploadMbps={recommendedUploadMbps}
          onSelect={handleScreenShareQualitySelect}
          onCancel={() => setShowQualityPicker(false)}
        />
      )}

      {showMicPicker && (
        <DevicePickerModal
          title="choose microphone"
          devices={audioDevices}
          selectedDeviceId={selectedMicId}
          onSelect={handleMicDevicePick}
          onCancel={() => setShowMicPicker(false)}
        />
      )}

      {showWebcamPicker && (
        <DevicePickerModal
          title="choose webcam"
          devices={videoDevices}
          selectedDeviceId={selectedWebcamId}
          onSelect={handleWebcamDevicePick}
          onCancel={() => setShowWebcamPicker(false)}
        />
      )}

      <Controls
        isReady={isReady}
        isScreenSharing={isScreenSharing}
        isMicOn={isMicOn}
        isWebcamOn={isWebcamOn}
        quality={quality}
        isMobile={isMobile}
        mediaE2EEUnavailable={mediaE2EEUnavailable}
        onScreenShare={handleScreenShare}
        onOpenQualityOrWindow={() => setShowQualityPicker(true)}
        onMic={handleMic}
        onWebcam={handleWebcam}
        onMicDeviceSwitch={handleMicDeviceSwitch}
        onWebcamDeviceSwitch={handleWebcamDeviceSwitch}
        onLeave={handleLeave}
      />

      {keyExchangeMessage && (
        <div className="toast" role="alert">
          {keyExchangeMessage}
        </div>
      )}
      {qualityChangeError && (
        <div className="toast" role="alert">
          {qualityChangeError}
        </div>
      )}
    </div>
  );
}

function OrphanAudio({ track }) {
  const audioRef = useRef(null);

  useEffect(() => {
    if (!audioRef.current || !track) return;
    const audio = audioRef.current;
    audio.srcObject = new MediaStream([track]);

    const tryPlay = async () => {
      try {
        await audio.play();
      } catch {
        const resume = () => {
          audio.play().catch(() => {});
          document.removeEventListener('touchstart', resume);
          document.removeEventListener('click', resume);
        };
        document.addEventListener('touchstart', resume, { once: true });
        document.addEventListener('click', resume, { once: true });
      }
    };
    tryPlay();

    return () => {
      audio.srcObject = null;
    };
  }, [track]);

  return <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />;
}
