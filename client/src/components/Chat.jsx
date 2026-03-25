import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as api from '../lib/api';
import { useMLS } from '../hooks/useMLS';

function base64ToUint8Array(base64) {
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function uint8ArrayToBase64(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

// Module-level pending send cache — survives component unmount/remount so plaintext
// can be recovered when the user navigates back to a channel before the self-echo
// has been processed (or in fan-out mode where no self-echo arrives).
const _pendingSends = new Map();
const PENDING_SEND_TTL = 60_000;

function addPendingSend(channelId, content, senderId) {
  const list = _pendingSends.get(channelId) || [];
  list.push({ content, senderId, timestamp: Date.now() });
  _pendingSends.set(channelId, list);
}

function consumePendingSend(channelId, senderId, serverTimestamp) {
  const list = _pendingSends.get(channelId);
  if (!list?.length) return null;
  const now = Date.now();
  const fresh = list.filter((p) => now - p.timestamp < PENDING_SEND_TTL);
  if (!fresh.length) {
    _pendingSends.delete(channelId);
    return null;
  }
  _pendingSends.set(channelId, fresh);
  const idx = fresh.findIndex(
    (p) => p.senderId === senderId && Math.abs(p.timestamp - serverTimestamp) < 10_000
  );
  if (idx < 0) return null;
  const [match] = fresh.splice(idx, 1);
  if (!fresh.length) _pendingSends.delete(channelId);
  return match.content;
}

async function decryptMessageRow(m, currentUserId, { decryptFromChannel, getCachedMessage, setCachedMessage }) {
  const ts = new Date(m.timestamp).getTime();
  if (typeof getCachedMessage === 'function') {
    const cached = await getCachedMessage(m.id);
    if (cached) {
      return {
        id: m.id,
        sender: cached.senderId ?? m.senderId,
        content: cached.content,
        timestamp: cached.timestamp,
        decryptionFailed: false,
      };
    }
  }
  // MLS: own sent messages are encrypted for other group members, not for self.
  // Recover from the module-level pending sends cache (populated at send time).
  if (m.senderId === currentUserId) {
    const pendingContent = consumePendingSend(m.channelId, m.senderId, ts);
    if (pendingContent !== null) {
      if (typeof setCachedMessage === 'function') {
        await setCachedMessage(m.id, { content: pendingContent, senderId: m.senderId, timestamp: ts });
      }
      return { id: m.id, sender: m.senderId, content: pendingContent, timestamp: ts, decryptionFailed: false };
    }
    // Own message — local plaintext cache lost (logout/session change).
    // MLS ciphertext can't be self-decrypted; keys may no longer exist.
    return {
      id: m.id,
      sender: m.senderId,
      content: null,
      timestamp: ts,
      decryptionFailed: true,
    };
  }
  let content = null;
  let decryptionFailed = false;
  try {
    const ct = base64ToUint8Array(m.ciphertext);
    content = await decryptFromChannel(ct);
    if (typeof setCachedMessage === 'function') {
      await setCachedMessage(m.id, { content, senderId: m.senderId, timestamp: ts });
    }
  } catch (err) {
    console.warn('[chat] Decrypt failed for msg', m.id, 'from', m.senderId, err);
    decryptionFailed = true;
  }
  return {
    id: m.id,
    sender: m.senderId,
    content,
    timestamp: ts,
    decryptionFailed,
  };
}

/**
 * Encrypt and send a single-ciphertext MLS message for the channel group.
 * No fan-out — MLS produces one ciphertext for all group members.
 *
 * @param {object} wsClient
 * @param {string} channelId
 * @param {string} plaintext
 * @param {Function} encryptForChannel
 * @returns {Promise<void>}
 */
async function encryptAndSendMLS(wsClient, channelId, plaintext, encryptForChannel) {
  const { ciphertext } = await encryptForChannel(plaintext);
  wsClient.send('message.send', {
    channel_id: channelId,
    ciphertext: uint8ArrayToBase64(ciphertext),
  });
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
  },
  messagesSection: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  messagesScroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  messagesScrollWithMessages: {
    justifyContent: 'flex-end',
  },
  message: (isOwn) => ({
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '8px 12px',
    borderRadius: 'var(--radius-md)',
    background: isOwn ? 'var(--hush-amber-ghost)' : 'var(--hush-elevated)',
    border: '1px solid transparent',
  }),
  messageHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  senderName: (isOwn) => ({
    fontSize: '0.75rem',
    fontWeight: 500,
    color: isOwn ? 'var(--hush-amber)' : 'var(--hush-text-secondary)',
  }),
  timestamp: {
    fontSize: '0.65rem',
    color: 'var(--hush-text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  messageText: {
    fontSize: '0.85rem',
    color: 'var(--hush-text)',
    wordWrap: 'break-word',
    whiteSpace: 'pre-wrap',
    lineHeight: 1.4,
  },
  inputSection: {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    borderTop: '1px solid var(--hush-border)',
    paddingTop: '12px',
    paddingBottom: '12px',
  },
  inputWrapper: {
    display: 'flex',
    gap: '8px',
  },
  input: {
    flex: 1,
    padding: '10px 12px',
    background: 'var(--hush-black)',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-md)',
    color: 'var(--hush-text)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.85rem',
    outline: 'none',
    transition: 'box-shadow var(--duration-normal) var(--ease-out)',
    resize: 'none',
    lineHeight: '24px',
    maxHeight: '120px',
  },
  sendButton: (disabled) => ({
    padding: '10px 16px',
    background: disabled ? 'var(--hush-surface)' : 'var(--hush-amber)',
    color: disabled ? 'var(--hush-text-ghost)' : 'var(--hush-black)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontSize: '0.85rem',
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all var(--duration-fast) var(--ease-out)',
    opacity: disabled ? 0.5 : 1,
  }),
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: '100%',
    gap: '12px',
    color: 'var(--hush-text-muted)',
    textAlign: 'center',
    padding: '40px 20px',
  },
  emptyIcon: {
    width: '48px',
    height: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-lg)',
    background: 'var(--hush-surface)',
    border: '1px solid transparent',
    color: 'var(--hush-text-ghost)',
  },
  emptyText: {
    fontSize: '0.85rem',
    color: 'var(--hush-text-muted)',
    maxWidth: '200px',
  },
};

export default function Chat({
  channelId,
  serverId,
  currentUserId,
  getToken,
  getStore,
  wsClient: wsClientProp,
  members = [],
  onNewMessage,
}) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const messagesEndRef = useRef(null);
  const messagesScrollRef = useRef(null);
  const inputRef = useRef(null);
  const lastSentTempIdRef = useRef(null);
  const knownMessageIdsRef = useRef(new Set());
  const wsClientRef = useRef(wsClientProp);
  wsClientRef.current = wsClientProp;
  const scrollRestoreRef = useRef(null);

  const displayNameMap = useMemo(() => {
    const map = new Map();
    for (const m of members) {
      const uid = m.userId ?? m.id;
      if (uid && m.displayName) map.set(uid, m.displayName);
    }
    return map;
  }, [members]);

  const { encryptForChannel, decryptFromChannel, getCachedMessage, setCachedMessage } = useMLS({
    getStore: getStore ?? (() => Promise.resolve(null)),
    getToken: getToken ?? (() => null),
    channelId,
  });

  const decryptFromChannelRef = useRef(decryptFromChannel);
  decryptFromChannelRef.current = decryptFromChannel;
  const encryptForChannelRef = useRef(encryptForChannel);
  encryptForChannelRef.current = encryptForChannel;
  const getCachedMessageRef = useRef(getCachedMessage);
  getCachedMessageRef.current = getCachedMessage;
  const setCachedMessageRef = useRef(setCachedMessage);
  setCachedMessageRef.current = setCachedMessage;
  const wsClient = wsClientProp;

  // Track which channel the current messages belong to, so we can detect
  // stale messages during render without clearing them (avoids empty-flash).
  const loadedChannelRef = useRef(channelId);

  // Load history and subscribe to channel
  useEffect(() => {
    if (!channelId || !serverId || !getToken) return;
    const token = getToken();
    if (!token) return;

    // Reset refs immediately (sync, no re-render)
    knownMessageIdsRef.current = new Set();
    lastSentTempIdRef.current = null;
    scrollRestoreRef.current = null;

    const loadHistory = async () => {
      try {
        const list = await api.getChannelMessages(token, serverId, channelId, { limit: 50 });
        const decrypted = [];
        for (let i = list.length - 1; i >= 0; i--) {
          const m = list[i];
          decrypted.push(
            await decryptMessageRow(m, currentUserId, {
              decryptFromChannel: decryptFromChannelRef.current,
              getCachedMessage: getCachedMessageRef.current,
              setCachedMessage: setCachedMessageRef.current,
            })
          );
          knownMessageIdsRef.current.add(m.id);
        }
        // Atomic replacement: old messages → new messages in one render
        loadedChannelRef.current = channelId;
        setMessages(decrypted);
        setHasMoreOlder(list.length >= 50);
        setInputText('');
      } catch (err) {
        console.error('[chat] Load history failed:', err.message);
        loadedChannelRef.current = channelId;
        setMessages([]);
      } finally {
        setIsInitialLoading(false);
      }
    };
    loadHistory();
  }, [channelId, serverId, getToken, currentUserId]);

  const loadMore = useCallback(async () => {
    if (!channelId || !serverId || !getToken || loadMoreLoading || !hasMoreOlder || messages.length === 0) return;
    const token = getToken();
    if (!token) return;
    const oldestTs = messages[0]?.timestamp;
    if (!oldestTs) return;
    setLoadMoreLoading(true);
    try {
      const before = new Date(oldestTs).toISOString();
      const list = await api.getChannelMessages(token, serverId, channelId, { before, limit: 50 });
      if (list.length === 0) {
        setHasMoreOlder(false);
        return;
      }
      if (list.length < 50) setHasMoreOlder(false);
      const older = [];
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (knownMessageIdsRef.current.has(m.id)) continue;
        knownMessageIdsRef.current.add(m.id);
        older.push(
          await decryptMessageRow(m, currentUserId, {
            decryptFromChannel: decryptFromChannelRef.current,
            getCachedMessage: getCachedMessageRef.current,
            setCachedMessage: setCachedMessageRef.current,
          })
        );
      }
      const el = messagesScrollRef.current;
      const oldScrollHeight = el?.scrollHeight ?? 0;
      const oldScrollTop = el?.scrollTop ?? 0;
      scrollRestoreRef.current = { oldScrollHeight, oldScrollTop };
      setMessages((prev) => [...older, ...prev]);
    } catch (err) {
      console.error('[chat] Load more failed:', err.message);
    } finally {
      setLoadMoreLoading(false);
    }
  }, [channelId, serverId, getToken, messages, loadMoreLoading, hasMoreOlder, currentUserId]);

  const handleScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el || loadMoreLoading || !hasMoreOlder) return;
    if (el.scrollTop < 80) loadMore();
  }, [loadMore, loadMoreLoading, hasMoreOlder]);

  // Subscribe to channel and listen for message.new
  useEffect(() => {
    if (!wsClient || !channelId) return;

    function doSubscribe() {
      if (wsClient.isConnected()) wsClient.send('subscribe', { channel_id: channelId });
    }
    doSubscribe();
    wsClient.on('open', doSubscribe);

    const onMessageNew = async (data) => {
      if (data.channel_id !== channelId) return;
      const id = data.id || `msg-${Date.now()}`;
      if (knownMessageIdsRef.current.has(id)) return;
      knownMessageIdsRef.current.add(id);
      const senderId = data.sender_id;
      const ts = data.timestamp ? new Date(data.timestamp).getTime() : Date.now();

      // Self-echo: server confirmed our message was persisted.
      // The ciphertext was encrypted for the recipient, so we can't decrypt it.
      // Read plaintext from the synchronous _pendingSends map (not React state)
      // so the cache write doesn't depend on React 18's deferred updater execution.
      if (senderId === currentUserId) {
        const pendingContent = consumePendingSend(data.channel_id, currentUserId, ts);
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.pending && m.sender === currentUserId);
          if (idx < 0) return prev;
          return prev.map((m, i) => (i === idx ? { ...m, id, pending: false, failed: false, timestamp: ts } : m));
        });
        if (pendingContent !== null) {
          setCachedMessageRef.current?.(id, { content: pendingContent, senderId: currentUserId, timestamp: ts });
        }
        return;
      }

      let content = null;
      let decryptionFailed = false;
      // MLS: single ciphertext for all group members. No ciphertext_by_recipient.
      const ciphertext = data.ciphertext;
      if (ciphertext) {
        try {
          const ct = base64ToUint8Array(ciphertext);
          content = await decryptFromChannelRef.current(ct);
          if (setCachedMessageRef.current) {
            setCachedMessageRef.current(id, { content, senderId, timestamp: ts });
          }
        } catch (_) {
          decryptionFailed = true;
        }
      }
      const msg = {
        id,
        sender: senderId,
        content,
        timestamp: ts,
        decryptionFailed,
      };
      onNewMessage?.();
      setMessages((prev) => [...prev, msg]);
    };
    const onError = (data) => {
      if (data.code === 'forbidden' || data.code === 'internal') {
        setMessages((prev) => prev.map((m) => (m.pending ? { ...m, failed: true } : m)));
      }
    };
    wsClient.on('message.new', onMessageNew);
    wsClient.on('error', onError);
    return () => {
      wsClient.off('open', doSubscribe);
      wsClient.off('message.new', onMessageNew);
      wsClient.off('error', onError);
      if (wsClient.isConnected()) wsClient.send('unsubscribe', { channel_id: channelId });
    };
  }, [wsClient, channelId, currentUserId, onNewMessage]);

  useEffect(() => {
    const rest = scrollRestoreRef.current;
    if (rest) {
      scrollRestoreRef.current = null;
      const el = messagesScrollRef.current;
      if (el && rest.oldScrollHeight > 0) {
        const newScrollHeight = el.scrollHeight;
        el.scrollTop = newScrollHeight - rest.oldScrollHeight + rest.oldScrollTop;
      }
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isSending || !channelId || !wsClient) return;
    const token = getToken?.();
    if (!token) return;

    const tempId = `temp-${Date.now()}`;
    const optimisticMessage = {
      id: tempId,
      sender: currentUserId,
      content: trimmed,
      timestamp: Date.now(),
      decryptionFailed: false,
      pending: true,
      failed: false,
    };
    setMessages((prev) => [...prev, optimisticMessage]);
    setInputText('');
    inputRef.current?.focus();
    lastSentTempIdRef.current = tempId;
    setIsSending(true);
    addPendingSend(channelId, trimmed, currentUserId);

    try {
      await encryptAndSendMLS(wsClient, channelId, trimmed, encryptForChannelRef.current);
    } catch (err) {
      console.error('[chat] Send failed:', err?.message ?? err);
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, failed: true } : m)));
    } finally {
      lastSentTempIdRef.current = null;
      setIsSending(false);
    }
  };

  const handleRetry = async (msg) => {
    if (!channelId || !wsClient || msg.failed !== true) return;
    const trimmed = (msg.content || '').trim();
    if (!trimmed) return;
    const tempId = msg.id;
    setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, failed: false, pending: true } : m)));
    try {
      await encryptAndSendMLS(wsClient, channelId, trimmed, encryptForChannelRef.current);
    } catch (err) {
      console.error('[chat] Retry send failed:', err.message);
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, failed: true } : m)));
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  // While fetching a new channel's messages, hide stale content from the
  // previous channel so the user never sees the wrong messages.
  const isChannelTransitioning = loadedChannelRef.current !== channelId;
  const visibleMessages = isChannelTransitioning ? [] : messages;
  const hasMessages = visibleMessages.length > 0;

  return (
    <div style={styles.container}>
      <div style={styles.messagesSection}>
        <div
          ref={messagesScrollRef}
          onScroll={handleScroll}
          style={{
            ...styles.messagesScroll,
            ...(hasMessages ? styles.messagesScrollWithMessages : {}),
          }}
        >
          {!isChannelTransitioning && hasMoreOlder && (loadMoreLoading || visibleMessages.length > 0) && (
            <div style={{ padding: '8px', textAlign: 'center', fontSize: '0.75rem', color: 'var(--hush-text-muted)' }}>
              {loadMoreLoading ? 'Loading…' : 'Scroll up for older messages'}
            </div>
          )}
          {isChannelTransitioning || isInitialLoading ? (
            <div style={styles.empty}>
              <div style={{ fontSize: '0.8rem', color: 'var(--hush-text-muted)' }}>
                Loading…
              </div>
            </div>
          ) : !hasMessages ? (
            <div style={styles.empty}>
              <div style={styles.emptyIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div style={styles.emptyText}>
                no messages yet, start the conversation
              </div>
            </div>
          ) : (
            visibleMessages.map((msg) => {
              const isOwn = msg.sender === currentUserId;
              const isFailed = msg.failed === true;
              const isPending = msg.pending === true;
              return (
                <div
                  key={msg.id}
                  style={{
                    ...styles.message(isOwn),
                    ...(isFailed ? { borderColor: 'var(--hush-danger)' } : {}),
                    ...(isPending ? { opacity: 0.8 } : {}),
                  }}
                >
                  <div style={styles.messageHeader}>
                    <span style={styles.senderName(isOwn)}>
                      {isOwn ? 'You' : (displayNameMap.get(msg.sender) ?? truncateUserId(msg.sender))}
                    </span>
                    <span style={styles.timestamp}>{formatTime(msg.timestamp)}</span>
                  </div>
                  <div style={styles.messageText}>
                    {msg.decryptionFailed ? (
                      <span style={{ color: 'var(--hush-text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>
                        Message encrypted — decryption key no longer available
                      </span>
                    ) : (
                      msg.content
                    )}
                  </div>
                  {isPending && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--hush-text-muted)', marginTop: '4px' }}>
                      sending…
                    </div>
                  )}
                  {isFailed && (
                    <div style={{ marginTop: '8px' }}>
                      <button
                        type="button"
                        onClick={() => handleRetry(msg)}
                        style={{
                          padding: '4px 10px',
                          fontSize: '0.75rem',
                          fontWeight: 500,
                          color: 'var(--hush-danger)',
                          background: 'var(--hush-danger-ghost)',
                          border: '1px solid var(--hush-danger)',
                          borderRadius: 'var(--radius-md)',
                          cursor: 'pointer',
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
          {hasMessages && <div ref={messagesEndRef} />}
        </div>
      </div>
      <div style={styles.inputSection}>
        <div style={styles.inputWrapper}>
          <textarea
            id="chat-message"
            name="message"
            ref={inputRef}
            style={styles.input}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="send a message..."
            rows={1}
            maxLength={2000}
            disabled={isSending}
            autoComplete="off"
          />
          <button
            style={styles.sendButton(!inputText.trim() || isSending)}
            onClick={handleSend}
            disabled={!inputText.trim() || isSending}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function truncateUserId(userId) {
  if (!userId) return 'User';
  return userId.slice(0, 8) + '…';
}
