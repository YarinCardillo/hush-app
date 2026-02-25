import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
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
}) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? '';

  const getStore = useCallback(() => {
    return signalStore.openStore(user?.id ?? '', 'default');
  }, [user?.id]);

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <span style={styles.channelName}>#{channel.name}</span>
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
