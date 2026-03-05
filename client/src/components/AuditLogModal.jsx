import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getAuditLog } from '../lib/api';

const PAGE_SIZE = 50;

const ACTIONS = ['kick', 'ban', 'unban', 'mute', 'unmute', 'message_delete', 'role_change'];

const ACTION_LABELS = {
  kick: 'Kick',
  ban: 'Ban',
  unban: 'Unban',
  mute: 'Mute',
  unmute: 'Unmute',
  message_delete: 'Message Delete',
  role_change: 'Role Change',
};

// ── Styles ────────────────────────────────────────────────────────────────────

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const panelStyle = {
  background: 'var(--hush-elevated)',
  borderRadius: '8px',
  padding: '24px',
  width: '680px',
  maxWidth: '92vw',
  maxHeight: '82vh',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const titleStyle = {
  fontSize: '1rem',
  fontWeight: 600,
  color: 'var(--hush-text)',
};

const closeBtnStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--hush-text-secondary)',
  cursor: 'pointer',
  fontSize: '1.2rem',
  lineHeight: 1,
  padding: '2px 6px',
};

const filterBarStyle = {
  display: 'flex',
  gap: '10px',
  alignItems: 'center',
  flexWrap: 'wrap',
};

const selectStyle = {
  padding: '6px 10px',
  fontSize: '0.82rem',
  background: 'var(--hush-black)',
  border: '1px solid var(--hush-border)',
  borderRadius: '4px',
  color: 'var(--hush-text)',
  cursor: 'pointer',
  minWidth: '140px',
};

const inputStyle = {
  flex: 1,
  minWidth: '160px',
  padding: '6px 10px',
  fontSize: '0.82rem',
  background: 'var(--hush-black)',
  border: '1px solid var(--hush-border)',
  borderRadius: '4px',
  color: 'var(--hush-text)',
  outline: 'none',
};

const tableWrapStyle = {
  overflowY: 'auto',
  flex: 1,
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.8rem',
};

const thStyle = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: '0.72rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'var(--hush-text-secondary)',
  borderBottom: '1px solid var(--hush-border)',
  whiteSpace: 'nowrap',
};

const tdStyle = (even) => ({
  padding: '8px 10px',
  color: 'var(--hush-text)',
  verticalAlign: 'top',
  background: even ? 'color-mix(in srgb, var(--hush-surface) 50%, transparent)' : 'transparent',
  borderBottom: '1px solid color-mix(in srgb, var(--hush-border) 40%, transparent)',
});

const actionBadgeStyle = (action) => {
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

const emptyStyle = {
  textAlign: 'center',
  color: 'var(--hush-text-muted)',
  fontSize: '0.85rem',
  padding: '32px 0',
};

const errorStyle = {
  fontSize: '0.8rem',
  color: 'var(--hush-danger)',
  padding: '8px 0',
};

const loadMoreBtnStyle = {
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
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function resolveUser(userId, members) {
  if (!userId) return null;
  if (!members?.length) return userId.slice(0, 8) + '…';
  const m = members.find((mem) => (mem.id ?? mem.userId) === userId);
  if (!m) return userId.slice(0, 8) + '…';
  return m.username ?? m.displayName ?? m.id ?? userId;
}

function truncate(str, max) {
  if (!str) return '—';
  if (str.length <= max) return str;
  return str.slice(0, max) + '…';
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * AuditLogModal — Admin-only modal showing guild audit log with action/user filters and pagination.
 *
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @param {string} props.serverId
 * @param {() => string} props.getToken
 * @param {(msg: object) => void} [props.showToast]
 * @param {Array<object>} [props.members] - Guild member list for username resolution
 */
export default function AuditLogModal({ isOpen, onClose, serverId, getToken, showToast, members = [] }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const debounceTimer = useRef(null);

  // Resolve userSearch string to a member ID (or undefined if no match)
  const resolvedUserId = useCallback((search) => {
    if (!search.trim() || !members?.length) return undefined;
    const lower = search.trim().toLowerCase();
    const match = members.find((m) => {
      const name = (m.username ?? m.displayName ?? '').toLowerCase();
      return name.includes(lower);
    });
    return match ? (match.id ?? match.userId) : null; // null = search active but no match
  }, [members]);

  const fetchEntries = useCallback(async (currentOffset, replaceAll) => {
    const userId = resolvedUserId(userSearch);
    // If search is non-empty but no member matches, show empty immediately
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
      const opts = {
        limit: PAGE_SIZE,
        offset: currentOffset,
      };
      if (actionFilter) opts.action = actionFilter;

      let fetched;
      if (userId) {
        // Fetch actor and target in parallel, merge and deduplicate
        const [byActor, byTarget] = await Promise.all([
          getAuditLog(token, serverId, { ...opts, actorId: userId }),
          getAuditLog(token, serverId, { ...opts, targetId: userId }),
        ]);
        const seen = new Set();
        fetched = [];
        for (const e of [...(byActor ?? []), ...(byTarget ?? [])]) {
          if (!seen.has(e.id)) {
            seen.add(e.id);
            fetched.push(e);
          }
        }
        // Sort merged results by createdAt descending
        fetched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        // Slice to PAGE_SIZE to approximate pagination
        fetched = fetched.slice(0, PAGE_SIZE);
      } else {
        fetched = await getAuditLog(token, serverId, opts);
        fetched = fetched ?? [];
      }

      const hadMore = fetched.length >= PAGE_SIZE;
      setHasMore(hadMore);

      if (replaceAll) {
        setEntries(fetched);
      } else {
        setEntries((prev) => [...prev, ...fetched]);
      }
    } catch (err) {
      setFetchError(err.message || 'Failed to load audit log.');
      showToast?.({ message: err.message || 'Failed to load audit log.', variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [actionFilter, userSearch, serverId, getToken, showToast, resolvedUserId]);

  // Fetch on open, or when actionFilter changes — reset offset
  useEffect(() => {
    if (!isOpen) return;
    setOffset(0);
    fetchEntries(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, actionFilter, serverId]);

  // Debounce userSearch changes (400ms)
  useEffect(() => {
    if (!isOpen) return;
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

  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div style={overlayStyle} onClick={handleOverlayClick}>
      <div style={panelStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={titleStyle}>Audit Log</span>
          <button type="button" style={closeBtnStyle} onClick={onClose} aria-label="Close">x</button>
        </div>

        {/* Filter bar */}
        <div style={filterBarStyle}>
          <select
            style={selectStyle}
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
            ))}
          </select>
          <input
            type="text"
            style={inputStyle}
            placeholder="Search by username..."
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        <div style={tableWrapStyle}>
          {loading && entries.length === 0 && (
            <div style={emptyStyle}>Loading...</div>
          )}
          {!loading && fetchError && (
            <div style={errorStyle}>{fetchError}</div>
          )}
          {!loading && !fetchError && entries.length === 0 && (
            <div style={emptyStyle}>No audit log entries found.</div>
          )}
          {entries.length > 0 && (
            <>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Time</th>
                    <th style={thStyle}>Actor</th>
                    <th style={thStyle}>Target</th>
                    <th style={thStyle}>Action</th>
                    <th style={thStyle}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, idx) => {
                    const even = idx % 2 === 0;
                    const td = tdStyle(even);
                    return (
                      <tr key={entry.id}>
                        <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--hush-text-secondary)', fontSize: '0.75rem' }}>
                          {formatTime(entry.createdAt)}
                        </td>
                        <td style={{ ...td, fontWeight: 500 }}>
                          {resolveUser(entry.actorId, members)}
                        </td>
                        <td style={{ ...td, color: 'var(--hush-text-secondary)' }}>
                          {entry.targetId ? resolveUser(entry.targetId, members) : '—'}
                        </td>
                        <td style={td}>
                          <span style={actionBadgeStyle(entry.action)}>
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
                  style={loadMoreBtnStyle}
                  onClick={handleLoadMore}
                  disabled={loading}
                >
                  {loading ? 'Loading...' : 'Load More'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
