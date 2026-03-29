import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useDevices } from '../hooks/useDevices';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useMicMonitor } from '../hooks/useMicMonitor';
import { getDeviceId } from '../hooks/useAuth.js';
import { getVaultConfig } from '../lib/identityVault';
import {
  getMicFilterSettings,
  setMicFilterSettings,
  MIC_GATE_THRESHOLD_MIN_DB,
  MIC_GATE_THRESHOLD_MAX_DB,
  MIC_GATE_THRESHOLD_STEP_DB,
} from '../lib/micProcessing';
import DeviceManagement from './DeviceManagement.jsx';
import InstancesSettingsTab from './InstancesSettingsTab.jsx';

const TAB_ACCOUNT = 'account';
const TAB_APPEARANCE = 'appearance';
const TAB_AUDIO_VIDEO = 'audio-video';
const TAB_DEVICES = 'devices';
const TAB_INSTANCES = 'instances';

const LEGACY_VAULT_TIMEOUT_KEY = 'hush_vault_timeout';

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

function formatVaultTimeoutValue(timeout) {
  if (typeof timeout === 'number') {
    switch (timeout) {
      case 60:
        return '1h';
      case 240:
        return '4h';
      default:
        return `${timeout}m`;
    }
  }
  return timeout || 'browser_close';
}

function parseVaultTimeoutValue(value) {
  switch (value) {
    case 'browser_close':
    case 'refresh':
    case 'never':
      return value;
    case '1m':
      return 1;
    case '15m':
      return 15;
    case '30m':
      return 30;
    case '1h':
      return 60;
    case '4h':
      return 240;
    default:
      return 'browser_close';
  }
}

function getStoredVaultTimeoutValue(userId) {
  const configuredTimeout = userId ? getVaultConfig(userId)?.timeout : null;
  if (configuredTimeout !== undefined && configuredTimeout !== null) {
    return formatVaultTimeoutValue(configuredTimeout);
  }
  return localStorage.getItem(LEGACY_VAULT_TIMEOUT_KEY) || 'browser_close';
}

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

function getMicMonitorErrorMessage(error) {
  if (!error) return null;
  if (error?.name === 'NotAllowedError') {
    return 'Microphone access is required to test your mic.';
  }
  if (error?.name === 'NotFoundError') {
    return 'No microphone input is available on this device.';
  }
  return error?.message || 'Unable to start mic test.';
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
  const { user, performLogout, logout, updateVaultTimeout } = useAuth();
  const navigate = useNavigate();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [vaultTimeout, setVaultTimeout] = useState(
    () => getStoredVaultTimeoutValue(user?.id),
  );

  useEffect(() => {
    setVaultTimeout(getStoredVaultTimeoutValue(user?.id));
  }, [user?.id]);

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
    if (typeof updateVaultTimeout === 'function') {
      updateVaultTimeout(parseVaultTimeoutValue(value));
      return;
    }
    localStorage.setItem(LEGACY_VAULT_TIMEOUT_KEY, value);
  };

  const displayName = user?.displayName || 'Anonymous';
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <>
      <div className="settings-section-title">Account</div>

      {/* Profile card */}
      <div className="settings-profile-card">
        <div className="settings-profile-banner" />
        <div className="settings-profile-body">
          <div className="settings-profile-avatar">{initials}</div>
          <div className="settings-profile-meta">
            <span className="settings-profile-display-name">{displayName}</span>
            <span className="settings-profile-username">@{user?.username || '\u2014'}</span>
          </div>
        </div>
      </div>

      {/* Settings card */}
      <div className="settings-card">
        <div className="settings-card-row">
          <div>
            <div className="settings-field-label">Display name</div>
            <div className="settings-card-value">{displayName}</div>
          </div>
        </div>
        <div className="settings-card-separator" />
        <div className="settings-card-row">
          <div>
            <div className="settings-field-label">Username</div>
            <div className="settings-card-value">{user?.username || '\u2014'}</div>
          </div>
        </div>
        <div className="settings-card-separator" />
        <div className="settings-card-row">
          <div style={{ flex: 1 }}>
            <div className="settings-field-label">Vault timeout</div>
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
        </div>
      </div>

      {/* Danger zone */}
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

function AudioVideoTab({ voiceRuntime = null }) {
  const {
    audioDevices,
    videoDevices,
    selectedMicId,
    selectedWebcamId,
    selectMic,
    selectWebcam,
    requestPermission,
    refreshDevices,
  } = useDevices();
  const {
    isTesting: isMicTesting,
    level: micTestLevel,
    gateOpen: isMicGateOpen,
    error: micTestError,
    setError: setMicTestError,
    start: startMicMonitor,
    stop: stopMicMonitor,
    updateSettings: updateMicMonitorSettings,
  } = useMicMonitor();
  const isolationSnapshotRef = useRef(null);
  const [micFilterSettings, setMicFilterSettingsState] = useState(() => getMicFilterSettings());

  const hasAudioLabels = audioDevices.some((d) => d.label);
  const hasVideoLabels = videoDevices.some((d) => d.label);

  const applyMicFilters = useCallback((nextSettings) => {
    const normalized = setMicFilterSettings(nextSettings);
    setMicFilterSettingsState(normalized);
    voiceRuntime?.onMicFilterSettingsChange?.(normalized);
    updateMicMonitorSettings(normalized);
    return normalized;
  }, [voiceRuntime, updateMicMonitorSettings]);

  const isolateVoiceForMicTest = useCallback(async () => {
    if (!voiceRuntime?.isInVoice) return;

    const snapshot = {
      isInVoice: true,
      isMuted: Boolean(voiceRuntime.isMuted),
      isDeafened: Boolean(voiceRuntime.isDeafened),
      appliedDeafen: false,
      appliedMute: false,
    };
    isolationSnapshotRef.current = snapshot;

    if (!snapshot.isDeafened) {
      snapshot.appliedDeafen = true;
      await Promise.resolve(voiceRuntime?.onDeafen?.());
      return;
    }

    if (!snapshot.isMuted) {
      snapshot.appliedMute = true;
      await Promise.resolve(voiceRuntime?.onMute?.());
    }
  }, [
    voiceRuntime?.isInVoice,
    voiceRuntime?.isMuted,
    voiceRuntime?.isDeafened,
    voiceRuntime?.onMute,
    voiceRuntime?.onDeafen,
  ]);

  const restoreVoiceAfterMicTest = useCallback(async () => {
    const snapshot = isolationSnapshotRef.current;
    isolationSnapshotRef.current = null;

    if (!snapshot?.isInVoice) return;

    if (snapshot.appliedDeafen) {
      await Promise.resolve(voiceRuntime?.onDeafen?.());
      return;
    }

    if (snapshot.appliedMute) {
      await Promise.resolve(voiceRuntime?.onMute?.());
    }
  }, [
    voiceRuntime?.onMute,
    voiceRuntime?.onDeafen,
  ]);

  const startMicTest = useCallback(async (deviceId = selectedMicId) => {
    setMicTestError(null);

    try {
      await isolateVoiceForMicTest();
      await startMicMonitor({
        deviceId: deviceId || null,
        settings: micFilterSettings,
      });
      await refreshDevices().catch(() => {});
    } catch (error) {
      await restoreVoiceAfterMicTest();
      setMicTestError(getMicMonitorErrorMessage(error));
    }
  }, [
    selectedMicId,
    micFilterSettings,
    setMicTestError,
    isolateVoiceForMicTest,
    startMicMonitor,
    refreshDevices,
    restoreVoiceAfterMicTest,
  ]);

  const stopMicTest = useCallback(async () => {
    await stopMicMonitor();
    await restoreVoiceAfterMicTest();
    setMicTestError(null);
  }, [restoreVoiceAfterMicTest, setMicTestError, stopMicMonitor]);

  const cleanupMicTest = useCallback(async () => {
    await stopMicMonitor();
    await restoreVoiceAfterMicTest();
  }, [restoreVoiceAfterMicTest, stopMicMonitor]);

  const handleMicSelectionChange = useCallback(async (event) => {
    const nextDeviceId = event.target.value;
    selectMic(nextDeviceId);

    if (!isMicTesting) return;

    setMicTestError(null);
    try {
      await stopMicMonitor();
      await startMicMonitor({
        deviceId: nextDeviceId || null,
        settings: micFilterSettings,
      });
    } catch (error) {
      await restoreVoiceAfterMicTest();
      setMicTestError(getMicMonitorErrorMessage(error));
    }
  }, [
    selectMic,
    isMicTesting,
    setMicTestError,
    stopMicMonitor,
    startMicMonitor,
    micFilterSettings,
    restoreVoiceAfterMicTest,
  ]);

  const handleMicTestToggle = useCallback(async () => {
    if (isMicTesting) {
      await stopMicTest();
      return;
    }
    await startMicTest();
  }, [isMicTesting, startMicTest, stopMicTest]);

  useEffect(() => {
    return () => {
      void cleanupMicTest();
    };
  }, [cleanupMicTest]);

  return (
    <>
      <div className="settings-section-title">Audio & Video</div>

      <div className="settings-card">
        <div className="settings-card-row">
          <div style={{ flex: 1 }}>
            <div className="settings-field-label">Microphone</div>
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
                onChange={handleMicSelectionChange}
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
        </div>
        <div className="settings-card-separator" />
        <div className="settings-card-row">
          <div style={{ flex: 1 }}>
            <div className="settings-field-label">Webcam</div>
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
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-row settings-card-row--stacked">
          <div className="settings-mic-section-header">
            <div>
              <div className="settings-field-label">Audio Filters</div>
              <div className="settings-card-value">Noise gate</div>
            </div>
            <button
              type="button"
              className={`settings-pill-toggle${micFilterSettings.noiseGateEnabled ? ' settings-pill-toggle--active' : ''}`}
              onClick={() => applyMicFilters({
                noiseGateEnabled: !micFilterSettings.noiseGateEnabled,
              })}
            >
              {micFilterSettings.noiseGateEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
          <div className="settings-field-note">
            Filters the published mic stream before it goes to the room.
          </div>
          <div className="settings-slider-row">
            <label className="settings-slider-label" htmlFor="noise-gate-threshold">
              Gate threshold
            </label>
            <span className="settings-slider-value">
              {micFilterSettings.noiseGateThresholdDb} dB
            </span>
          </div>
          <input
            id="noise-gate-threshold"
            type="range"
            className="settings-range"
            min={MIC_GATE_THRESHOLD_MIN_DB}
            max={MIC_GATE_THRESHOLD_MAX_DB}
            step={MIC_GATE_THRESHOLD_STEP_DB}
            value={micFilterSettings.noiseGateThresholdDb}
            disabled={!micFilterSettings.noiseGateEnabled}
            onChange={(event) => applyMicFilters({
              noiseGateThresholdDb: Number(event.target.value),
            })}
          />
          <div className="settings-range-scale">
            <span>More open</span>
            <span>More aggressive</span>
          </div>
        </div>
        <div className="settings-card-separator" />
        <div className="settings-card-row settings-card-row--stacked">
          <div className="settings-mic-section-header">
            <div>
              <div className="settings-field-label">Mic Test</div>
              <div className="settings-card-value">Listen to your processed mic</div>
            </div>
            <button
              type="button"
              className={`settings-pill-toggle${isMicTesting ? ' settings-pill-toggle--active' : ''}`}
              onClick={handleMicTestToggle}
            >
              {isMicTesting ? 'Stop test' : 'Start test'}
            </button>
          </div>
          <div className="settings-field-note">
            {voiceRuntime?.isInVoice
              ? 'While active, Hush temporarily deafens you from the room and mutes your room mic so you can tune filters safely.'
              : 'Hear the same processed mic path Hush will publish to voice rooms.'}
          </div>
          <div
            className="settings-mic-meter"
            aria-label="Microphone input level"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={micTestLevel}
          >
            <div
              className={`settings-mic-meter-fill${isMicTesting && isMicGateOpen ? ' settings-mic-meter-fill--open' : ''}`}
              style={{ width: `${micTestLevel}%` }}
            />
          </div>
          <div className="settings-mic-test-status">
            {isMicTesting
              ? `Monitoring locally${micFilterSettings.noiseGateEnabled ? ` · gate ${isMicGateOpen ? 'open' : 'closed'}` : ' · gate disabled'}`
              : 'Start the test to hear your mic locally while you adjust the filter.'}
          </div>
          {micTestError && (
            <div className="settings-mic-test-error">
              {micTestError}
            </div>
          )}
        </div>
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

// ─── Sidebar icon components ─────────────────────────────

function IconAccount() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>);
}
function IconAppearance() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 2a7 7 0 0 0 0 20z" fill="currentColor" /></svg>);
}
function IconAudioVideo() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>);
}
function IconDevices() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>);
}
function IconInstances() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></svg>);
}
function IconChangelog() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>);
}

const SIDEBAR_ICONS = {
  [TAB_ACCOUNT]: IconAccount,
  [TAB_APPEARANCE]: IconAppearance,
  [TAB_AUDIO_VIDEO]: IconAudioVideo,
  [TAB_DEVICES]: IconDevices,
  [TAB_INSTANCES]: IconInstances,
};

// ─── Main Modal ───────────────────────────────────────────

export default function UserSettingsModal({ onClose, voiceRuntime = null }) {
  const [tab, setTab] = useState(TAB_ACCOUNT);
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useAuth();
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

  const userTabs = [
    { key: TAB_ACCOUNT, label: 'Account' },
    { key: TAB_APPEARANCE, label: 'Appearance' },
    { key: TAB_AUDIO_VIDEO, label: 'Audio & Video' },
    { key: TAB_DEVICES, label: 'Devices' },
    { key: TAB_INSTANCES, label: 'My Instances' },
  ];

  const displayName = user?.displayName || user?.username || 'User';
  const initials = displayName.charAt(0).toUpperCase();

  return createPortal(
    <div
      className={`settings-overlay${isOpen ? ' settings-overlay--open' : ''}${isMobile ? ' settings-overlay--mobile' : ''}`}
      onClick={handleOverlayClick}
    >
      {isMobile ? (
        <div className="settings-mobile-tab-bar">
          {userTabs.map((t) => (
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
          {/* User profile header */}
          <div className="settings-sidebar-profile">
            <div className="settings-sidebar-avatar">{initials}</div>
            <div className="settings-sidebar-profile-info">
              <span className="settings-sidebar-profile-name">{displayName}</span>
              <span className="settings-sidebar-profile-sub">{user?.username || ''}</span>
            </div>
          </div>

          {/* User Settings group */}
          <div className="settings-sidebar-group">
            <div className="settings-sidebar-group-label">User Settings</div>
            {userTabs.map((t) => {
              const Icon = SIDEBAR_ICONS[t.key];
              return (
                <button
                  key={t.key}
                  type="button"
                  className={`settings-sidebar-item${tab === t.key ? ' settings-sidebar-item--active' : ''}`}
                  onClick={() => setTab(t.key)}
                >
                  {Icon && <Icon />}
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="settings-sidebar-divider" />

          {/* Info links */}
          <div className="settings-sidebar-group">
            <button type="button" className="settings-sidebar-item" onClick={() => window.open('https://github.com/nicholasgriffintn/hush/blob/main/CHANGELOG.md', '_blank')}>
              <IconChangelog />
              Changelog
              <svg className="settings-external-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className={`settings-content${isMobile ? ' settings-content--mobile' : ''}`}>
        <button
          type="button"
          className="settings-close-btn"
          onClick={onClose}
          title="Close (Esc)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        {tab === TAB_ACCOUNT && <AccountTab />}
        {tab === TAB_APPEARANCE && <AppearanceTab />}
        {tab === TAB_AUDIO_VIDEO && <AudioVideoTab voiceRuntime={voiceRuntime} />}
        {tab === TAB_DEVICES && <DevicesTab />}
        {tab === TAB_INSTANCES && <InstancesSettingsTab />}
      </div>
    </div>,
    document.body,
  );
}

export { applyThemeMode, getStoredThemeMode, DARK_THEMES, LIGHT_THEMES };
