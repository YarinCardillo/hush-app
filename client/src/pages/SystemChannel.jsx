import { useState, useEffect, useRef, useCallback } from 'react';
import { getSystemMessages } from '../lib/api';
import SystemMessageRow from '../components/SystemMessageRow';

const PAGE_SIZE = 50;

const styles = {
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    height: '48px',
    background: 'var(--hush-surface)',
    borderBottom: '1px solid var(--hush-border)',
    flexShrink: 0,
  },
  channelName: {
    fontSize: '0.9rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  messageList: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '8px 0',
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--hush-text-muted)',
    fontSize: '0.85rem',
  },
  loadingMore: {
    textAlign: 'center',
    padding: '8px',
    color: 'var(--hush-text-muted)',
    fontSize: '0.75rem',
  },
};

/**
 * SystemChannel: read-only view of system/moderation messages.
 * No message input, no encryption. Fetches from GET /api/servers/:id/system-messages.
 * Listens for 'system_message' WS events for real-time updates.
 */
export default function SystemChannel({ channel, serverId, getToken, wsClient, members = [], onToggleDrawer }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const listRef = useRef(null);
  const prevScrollHeightRef = useRef(0);

  // Fetch initial messages
  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setLoading(true);
    setHasMore(false);

    const token = getToken();
    if (!token || !serverId) {
      setLoading(false);
      return;
    }

    getSystemMessages(token, serverId, { limit: PAGE_SIZE })
      .then((data) => {
        if (cancelled) return;
        const arr = Array.isArray(data) ? data : [];
        setMessages(arr);
        setHasMore(arr.length === PAGE_SIZE);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [serverId, channel?.id, getToken]);

  // Auto-scroll to bottom on initial load
  useEffect(() => {
    if (!loading && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [loading]);

  // WS listener for real-time system_message events
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (data.server_id !== serverId) return;
      if (!data.system_message) return;
      setMessages((prev) => [...prev, data.system_message]);
      // Auto-scroll to bottom if already near bottom
      requestAnimationFrame(() => {
        if (listRef.current) {
          const el = listRef.current;
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (nearBottom) {
            el.scrollTop = el.scrollHeight;
          }
        }
      });
    };
    wsClient.on('system_message', handler);
    return () => wsClient.off('system_message', handler);
  }, [wsClient, serverId]);

  // Load older messages when scrolled to top
  const handleScroll = useCallback(() => {
    if (!hasMore || loadingMore) return;
    const el = listRef.current;
    if (!el || el.scrollTop > 40) return;

    setLoadingMore(true);
    prevScrollHeightRef.current = el.scrollHeight;

    const token = getToken();
    if (!token) {
      setLoadingMore(false);
      return;
    }

    // Messages are ordered oldest-first; the oldest is at index 0
    const oldest = messages[0];
    if (!oldest) {
      setLoadingMore(false);
      return;
    }

    getSystemMessages(token, serverId, { before: oldest.createdAt, limit: PAGE_SIZE })
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        if (arr.length === 0) {
          setHasMore(false);
          return;
        }
        setMessages((prev) => [...arr, ...prev]);
        setHasMore(arr.length === PAGE_SIZE);
        // Restore scroll position after prepending
        requestAnimationFrame(() => {
          if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight - prevScrollHeightRef.current;
          }
        });
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [hasMore, loadingMore, messages, getToken, serverId]);

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
          {onToggleDrawer && (
            <button
              type="button"
              onClick={onToggleDrawer}
              style={{
                width: 44, height: 44,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none',
                color: 'var(--hush-text-secondary)', cursor: 'pointer',
                padding: 0, flexShrink: 0,
              }}
              aria-label="Toggle channels"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          )}
          <span style={styles.channelName}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            #{channel.name}
          </span>
        </div>
      </header>

      {loading ? (
        <div style={styles.empty}>Loading...</div>
      ) : messages.length === 0 ? (
        <div style={styles.empty}>No system messages yet</div>
      ) : (
        <div
          ref={listRef}
          style={styles.messageList}
          onScroll={handleScroll}
        >
          {loadingMore && <div style={styles.loadingMore}>Loading older messages...</div>}
          {messages.map((msg) => (
            <SystemMessageRow key={msg.id} message={msg} members={members} />
          ))}
        </div>
      )}
    </div>
  );
}
