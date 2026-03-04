import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { listBans, listMutes, unbanUser, unmuteUser } from '../lib/api';

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
  width: '540px',
  maxWidth: '90vw',
  maxHeight: '80vh',
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

const tabBarStyle = {
  display: 'flex',
  gap: '2px',
  borderBottom: '1px solid var(--hush-border)',
  paddingBottom: '0',
};

const tabStyle = (active) => ({
  padding: '8px 16px',
  fontSize: '0.85rem',
  fontWeight: active ? 600 : 400,
  color: active ? 'var(--hush-accent)' : 'var(--hush-text-secondary)',
  background: 'none',
  border: 'none',
  borderBottom: active ? '2px solid var(--hush-accent)' : '2px solid transparent',
  cursor: 'pointer',
  marginBottom: '-1px',
});

const listContainerStyle = {
  overflowY: 'auto',
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const rowStyle = {
  background: 'var(--hush-surface)',
  borderRadius: '6px',
  padding: '10px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const rowHeaderStyle = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '8px',
};

const userIdStyle = {
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'var(--hush-text)',
  wordBreak: 'break-all',
};

const metaStyle = {
  fontSize: '0.75rem',
  color: 'var(--hush-text-secondary)',
};

const actionBtnStyle = {
  padding: '4px 10px',
  fontSize: '0.75rem',
  borderRadius: '4px',
  border: 'none',
  background: 'var(--hush-danger)',
  color: '#fff',
  cursor: 'pointer',
  flexShrink: 0,
};

const reasonInputStyle = {
  width: '100%',
  padding: '6px 10px',
  fontSize: '0.8rem',
  background: 'var(--hush-black)',
  border: '1px solid var(--hush-border)',
  borderRadius: '4px',
  color: 'var(--hush-text)',
  boxSizing: 'border-box',
};

const reasonActionsStyle = {
  display: 'flex',
  gap: '6px',
  justifyContent: 'flex-end',
};

const confirmBtnStyle = {
  padding: '4px 12px',
  fontSize: '0.75rem',
  borderRadius: '4px',
  border: 'none',
  background: 'var(--hush-danger)',
  color: '#fff',
  cursor: 'pointer',
};

const cancelBtnStyle = {
  padding: '4px 12px',
  fontSize: '0.75rem',
  borderRadius: '4px',
  border: '1px solid var(--hush-border)',
  background: 'none',
  color: 'var(--hush-text-secondary)',
  cursor: 'pointer',
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

const emptyStyle = {
  textAlign: 'center',
  color: 'var(--hush-text-muted)',
  fontSize: '0.85rem',
  padding: '24px 0',
};

const errorStyle = {
  fontSize: '0.8rem',
  color: 'var(--hush-danger)',
};

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

/**
 * Row for a single ban or mute entry with inline confirm-with-reason flow.
 */
function ModerationRow({ entry, actionLabel, onAction }) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async () => {
    if (!reason.trim()) {
      setError('Reason is required.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onAction(entry.userId, reason.trim());
      // Parent removes the row on success.
    } catch (err) {
      setError(err.message || 'Action failed.');
      setSubmitting(false);
    }
  }, [reason, entry.userId, onAction]);

  return (
    <div style={rowStyle}>
      <div style={rowHeaderStyle}>
        <div>
          <div style={userIdStyle}>{entry.userId}</div>
          <div style={metaStyle}>
            Reason: {entry.reason}
            {' · '}Banned: {formatDate(entry.createdAt)}
            {entry.expiresAt ? ` · Expires: ${formatDate(entry.expiresAt)}` : ' · Permanent'}
          </div>
        </div>
        {!expanded && (
          <button type="button" style={actionBtnStyle} onClick={() => setExpanded(true)}>
            {actionLabel}
          </button>
        )}
      </div>
      {expanded && (
        <>
          <input
            type="text"
            style={reasonInputStyle}
            placeholder="Reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            autoFocus
          />
          {error && <div style={errorStyle}>{error}</div>}
          <div style={reasonActionsStyle}>
            <button type="button" style={cancelBtnStyle} onClick={() => { setExpanded(false); setReason(''); setError(''); }} disabled={submitting}>
              Cancel
            </button>
            <button type="button" style={confirmBtnStyle} onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Submitting...' : `Confirm ${actionLabel}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * BanMuteListModal — Admin-only modal listing active bans and mutes with unban/unmute actions.
 *
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @param {string} props.serverId
 * @param {() => string} props.getToken
 * @param {(msg: object) => void} [props.showToast]
 */
export default function BanMuteListModal({ isOpen, onClose, serverId, getToken, showToast }) {
  const [tab, setTab] = useState('bans');
  const [bans, setBans] = useState([]);
  const [mutes, setMutes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');

  // Fetch on open
  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen, serverId, getToken]);

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

  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!isOpen) return null;

  const currentList = tab === 'bans' ? bans : mutes;
  const actionLabel = tab === 'bans' ? 'Unban' : 'Unmute';
  const handleAction = tab === 'bans' ? handleUnban : handleUnmute;

  return createPortal(
    <div style={overlayStyle} onClick={handleOverlayClick}>
      <div style={panelStyle}>
        <div style={headerStyle}>
          <span style={titleStyle}>Ban / Mute Management</span>
          <button type="button" style={closeBtnStyle} onClick={onClose} aria-label="Close">x</button>
        </div>

        <div style={tabBarStyle}>
          <button type="button" style={tabStyle(tab === 'bans')} onClick={() => setTab('bans')}>
            Banned Users ({bans.length})
          </button>
          <button type="button" style={tabStyle(tab === 'mutes')} onClick={() => setTab('mutes')}>
            Muted Users ({mutes.length})
          </button>
        </div>

        <div style={listContainerStyle}>
          {loading && <div style={emptyStyle}>Loading...</div>}
          {!loading && fetchError && <div style={errorStyle}>{fetchError}</div>}
          {!loading && !fetchError && currentList.length === 0 && (
            <div style={emptyStyle}>No active {tab === 'bans' ? 'bans' : 'mutes'}.</div>
          )}
          {!loading && !fetchError && currentList.map((entry) => (
            <ModerationRow
              key={entry.id}
              entry={entry}
              actionLabel={actionLabel}
              onAction={handleAction}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
