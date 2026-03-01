import { useState, useEffect, useCallback } from 'react';
import { updateServer, deleteServer, leaveServer, getServerMembers } from '../lib/api';
import ConfirmModal from './ConfirmModal';

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

function OverviewTab({ getToken, serverId, serverName, isAdmin, onDeleteServer, onLeaveServer }) {
  const [name, setName] = useState(serverName ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // 'delete' | 'leave'

  const isDirty = name.trim() !== (serverName ?? '');

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    try {
      await updateServer(getToken(), serverId, { name: trimmed });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setName(serverName ?? '');
    setSaveError('');
    setSaveSuccess(false);
  };

  const handleDeleteConfirmed = async () => {
    setConfirmAction(null);
    try {
      await deleteServer(getToken(), serverId);
      onDeleteServer?.();
    } catch (err) {
      setSaveError(err.message || 'Failed to delete server');
    }
  };

  const handleLeaveConfirmed = async () => {
    setConfirmAction(null);
    try {
      await leaveServer(getToken(), serverId);
      onLeaveServer?.();
    } catch (err) {
      setSaveError(err.message || 'Failed to leave server');
    }
  };

  return (
    <>
      <div style={styles.sectionTitle}>Overview</div>

      {isAdmin && (
        <div style={styles.fieldRow}>
          <label htmlFor="settings-server-name" style={styles.fieldLabel}>Server name</label>
          <input
            id="settings-server-name"
            className="input"
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setSaveError(''); setSaveSuccess(false); }}
            maxLength={100}
            autoComplete="off"
          />
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
        </div>
      )}

      <div style={styles.dangerZone}>
        <div style={styles.dangerTitle}>Danger zone</div>

        <div style={styles.dangerAction}>
          <span style={styles.dangerActionText}>
            Leave this server. You won't be able to rejoin unless invited.
          </span>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setConfirmAction('leave')}
          >
            Leave Server
          </button>
        </div>

        {isAdmin && (
          <div style={{ ...styles.dangerAction, paddingTop: '12px', borderTop: '1px solid color-mix(in srgb, var(--hush-danger) 30%, transparent)' }}>
            <span style={styles.dangerActionText}>
              Permanently delete this server and all its channels. This cannot be undone.
            </span>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirmAction('delete')}
            >
              Delete Server
            </button>
          </div>
        )}
      </div>

      {confirmAction === 'delete' && (
        <ConfirmModal
          title="Delete server"
          message={`Permanently delete "${serverName}"? All channels and messages will be lost. This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === 'leave' && (
        <ConfirmModal
          title="Leave server"
          message={`Leave "${serverName}"? You'll need an invite to rejoin.`}
          confirmLabel="Leave"
          onConfirm={handleLeaveConfirmed}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}

function MembersTab({ getToken, serverId }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getServerMembers(getToken(), serverId)
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
            const isAdmin = m.role === 'admin';
            const initial = (m.displayName || m.userId || '?')[0];
            return (
              <div key={m.userId} style={styles.memberRow}>
                <div style={styles.memberAvatar}>{initial}</div>
                <span style={styles.memberName}>{m.displayName || m.userId}</span>
                <span style={styles.memberRoleBadge(isAdmin)}>
                  {isAdmin ? 'Admin' : 'Member'}
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
 * Discord-style full-screen server settings modal.
 * Sidebar navigation + Overview and Members tabs.
 */
export default function ServerSettingsModal({
  getToken,
  serverId,
  serverName,
  isAdmin,
  onClose,
  onDeleteServer,
  onLeaveServer,
}) {
  const [tab, setTab] = useState(TAB_OVERVIEW);
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
          <div style={styles.sidebarGroupLabel}>{serverName ?? 'Server'}</div>
          <button
            type="button"
            style={styles.sidebarItem(tab === TAB_OVERVIEW)}
            onClick={() => setTab(TAB_OVERVIEW)}
          >
            Overview
          </button>
          <button
            type="button"
            style={styles.sidebarItem(tab === TAB_MEMBERS)}
            onClick={() => setTab(TAB_MEMBERS)}
          >
            Members
          </button>
        </div>
      </div>

      <div style={styles.content}>
        {tab === TAB_OVERVIEW && (
          <OverviewTab
            getToken={getToken}
            serverId={serverId}
            serverName={serverName}
            isAdmin={isAdmin}
            onDeleteServer={onDeleteServer}
            onLeaveServer={onLeaveServer}
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
    </div>
  );
}
