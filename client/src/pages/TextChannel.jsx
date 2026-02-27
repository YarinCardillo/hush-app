import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getDeviceId } from '../hooks/useAuth';
import * as signalStore from '../lib/signalStore';
import Chat from '../components/Chat';

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
  membersToggle: {
    padding: '4px 8px',
    fontSize: '0.8rem',
    fontFamily: 'var(--font-sans)',
    background: 'none',
    border: '1px solid var(--hush-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--hush-text-secondary)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  channelName: {
    fontSize: '0.9rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  main: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
};

/**
 * Text-only channel view: header bar + Chat panel.
 * Used by ServerLayout when currentChannel.type === 'text'.
 */
export default function TextChannel({
  channel,
  serverId,
  getToken,
  wsClient,
  recipientUserIds = [],
  showMembers = false,
  onToggleMembers,
}) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? '';

  const getStore = useCallback(() => {
    return signalStore.openStore(user?.id ?? '', getDeviceId());
  }, [user?.id]);

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <span style={styles.channelName}>#{channel.name}</span>
        {onToggleMembers && (
          <button
            type="button"
            style={styles.membersToggle}
            onClick={onToggleMembers}
            aria-pressed={showMembers}
          >
            Members
          </button>
        )}
      </header>
      <div style={styles.main}>
        <Chat
          channelId={channel.id}
          currentUserId={currentUserId}
          getToken={getToken}
          getStore={getStore}
          wsClient={wsClient}
          recipientUserIds={recipientUserIds}
        />
      </div>
    </div>
  );
}
