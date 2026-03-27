import { QUALITY_PRESETS, IS_SCREEN_SHARE_SUPPORTED } from '../utils/constants';

/**
 * VoiceConnectedPanel — mini voice status panel shown at the bottom of the
 * channel list sidebar when the user is connected to a voice channel.
 *
 * @param {object} props
 * @param {string} props.channelName - Name of the connected voice channel.
 * @param {boolean} props.isMuted - Whether the microphone is muted.
 * @param {boolean} props.isDeafened - Whether audio output is muted (deafened).
 * @param {function} props.onMute - Toggle microphone mute.
 * @param {function} props.onDeafen - Toggle deafen.
 * @param {function} props.onSettings - Open voice/audio settings.
 * @param {function} props.onDisconnect - Disconnect from voice.
 */
export function VoiceConnectedPanel({ channelName, isMuted, isDeafened, onMute, onDeafen, onSettings, onDisconnect }) {
  return (
    <div className="voice-panel">
      <div className="voice-panel-info">
        <span className="voice-panel-channel">{channelName}</span>
        <span className="voice-panel-status">Voice Connected</span>
      </div>
      <div className="voice-panel-controls">
        {/* Mute */}
        <button
          type="button"
          className={`voice-panel-btn${isMuted ? ' muted' : ''}`}
          onClick={onMute}
          title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {isMuted ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .51-.06 1-.16 1.47" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>

        {/* Deafen */}
        <button
          type="button"
          className={`voice-panel-btn${isDeafened ? ' muted' : ''}`}
          onClick={onDeafen}
          title={isDeafened ? 'Undeafen' : 'Deafen'}
        >
          {isDeafened ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" />
              <polyline points="17 3 21 3 21 7" />
              <line x1="15" y1="9" x2="21" y2="3" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
            </svg>
          )}
        </button>

        {/* Settings */}
        {onSettings && (
          <button
            type="button"
            className="voice-panel-btn"
            onClick={onSettings}
            title="Voice settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}

        {/* Disconnect */}
        <button
          type="button"
          className="voice-panel-btn disconnect"
          onClick={onDisconnect}
          title="Disconnect from voice"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07C9.44 17.29 7.76 15.19 6.7 12.77A19.79 19.79 0 0 1 3.63 4.14 2 2 0 0 1 5.6 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L9.58 9.91" />
            <line x1="23" y1="1" x2="1" y2="23" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default function Controls({
  isReady,
  isScreenSharing,
  isMicOn,
  isWebcamOn,
  quality,
  isMobile = false,
  mediaE2EEUnavailable = false,
  showScreenShare = true,
  showWebcam = true,
  showQualityPicker = true,
  onScreenShare,
  onOpenQualityOrWindow,
  onMic,
  onWebcam,
  onMicDeviceSwitch,
  onWebcamDeviceSwitch,
  onLeave,
}) {
  const btnSize = isMobile ? '52px' : '44px';
  const mediaDisabled = mediaE2EEUnavailable;
  const mediaTitle = mediaE2EEUnavailable ? 'Media encryption unavailable' : undefined;

  return (
    <div className="ctrl-bar">
      {/* Screen Share — hidden when showScreenShare false (e.g. low-latency voice) or mobile when not supported */}
      {showScreenShare && (!isMobile || IS_SCREEN_SHARE_SUPPORTED) && (
        <button
          className={`ctrl-btn${isScreenSharing ? ' ctrl-btn--active' : ''}`}
          style={{
            height: btnSize,
            ...(mediaDisabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
          }}
          onClick={onScreenShare}
          disabled={!isReady || !IS_SCREEN_SHARE_SUPPORTED || mediaDisabled}
          title={mediaTitle || (isScreenSharing ? 'Stop sharing' : 'Share screen')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          {isScreenSharing ? 'Stop' : 'Share'}
          {isScreenSharing && (
            <span className="ctrl-quality-tag">{QUALITY_PRESETS[quality]?.label || quality}</span>
          )}
        </button>
      )}

      {/* Change quality or window (only visible when sharing and showQualityPicker) */}
      {showQualityPicker && isScreenSharing && (
        <button
          className={`ctrl-icon-btn${isScreenSharing ? ' ctrl-icon-btn--active' : ''}`}
          style={{ width: btnSize, height: btnSize }}
          onClick={onOpenQualityOrWindow}
          title="Change quality or window"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16 3 21 3 21 8" />
            <line x1="4" y1="20" x2="21" y2="3" />
            <polyline points="21 16 21 21 16 21" />
            <line x1="15" y1="15" x2="21" y2="21" />
          </svg>
        </button>
      )}

      {showScreenShare && <div className="ctrl-divider" />}

      {/* Microphone + device switch (always show chevron when device switch available) */}
      {onMicDeviceSwitch ? (
        <div
          className="ctrl-device-group"
          style={{
            height: btnSize,
            background: isMicOn ? 'var(--hush-amber)' : 'var(--hush-surface)',
            color: isMicOn ? 'var(--hush-black)' : 'var(--hush-text-secondary)',
            ...(mediaDisabled ? { opacity: 0.6, pointerEvents: 'none' } : {}),
          }}
        >
          <button
            type="button"
            className="ctrl-device-group-main"
            style={{ width: btnSize, height: btnSize }}
            onClick={onMic}
            disabled={!isReady || mediaDisabled}
            title={mediaTitle || (isMicOn ? 'Mute mic' : 'Unmute mic')}
          >
            {isMicOn ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .51-.06 1-.16 1.47" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="ctrl-device-group-chevron"
            style={{ height: btnSize }}
            onClick={(e) => {
              e.stopPropagation();
              onMicDeviceSwitch();
            }}
            disabled={mediaDisabled}
            title="Change microphone"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      ) : (
        <button
          className={`ctrl-icon-btn${isMicOn ? ' ctrl-icon-btn--active' : ''}`}
          style={{
            width: btnSize,
            height: btnSize,
            ...(mediaDisabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
          }}
          onClick={onMic}
          disabled={!isReady || mediaDisabled}
          title={mediaTitle || (isMicOn ? 'Mute mic' : 'Unmute mic')}
        >
          {isMicOn ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .51-.06 1-.16 1.47" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>
      )}

      {showWebcam && <div className="ctrl-divider" />}
      {/* Webcam + device switch (hidden when showWebcam false, e.g. low-latency voice) */}
      {showWebcam && onWebcamDeviceSwitch ? (
        <div
          className="ctrl-device-group"
          style={{
            height: btnSize,
            background: isWebcamOn ? 'var(--hush-amber)' : 'var(--hush-surface)',
            color: isWebcamOn ? 'var(--hush-black)' : 'var(--hush-text-secondary)',
            ...(mediaDisabled ? { opacity: 0.6, pointerEvents: 'none' } : {}),
          }}
        >
          <button
            type="button"
            className="ctrl-device-group-main"
            style={{ width: btnSize, height: btnSize }}
            onClick={onWebcam}
            disabled={!isReady || mediaDisabled}
            title={mediaTitle || (isWebcamOn ? 'Turn off camera' : 'Turn on camera')}
          >
            {isWebcamOn ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="ctrl-device-group-chevron"
            style={{ height: btnSize }}
            onClick={(e) => {
              e.stopPropagation();
              onWebcamDeviceSwitch();
            }}
            disabled={mediaDisabled}
            title="Change webcam"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      ) : showWebcam ? (
        <button
          className={`ctrl-icon-btn${isWebcamOn ? ' ctrl-icon-btn--active' : ''}`}
          style={{
            width: btnSize,
            height: btnSize,
            ...(mediaDisabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
          }}
          onClick={onWebcam}
          disabled={!isReady || mediaDisabled}
          title={mediaTitle || (isWebcamOn ? 'Turn off camera' : 'Turn on camera')}
        >
          {isWebcamOn ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          )}
        </button>
      ) : null}

      <div className="ctrl-divider" />

      {/* Leave */}
      <button
        className="ctrl-btn ctrl-btn--danger"
        style={{ height: btnSize }}
        onClick={onLeave}
      >
        Leave
      </button>
    </div>
  );
}
