import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useDevices } from '../hooks/useDevices';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { getDeviceId } from '../hooks/useAuth.js';
import DeviceManagement from './DeviceManagement.jsx';
import InstancesSettingsTab from './InstancesSettingsTab.jsx';

const TAB_ACCOUNT = 'account';
const TAB_APPEARANCE = 'appearance';
const TAB_AUDIO_VIDEO = 'audio-video';
const TAB_DEVICES = 'devices';
const TAB_INSTANCES = 'instances';

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


// ─── Logout Confirmation Modal ────────────────────────────

function LogoutConfirmModal({ onConfirm, onCancel, loading }) {
  return createPortal(
    <div className="logout-confirm-overlay">
      <div className="logout-confirm-card">
        <div className="logout-confirm-title">Sign out and wipe data?</div>
        <div className="logout-confirm-body">
          This will permanently delete all local data on this device,
          including your message history, encryption keys, and session.
          Messages will become unreadable after signing out.
        </div>
        <div className="logout-confirm-warning">
          You will need your 12-word recovery phrase to sign back in.
          This action cannot be undone.
        </div>
        <div className="logout-confirm-actions">
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
      <div className="settings-section-title">Account</div>

      <div className="settings-field-row">
        <label className="settings-field-label">Display name</label>
        <div className="settings-field-value">{user?.displayName || 'Anonymous'}</div>
      </div>

      <div className="settings-field-row">
        <label className="settings-field-label">Username</label>
        <div className="settings-field-value">{user?.username || '\u2014'}</div>
      </div>

      <div className="settings-field-row">
        <label className="settings-field-label">Vault timeout</label>
        <select
          value={vaultTimeout}
          onChange={(e) => handleVaultTimeoutChange(e.target.value)}
          className="settings-device-select"
        >
          {VAULT_TIMEOUT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {vaultTimeout === 'never' && (
          <div className="settings-field-note" style={{ color: 'var(--hush-danger)' }}>
            Your key will remain decrypted in memory.
          </div>
        )}
        <div className="settings-field-note">
          How long before your vault locks and requires PIN re-entry.
        </div>
      </div>

      <div className="settings-danger-zone">
        <div className="settings-danger-title">Session</div>
        <div className="settings-danger-action">
          <span className="settings-danger-action-text">
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
      <div className="settings-section-title">Appearance</div>

      <div className="settings-field-row">
        <label className="settings-field-label">Theme mode</label>
        <div className="settings-mode-group">
          {[
            { key: 'system', label: 'System' },
            { key: 'dark', label: 'Dark' },
            { key: 'light', label: 'Light' },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`settings-mode-btn${mode === opt.key ? ' settings-mode-btn--active' : ''}`}
              onClick={() => handleModeChange(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="settings-field-note">
          {mode === 'system'
            ? 'Follows your operating system preference.'
            : mode === 'dark'
              ? 'Always use the selected dark theme.'
              : 'Always use the selected light theme.'}
        </div>
      </div>

      {showDarkPicker && (
        <div className="settings-field-row">
          <label className="settings-field-label">Dark theme</label>
          <div className="settings-mode-group">
            {DARK_THEMES.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`settings-mode-btn${darkTheme === t.key ? ' settings-mode-btn--active' : ''}`}
                onClick={() => handleDarkThemeChange(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {showLightPicker && (
        <div className="settings-field-row">
          <label className="settings-field-label">Light theme</label>
          <div className="settings-mode-group">
            {LIGHT_THEMES.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`settings-mode-btn${lightTheme === t.key ? ' settings-mode-btn--active' : ''}`}
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
      <div className="settings-section-title">Audio & Video</div>

      <div className="settings-field-row">
        <label className="settings-field-label">Microphone</label>
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
            className="settings-device-select"
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

      <div className="settings-field-row">
        <label className="settings-field-label">Webcam</label>
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
            className="settings-device-select"
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
  const { token, identityKeyRef, handshakeData, setTransparencyError } = useAuth();
  const currentDeviceId = getDeviceId();
  return (
    <DeviceManagement
      token={token}
      currentDeviceId={currentDeviceId}
      identityKeyRef={identityKeyRef}
      handshakeData={handshakeData}
      setTransparencyError={setTransparencyError}
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
    { key: TAB_INSTANCES, label: 'My Instances' },
  ];

  return createPortal(
    <div
      className={`settings-overlay${isOpen ? ' settings-overlay--open' : ''}${isMobile ? ' settings-overlay--mobile' : ''}`}
      onClick={handleOverlayClick}
    >
      {isMobile ? (
        <div className="settings-mobile-tab-bar">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`settings-mobile-tab-btn${tab === t.key ? ' settings-mobile-tab-btn--active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="settings-sidebar">
          <div className="settings-sidebar-group">
            <div className="settings-sidebar-group-label">User Settings</div>
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`settings-sidebar-item${tab === t.key ? ' settings-sidebar-item--active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`settings-content${isMobile ? ' settings-content--mobile' : ''}`}>
        {tab === TAB_ACCOUNT && <AccountTab />}
        {tab === TAB_APPEARANCE && <AppearanceTab />}
        {tab === TAB_AUDIO_VIDEO && <AudioVideoTab />}
        {tab === TAB_DEVICES && <DevicesTab />}
        {tab === TAB_INSTANCES && <InstancesSettingsTab />}
      </div>

      <button
        type="button"
        className="settings-close-btn"
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
