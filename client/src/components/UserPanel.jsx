import { useState } from 'react';
import UserSettingsModal from './UserSettingsModal';

/**
 * UserPanel — persistent user info panel at the very bottom of the channel
 * sidebar. Always visible regardless of voice state.
 *
 * Shows avatar (initials), username, online status, and quick-access buttons
 * for mic toggle, deafen toggle, and user settings.
 *
 * @param {object} props
 * @param {object} props.user - Auth user object ({ id, username, displayName }).
 * @param {boolean} props.isMuted - Current mic mute state.
 * @param {boolean} props.isDeafened - Current deafen state.
 * @param {boolean} props.isInVoice - Whether user is currently in a voice channel.
 * @param {function} props.onMute - Toggle mic mute.
 * @param {function} props.onDeafen - Toggle deafen.
 * @param {(settings: Partial<{ noiseGateEnabled: boolean, noiseGateThresholdDb: number }>) => void} [props.onMicFilterSettingsChange]
 */
export default function UserPanel({
  user,
  isMuted,
  isDeafened,
  isInVoice,
  onMute,
  onDeafen,
  onMicFilterSettingsChange,
}) {
  const [showSettings, setShowSettings] = useState(false);

  if (!user) return null;

  const displayName = user.displayName || user.username || 'User';
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <>
      <div className="user-panel">
        <div className="user-panel-identity">
          <div className="user-panel-avatar">{initials}</div>
          <div className="user-panel-info">
            <span className="user-panel-name">{displayName}</span>
            <span className="user-panel-status">Online</span>
          </div>
        </div>
        <div className="user-panel-actions">
          {/* Mic toggle */}
          <button
            type="button"
            className={`user-panel-btn${isMuted ? ' user-panel-btn--danger' : ''}`}
            onClick={onMute}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            disabled={!isInVoice}
          >
            {isMuted ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .51-.06 1-.16 1.47" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>

          {/* Deafen toggle */}
          <button
            type="button"
            className={`user-panel-btn${isDeafened ? ' user-panel-btn--danger' : ''}`}
            onClick={onDeafen}
            title={isDeafened ? 'Undeafen' : 'Deafen'}
            disabled={!isInVoice}
          >
            {isDeafened ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
              </svg>
            )}
          </button>

          {/* Settings */}
          <button
            type="button"
            className="user-panel-btn"
            onClick={() => setShowSettings(true)}
            title="User settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>
      {showSettings && (
        <UserSettingsModal
          onClose={() => setShowSettings(false)}
          voiceRuntime={{
            isInVoice,
            isMuted,
            isDeafened,
            onMute,
            onDeafen,
            onMicFilterSettingsChange,
          }}
        />
      )}
    </>
  );
}
