import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { updateInstance, getGuildMembers } from '../lib/api';
import ConfirmModal from './ConfirmModal';
import { useBreakpoint } from '../hooks/useBreakpoint';

const TAB_OVERVIEW = 'overview';
const TAB_MEMBERS = 'members';

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
  saveRow: {
    display: 'flex',
    gap: '8px',
    marginTop: '24px',
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
  memberList: {
    marginTop: '8px',
  },
  memberRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 0',
    borderBottom: '1px solid var(--hush-border)',
    gap: '12px',
  },
  memberAvatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: 'var(--hush-elevated)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.8rem',
    fontWeight: 700,
    color: 'var(--hush-text)',
    flexShrink: 0,
    textTransform: 'uppercase',
  },
  memberName: {
    flex: 1,
    fontSize: '0.85rem',
    color: 'var(--hush-text)',
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  memberRoleBadge: (isAdmin) => ({
    fontSize: '0.68rem',
    fontWeight: 700,
    padding: '2px 7px',
    borderRadius: 'var(--radius-sm)',
    background: isAdmin
      ? 'color-mix(in srgb, var(--hush-amber) 15%, transparent)'
      : 'var(--hush-elevated)',
    color: isAdmin ? 'var(--hush-amber)' : 'var(--hush-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    flexShrink: 0,
  }),
  errorMsg: {
    fontSize: '0.8rem',
    color: 'var(--hush-danger)',
    marginTop: '8px',
  },
  successMsg: {
    fontSize: '0.8rem',
    color: 'var(--hush-live)',
    marginTop: '8px',
  },
};

/**
 * Overview tab: edit instance name, icon URL, and registration mode.
 * Only the owner can access this.
 */
function OverviewTab({ getToken, instanceName, instanceData }) {
  const [name, setName] = useState(instanceName ?? '');
  const [iconUrl, setIconUrl] = useState(instanceData?.iconUrl ?? '');
  const [registrationMode, setRegistrationMode] = useState(instanceData?.registrationMode ?? 'invite_only');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const isDirty =
    name.trim() !== (instanceName ?? '') ||
    iconUrl.trim() !== (instanceData?.iconUrl ?? '') ||
    registrationMode !== (instanceData?.registrationMode ?? 'invite_only');

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    try {
      await updateInstance(getToken(), {
        name: trimmedName,
        iconUrl: iconUrl.trim() || undefined,
        registrationMode,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setName(instanceName ?? '');
    setIconUrl(instanceData?.iconUrl ?? '');
    setRegistrationMode(instanceData?.registrationMode ?? 'invite_only');
    setSaveError('');
    setSaveSuccess(false);
  };

  return (
    <>
      <div style={styles.sectionTitle}>Overview</div>

      <div style={styles.fieldRow}>
        <label htmlFor="settings-instance-name" style={styles.fieldLabel}>Instance name</label>
        <input
          id="settings-instance-name"
          className="input"
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setSaveError(''); setSaveSuccess(false); }}
          maxLength={100}
          autoComplete="off"
        />
      </div>

      <div style={styles.fieldRow}>
        <label htmlFor="settings-icon-url" style={styles.fieldLabel}>Icon URL (optional)</label>
        <input
          id="settings-icon-url"
          className="input"
          type="url"
          placeholder="https://..."
          value={iconUrl}
          onChange={(e) => { setIconUrl(e.target.value); setSaveError(''); setSaveSuccess(false); }}
          autoComplete="off"
        />
      </div>

      <div style={styles.fieldRow}>
        <label htmlFor="settings-registration-mode" style={styles.fieldLabel}>Registration mode</label>
        <select
          id="settings-registration-mode"
          className="input"
          value={registrationMode}
          onChange={(e) => { setRegistrationMode(e.target.value); setSaveError(''); setSaveSuccess(false); }}
        >
          <option value="open">Open (anyone can register)</option>
          <option value="invite_only">Invite only</option>
        </select>
        <div style={styles.fieldNote}>
          Invite-only mode requires users to have an invite link to register.
        </div>
      </div>

      {saveError && <div style={styles.errorMsg}>{saveError}</div>}
      {saveSuccess && <div style={styles.successMsg}>Saved.</div>}

      {isDirty && (
        <div style={styles.saveRow}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !name.trim()}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleReset}>
            Reset
          </button>
        </div>
      )}
    </>
  );
}

function MembersTab({ getToken, serverId }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!serverId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    getGuildMembers(getToken(), serverId)
      .then((list) => { if (!cancelled) { setMembers(list); setLoading(false); } })
      .catch((err) => { if (!cancelled) { setError(err.message || 'Failed to load members'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [getToken, serverId]);

  return (
    <>
      <div style={styles.sectionTitle}>
        Members{members.length > 0 ? ` — ${members.length}` : ''}
      </div>

      {loading && (
        <div style={{ color: 'var(--hush-text-muted)', fontSize: '0.85rem' }}>Loading…</div>
      )}
      {error && <div style={styles.errorMsg}>{error}</div>}

      {!loading && !error && (
        <div style={styles.memberList}>
          {members.map((m) => {
            const memberId = m.id ?? m.userId ?? '';
            const isPrivileged = m.role === 'owner' || m.role === 'admin';
            const initial = (m.displayName || m.username || '?')[0].toUpperCase();
            return (
              <div key={memberId} style={styles.memberRow}>
                <div style={styles.memberAvatar}>{initial}</div>
                <span style={styles.memberName}>{m.displayName || m.username}</span>
                <span style={styles.memberRoleBadge(isPrivileged)}>
                  {m.role ?? 'member'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * Full-screen instance settings modal.
 * Sidebar navigation: Overview (owner-only) and Members tabs.
 */
export default function ServerSettingsModal({
  getToken,
  serverId,
  instanceName,
  instanceData,
  isAdmin,
  onClose,
}) {
  const [tab, setTab] = useState(TAB_OVERVIEW);
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
    ...(isAdmin ? [{ key: TAB_OVERVIEW, label: 'Overview' }] : []),
    { key: TAB_MEMBERS, label: 'Members' },
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
        }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              style={{
                flex: 1,
                padding: '8px 4px',
                fontSize: '0.78rem',
                fontFamily: 'var(--font-sans)',
                fontWeight: tab === t.key ? 600 : 400,
                color: tab === t.key ? 'var(--hush-text)' : 'var(--hush-text-secondary)',
                background: tab === t.key ? 'var(--hush-elevated)' : 'none',
                border: 'none',
                borderBottom: tab === t.key ? '2px solid var(--hush-amber)' : '2px solid transparent',
                cursor: 'pointer',
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
            <div style={styles.sidebarGroupLabel}>{instanceName ?? 'instance'}</div>
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
        {tab === TAB_OVERVIEW && isAdmin && (
          <OverviewTab
            getToken={getToken}
            instanceName={instanceName}
            instanceData={instanceData}
          />
        )}
        {tab === TAB_MEMBERS && (
          <MembersTab
            getToken={getToken}
            serverId={serverId}
          />
        )}
      </div>

      <button
        type="button"
        style={styles.closeBtn}
        onClick={onClose}
        title="Close (Esc)"
      >
        ✕
      </button>
    </div>,
    document.body,
  );
}
