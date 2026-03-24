import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getGuildMembers, listBans, listMutes, unbanUser, unmuteUser, getAuditLog, leaveGuild } from '../lib/api';
import ConfirmModal from './ConfirmModal';
import { useBreakpoint } from '../hooks/useBreakpoint';

const TAB_OVERVIEW = 'overview';
const TAB_MEMBERS = 'members';
const TAB_AUDIT_LOG = 'audit_log';
const TAB_BANS_MUTES = 'bans_mutes';

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
    maxWidth: '740px',
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

// ── Audit Log styles ───────────────────────────────────────────────

const auditStyles = {
  filterBar: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: '16px',
  },
  select: {
    padding: '6px 10px',
    fontSize: '0.82rem',
    background: 'var(--hush-black)',
    border: '1px solid var(--hush-border)',
    borderRadius: '4px',
    color: 'var(--hush-text)',
    cursor: 'pointer',
    minWidth: '0',
  },
  input: {
    flex: 1,
    minWidth: '0',
    padding: '6px 10px',
    fontSize: '0.82rem',
    background: 'var(--hush-black)',
    border: '1px solid var(--hush-border)',
    borderRadius: '4px',
    color: 'var(--hush-text)',
    outline: 'none',
  },
  tableWrap: {
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch',
  },
  table: {
    width: '100%',
    minWidth: '520px',
    borderCollapse: 'collapse',
    fontSize: '0.8rem',
  },
  th: {
    textAlign: 'left',
    padding: '8px 10px',
    fontSize: '0.72rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    color: 'var(--hush-text-secondary)',
    borderBottom: '1px solid var(--hush-border)',
    whiteSpace: 'nowrap',
  },
  td: (even) => ({
    padding: '8px 10px',
    color: 'var(--hush-text)',
    verticalAlign: 'top',
    background: even ? 'color-mix(in srgb, var(--hush-surface) 50%, transparent)' : 'transparent',
    borderBottom: '1px solid color-mix(in srgb, var(--hush-border) 40%, transparent)',
  }),
  loadMoreBtn: {
    display: 'block',
    width: '100%',
    padding: '8px 0',
    marginTop: '8px',
    background: 'none',
    border: '1px solid var(--hush-border)',
    borderRadius: '4px',
    color: 'var(--hush-text-secondary)',
    fontSize: '0.82rem',
    cursor: 'pointer',
  },
  empty: {
    textAlign: 'center',
    color: 'var(--hush-text-muted)',
    fontSize: '0.85rem',
    padding: '32px 0',
  },
};

const ACTION_BADGE_STYLE = (action) => {
  const dangerActions = ['ban', 'kick', 'mute'];
  const safeActions = ['unban', 'unmute'];
  let bg = 'color-mix(in srgb, var(--hush-text-muted) 20%, transparent)';
  let color = 'var(--hush-text-secondary)';
  if (dangerActions.includes(action)) {
    bg = 'color-mix(in srgb, var(--hush-danger) 18%, transparent)';
    color = 'var(--hush-danger)';
  } else if (safeActions.includes(action)) {
    bg = 'color-mix(in srgb, var(--hush-live) 18%, transparent)';
    color = 'var(--hush-live)';
  } else if (action === 'message_delete') {
    bg = 'color-mix(in srgb, var(--hush-amber) 18%, transparent)';
    color = 'var(--hush-amber)';
  }
  return {
    display: 'inline-block',
    padding: '2px 7px',
    borderRadius: '4px',
    fontSize: '0.72rem',
    fontWeight: 600,
    background: bg,
    color,
    whiteSpace: 'nowrap',
  };
};

// ── Ban/Mute styles ────────────────────────────────────────────────

const banMuteStyles = {
  tabBar: {
    display: 'flex',
    gap: '2px',
    borderBottom: '1px solid var(--hush-border)',
    marginBottom: '16px',
  },
  tab: (active) => ({
    padding: '8px 16px',
    fontSize: '0.85rem',
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--hush-accent, var(--hush-amber))' : 'var(--hush-text-secondary)',
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid var(--hush-accent, var(--hush-amber))' : '2px solid transparent',
    cursor: 'pointer',
    marginBottom: '-1px',
    fontFamily: 'var(--font-sans)',
  }),
  row: {
    background: 'var(--hush-surface)',
    borderRadius: '6px',
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '8px',
  },
  rowHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '8px',
  },
  userId: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: 'var(--hush-text)',
    wordBreak: 'break-all',
  },
  meta: {
    fontSize: '0.75rem',
    color: 'var(--hush-text-secondary)',
  },
  actionBtn: {
    padding: '4px 10px',
    fontSize: '0.75rem',
    borderRadius: '4px',
    border: 'none',
    background: 'var(--hush-danger)',
    color: '#fff',
    cursor: 'pointer',
    flexShrink: 0,
  },
  reasonInput: {
    width: '100%',
    padding: '6px 10px',
    fontSize: '0.8rem',
    background: 'var(--hush-black)',
    border: '1px solid var(--hush-border)',
    borderRadius: '4px',
    color: 'var(--hush-text)',
    boxSizing: 'border-box',
  },
  reasonActions: {
    display: 'flex',
    gap: '6px',
    justifyContent: 'flex-end',
  },
  confirmBtn: {
    padding: '4px 12px',
    fontSize: '0.75rem',
    borderRadius: '4px',
    border: 'none',
    background: 'var(--hush-danger)',
    color: '#fff',
    cursor: 'pointer',
  },
  cancelBtn: {
    padding: '4px 12px',
    fontSize: '0.75rem',
    borderRadius: '4px',
    border: '1px solid var(--hush-border)',
    background: 'none',
    color: 'var(--hush-text-secondary)',
    cursor: 'pointer',
  },
  empty: {
    textAlign: 'center',
    color: 'var(--hush-text-muted)',
    fontSize: '0.85rem',
    padding: '24px 0',
  },
};

// ── Helpers ────────────────────────────────────────────────────────

const AUDIT_ACTIONS = ['kick', 'ban', 'unban', 'mute', 'unmute', 'message_delete', 'role_change'];
const ACTION_LABELS = {
  kick: 'Kick', ban: 'Ban', unban: 'Unban', mute: 'Mute', unmute: 'Unmute',
  message_delete: 'Message Delete', role_change: 'Role Change',
};
const PAGE_SIZE = 50;

function formatTime(iso) {
  if (!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function resolveUser(userId, members) {
  if (!userId) return null;
  if (!members?.length) return userId.slice(0, 8) + '\u2026';
  const m = members.find((mem) => (mem.id ?? mem.userId) === userId);
  if (!m) return userId.slice(0, 8) + '\u2026';
  return m.username ?? m.displayName ?? m.id ?? userId;
}

function truncate(str, max) {
  if (!str) return '\u2014';
  if (str.length <= max) return str;
  return str.slice(0, max) + '\u2026';
}

// ── Tab: Overview ──────────────────────────────────────────────────

function OverviewTab({ serverName }) {
  return (
    <>
      <div style={styles.sectionTitle}>Overview</div>

      <div style={styles.fieldRow}>
        <label style={styles.fieldLabel}>Server name</label>
        <div style={{ fontSize: '0.95rem', color: 'var(--hush-text)', padding: '8px 0' }}>
          {serverName || 'Unnamed server'}
        </div>
        <div style={styles.fieldNote}>
          Server names are end-to-end encrypted. Only members can see this name.
        </div>
      </div>

    </>
  );
}

// ── Tab: Members ───────────────────────────────────────────────────

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
        Members{members.length > 0 ? ` \u2014 ${members.length}` : ''}
      </div>

      {loading && (
        <div style={{ color: 'var(--hush-text-muted)', fontSize: '0.85rem' }}>Loading\u2026</div>
      )}
      {error && <div style={styles.errorMsg}>{error}</div>}

      {!loading && !error && (
        <div style={styles.memberList}>
          {members.map((m) => {
            const memberId = m.id ?? m.userId ?? '';
            // Prefer integer permissionLevel (new API), fall back to role string
            const level = m.permissionLevel ?? ({ owner: 3, admin: 2, mod: 1, member: 0 }[m.role] ?? 0);
            const isPrivileged = level >= 2;
            const roleLabel = ({ 3: 'Owner', 2: 'Admin', 1: 'Mod', 0: 'Member' }[level] ?? m.role ?? 'Member');
            const initial = (m.displayName || m.username || '?')[0].toUpperCase();
            return (
              <div key={memberId} style={styles.memberRow}>
                <div style={styles.memberAvatar}>{initial}</div>
                <span style={styles.memberName}>{m.displayName || m.username}</span>
                <span style={styles.memberRoleBadge(isPrivileged)}>
                  {roleLabel}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Tab: Audit Log ─────────────────────────────────────────────────

function AuditLogTab({ getToken, serverId, showToast, members = [] }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const debounceTimer = useRef(null);

  const resolvedUserId = useCallback((search) => {
    if (!search.trim() || !members?.length) return undefined;
    const lower = search.trim().toLowerCase();
    const match = members.find((m) => {
      const name = (m.username ?? m.displayName ?? '').toLowerCase();
      return name.includes(lower);
    });
    return match ? (match.id ?? match.userId) : null;
  }, [members]);

  const fetchEntries = useCallback(async (currentOffset, replaceAll) => {
    const userId = resolvedUserId(userSearch);
    if (userSearch.trim() && userId === null) {
      setEntries([]);
      setHasMore(false);
      setLoading(false);
      setFetchError('');
      return;
    }

    setLoading(true);
    setFetchError('');
    try {
      const token = getToken();
      const opts = { limit: PAGE_SIZE, offset: currentOffset };
      if (actionFilter) opts.action = actionFilter;

      let fetched;
      if (userId) {
        const [byActor, byTarget] = await Promise.all([
          getAuditLog(token, serverId, { ...opts, actorId: userId }),
          getAuditLog(token, serverId, { ...opts, targetId: userId }),
        ]);
        const seen = new Set();
        fetched = [];
        for (const e of [...(byActor ?? []), ...(byTarget ?? [])]) {
          if (!seen.has(e.id)) { seen.add(e.id); fetched.push(e); }
        }
        fetched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        fetched = fetched.slice(0, PAGE_SIZE);
      } else {
        fetched = await getAuditLog(token, serverId, opts);
        fetched = fetched ?? [];
      }

      setHasMore(fetched.length >= PAGE_SIZE);
      if (replaceAll) { setEntries(fetched); } else { setEntries((prev) => [...prev, ...fetched]); }
    } catch (err) {
      setFetchError(err.message || 'Failed to load audit log.');
      showToast?.({ message: err.message || 'Failed to load audit log.', variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [actionFilter, userSearch, serverId, getToken, showToast, resolvedUserId]);

  useEffect(() => {
    setOffset(0);
    fetchEntries(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, serverId]);

  useEffect(() => {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setOffset(0);
      fetchEntries(0, true);
    }, 400);
    return () => clearTimeout(debounceTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSearch]);

  const handleLoadMore = useCallback(() => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    fetchEntries(nextOffset, false);
  }, [offset, fetchEntries]);

  return (
    <>
      <div style={styles.sectionTitle}>Audit Log</div>

      <div style={auditStyles.filterBar}>
        <select
          style={auditStyles.select}
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
          ))}
        </select>
        <input
          type="text"
          style={auditStyles.input}
          placeholder="Search by username..."
          value={userSearch}
          onChange={(e) => setUserSearch(e.target.value)}
        />
      </div>

      <div style={auditStyles.tableWrap}>
        {loading && entries.length === 0 && (
          <div style={auditStyles.empty}>Loading...</div>
        )}
        {!loading && fetchError && (
          <div style={styles.errorMsg}>{fetchError}</div>
        )}
        {!loading && !fetchError && entries.length === 0 && (
          <div style={auditStyles.empty}>No audit log entries found.</div>
        )}
        {entries.length > 0 && (
          <>
            <table style={auditStyles.table}>
              <thead>
                <tr>
                  <th style={auditStyles.th}>Time</th>
                  <th style={auditStyles.th}>Actor</th>
                  <th style={auditStyles.th}>Target</th>
                  <th style={auditStyles.th}>Action</th>
                  <th style={auditStyles.th}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => {
                  const even = idx % 2 === 0;
                  const td = auditStyles.td(even);
                  return (
                    <tr key={entry.id}>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--hush-text-secondary)', fontSize: '0.75rem' }}>
                        {formatTime(entry.createdAt)}
                      </td>
                      <td style={{ ...td, fontWeight: 500 }}>
                        {resolveUser(entry.actorId, members)}
                      </td>
                      <td style={{ ...td, color: 'var(--hush-text-secondary)' }}>
                        {entry.targetId ? resolveUser(entry.targetId, members) : '\u2014'}
                      </td>
                      <td style={td}>
                        <span style={ACTION_BADGE_STYLE(entry.action)}>
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                      </td>
                      <td style={{ ...td, color: 'var(--hush-text-secondary)' }}>
                        <span title={entry.reason || ''}>
                          {truncate(entry.reason, 50)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {hasMore && (
              <button
                type="button"
                style={auditStyles.loadMoreBtn}
                onClick={handleLoadMore}
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Load More'}
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ── Tab: Bans & Mutes ──────────────────────────────────────────────

function ModerationRow({ entry, actionLabel, onAction }) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async () => {
    if (!reason.trim()) { setError('Reason is required.'); return; }
    setSubmitting(true);
    setError('');
    try {
      await onAction(entry.userId, reason.trim());
    } catch (err) {
      setError(err.message || 'Action failed.');
      setSubmitting(false);
    }
  }, [reason, entry.userId, onAction]);

  return (
    <div style={banMuteStyles.row}>
      <div style={banMuteStyles.rowHeader}>
        <div>
          <div style={banMuteStyles.userId}>{entry.userId}</div>
          <div style={banMuteStyles.meta}>
            Reason: {entry.reason}
            {' \u00b7 '}Banned: {formatDate(entry.createdAt)}
            {entry.expiresAt ? ` \u00b7 Expires: ${formatDate(entry.expiresAt)}` : ' \u00b7 Permanent'}
          </div>
        </div>
        {!expanded && (
          <button type="button" style={banMuteStyles.actionBtn} onClick={() => setExpanded(true)}>
            {actionLabel}
          </button>
        )}
      </div>
      {expanded && (
        <>
          <input
            type="text"
            style={banMuteStyles.reasonInput}
            placeholder="Reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            autoFocus
          />
          {error && <div style={styles.errorMsg}>{error}</div>}
          <div style={banMuteStyles.reasonActions}>
            <button type="button" style={banMuteStyles.cancelBtn} onClick={() => { setExpanded(false); setReason(''); setError(''); }} disabled={submitting}>
              Cancel
            </button>
            <button type="button" style={banMuteStyles.confirmBtn} onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Submitting...' : `Confirm ${actionLabel}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function BansMutesTab({ getToken, serverId, showToast }) {
  const [subTab, setSubTab] = useState('bans');
  const [bans, setBans] = useState([]);
  const [mutes, setMutes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setFetchError('');
      try {
        const token = getToken();
        const [fetchedBans, fetchedMutes] = await Promise.all([
          listBans(token, serverId),
          listMutes(token, serverId),
        ]);
        if (!cancelled) {
          setBans(fetchedBans ?? []);
          setMutes(fetchedMutes ?? []);
        }
      } catch (err) {
        if (!cancelled) setFetchError(err.message || 'Failed to load data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [serverId, getToken]);

  const handleUnban = useCallback(async (userId, reason) => {
    const token = getToken();
    await unbanUser(token, serverId, userId, reason);
    setBans((prev) => prev.filter((b) => b.userId !== userId));
    showToast?.({ message: 'User unbanned.', variant: 'success' });
  }, [getToken, serverId, showToast]);

  const handleUnmute = useCallback(async (userId, reason) => {
    const token = getToken();
    await unmuteUser(token, serverId, userId, reason);
    setMutes((prev) => prev.filter((m) => m.userId !== userId));
    showToast?.({ message: 'User unmuted.', variant: 'success' });
  }, [getToken, serverId, showToast]);

  const currentList = subTab === 'bans' ? bans : mutes;
  const actionLabel = subTab === 'bans' ? 'Unban' : 'Unmute';
  const handleAction = subTab === 'bans' ? handleUnban : handleUnmute;

  return (
    <>
      <div style={styles.sectionTitle}>Bans & Mutes</div>

      <div style={banMuteStyles.tabBar}>
        <button type="button" style={banMuteStyles.tab(subTab === 'bans')} onClick={() => setSubTab('bans')}>
          Banned Users ({bans.length})
        </button>
        <button type="button" style={banMuteStyles.tab(subTab === 'mutes')} onClick={() => setSubTab('mutes')}>
          Muted Users ({mutes.length})
        </button>
      </div>

      {loading && <div style={banMuteStyles.empty}>Loading...</div>}
      {!loading && fetchError && <div style={styles.errorMsg}>{fetchError}</div>}
      {!loading && !fetchError && currentList.length === 0 && (
        <div style={banMuteStyles.empty}>No active {subTab === 'bans' ? 'bans' : 'mutes'}.</div>
      )}
      {!loading && !fetchError && currentList.map((entry) => (
        <ModerationRow
          key={entry.id}
          entry={entry}
          actionLabel={actionLabel}
          onAction={handleAction}
        />
      ))}
    </>
  );
}

// ── Main Modal ─────────────────────────────────────────────────────

/**
 * Full-screen server settings modal.
 * Sidebar navigation: Overview (owner-only), Members, Audit Log (admin), Bans & Mutes (admin).
 */
export default function ServerSettingsModal({
  getToken,
  serverId,
  instanceName,
  instanceData,
  isAdmin,
  myRole,
  onClose,
  showToast,
  members,
}) {
  const [tab, setTab] = useState(isAdmin ? TAB_OVERVIEW : TAB_MEMBERS);
  const [isOpen, setIsOpen] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
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

  const handleLeaveServer = useCallback(async () => {
    try {
      await leaveGuild(getToken(), serverId);
      onClose();
    } catch (err) {
      showToast?.({ message: err.message || 'Failed to leave server', variant: 'error' });
      setShowLeaveConfirm(false);
    }
  }, [getToken, serverId, onClose, showToast]);

  const tabs = [
    ...(isAdmin ? [{ key: TAB_OVERVIEW, label: 'Overview' }] : []),
    { key: TAB_MEMBERS, label: 'Members' },
    ...(isAdmin ? [
      { key: TAB_AUDIT_LOG, label: 'Audit Log' },
      { key: TAB_BANS_MUTES, label: 'Bans & Mutes' },
    ] : []),
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
                flexShrink: 0,
                padding: '8px 12px',
                fontSize: '0.78rem',
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
            <div style={styles.sidebarGroupLabel}>{instanceName ?? 'server'}</div>
            {tabs.filter(t => t.key === TAB_OVERVIEW || t.key === TAB_MEMBERS).map((t) => (
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
          {isAdmin && (
            <>
              <div style={styles.sidebarDivider} />
              <div style={styles.sidebarGroup}>
                <div style={styles.sidebarGroupLabel}>Moderation</div>
                {tabs.filter(t => t.key === TAB_AUDIT_LOG || t.key === TAB_BANS_MUTES).map((t) => (
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
            </>
          )}
        </div>
      )}

      <div style={{
        ...styles.content,
        ...(isMobile ? { padding: '20px 16px', maxWidth: 'none' } : {}),
      }}>
        {tab === TAB_OVERVIEW && isAdmin && (
          <OverviewTab serverName={instanceName} />
        )}
        {tab === TAB_MEMBERS && (
          <MembersTab
            getToken={getToken}
            serverId={serverId}
          />
        )}
        {tab === TAB_AUDIT_LOG && isAdmin && (
          <AuditLogTab
            getToken={getToken}
            serverId={serverId}
            showToast={showToast}
            members={members}
          />
        )}
        {tab === TAB_BANS_MUTES && isAdmin && (
          <BansMutesTab
            getToken={getToken}
            serverId={serverId}
            showToast={showToast}
          />
        )}

        {myRole !== 'owner' && (
          <div style={styles.dangerZone}>
            <div style={styles.dangerTitle}>Danger Zone</div>
            <div style={styles.dangerAction}>
              <span style={styles.dangerActionText}>
                Leave this server. You will lose access to all channels.
              </span>
              <button
                type="button"
                className="btn"
                style={{ background: 'var(--hush-danger)', color: '#fff', fontSize: '0.8rem', padding: '6px 16px' }}
                onClick={() => setShowLeaveConfirm(true)}
              >
                Leave Server
              </button>
            </div>
          </div>
        )}
      </div>

      {showLeaveConfirm && (
        <ConfirmModal
          title="Leave Server"
          message={`Are you sure you want to leave "${instanceName}"? You will need a new invite to rejoin.`}
          confirmLabel="Leave"
          onConfirm={handleLeaveServer}
          onCancel={() => setShowLeaveConfirm(false)}
        />
      )}

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
