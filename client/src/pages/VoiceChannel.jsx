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
import VoiceReconnectOverlay from '../components/VoiceReconnectOverlay';

/** Returns inline style for a peer dot based on streaming state. */
function peerDotStyle(isStreaming) {
  return {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: isStreaming ? 'var(--hush-live)' : 'var(--hush-text-muted)',
    boxShadow: isStreaming ? '0 0 6px var(--hush-live-glow)' : 'none',
  };
}

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
export default function VoiceChannel({ channel, serverId, getToken, wsClient, recipientUserIds = [], members = [], onlineUserIds, myRole = 'member', showToast, onMemberUpdate, showMembers = false, showChatPanel = false, showParticipantsPanel = false, onTogglePanel, onLeave, onOrbPhaseChange, serverParticipants = [], onMobileBack, voiceControlsRef, onVoiceStateChange }) {
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
  const [isDeafened, setIsDeafened] = useState(false);
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
    muteMic,
    unmuteMic,
    availableScreens,
    watchedScreens,
    loadingScreens,
    watchScreen,
    unwatchScreen,
    isE2EEEnabled,
    voiceEpoch,
    isVoiceReconnecting,
    voiceReconnectFailed,
    activeSpeakerIds,
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

  // Auto-publish mic when room is ready
  const autoMicFiredRef = useRef(false);
  useEffect(() => {
    if (!isReady || autoMicFiredRef.current) return;
    autoMicFiredRef.current = true;
    (async () => {
      try {
        if (hasSavedMic) {
          await publishMic(selectedMicId);
          micPublishedRef.current = true;
          setIsMicOn(true);
        } else {
          await requestPermission('audio');
          setShowMicPicker(true);
        }
      } catch (err) {
        console.warn('[VoiceChannel] Auto-mic failed:', err);
      }
    })();
  }, [isReady, hasSavedMic, selectedMicId, publishMic, requestPermission]);

  useEffect(() => {
    if (!wsClient || !channel?.id) return;

    connectRoomRef.current(roomName, displayName, channel.id).catch(() => {});

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
      disconnectRoomRef.current();
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

  const micPublishedRef = useRef(false);
  const handleMic = async () => {
    if (isMicOn) {
      // Mic is on — mute it (keep track published)
      await muteMic();
      setIsMicOn(false);
    } else if (!micPublishedRef.current && !hasSavedMic) {
      // Never published — need device selection first
      await requestPermission('audio');
      setShowMicPicker(true);
    } else if (!micPublishedRef.current) {
      // Never published — publish with saved device
      await publishMic(selectedMicId);
      micPublishedRef.current = true;
      setIsMicOn(true);
    } else {
      // Already published — unmute
      await unmuteMic();
      setIsMicOn(true);
    }
  };

  const handleMicDevicePick = async (deviceId) => {
    setShowMicPicker(false);
    selectMic(deviceId);
    if (micPublishedRef.current) await unpublishMic();
    await publishMic(deviceId);
    micPublishedRef.current = true;
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

  const handleDeafen = useCallback(() => {
    setIsDeafened((prev) => {
      const next = !prev;
      // Mute/unmute all remote audio elements
      document.querySelectorAll('audio[autoplay]').forEach((el) => {
        el.muted = next;
      });
      return next;
    });
  }, []);

  // Expose controls to parent via ref (for VoiceConnectedPanel)
  const handleMicRef = useRef(handleMic);
  handleMicRef.current = handleMic;
  useEffect(() => {
    if (voiceControlsRef) {
      voiceControlsRef.current = {
        toggleMic: () => handleMicRef.current(),
        toggleDeafen: handleDeafen,
      };
    }
    onVoiceStateChange?.({ isMicOn, isDeafened });
  }, [voiceControlsRef, isMicOn, isDeafened, handleDeafen, onVoiceStateChange]);

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

  /**
   * Rejoin handler: disconnect the failed room and immediately reconnect.
   * Reuses the existing connectRoom flow which re-derives the MLS frame key.
   */
  const handleRejoin = useCallback(async () => {
    try {
      await disconnectRoom();
    } catch (err) {
      console.warn('[VoiceChannel] Rejoin disconnect error:', err);
    }
    try {
      await connectRoom(roomName, displayName, channel.id);
    } catch (err) {
      console.error('[VoiceChannel] Rejoin connect error:', err);
    }
  }, [disconnectRoom, connectRoom, roomName, displayName, channel.id]);

  if (error) {
    const displayError = getFriendlyRoomError(error);
    return (
      <div className="vc-page">
        <div className="vc-error-center">
          <p className="vc-error-text">{displayError}</p>
          <button type="button" className="btn btn-primary" onClick={handleLeave} style={{ padding: '10px 20px' }}>
            Leave
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="vc-page">
      <div className="vc-header">
        <div className="vc-header-left">
          {onMobileBack && (
            <button
              type="button"
              className="vc-back-btn"
              onClick={onMobileBack}
              aria-label="Back to channels"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <span className="vc-room-title">#{channel._displayName ?? channel.name ?? ''}</span>
          {isVoiceReconnecting ? (
            <div role="status" className="vc-reconnecting">
              Reconnecting...
            </div>
          ) : (
            <span
              className="vc-secure-live-badge"
              title={isE2EEEnabled
                ? `Encrypted${voiceEpoch != null ? ` \u00b7 Epoch ${voiceEpoch}` : ''} \u00b7 Live`
                : 'Live'}
            >
              {isE2EEEnabled ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              ) : (
                <span className="live-dot" />
              )}
              Live
            </span>
          )}
        </div>
        <div className="vc-header-right">
          <button
            className="vc-participant-count"
            title="Chat"
            onClick={() => onTogglePanel('chat')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {unreadChatCount > 0 && <span className="vc-unread-dot" />}
          </button>
          <button
            className="vc-participant-count"
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
            {participantsBadge && <span className="vc-unread-dot" />}
          </button>
          <button
            className="vc-members-toggle"
            title="Members"
            onClick={() => onTogglePanel('members')}
            aria-pressed={showMembers}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </button>
        </div>
      </div>

      <div className="vc-main">
        <div className="vc-content" style={{ position: 'relative' }}>
          <VoiceReconnectOverlay
            isReconnecting={isVoiceReconnecting}
            hasFailed={voiceReconnectFailed}
            onRejoin={handleRejoin}
          />
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
            participants={serverParticipants}
            currentUserId={currentUserId}
            currentDisplayName={displayName}
            activeSpeakerIds={activeSpeakerIds}
            isMicOn={isMicOn}
          />
          <Controls
            isReady={isReady}
            isScreenSharing={isScreenSharing}
            isMicOn={isMicOn}
            isDeafened={isDeafened}
            isWebcamOn={isWebcamOn}
            quality={quality}
            isMobile={isMobile}
            showScreenShare={!isLowLatency}
            showWebcam={!isLowLatency}
            showQualityPicker={!isLowLatency}
            onScreenShare={handleScreenShare}
            onOpenQualityOrWindow={() => setShowQualityPicker(true)}
            onMic={handleMic}
            onDeafen={handleDeafen}
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
              <div className="vc-sidebar-section">
                <div className="vc-sidebar-label">Participants ({totalParticipantCount || 1})</div>
                <div className="vc-peer-item">
                  <div style={peerDotStyle(isScreenSharing)} />
                  <span>You</span>
                </div>
                {displayParticipants.map((p) => (
                  <div key={p.userId} className="vc-peer-item">
                    <div style={peerDotStyle(true)} />
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
              <div className="vc-sidebar-section">
                <div className="vc-sidebar-label">Chat</div>
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
              <div className="sidebar-desktop-inner vc-sidebar-inner">
                <div className="vc-sidebar-section">
                  <div className="vc-sidebar-label">Participants ({totalParticipantCount || 1})</div>
                  <div className="vc-peer-item">
                    <div style={peerDotStyle(isScreenSharing)} />
                    <span>You</span>
                  </div>
                  {displayParticipants.map((p) => (
                    <div key={p.userId} className="vc-peer-item">
                      <div style={peerDotStyle(true)} />
                      <span>{p.displayName}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className={`sidebar-desktop ${showChatPanel ? 'sidebar-desktop-open' : ''}`}>
              <div className="sidebar-desktop-inner vc-sidebar-inner">
                <div className="vc-sidebar-section">
                  <div className="vc-sidebar-label">Chat</div>
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
