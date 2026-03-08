import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useDevices } from '../hooks/useDevices';
import { useBreakpoint } from '../hooks/useBreakpoint';
import {
  searchInstanceUsers,
  instanceBanUser,
  instanceUnbanUser,
  getInstanceAuditLog,
  updateInstanceConfig,
  listServerTemplates,
  createServerTemplate,
  updateServerTemplate,
  deleteServerTemplate,
  fetchWithAuth,
} from '../lib/api';

const TAB_ACCOUNT = 'account';
const TAB_APPEARANCE = 'appearance';
const TAB_AUDIO_VIDEO = 'audio-video';
const TAB_ADMIN_USERS = 'admin-users';
const TAB_ADMIN_AUDIT = 'admin-audit';
const TAB_ADMIN_CONFIG = 'admin-config';
const TAB_ADMIN_TEMPLATE = 'admin-template';

const DURATION_PRESETS = [
  { label: '1 hour', value: 3600 },
  { label: '24 hours', value: 86400 },
  { label: '7 days', value: 604800 },
  { label: '30 days', value: 2592000 },
  { label: 'Permanent', value: null },
];

const ROLE_RANK = { member: 0, mod: 1, admin: 2, owner: 3 };

const AUDIT_ACTIONS = [
  { label: 'All actions', value: '' },
  { label: 'Instance Ban', value: 'instance_ban' },
  { label: 'Instance Unban', value: 'instance_unban' },
  { label: 'Config Change', value: 'config_change' },
  { label: 'Role Change', value: 'user_role_change' },
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

// ─── Admin: User Management Tab ───────────────────────────

const adminStyles = {
  searchInput: {
    width: '100%',
    padding: '11px 14px',
    background: 'var(--hush-black)',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-md)',
    color: 'var(--hush-text)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.9rem',
    outline: 'none',
    transition: 'box-shadow var(--duration-normal) var(--ease-out)',
  },
  resultRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 0',
    borderBottom: '1px solid var(--hush-border)',
    flexWrap: 'wrap',
  },
  badge: (bg, color) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.72rem',
    fontWeight: 500,
    letterSpacing: '0.04em',
    background: bg,
    color: color,
  }),
  inlineForm: {
    width: '100%',
    padding: '12px 0 4px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  textarea: {
    width: '100%',
    padding: '8px 12px',
    background: 'var(--hush-black)',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-md)',
    color: 'var(--hush-text)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.85rem',
    resize: 'vertical',
    minHeight: '60px',
    outline: 'none',
  },
  btnRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  errorText: {
    fontSize: '0.78rem',
    color: 'var(--hush-danger)',
    marginTop: '4px',
  },
  emptyText: {
    fontSize: '0.85rem',
    color: 'var(--hush-text-muted)',
    padding: '24px 0',
    textAlign: 'center',
  },
};

function AdminUsersTab() {
  const { token, user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [banModal, setBanModal] = useState(null);
  const [banReason, setBanReason] = useState('');
  const [banDuration, setBanDuration] = useState(null);
  const [unbanTarget, setUnbanTarget] = useState(null);
  const [unbanReason, setUnbanReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const debounceRef = useRef(null);

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const data = await searchInstanceUsers(token, q.trim());
      setResults(data || []);
    } catch { setResults([]); }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(searchQuery), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery, doSearch]);

  const handleBan = async () => {
    if (!banReason.trim() || !banModal) return;
    setActionLoading(true);
    setActionError('');
    try {
      await instanceBanUser(token, banModal.userId, banReason.trim(), banDuration);
      setBanModal(null);
      setBanReason('');
      setBanDuration(null);
      doSearch(searchQuery);
    } catch (e) { setActionError(e.message); }
    setActionLoading(false);
  };

  const handleUnban = async () => {
    if (!unbanReason.trim() || !unbanTarget) return;
    setActionLoading(true);
    setActionError('');
    try {
      await instanceUnbanUser(token, unbanTarget, unbanReason.trim());
      setUnbanTarget(null);
      setUnbanReason('');
      doSearch(searchQuery);
    } catch (e) { setActionError(e.message); }
    setActionLoading(false);
  };

  const actorRank = ROLE_RANK[user?.role] ?? 0;

  return (
    <>
      <div style={styles.sectionTitle}>User Management</div>

      <div style={styles.fieldRow}>
        <label style={styles.fieldLabel}>Search users</label>
        <input
          type="text"
          placeholder="Type a username..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={adminStyles.searchInput}
        />
      </div>

      {loading && <div style={adminStyles.emptyText}>Searching...</div>}

      {!loading && searchQuery.trim() && results.length === 0 && (
        <div style={adminStyles.emptyText}>No users found</div>
      )}

      {results.map((u) => {
        const targetRank = ROLE_RANK[u.role] ?? 0;
        const canBan = actorRank > targetRank && u.id !== user?.id;

        return (
          <div key={u.id}>
            <div style={adminStyles.resultRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--hush-text)', fontWeight: 500 }}>
                  {u.username}
                  {u.displayName && u.displayName !== u.username && (
                    <span style={{ fontWeight: 400, color: 'var(--hush-text-secondary)', marginLeft: '8px' }}>
                      {u.displayName}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--hush-text-muted)', marginTop: '2px' }}>
                  <span style={adminStyles.badge('var(--hush-elevated)', 'var(--hush-text-secondary)')}>
                    {u.role}
                  </span>
                  <span style={{ marginLeft: '8px' }}>
                    Joined {new Date(u.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                {u.isBanned ? (
                  <>
                    <span style={adminStyles.badge('var(--hush-danger)', '#fff')}>
                      Banned {u.banExpiresAt ? `until ${new Date(u.banExpiresAt).toLocaleDateString()}` : '(permanent)'}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '4px 12px', fontSize: '0.78rem' }}
                      onClick={() => { setUnbanTarget(u.id); setUnbanReason(''); setActionError(''); }}
                    >
                      Unban
                    </button>
                  </>
                ) : canBan ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ padding: '4px 12px', fontSize: '0.78rem' }}
                    onClick={() => { setBanModal({ userId: u.id, username: u.username }); setBanReason(''); setBanDuration(null); setActionError(''); }}
                  >
                    Ban
                  </button>
                ) : null}
              </div>
            </div>

            {/* Inline ban form */}
            {banModal && banModal.userId === u.id && (
              <div style={adminStyles.inlineForm}>
                <label style={styles.fieldLabel}>Ban reason (required)</label>
                <textarea
                  placeholder="Reason for banning this user..."
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  style={adminStyles.textarea}
                />
                <label style={styles.fieldLabel}>Duration</label>
                <select
                  style={styles.deviceSelect}
                  value={banDuration === null ? 'null' : String(banDuration)}
                  onChange={(e) => setBanDuration(e.target.value === 'null' ? null : Number(e.target.value))}
                >
                  {DURATION_PRESETS.map((p) => (
                    <option key={p.label} value={p.value === null ? 'null' : String(p.value)}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <div style={adminStyles.btnRow}>
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ padding: '6px 16px', fontSize: '0.8rem' }}
                    onClick={handleBan}
                    disabled={!banReason.trim() || actionLoading}
                  >
                    {actionLoading ? 'Banning...' : 'Confirm Ban'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '6px 16px', fontSize: '0.8rem' }}
                    onClick={() => setBanModal(null)}
                  >
                    Cancel
                  </button>
                </div>
                {actionError && <div style={adminStyles.errorText}>{actionError}</div>}
              </div>
            )}

            {/* Inline unban form */}
            {unbanTarget === u.id && (
              <div style={adminStyles.inlineForm}>
                <label style={styles.fieldLabel}>Unban reason (required)</label>
                <input
                  type="text"
                  placeholder="Reason for unbanning..."
                  value={unbanReason}
                  onChange={(e) => setUnbanReason(e.target.value)}
                  style={adminStyles.searchInput}
                />
                <div style={adminStyles.btnRow}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '6px 16px', fontSize: '0.8rem' }}
                    onClick={handleUnban}
                    disabled={!unbanReason.trim() || actionLoading}
                  >
                    {actionLoading ? 'Unbanning...' : 'Confirm Unban'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '6px 16px', fontSize: '0.8rem' }}
                    onClick={() => setUnbanTarget(null)}
                  >
                    Cancel
                  </button>
                </div>
                {actionError && <div style={adminStyles.errorText}>{actionError}</div>}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ─── Admin: Audit Log Tab ─────────────────────────────────

function AdminAuditLogTab() {
  const { token } = useAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState('');
  const [targetFilter, setTargetFilter] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const loadEntries = useCallback(async (pageNum, append) => {
    setLoading(true);
    try {
      const data = await getInstanceAuditLog(token, {
        limit: 50,
        offset: pageNum * 50,
        action: actionFilter || undefined,
        targetId: targetFilter.trim() || undefined,
      });
      const items = data || [];
      if (append) {
        setEntries((prev) => [...prev, ...items]);
      } else {
        setEntries(items);
      }
      setHasMore(items.length === 50);
    } catch {
      if (!append) setEntries([]);
      setHasMore(false);
    }
    setLoading(false);
  }, [token, actionFilter, targetFilter]);

  useEffect(() => {
    setPage(0);
    loadEntries(0, false);
  }, [loadEntries]);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    loadEntries(next, true);
  };

  const formatAction = (action) => {
    const map = {
      instance_ban: 'Ban',
      instance_unban: 'Unban',
      config_change: 'Config',
      user_role_change: 'Role',
    };
    return map[action] || action;
  };

  const actionColor = (action) => {
    if (action === 'instance_ban') return { bg: 'var(--hush-danger)', color: '#fff' };
    if (action === 'instance_unban') return { bg: 'var(--hush-live)', color: 'var(--hush-black)' };
    return { bg: 'var(--hush-elevated)', color: 'var(--hush-text-secondary)' };
  };

  return (
    <>
      <div style={styles.sectionTitle}>Instance Audit Log</div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select
          style={{ ...styles.deviceSelect, flex: 1, minWidth: '140px' }}
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        >
          {AUDIT_ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Filter by target user ID..."
          value={targetFilter}
          onChange={(e) => setTargetFilter(e.target.value)}
          style={{ ...adminStyles.searchInput, flex: 1, minWidth: '140px' }}
        />
      </div>

      {loading && entries.length === 0 && <div style={adminStyles.emptyText}>Loading...</div>}
      {!loading && entries.length === 0 && <div style={adminStyles.emptyText}>No audit log entries found</div>}

      {entries.map((entry) => {
        const colors = actionColor(entry.action);
        return (
          <div key={entry.id} style={{ ...adminStyles.resultRow, flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
              <span style={adminStyles.badge(colors.bg, colors.color)}>
                {formatAction(entry.action)}
              </span>
              <span style={{ fontSize: '0.78rem', color: 'var(--hush-text-muted)' }}>
                {new Date(entry.createdAt).toLocaleString()}
              </span>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--hush-text-secondary)' }}>
              <span style={{ color: 'var(--hush-text-muted)' }}>Actor: </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{entry.actorId?.slice(0, 8)}...</span>
              {entry.targetId && (
                <>
                  <span style={{ color: 'var(--hush-text-muted)', marginLeft: '12px' }}>Target: </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{entry.targetId.slice(0, 8)}...</span>
                </>
              )}
            </div>
            {entry.reason && (
              <div style={{ fontSize: '0.8rem', color: 'var(--hush-text-secondary)' }}>
                {entry.reason}
              </div>
            )}
            {entry.metadata && Object.keys(entry.metadata).length > 0 && (
              <div style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--hush-text-muted)', wordBreak: 'break-all' }}>
                {JSON.stringify(entry.metadata)}
              </div>
            )}
          </div>
        );
      })}

      {hasMore && entries.length > 0 && (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', padding: '8px 20px' }}
            onClick={handleLoadMore}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </>
  );
}

// ─── Admin: Instance Config Tab ───────────────────────────

function AdminConfigTab() {
  const { token } = useAuth();
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [regMode, setRegMode] = useState('');
  const [serverPolicy, setServerPolicy] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(token, '/api/instance');
        const data = await res.json();
        if (!cancelled) {
          setConfig(data);
          setRegMode(data.registrationMode || 'open');
          setServerPolicy(data.serverCreationPolicy || 'any_member');
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await updateInstanceConfig(token, {
        registrationMode: regMode,
        serverCreationPolicy: serverPolicy,
      });
      setSuccess('Configuration saved');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  };

  if (!config) return <div style={adminStyles.emptyText}>Loading configuration...</div>;

  return (
    <>
      <div style={styles.sectionTitle}>Instance Config</div>

      <div style={styles.fieldRow}>
        <label style={styles.fieldLabel}>Registration mode</label>
        <select
          style={styles.deviceSelect}
          value={regMode}
          onChange={(e) => setRegMode(e.target.value)}
        >
          <option value="open">Open</option>
          <option value="invite_only">Invite only</option>
          <option value="closed">Closed</option>
        </select>
        <div style={styles.fieldNote}>
          Controls who can register new accounts on this instance.
        </div>
      </div>

      <div style={styles.fieldRow}>
        <label style={styles.fieldLabel}>Server creation policy</label>
        <select
          style={styles.deviceSelect}
          value={serverPolicy}
          onChange={(e) => setServerPolicy(e.target.value)}
        >
          <option value="any_member">Any member</option>
          <option value="admin_only">Admin only</option>
        </select>
        <div style={styles.fieldNote}>
          Controls who can create new servers on this instance.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        {success && <span style={{ fontSize: '0.8rem', color: 'var(--hush-live)' }}>{success}</span>}
        {error && <span style={adminStyles.errorText}>{error}</span>}
      </div>
    </>
  );
}

// ─── Admin: Server Template Tab ───────────────────────────

const DEFAULT_TEMPLATE = [
  { name: 'system', type: 'system', position: -1 },
  { name: 'general', type: 'text', position: 0 },
  { name: 'General', type: 'voice', voiceMode: 'quality', position: 1 },
];

const CHANNEL_TYPE_ICONS = {
  system: '\u{1F6E1}',  // shield
  text: '#',
  voice: '\u{1F50A}',   // speaker
  category: '\u{1F4C1}', // folder
};

const templateStyles = {
  channelRow: (isSystem) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    background: isSystem ? 'var(--hush-elevated)' : 'var(--hush-surface)',
    borderBottom: '1px solid var(--hush-border)',
    opacity: isSystem ? 0.6 : 1,
  }),
  channelRowNested: {
    paddingLeft: '32px',
  },
  typeIcon: {
    fontSize: '0.85rem',
    width: '20px',
    textAlign: 'center',
    flexShrink: 0,
    color: 'var(--hush-text-muted)',
  },
  nameInput: {
    flex: 1,
    minWidth: 0,
    padding: '6px 10px',
    background: 'var(--hush-black)',
    border: '1px solid transparent',
    borderRadius: 0,
    color: 'var(--hush-text)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.85rem',
    outline: 'none',
  },
  nameLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: '0.85rem',
    color: 'var(--hush-text-muted)',
    padding: '6px 10px',
  },
  smallSelect: {
    padding: '6px 10px',
    background: 'var(--hush-black)',
    border: '1px solid transparent',
    borderRadius: 0,
    color: 'var(--hush-text)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.78rem',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
  },
  arrowBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--hush-text-secondary)',
    cursor: 'pointer',
    padding: '2px 4px',
    fontSize: '0.85rem',
    fontFamily: 'var(--font-sans)',
    lineHeight: 1,
    transition: 'color var(--duration-fast) var(--ease-out)',
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--hush-danger)',
    cursor: 'pointer',
    padding: '2px 6px',
    fontSize: '1rem',
    fontFamily: 'var(--font-sans)',
    lineHeight: 1,
    transition: 'opacity var(--duration-fast) var(--ease-out)',
  },
  addForm: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: '12px',
  },
  lockIcon: {
    fontSize: '0.72rem',
    color: 'var(--hush-text-ghost)',
    flexShrink: 0,
  },
  toolbar: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: '16px',
  },
};

/** Channel editor for a single template — used by ServerTemplateTab */
function TemplateChannelEditor({ channels, onChange }) {
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('text');
  const [newVoiceMode, setNewVoiceMode] = useState('quality');

  const recalcPositions = (tpl) => {
    let pos = 0;
    for (let i = 0; i < tpl.length; i++) {
      tpl[i].position = tpl[i].type === 'system' ? -1 : pos++;
    }
  };

  const update = (newChs) => { recalcPositions(newChs); onChange(newChs); };

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    const entry = { name, type: newType, position: 0 };
    if (newType === 'voice') entry.voiceMode = newVoiceMode;
    update([...channels, entry]);
    setNewName(''); setNewType('text'); setNewVoiceMode('quality');
  };

  const categories = channels.filter(ch => ch.type === 'category');

  return (
    <>
      <div style={{ marginTop: '8px' }}>
        {channels.map((ch, idx) => {
          const isSystem = ch.type === 'system';
          const isNested = ch.parentRef && categories.some(c => c.name === ch.parentRef);
          return (
            <div key={idx} style={{ ...templateStyles.channelRow(isSystem), ...(isNested ? templateStyles.channelRowNested : {}) }}>
              <span style={templateStyles.typeIcon}>{CHANNEL_TYPE_ICONS[ch.type] || '?'}</span>
              {isSystem ? (
                <span style={templateStyles.nameLabel}>{ch.name}<span style={templateStyles.lockIcon}> (locked)</span></span>
              ) : (
                <input type="text" value={ch.name} style={templateStyles.nameInput} placeholder="Channel name"
                  onChange={(e) => { const u = channels.map((c, i) => i === idx ? { ...c, name: e.target.value } : c); onChange(u); }} />
              )}
              {ch.type === 'voice' && (
                <select style={templateStyles.smallSelect} value={ch.voiceMode || 'quality'}
                  onChange={(e) => { const u = channels.map((c, i) => i === idx ? { ...c, voiceMode: e.target.value } : c); onChange(u); }}>
                  <option value="quality">Quality</option>
                  <option value="low-latency">Low-latency</option>
                </select>
              )}
              {(ch.type === 'text' || ch.type === 'voice') && categories.length > 0 && (
                <select style={templateStyles.smallSelect} value={ch.parentRef || ''} title="Parent category"
                  onChange={(e) => {
                    const u = channels.map((c, i) => {
                      if (i !== idx) return c;
                      const c2 = { ...c };
                      e.target.value === '' ? delete c2.parentRef : c2.parentRef = e.target.value;
                      return c2;
                    });
                    onChange(u);
                  }}>
                  <option value="">No category</option>
                  {categories.map(cat => <option key={cat.name} value={cat.name}>{cat.name}</option>)}
                </select>
              )}
              {!isSystem && (
                <>
                  <button type="button" style={templateStyles.arrowBtn} onClick={() => { if (idx <= 0) return; const u = [...channels]; [u[idx-1], u[idx]] = [u[idx], u[idx-1]]; update(u); }} disabled={idx === 0} title="Move up">&#x25B2;</button>
                  <button type="button" style={templateStyles.arrowBtn} onClick={() => { if (idx >= channels.length-1) return; const u = [...channels]; [u[idx], u[idx+1]] = [u[idx+1], u[idx]]; update(u); }} disabled={idx === channels.length-1} title="Move down">&#x25BC;</button>
                  <button type="button" style={templateStyles.removeBtn} onClick={() => update(channels.filter((_, i) => i !== idx))} title="Remove">&#x2715;</button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div style={templateStyles.addForm}>
        <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New channel name"
          style={{ ...templateStyles.nameInput, flex: '1 1 120px' }} onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }} />
        <select style={templateStyles.smallSelect} value={newType} onChange={(e) => setNewType(e.target.value)}>
          <option value="text">Text</option><option value="voice">Voice</option><option value="category">Category</option>
        </select>
        {newType === 'voice' && (
          <select style={templateStyles.smallSelect} value={newVoiceMode} onChange={(e) => setNewVoiceMode(e.target.value)}>
            <option value="quality">Quality</option><option value="low-latency">Low-latency</option>
          </select>
        )}
        <button type="button" className="btn btn-secondary" style={{ padding: '6px 14px', fontSize: '0.8rem' }}
          onClick={handleAdd} disabled={!newName.trim()}>Add</button>
      </div>
    </>
  );
}

function ServerTemplateTab() {
  const { token } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Editing state
  const [editingId, setEditingId] = useState(null); // template id being edited, or 'new'
  const [editName, setEditName] = useState('');
  const [editChannels, setEditChannels] = useState([]);
  const [editIsDefault, setEditIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    try {
      const data = await listServerTemplates(token);
      setTemplates(Array.isArray(data) ? data : []);
    } catch {
      setError('Could not load templates');
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listServerTemplates(token);
        if (!cancelled) setTemplates(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setError('Could not load templates');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const startEdit = (tmpl) => {
    setEditingId(tmpl.id);
    setEditName(tmpl.name);
    setEditChannels(tmpl.channels.map(ch => ({ ...ch })));
    setEditIsDefault(tmpl.isDefault);
    setError(''); setSuccess('');
  };

  const startNew = () => {
    setEditingId('new');
    setEditName('');
    setEditChannels([...DEFAULT_TEMPLATE]);
    setEditIsDefault(false);
    setError(''); setSuccess('');
  };

  const cancelEdit = () => { setEditingId(null); setError(''); };

  const validateChannels = (chs) => {
    for (const ch of chs) {
      if (!ch.name || !ch.name.trim()) return 'All channel names must be non-empty';
      if (ch.type === 'voice' && !ch.voiceMode) return 'Voice channels must have a voice mode';
    }
    if (!chs.some(ch => ch.type === 'system')) return 'Template must include a system channel';
    const seen = new Set();
    for (const ch of chs) {
      const key = `${ch.name.toLowerCase()}:${ch.type}`;
      if (seen.has(key)) return `Duplicate channel: "${ch.name}" (${ch.type})`;
      seen.add(key);
    }
    return null;
  };

  const handleSave = async () => {
    if (!editName.trim()) { setError('Template name is required'); return; }
    const err = validateChannels(editChannels);
    if (err) { setError(err); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      const body = { name: editName.trim(), channels: editChannels, isDefault: editIsDefault };
      if (editingId === 'new') {
        await createServerTemplate(token, body);
        setSuccess('Template created');
      } else {
        await updateServerTemplate(token, editingId, body);
        setSuccess('Template saved');
      }
      await reload();
      setEditingId(null);
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) { setError(e.message); }
    setSaving(false);
  };

  const handleDelete = async (tmpl) => {
    if (tmpl.isDefault) { setError('Cannot delete the default template'); return; }
    if (!window.confirm(`Delete template "${tmpl.name}"?`)) return;
    try {
      await deleteServerTemplate(token, tmpl.id);
      await reload();
      setSuccess('Template deleted');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) { setError(e.message); }
  };

  if (loading) return <div style={adminStyles.emptyText}>Loading templates...</div>;

  // Editing view
  if (editingId) {
    return (
      <>
        <div style={styles.sectionTitle}>{editingId === 'new' ? 'New Template' : `Edit: ${editName}`}</div>
        <div style={{ marginTop: '12px' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--hush-text-secondary)' }}>Template name</label>
          <input type="text" className="input" value={editName} onChange={(e) => setEditName(e.target.value)}
            placeholder="e.g. Gaming, Study Group" style={{ marginTop: '4px', marginBottom: '12px' }} autoFocus />
        </div>
        <label style={{ fontSize: '0.8rem', color: 'var(--hush-text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          <input type="checkbox" checked={editIsDefault} onChange={(e) => setEditIsDefault(e.target.checked)} />
          Default template (used when no template is selected)
        </label>
        <div style={{ fontSize: '0.8rem', color: 'var(--hush-text-ghost)', marginBottom: '8px' }}>
          Channels created automatically when this template is chosen. The system channel is always included.
        </div>
        <TemplateChannelEditor channels={editChannels} onChange={setEditChannels} />
        <div style={templateStyles.toolbar}>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : editingId === 'new' ? 'Create Template' : 'Save Changes'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={cancelEdit}>Cancel</button>
          {error && <span style={adminStyles.errorText}>{error}</span>}
        </div>
      </>
    );
  }

  // List view
  return (
    <>
      <div style={styles.sectionTitle}>Server Templates</div>
      <div style={styles.fieldNote}>
        Templates define channels created when a new server is made. Users pick a template when creating a server.
      </div>

      {templates.length === 0 ? (
        <div style={adminStyles.emptyText}>No templates yet.</div>
      ) : (
        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {templates.map(tmpl => (
            <div key={tmpl.id} style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
              background: 'var(--hush-bg-secondary)', borderRadius: 'var(--radius-md)',
              border: tmpl.isDefault ? '1px solid var(--hush-live)' : '1px solid transparent',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--hush-text-primary)' }}>
                  {tmpl.name}
                  {tmpl.isDefault && <span style={{ fontSize: '0.72rem', color: 'var(--hush-live)', marginLeft: '6px' }}>DEFAULT</span>}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--hush-text-ghost)', marginTop: '2px' }}>
                  {tmpl.channels.length} channel{tmpl.channels.length !== 1 ? 's' : ''}: {tmpl.channels.filter(c => c.type !== 'system').map(c => c.type === 'voice' ? `${c.name} (voice)` : `#${c.name}`).join(', ') || 'system only'}
                </div>
              </div>
              <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                onClick={() => startEdit(tmpl)}>Edit</button>
              {!tmpl.isDefault && (
                <button type="button" style={{ ...templateStyles.removeBtn, fontSize: '0.85rem' }}
                  onClick={() => handleDelete(tmpl)} title="Delete template">&#x2715;</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '16px' }}>
        <button type="button" className="btn btn-primary" onClick={startNew}>+ New Template</button>
      </div>

      {success && <div style={{ fontSize: '0.8rem', color: 'var(--hush-live)', marginTop: '8px' }}>{success}</div>}
      {error && <div style={{ ...adminStyles.errorText, marginTop: '8px' }}>{error}</div>}
    </>
  );
}

// ─── Main Modal ───────────────────────────────────────────

export default function UserSettingsModal({ onClose }) {
  const [tab, setTab] = useState(TAB_ACCOUNT);
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useAuth();
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';

  const isInstanceAdmin = user?.role === 'admin' || user?.role === 'owner';
  const isInstanceOwner = user?.role === 'owner';

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

  const baseTabs = [
    { key: TAB_ACCOUNT, label: 'Account' },
    { key: TAB_APPEARANCE, label: 'Appearance' },
    { key: TAB_AUDIO_VIDEO, label: 'Audio & Video' },
  ];

  const adminTabs = [];
  if (isInstanceAdmin) {
    adminTabs.push({ key: TAB_ADMIN_USERS, label: 'User Management' });
  }
  if (isInstanceOwner) {
    adminTabs.push({ key: TAB_ADMIN_AUDIT, label: 'Audit Log' });
  }
  if (isInstanceAdmin) {
    adminTabs.push({ key: TAB_ADMIN_CONFIG, label: 'Instance Config' });
  }
  if (isInstanceOwner) {
    adminTabs.push({ key: TAB_ADMIN_TEMPLATE, label: 'Server Template' });
  }

  const allMobileTabs = [...baseTabs, ...adminTabs];

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
          {allMobileTabs.map((t) => (
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
            {baseTabs.map((t) => (
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
          {isInstanceAdmin && (
            <>
              <div style={styles.sidebarDivider} />
              <div style={styles.sidebarGroup}>
                <div style={styles.sidebarGroupLabel}>Instance Admin</div>
                <button
                  type="button"
                  style={styles.sidebarItem(tab === TAB_ADMIN_USERS)}
                  onClick={() => setTab(TAB_ADMIN_USERS)}
                >
                  User Management
                </button>
                {isInstanceOwner && (
                  <button
                    type="button"
                    style={styles.sidebarItem(tab === TAB_ADMIN_AUDIT)}
                    onClick={() => setTab(TAB_ADMIN_AUDIT)}
                  >
                    Audit Log
                  </button>
                )}
                <button
                  type="button"
                  style={styles.sidebarItem(tab === TAB_ADMIN_CONFIG)}
                  onClick={() => setTab(TAB_ADMIN_CONFIG)}
                >
                  Instance Config
                </button>
                {isInstanceOwner && (
                  <button
                    type="button"
                    style={styles.sidebarItem(tab === TAB_ADMIN_TEMPLATE)}
                    onClick={() => setTab(TAB_ADMIN_TEMPLATE)}
                  >
                    Server Template
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div style={{
        ...styles.content,
        ...(isMobile ? { padding: '20px 16px', maxWidth: 'none' } : {}),
      }}>
        {tab === TAB_ACCOUNT && <AccountTab />}
        {tab === TAB_APPEARANCE && <AppearanceTab />}
        {tab === TAB_AUDIO_VIDEO && <AudioVideoTab />}
        {tab === TAB_ADMIN_USERS && isInstanceAdmin && <AdminUsersTab />}
        {tab === TAB_ADMIN_AUDIT && isInstanceOwner && <AdminAuditLogTab />}
        {tab === TAB_ADMIN_CONFIG && isInstanceAdmin && <AdminConfigTab />}
        {tab === TAB_ADMIN_TEMPLATE && isInstanceOwner && <ServerTemplateTab />}
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
