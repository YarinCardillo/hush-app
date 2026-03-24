import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useDevices } from '../hooks/useDevices';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { getDeviceId } from '../hooks/useAuth.js';
import DeviceManagement from './DeviceManagement.jsx';

const TAB_ACCOUNT = 'account';
const TAB_APPEARANCE = 'appearance';
const TAB_AUDIO_VIDEO = 'audio-video';
const TAB_DEVICES = 'devices';

const VAULT_TIMEOUT_KEY = 'hush_vault_timeout';

const VAULT_TIMEOUT_OPTIONS = [
  { value: 'browser_close', label: 'On browser close' },
  { value: 'refresh', label: 'On refresh' },
  { value: '1m', label: '1 minute' },
  { value: '15m', label: '15 minutes' },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: 'never', label: 'Never' },
];

const THEME_MODE_KEY = 'hush_theme_mode';
const DARK_THEME_KEY = 'hush_dark_theme';
const LIGHT_THEME_KEY = 'hush_light_theme';

const DARK_THEMES = [
  { key: 'og-dark', label: 'OG Dark', css: 'dark' },
];

const LIGHT_THEMES = [
  { key: 'og-light', label: 'OG Light', css: 'light' },
];

function getStoredThemeMode() {
  return localStorage.getItem(THEME_MODE_KEY) || 'system';
}

function getStoredDarkTheme() {
  return localStorage.getItem(DARK_THEME_KEY) || 'og-dark';
}

function getStoredLightTheme() {
  return localStorage.getItem(LIGHT_THEME_KEY) || 'og-light';
}

function findThemeCss(key, themes, fallback) {
  const found = themes.find((t) => t.key === key);
  return found ? found.css : fallback;
}

function resolveActiveThemeCss(mode) {
  if (mode === 'light') {
    return findThemeCss(getStoredLightTheme(), LIGHT_THEMES, 'light');
  }
  if (mode === 'dark') {
    return findThemeCss(getStoredDarkTheme(), DARK_THEMES, 'dark');
  }
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark
    ? findThemeCss(getStoredDarkTheme(), DARK_THEMES, 'dark')
    : findThemeCss(getStoredLightTheme(), LIGHT_THEMES, 'light');
}

function applyThemeMode(mode) {
  localStorage.setItem(THEME_MODE_KEY, mode);
  document.documentElement.dataset.theme = resolveActiveThemeCss(mode);
}

// Re-apply when OS preference changes while mode is 'system'
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoredThemeMode() === 'system') {
      document.documentElement.dataset.theme = resolveActiveThemeCss('system');
    }
  });
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

// ─── Logout Confirmation Modal ────────────────────────────

function LogoutConfirmModal({ onConfirm, onCancel, loading }) {
  return createPortal(
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 400,
    }}>
      <div style={{
        background: 'var(--hush-surface)',
        border: '1px solid transparent',
        padding: '28px',
        width: '100%',
        maxWidth: '400px',
      }}>
        <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--hush-text)', marginBottom: '12px' }}>
          Sign out and wipe data?
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--hush-text-secondary)', marginBottom: '8px', lineHeight: 1.6 }}>
          Signing out will delete all local data including your encrypted
          identity key, MLS group states, and session tokens.
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--hush-danger)', marginBottom: '24px', lineHeight: 1.6 }}>
          You will need your 12-word recovery phrase to sign back in.
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            Stay signed in
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? 'Signing out\u2026' : 'Sign out and wipe data'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Account Tab ──────────────────────────────────────────

function AccountTab() {
  const { user, performLogout, logout } = useAuth();
  const navigate = useNavigate();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [vaultTimeout, setVaultTimeout] = useState(
    () => localStorage.getItem(VAULT_TIMEOUT_KEY) || 'browser_close',
  );

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true);
  };

  const handleLogoutConfirm = async () => {
    setLoggingOut(true);
    try {
      // Use scorched-earth wipe if available (BIP39 auth), else standard logout.
      const wipe = performLogout || logout;
      await wipe();
    } finally {
      navigate('/');
    }
  };

  const handleVaultTimeoutChange = (value) => {
    setVaultTimeout(value);
    localStorage.setItem(VAULT_TIMEOUT_KEY, value);
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

      <div style={styles.fieldRow}>
        <label style={styles.fieldLabel}>Vault timeout</label>
        <select
          value={vaultTimeout}
          onChange={(e) => handleVaultTimeoutChange(e.target.value)}
          style={{
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
          }}
        >
          {VAULT_TIMEOUT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {vaultTimeout === 'never' && (
          <div style={{ ...styles.fieldNote, color: 'var(--hush-danger)' }}>
            Your key will remain decrypted in memory.
          </div>
        )}
        <div style={styles.fieldNote}>
          How long before your vault locks and requires PIN re-entry.
        </div>
      </div>

      <div style={styles.dangerZone}>
        <div style={styles.dangerTitle}>Session</div>
        <div style={styles.dangerAction}>
          <span style={styles.dangerActionText}>
            Sign out and permanently wipe all local data.
          </span>
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleLogoutClick}
            disabled={loggingOut}
          >
            {loggingOut ? 'Signing out\u2026' : 'Sign out'}
          </button>
        </div>
      </div>

      {showLogoutConfirm && (
        <LogoutConfirmModal
          onConfirm={handleLogoutConfirm}
          onCancel={() => setShowLogoutConfirm(false)}
          loading={loggingOut}
        />
      )}
    </>
  );
}

// ─── Appearance Tab ───────────────────────────────────────

function AppearanceTab() {
  const [mode, setMode] = useState(getStoredThemeMode);
  const [darkTheme, setDarkTheme] = useState(getStoredDarkTheme);
  const [lightTheme, setLightTheme] = useState(getStoredLightTheme);

  const handleModeChange = (newMode) => {
    setMode(newMode);
    applyThemeMode(newMode);
  };

  const handleDarkThemeChange = (key) => {
    setDarkTheme(key);
    localStorage.setItem(DARK_THEME_KEY, key);
    applyThemeMode(mode);
  };

  const handleLightThemeChange = (key) => {
    setLightTheme(key);
    localStorage.setItem(LIGHT_THEME_KEY, key);
    applyThemeMode(mode);
  };

  const showDarkPicker = mode === 'dark' || mode === 'system';
  const showLightPicker = mode === 'light' || mode === 'system';

  return (
    <>
      <div style={styles.sectionTitle}>Appearance</div>

      <div style={styles.fieldRow}>
        <label style={styles.fieldLabel}>Theme mode</label>
        <div style={styles.modeGroup}>
          {[
            { key: 'system', label: 'System' },
            { key: 'dark', label: 'Dark' },
            { key: 'light', label: 'Light' },
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
              ? 'Always use the selected dark theme.'
              : 'Always use the selected light theme.'}
        </div>
      </div>

      {showDarkPicker && (
        <div style={styles.fieldRow}>
          <label style={styles.fieldLabel}>Dark theme</label>
          <div style={styles.modeGroup}>
            {DARK_THEMES.map((t) => (
              <button
                key={t.key}
                type="button"
                style={styles.modeBtn(darkTheme === t.key)}
                onClick={() => handleDarkThemeChange(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {showLightPicker && (
        <div style={styles.fieldRow}>
          <label style={styles.fieldLabel}>Light theme</label>
          <div style={styles.modeGroup}>
            {LIGHT_THEMES.map((t) => (
              <button
                key={t.key}
                type="button"
                style={styles.modeBtn(lightTheme === t.key)}
                onClick={() => handleLightThemeChange(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
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

// ─── Devices Tab ──────────────────────────────────────────

function DevicesTab() {
  const { token } = useAuth();
  const currentDeviceId = getDeviceId();
  return (
    <DeviceManagement
      token={token}
      currentDeviceId={currentDeviceId}
    />
  );
}

// ─── Main Modal ───────────────────────────────────────────

export default function UserSettingsModal({ onClose }) {
  const [tab, setTab] = useState(TAB_ACCOUNT);
  const [isOpen, setIsOpen] = useState(false);
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';

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

  const tabs = [
    { key: TAB_ACCOUNT, label: 'Account' },
    { key: TAB_APPEARANCE, label: 'Appearance' },
    { key: TAB_AUDIO_VIDEO, label: 'Audio & Video' },
    { key: TAB_DEVICES, label: 'Devices' },
  ];

  return createPortal(
    <div
      style={{
        ...styles.overlay,
        ...(isOpen ? { opacity: 1 } : {}),
        ...(isMobile ? { flexDirection: 'column' } : {}),
      }}
      onClick={handleOverlayClick}
    >
      {isMobile ? (
        <div style={{
          display: 'flex',
          gap: '2px',
          background: 'var(--hush-surface)',
          padding: '8px 8px 0',
          flexShrink: 0,
          borderBottom: '1px solid var(--hush-border)',
          overflowX: 'auto',
        }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              style={{
                flex: '0 0 auto',
                padding: '8px 8px',
                fontSize: '0.72rem',
                fontFamily: 'var(--font-sans)',
                fontWeight: tab === t.key ? 600 : 400,
                color: tab === t.key ? 'var(--hush-text)' : 'var(--hush-text-secondary)',
                background: tab === t.key ? 'var(--hush-elevated)' : 'none',
                border: 'none',
                borderBottom: tab === t.key ? '2px solid var(--hush-amber)' : '2px solid transparent',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : (
        <div style={styles.sidebar}>
          <div style={styles.sidebarGroup}>
            <div style={styles.sidebarGroupLabel}>User Settings</div>
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                style={styles.sidebarItem(tab === t.key)}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{
        ...styles.content,
        ...(isMobile ? { padding: '20px 16px', maxWidth: 'none' } : {}),
      }}>
        {tab === TAB_ACCOUNT && <AccountTab />}
        {tab === TAB_APPEARANCE && <AppearanceTab />}
        {tab === TAB_AUDIO_VIDEO && <AudioVideoTab />}
        {tab === TAB_DEVICES && <DevicesTab />}
      </div>

      <button
        type="button"
        style={styles.closeBtn}
        onClick={onClose}
        title="Close (Esc)"
      >
        &#x2715;
      </button>
    </div>,
    document.body,
  );
}

export { applyThemeMode, getStoredThemeMode, DARK_THEMES, LIGHT_THEMES };
