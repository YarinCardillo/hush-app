import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSignal } from '../hooks/useSignal';
import * as signalStore from '../lib/signalStore';
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
export default function VoiceChannel({ channel, serverId, getToken, wsClient, recipientUserIds = [], showMembers = false, onToggleMembers }) {
  const navigate = useNavigate();
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const { user } = useAuth();
  const currentUserId = user?.id ?? '';
  const displayName = user?.displayName ?? 'Anonymous';

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
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [showParticipantsPanel, setShowParticipantsPanel] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [participantsBadge, setParticipantsBadge] = useState(false);
  const showChatPanelRef = useRef(false);
  const showParticipantsPanelRef = useRef(false);
  const seenParticipantIdsRef = useRef(null);

  const roomName = `server-${serverId}-channel-${channel.id}`;
  const isLowLatency = channel.voiceMode === 'low-latency';

  const getStore = useCallback(
    () => signalStore.openStore(user?.id ?? '', 'default'),
    [user?.id],
  );
  const { encryptForUser, decryptFromUser } = useSignal({
    getStore,
    getToken: getToken ?? (() => null),
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
    currentUserId,
    encryptForUser,
    decryptFromUser,
  });

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

  useEffect(() => {
    if (!wsClient || !channel?.id || !serverId) return;
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
        const rec = getRecommendedQuality(speed);
        setRecommendedQualityKey(rec.key);
        setRecommendedUploadMbps(rec.uploadMbps);
        setQuality(rec.key);
      });
    }

    return () => { disconnectRoomRef.current(); };
  }, [wsClient, channel?.id, serverId, roomName, displayName]);

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

  const toggleChat = useCallback(() => {
    setShowChatPanel((prev) => {
      if (!prev) setShowParticipantsPanel(false);
      return !prev;
    });
  }, []);
  const toggleParticipants = useCallback(() => {
    setShowParticipantsPanel((prev) => {
      if (!prev) setShowChatPanel(false);
      return !prev;
    });
  }, []);

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
      seenParticipantIdsRef.current = new Set(participants.map((p) => p.id));
      return;
    }
    const hasNew = participants.some((p) => !seenParticipantIdsRef.current.has(p.id));
    if (hasNew && !showParticipantsPanelRef.current) setParticipantsBadge(true);
    participants.forEach((p) => seenParticipantIdsRef.current.add(p.id));
  }, [participants, isReady]);

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
    navigate(`/server/${serverId}`);
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
          <span style={styles.roomTitle}>#{channel.name}</span>
          <span style={styles.headerBadge}>
            <span className="live-dot" />
            Live
          </span>
        </div>
        <div style={styles.headerRight}>
          <button
            style={{ ...styles.participantCount, position: 'relative' }}
            title="Chat"
            onClick={toggleChat}
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
            onClick={toggleParticipants}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {participants.length + 1}
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
          {onToggleMembers && (
            <button
              style={styles.participantCount}
              title="Members"
              onClick={onToggleMembers}
              aria-pressed={showMembers}
            >
              Members
            </button>
          )}
        </div>
      </div>

      <div style={styles.main}>
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

        {isMobile ? (
          <>
            <div
              className={`sidebar-overlay ${showParticipantsPanel ? 'sidebar-overlay-open' : ''}`}
              onClick={() => setShowParticipantsPanel(false)}
              aria-hidden={!showParticipantsPanel}
            />
            <div className={`sidebar-panel-right ${showParticipantsPanel ? 'sidebar-panel-open' : ''}`}>
              <div style={styles.sidebarSection}>
                <div style={styles.sidebarLabel}>Participants ({participants.length + 1})</div>
                <div style={styles.peerItem}>
                  <div style={styles.peerDot(isScreenSharing)} />
                  <span>You</span>
                </div>
                {participants.map((p) => (
                  <div key={p.id} style={styles.peerItem}>
                    <div style={styles.peerDot(true)} />
                    <span>{p.displayName}</span>
                  </div>
                ))}
              </div>
            </div>
            <div
              className={`sidebar-overlay ${showChatPanel ? 'sidebar-overlay-open' : ''}`}
              onClick={() => setShowChatPanel(false)}
              aria-hidden={!showChatPanel}
            />
            <div className={`sidebar-panel-right ${showChatPanel ? 'sidebar-panel-open' : ''}`}>
              <div style={styles.sidebarSection}>
                <div style={styles.sidebarLabel}>Chat</div>
                <Chat
                  channelId={channel.id}
                  currentUserId={currentUserId}
                  getToken={getToken}
                  getStore={getStore}
                  wsClient={wsClient}
                  recipientUserIds={recipientUserIds}
                  onNewMessage={handleNewChatMessage}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div
              className={`sidebar-overlay ${showParticipantsPanel || showChatPanel ? 'sidebar-overlay-open' : ''}`}
              onClick={() => {
                setShowParticipantsPanel(false);
                setShowChatPanel(false);
              }}
              aria-hidden={!showParticipantsPanel && !showChatPanel}
            />
            <div className={`sidebar-desktop ${showParticipantsPanel ? 'sidebar-desktop-open' : ''}`}>
              <div className="sidebar-desktop-inner" style={styles.sidebar(false)}>
                <div style={styles.sidebarSection}>
                  <div style={styles.sidebarLabel}>Participants ({participants.length + 1})</div>
                  <div style={styles.peerItem}>
                    <div style={styles.peerDot(isScreenSharing)} />
                    <span>You</span>
                  </div>
                  {participants.map((p) => (
                    <div key={p.id} style={styles.peerItem}>
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
                    currentUserId={currentUserId}
                    getToken={getToken}
                    getStore={getStore}
                    wsClient={wsClient}
                    recipientUserIds={recipientUserIds}
                    onNewMessage={handleNewChatMessage}
                  />
                </div>
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

      <Controls
        isReady={isReady}
        isScreenSharing={isScreenSharing}
        isMicOn={isMicOn}
        isWebcamOn={isWebcamOn}
        quality={quality}
        isMobile={isMobile}
        mediaE2EEUnavailable={mediaE2EEUnavailable}
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
