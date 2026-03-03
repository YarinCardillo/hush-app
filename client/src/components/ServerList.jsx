import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UserSettingsModal from './UserSettingsModal';

const ICON_SIZE = 48;
const STRIP_WIDTH = 72;

const styles = {
  strip: {
    width: STRIP_WIDTH,
    minWidth: STRIP_WIDTH,
    background: 'var(--hush-surface)',
    borderRight: '1px solid transparent',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px 0',
    gap: '8px',
    overflowY: 'auto',
  },
  instanceBtn: (isActive) => ({
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: isActive ? 'var(--hush-amber)' : 'var(--hush-elevated)',
    color: isActive ? 'var(--hush-black)' : 'var(--hush-text)',
    fontSize: '1rem',
    fontWeight: 500,
    fontFamily: 'var(--font-sans)',
    transition: 'all var(--duration-fast) var(--ease-out)',
    overflow: 'hidden',
    flexShrink: 0,
  }),
  settingsBtn: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--hush-elevated)',
    color: 'var(--hush-text-secondary)',
    transition: 'all var(--duration-fast) var(--ease-out)',
    flexShrink: 0,
    marginTop: 'auto',
  },
};

function getInitials(name) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * Sidebar strip showing the single instance icon.
 * Layout is preserved so multi-instance management can extend it to a list.
 *
 * @param {{ getToken: () => string|null, instanceData: object|null }} props
 */
export default function ServerList({ getToken, instanceData }) {
  const navigate = useNavigate();
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [hover, setHover] = useState(false);

  const instanceName = instanceData?.name ?? '';
  const iconUrl = instanceData?.iconUrl ?? null;

  const handleInstanceClick = () => {
    navigate('/channels');
  };

  return (
    <div style={styles.strip}>
      <button
        type="button"
        style={{
          ...styles.instanceBtn(true),
          ...(hover ? { background: 'var(--hush-amber-bright)' } : {}),
        }}
        title={instanceName || 'instance'}
        aria-label={instanceName || 'instance'}
        onClick={handleInstanceClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            width={ICON_SIZE}
            height={ICON_SIZE}
            style={{ objectFit: 'cover', width: '100%', height: '100%' }}
          />
        ) : (
          getInitials(instanceName)
        )}
      </button>

      <button
        type="button"
        style={styles.settingsBtn}
        title="User settings"
        onClick={() => setShowUserSettings(true)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {showUserSettings && (
        <UserSettingsModal onClose={() => setShowUserSettings(false)} />
      )}
    </div>
  );
}
