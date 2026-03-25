import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getDeviceId } from '../hooks/useAuth';
import * as mlsStore from '../lib/mlsStore';
import { useRoom } from '../hooks/useRoom';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useDevices } from '../hooks/useDevices';
import { DEFAULT_QUALITY, MEDIA_SOURCES } from '../utils/constants';
import {
  estimateUploadSpeed,
  getRecommendedQuality,
  measureLiveUploadMbps,
} from '../lib/bandwidthEstimator';
import VideoGrid from '../components/VideoGrid';
import Controls from '../components/Controls';
import QualityPickerModal from '../components/QualityPickerModal';
import DevicePickerModal from '../components/DevicePickerModal';
import Chat from '../components/Chat';
import MemberList from '../components/MemberList';

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
    fontSize: '0.9rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
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
  membersToggle: {
    padding: '4px 8px',
    fontSize: '0.8rem',
    fontFamily: 'var(--font-sans)',
    background: 'none',
    border: '1px solid var(--hush-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--hush-text-secondary)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  main: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    position: 'relative',
  },
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
};

function getFriendlyRoomError(errorMessage) {
  if (!errorMessage || typeof errorMessage !== 'string') return 'Something went wrong. Please try again.';
  const short = errorMessage.trim();
  if (short.length <= 80 && !short.includes('http') && !/^[A-Za-z]+Error:/i.test(short)) return short;
  if (/room not found|not found/i.test(short)) return 'Room not found.';
  if (/disconnected|disconnect/i.test(short)) return short;
  return 'Something went wrong. Please try again.';
}

/**
 * Voice channel view: LiveKit room (server-{serverId}-channel-{channel.id}), video grid, controls, chat sidebar.
 * Used by ServerLayout when currentChannel.type === 'voice'.
 */
export default function VoiceChannel({ channel, serverId, getToken, wsClient, recipientUserIds = [], members = [], onlineUserIds, myRole = 'member', showToast, onMemberUpdate, showMembers = false, showChatPanel = false, showParticipantsPanel = false, onTogglePanel, onLeave, onOrbPhaseChange, serverParticipants = [] }) {
  const navigate = useNavigate();
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const { user } = useAuth();
  const currentUserId = user?.id ?? '';
  const displayName = user?.displayName ?? 'Anonymous';

  // Server-authoritative participant list (excludes self for display; "You" is shown separately).
  const displayParticipants = useMemo(
    () => serverParticipants.filter((p) => p.userId !== currentUserId),
    [serverParticipants, currentUserId],
  );
  const totalParticipantCount = serverParticipants.length;

  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [recommendedQualityKey, setRecommendedQualityKey] = useState(null);
  const [recommendedUploadMbps, setRecommendedUploadMbps] = useState(null);
  const [liveUploadMbps, setLiveUploadMbps] = useState(null);
  const liveUploadPrevRef = useRef({ bytesSent: null, timestamp: null });
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isWebcamOn, setIsWebcamOn] = useState(false);
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  const [qualityChangeError, setQualityChangeError] = useState(null);
  const [localScreenWatched, setLocalScreenWatched] = useState(false);
  const [showMicPicker, setShowMicPicker] = useState(false);
  const [showWebcamPicker, setShowWebcamPicker] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [participantsBadge, setParticipantsBadge] = useState(false);
  const showChatPanelRef = useRef(false);
  const showParticipantsPanelRef = useRef(false);
  const seenParticipantIdsRef = useRef(null);

  const roomName = `channel-${channel.id}`;
  const isLowLatency = channel.voiceMode === 'low-latency';

  const getStore = useCallback(
    () => mlsStore.openStore(user?.id ?? '', getDeviceId()),
    [user?.id],
  );
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
    isE2EEEnabled,
    voiceEpoch,
    isVoiceReconnecting,
  } = useRoom({
    wsClient,
    getToken,
    currentUserId,
    getStore,
    voiceKeyRotationHours: undefined, // uses server handshake default (2h) when undefined
  });

  // idle = connecting; waiting = alone; activating = others in room
  const orbPhase = !isReady ? 'idle' : (displayParticipants.length > 0 ? 'activating' : 'waiting');

  useEffect(() => { onOrbPhaseChange?.(orbPhase); }, [orbPhase, onOrbPhaseChange]);

  const connectRoomRef = useRef(connectRoom);
  connectRoomRef.current = connectRoom;
  const disconnectRoomRef = useRef(disconnectRoom);
  disconnectRoomRef.current = disconnectRoom;

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

  // Auto-leave and show toast when muted from voice join
  useEffect(() => {
    if (!error) return;
    if (error.toLowerCase().includes('muted')) {
      showToast?.({ message: error, variant: 'error' });
      onLeave?.();
    }
  }, [error, showToast, onLeave]);

  useEffect(() => {
    if (!wsClient || !channel?.id) return;

    // Track whether this effect instance is still active (StrictMode guard).
    // Prevents the first mount's cleanup from aborting a connection that the
    // second mount hasn't started yet.
    let active = true;

    (async () => {
      // Small delay so StrictMode's first mount/unmount cycle completes
      // before we start the expensive connect (MLS + LiveKit WebSocket).
      await new Promise(r => setTimeout(r, 50));
      if (!active) return;

      connectRoomRef.current(roomName, displayName, channel.id).catch(() => {
        // Connection errors are surfaced via useRoom's `error` state
      });

      const isLocalhost =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      if (isLocalhost) {
        setRecommendedQualityKey('source');
        setRecommendedUploadMbps(100);
        setQuality('source');
      } else {
        estimateUploadSpeed().then((speed) => {
          if (!active) return;
          const rec = getRecommendedQuality(speed);
          setRecommendedQualityKey(rec.key);
          setRecommendedUploadMbps(rec.uploadMbps);
          setQuality(rec.key);
        });
      }
    })();

    return () => {
      active = false;
      // Only disconnect if the room was actually established.
      // Prevents StrictMode first-mount cleanup from aborting in-progress connects.
      if (isReady) {
        disconnectRoomRef.current();
      }
    };
  }, [wsClient, channel?.id, roomName, displayName]);

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


  useEffect(() => {
    showChatPanelRef.current = showChatPanel;
    if (showChatPanel) setUnreadChatCount(0);
  }, [showChatPanel]);
  const handleNewChatMessage = useCallback(() => {
    if (!showChatPanelRef.current) setUnreadChatCount((c) => c + 1);
  }, []);

  useEffect(() => {
    showParticipantsPanelRef.current = showParticipantsPanel;
    if (showParticipantsPanel) setParticipantsBadge(false);
  }, [showParticipantsPanel]);
  useEffect(() => {
    if (!isReady) return;
    if (seenParticipantIdsRef.current === null) {
      seenParticipantIdsRef.current = new Set(displayParticipants.map((p) => p.userId));
      return;
    }
    const hasNew = displayParticipants.some((p) => !seenParticipantIdsRef.current.has(p.userId));
    if (hasNew && !showParticipantsPanelRef.current) setParticipantsBadge(true);
    displayParticipants.forEach((p) => seenParticipantIdsRef.current.add(p.userId));
  }, [displayParticipants, isReady]);

  useEffect(() => {
    if (!isScreenSharing) setLocalScreenWatched(false);
  }, [isScreenSharing]);
  useEffect(() => {
    if (!qualityChangeError) return;
    const t = setTimeout(() => setQualityChangeError(null), 4000);
    return () => clearTimeout(t);
  }, [qualityChangeError]);

  const handleScreenShare = async () => {
    if (isLowLatency) return;
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
      stream.getVideoTracks()[0]?.addEventListener('ended', () => setIsScreenSharing(false));
    } catch (err) {
      console.error('[VoiceChannel] Screen share failed:', err);
    }
  };

  const handleScreenShareQualitySelect = async (qualityKey) => {
    if (isScreenSharing) {
      try {
        await changeQuality(qualityKey);
        setQuality(qualityKey);
        setShowQualityPicker(false);
      } catch (err) {
        setQualityChangeError(err?.message || 'Quality change failed');
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
    if (isLowLatency) return;
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

  const handleLeave = async () => {
    try {
      await disconnectRoom();
    } catch (err) {
      console.error('[VoiceChannel] Leave error:', err);
    }
    if (onLeave) {
      onLeave();
    } else {
      const fallbackPath = serverId ? `/servers/${serverId}/channels` : '/';
      navigate(fallbackPath);
    }
  };

  if (error) {
    const displayError = getFriendlyRoomError(error);
    return (
      <div style={styles.page}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '24px',
            padding: '24px',
          }}
        >
          <p
            style={{
              color: 'var(--hush-danger)',
              fontSize: '1rem',
              fontWeight: 500,
              textAlign: 'center',
              maxWidth: '360px',
              overflowWrap: 'break-word',
              wordBreak: 'break-word',
            }}
          >
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
          <span style={styles.roomTitle}>#{channel._displayName ?? channel.name ?? ''}</span>
          {isE2EEEnabled && !isVoiceReconnecting && (
            <span
              title={`Encrypted${voiceEpoch != null ? ` \u00b7 Epoch ${voiceEpoch}` : ''}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                cursor: 'default',
                color: 'var(--hush-success, #22c55e)',
                marginLeft: '4px',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
          )}
          {isVoiceReconnecting && (
            <div
              role="status"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                backgroundColor: 'var(--hush-warning-bg, rgba(234, 179, 8, 0.1))',
                color: 'var(--hush-warning, #eab308)',
                borderRadius: '6px',
                fontSize: '0.85rem',
              }}
            >
              Reconnecting...
            </div>
          )}
          <span style={styles.headerBadge}>
            <span className="live-dot" />
            Live
          </span>
        </div>
        <div style={styles.headerRight}>
          <button
            style={{ ...styles.participantCount, position: 'relative' }}
            title="Chat"
            onClick={() => onTogglePanel('chat')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Chat
            {unreadChatCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '3px',
                  right: '3px',
                  width: '7px',
                  height: '7px',
                  background: 'var(--hush-amber)',
                  borderRadius: '50%',
                  pointerEvents: 'none',
                }}
              />
            )}
          </button>
          <button
            style={{ ...styles.participantCount, position: 'relative' }}
            title="Participants"
            onClick={() => onTogglePanel('participants')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {totalParticipantCount || 1}
            {participantsBadge && (
              <span
                style={{
                  position: 'absolute',
                  top: '3px',
                  right: '3px',
                  width: '7px',
                  height: '7px',
                  background: 'var(--hush-amber)',
                  borderRadius: '50%',
                  pointerEvents: 'none',
                }}
              />
            )}
          </button>
          <button
            style={styles.membersToggle}
            title="Members"
            onClick={() => onTogglePanel('members')}
            aria-pressed={showMembers}
          >
            Members
          </button>
        </div>
      </div>

      <div style={styles.main}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <VideoGrid
            localTracks={localTracks}
            remoteTracks={remoteTracks}
            availableScreens={availableScreens}
            watchedScreens={watchedScreens}
            loadingScreens={loadingScreens}
            isScreenSharing={isScreenSharing}
            localScreenWatched={localScreenWatched}
            isMobile={isMobile}
            breakpoint={breakpoint}
            onWatchScreen={watchScreen}
            onUnwatchScreen={unwatchScreen}
            onWatchLocalScreen={() => setLocalScreenWatched(true)}
            onUnwatchLocalScreen={() => setLocalScreenWatched(false)}
          />
          <Controls
            isReady={isReady}
            isScreenSharing={isScreenSharing}
            isMicOn={isMicOn}
            isWebcamOn={isWebcamOn}
            quality={quality}
            isMobile={isMobile}
            showScreenShare={!isLowLatency}
            showWebcam={!isLowLatency}
            showQualityPicker={!isLowLatency}
            onScreenShare={handleScreenShare}
            onOpenQualityOrWindow={() => setShowQualityPicker(true)}
            onMic={handleMic}
            onWebcam={handleWebcam}
            onMicDeviceSwitch={handleMicDeviceSwitch}
            onWebcamDeviceSwitch={handleWebcamDeviceSwitch}
            onLeave={handleLeave}
          />
        </div>

        {isMobile ? (
          <>
            <div
              className={`sidebar-overlay ${showParticipantsPanel ? 'sidebar-overlay-open' : ''}`}
              onClick={() => onTogglePanel('participants')}
              aria-hidden={!showParticipantsPanel}
            />
            <div className={`sidebar-panel-right ${showParticipantsPanel ? 'sidebar-panel-open' : ''}`}>
              <div style={styles.sidebarSection}>
                <div style={styles.sidebarLabel}>Participants ({totalParticipantCount || 1})</div>
                <div style={styles.peerItem}>
                  <div style={styles.peerDot(isScreenSharing)} />
                  <span>You</span>
                </div>
                {displayParticipants.map((p) => (
                  <div key={p.userId} style={styles.peerItem}>
                    <div style={styles.peerDot(true)} />
                    <span>{p.displayName}</span>
                  </div>
                ))}
              </div>
            </div>
            <div
              className={`sidebar-overlay ${showChatPanel ? 'sidebar-overlay-open' : ''}`}
              onClick={() => onTogglePanel('chat')}
              aria-hidden={!showChatPanel}
            />
            <div className={`sidebar-panel-right ${showChatPanel ? 'sidebar-panel-open' : ''}`}>
              <div style={styles.sidebarSection}>
                <div style={styles.sidebarLabel}>Chat</div>
                <Chat
                  channelId={channel.id}
                  serverId={serverId}
                  currentUserId={currentUserId}
                  getToken={getToken}
                  getStore={getStore}
                  wsClient={wsClient}
                  recipientUserIds={recipientUserIds}
                  members={members}
                  onNewMessage={handleNewChatMessage}
                />
              </div>
            </div>
            <div
              className={`sidebar-overlay ${showMembers ? 'sidebar-overlay-open' : ''}`}
              onClick={() => onTogglePanel('members')}
              aria-hidden={!showMembers}
            />
            <div className={`sidebar-panel-right ${showMembers ? 'sidebar-panel-open' : ''}`}>
              <MemberList
                members={members}
                onlineUserIds={onlineUserIds ?? new Set()}
                currentUserId={currentUserId}
                myRole={myRole}
                showToast={showToast}
                onMemberUpdate={onMemberUpdate}
              />
            </div>
          </>
        ) : (
          <>
            <div className={`sidebar-desktop ${showParticipantsPanel ? 'sidebar-desktop-open' : ''}`}>
              <div className="sidebar-desktop-inner" style={styles.sidebar(false)}>
                <div style={styles.sidebarSection}>
                  <div style={styles.sidebarLabel}>Participants ({totalParticipantCount || 1})</div>
                  <div style={styles.peerItem}>
                    <div style={styles.peerDot(isScreenSharing)} />
                    <span>You</span>
                  </div>
                  {displayParticipants.map((p) => (
                    <div key={p.userId} style={styles.peerItem}>
                      <div style={styles.peerDot(true)} />
                      <span>{p.displayName}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className={`sidebar-desktop ${showChatPanel ? 'sidebar-desktop-open' : ''}`}>
              <div className="sidebar-desktop-inner" style={styles.sidebar(false)}>
                <div style={styles.sidebarSection}>
                  <div style={styles.sidebarLabel}>Chat</div>
                  <Chat
                    channelId={channel.id}
                    serverId={serverId}
                    currentUserId={currentUserId}
                    getToken={getToken}
                    getStore={getStore}
                    wsClient={wsClient}
                    recipientUserIds={recipientUserIds}
                    members={members}
                    onNewMessage={handleNewChatMessage}
                  />
                </div>
              </div>
            </div>
            <div className={`sidebar-desktop ${showMembers ? 'sidebar-desktop-open' : ''}`}>
              <div className="sidebar-desktop-inner">
                <MemberList
                  members={members}
                  onlineUserIds={onlineUserIds ?? new Set()}
                  currentUserId={currentUserId}
                  myRole={myRole}
                  showToast={showToast}
                  onMemberUpdate={onMemberUpdate}
                />
              </div>
            </div>
          </>
        )}
      </div>

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

      {qualityChangeError && (
        <div className="toast" role="alert">
          {qualityChangeError}
        </div>
      )}
    </div>
  );
}
