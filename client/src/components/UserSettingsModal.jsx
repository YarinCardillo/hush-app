import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useDevices } from '../hooks/useDevices';

const TAB_ACCOUNT = 'account';
const TAB_APPEARANCE = 'appearance';
const TAB_AUDIO_VIDEO = 'audio-video';

const THEME_STORAGE_KEY = 'hush_theme_mode';

function getStoredThemeMode() {
  return localStorage.getItem(THEME_STORAGE_KEY) || 'system';
}

function applyThemeMode(mode) {
  if (mode === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = mode;
  }
  localStorage.setItem(THEME_STORAGE_KEY, mode);
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    zIndex: 200,
    opacity: 0,
    transition: 'opacity var(--duration-normal) var(--ease-out)',
  },
  sidebar: {
    width: '220px',
    flexShrink: 0,
    background: 'var(--hush-surface)',
    borderRight: '1px solid var(--hush-border)',
    display: 'flex',
    flexDirection: 'column',
    padding: '48px 8px 24px',
    overflowY: 'auto',
  },
  sidebarGroup: {
    marginBottom: '4px',
  },
  sidebarGroupLabel: {
    fontSize: '0.68rem',
    fontWeight: 700,
    color: 'var(--hush-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    padding: '8px 8px 4px',
  },
  sidebarItem: (active) => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '7px 8px',
    borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--hush-elevated)' : 'none',
    border: 'none',
    color: active ? 'var(--hush-text)' : 'var(--hush-text-secondary)',
    fontSize: '0.85rem',
    fontFamily: 'var(--font-sans)',
    fontWeight: active ? 500 : 400,
    cursor: 'pointer',
    transition: 'all var(--duration-fast) var(--ease-out)',
  }),
  sidebarDivider: {
    height: '1px',
    background: 'var(--hush-border)',
    margin: '8px 8px',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '48px 40px',
    background: 'var(--hush-black)',
    maxWidth: '680px',
  },
  closeBtn: {
    position: 'fixed',
    top: '16px',
    right: '16px',
    background: 'none',
    border: '1px solid var(--hush-border)',
    borderRadius: '50%',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--hush-text-secondary)',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    fontSize: '1rem',
    zIndex: 201,
    flexShrink: 0,
    transition: 'color var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)',
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: 'var(--hush-text)',
    marginBottom: '24px',
    paddingBottom: '16px',
    borderBottom: '1px solid var(--hush-border)',
  },
  fieldLabel: {
    display: 'block',
    marginBottom: '6px',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--hush-text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  fieldNote: {
    fontSize: '0.75rem',
    color: 'var(--hush-text-muted)',
    marginTop: '4px',
  },
  fieldRow: {
    marginBottom: '24px',
  },
  fieldValue: {
    fontSize: '0.9rem',
    color: 'var(--hush-text)',
    padding: '11px 14px',
    background: 'var(--hush-black)',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-md)',
  },
  dangerZone: {
    marginTop: '40px',
    padding: '16px 20px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--hush-danger)',
    background: 'color-mix(in srgb, var(--hush-danger) 6%, transparent)',
  },
  dangerTitle: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--hush-danger)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: '16px',
  },
  dangerAction: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    gap: '16px',
  },
  dangerActionText: {
    fontSize: '0.85rem',
    color: 'var(--hush-text-secondary)',
  },
  // Appearance tab
  modeGroup: {
    display: 'flex',
    gap: '8px',
  },
  modeBtn: (active) => ({
    flex: 1,
    padding: '12px 16px',
    background: active ? 'var(--hush-elevated)' : 'var(--hush-black)',
    border: active ? '1px solid var(--hush-amber-dim)' : '1px solid transparent',
    borderRadius: 'var(--radius-md)',
    color: active ? 'var(--hush-text)' : 'var(--hush-text-secondary)',
    fontSize: '0.85rem',
    fontFamily: 'var(--font-sans)',
    fontWeight: active ? 500 : 400,
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all var(--duration-fast) var(--ease-out)',
  }),
  // Audio/video tab
  deviceSelect: {
    width: '100%',
    padding: '11px 14px',
    background: 'var(--hush-black)',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-md)',
    color: 'var(--hush-text)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.9rem',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
    transition: 'border-color var(--duration-fast) var(--ease-out)',
  },
};

// ─── Account Tab ──────────────────────────────────────────

function AccountTab() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
    navigate('/');
  };

  return (
    <>
      <div style={styles.sectionTitle}>Account</div>

      <div style={styles.fieldRow}>
        <label style={styles.fieldLabel}>Display name</label>
        <div style={styles.fieldValue}>{user?.displayName || 'Anonymous'}</div>
      </div>

      <div style={styles.fieldRow}>
        <label style={styles.fieldLabel}>Username</label>
        <div style={styles.fieldValue}>{user?.username || '\u2014'}</div>
      </div>

      <div style={styles.dangerZone}>
        <div style={styles.dangerTitle}>Session</div>
        <div style={styles.dangerAction}>
          <span style={styles.dangerActionText}>
            Sign out and return to the home page.
          </span>
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? 'Signing out\u2026' : 'Log out'}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Appearance Tab ───────────────────────────────────────

function AppearanceTab() {
  const [mode, setMode] = useState(getStoredThemeMode);

  const handleModeChange = (newMode) => {
    setMode(newMode);
    applyThemeMode(newMode);
  };

  return (
    <>
      <div style={styles.sectionTitle}>Appearance</div>

      <div style={styles.fieldRow}>
        <label style={styles.fieldLabel}>Theme mode</label>
        <div style={styles.modeGroup}>
          {[
            { key: 'system', label: 'System' },
            { key: 'dark', label: 'OG Dark' },
            { key: 'light', label: 'OG Light' },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              style={styles.modeBtn(mode === opt.key)}
              onClick={() => handleModeChange(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div style={styles.fieldNote}>
          {mode === 'system'
            ? 'Follows your operating system preference.'
            : mode === 'dark'
              ? 'Always use the dark theme.'
              : 'Always use the light theme.'}
        </div>
      </div>
    </>
  );
}

// ─── Audio & Video Tab ────────────────────────────────────

function AudioVideoTab() {
  const {
    audioDevices,
    videoDevices,
    selectedMicId,
    selectedWebcamId,
    selectMic,
    selectWebcam,
    requestPermission,
  } = useDevices();

  const hasAudioLabels = audioDevices.some((d) => d.label);
  const hasVideoLabels = videoDevices.some((d) => d.label);

  return (
    <>
      <div style={styles.sectionTitle}>Audio & Video</div>

      <div style={styles.fieldRow}>
        <label style={styles.fieldLabel}>Microphone</label>
        {audioDevices.length === 0 || !hasAudioLabels ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => requestPermission('audio')}
          >
            Grant microphone access
          </button>
        ) : (
          <select
            style={styles.deviceSelect}
            value={selectedMicId || ''}
            onChange={(e) => selectMic(e.target.value)}
          >
            <option value="">Default</option>
            {audioDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || d.deviceId}
              </option>
            ))}
          </select>
        )}
      </div>

      <div style={styles.fieldRow}>
        <label style={styles.fieldLabel}>Webcam</label>
        {videoDevices.length === 0 || !hasVideoLabels ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => requestPermission('video')}
          >
            Grant webcam access
          </button>
        ) : (
          <select
            style={styles.deviceSelect}
            value={selectedWebcamId || ''}
            onChange={(e) => selectWebcam(e.target.value)}
          >
            <option value="">Default</option>
            {videoDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || d.deviceId}
              </option>
            ))}
          </select>
        )}
      </div>
    </>
  );
}

// ─── Main Modal ───────────────────────────────────────────

export default function UserSettingsModal({ onClose }) {
  const [tab, setTab] = useState(TAB_ACCOUNT);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setIsOpen(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <div
      style={{ ...styles.overlay, ...(isOpen ? { opacity: 1 } : {}) }}
      onClick={handleOverlayClick}
    >
      <div style={styles.sidebar}>
        <div style={styles.sidebarGroup}>
          <div style={styles.sidebarGroupLabel}>User Settings</div>
          <button
            type="button"
            style={styles.sidebarItem(tab === TAB_ACCOUNT)}
            onClick={() => setTab(TAB_ACCOUNT)}
          >
            Account
          </button>
          <button
            type="button"
            style={styles.sidebarItem(tab === TAB_APPEARANCE)}
            onClick={() => setTab(TAB_APPEARANCE)}
          >
            Appearance
          </button>
          <button
            type="button"
            style={styles.sidebarItem(tab === TAB_AUDIO_VIDEO)}
            onClick={() => setTab(TAB_AUDIO_VIDEO)}
          >
            Audio & Video
          </button>
        </div>
      </div>

      <div style={styles.content}>
        {tab === TAB_ACCOUNT && <AccountTab />}
        {tab === TAB_APPEARANCE && <AppearanceTab />}
        {tab === TAB_AUDIO_VIDEO && <AudioVideoTab />}
      </div>

      <button
        type="button"
        style={styles.closeBtn}
        onClick={onClose}
        title="Close (Esc)"
      >
        &#x2715;
      </button>
    </div>
  );
}

export { applyThemeMode, getStoredThemeMode };
