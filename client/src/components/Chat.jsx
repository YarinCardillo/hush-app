import { useState, useEffect, useRef } from 'react';
import { getSocket } from '../lib/socket';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    gap: '12px',
  },

  messagesSection: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },

  messagesScroll: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },

  message: (isOwn) => ({
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '8px 12px',
    borderRadius: 'var(--radius-md)',
    background: isOwn ? 'var(--hush-amber-ghost)' : 'var(--hush-elevated)',
    border: isOwn ? '1px solid rgba(212, 160, 83, 0.2)' : '1px solid var(--hush-border)',
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
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    borderTop: '1px solid var(--hush-border)',
    paddingTop: '12px',
  },

  inputWrapper: {
    display: 'flex',
    gap: '8px',
  },

  input: {
    flex: 1,
    padding: '10px 12px',
    background: 'var(--hush-black)',
    border: '1px solid var(--hush-border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--hush-text)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.85rem',
    outline: 'none',
    transition: 'border-color var(--duration-normal) var(--ease-out)',
    resize: 'none',
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
    border: '1px solid var(--hush-border)',
    color: 'var(--hush-text-ghost)',
  },

  emptyText: {
    fontSize: '0.85rem',
    color: 'var(--hush-text-muted)',
    maxWidth: '200px',
  },
};

export default function Chat({ currentPeerId, messages }) {
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    const socket = getSocket();

    try {
      await new Promise((resolve, reject) => {
        socket.emit('sendMessage', { text: trimmed }, (response) => {
          if (response?.error) {
            reject(new Error(response.error));
          } else {
            resolve();
          }
        });
      });

      setInputText('');
      inputRef.current?.focus();
    } catch (err) {
      console.error('[chat] Send failed:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  return (
    <div style={styles.container}>
      <div style={styles.messagesSection}>
        <div style={styles.messagesScroll}>
          {messages.length === 0 ? (
            <div style={styles.empty}>
              <div style={styles.emptyIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div style={styles.emptyText}>
                no messages yet — start the conversation
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isOwn = msg.peerId === currentPeerId;
              return (
                <div key={msg.messageId} style={styles.message(isOwn)}>
                  <div style={styles.messageHeader}>
                    <span style={styles.senderName(isOwn)}>
                      {isOwn ? 'You' : msg.displayName}
                    </span>
                    <span style={styles.timestamp}>{formatTime(msg.timestamp)}</span>
                  </div>
                  <div style={styles.messageText}>{msg.text}</div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div style={styles.inputSection}>
        <div style={styles.inputWrapper}>
          <textarea
            ref={inputRef}
            style={styles.input}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="send a message..."
            rows={1}
            maxLength={2000}
            disabled={isSending}
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
