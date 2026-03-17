import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getDeviceId } from '../hooks/useAuth';
import * as mlsStore from '../lib/mlsStore';
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
    overflow: 'hidden',
  },
  chatArea: {
    flex: 1,
    minWidth: 0,
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
  members = [],
  showMembers = false,
  onToggleMembers,
  onToggleDrawer,
  sidebarSlot = null,
}) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? '';
  const getStore = useCallback(() => {
    return mlsStore.openStore(user?.id ?? '', getDeviceId());
  }, [user?.id]);

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
          <span style={styles.channelName}>#{channel.name}</span>
        </div>
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
        <div style={styles.chatArea}>
          <Chat
            channelId={channel.id}
            serverId={serverId}
            currentUserId={currentUserId}
            getToken={getToken}
            getStore={getStore}
            wsClient={wsClient}
            recipientUserIds={recipientUserIds}
            members={members}
          />
        </div>
        {sidebarSlot}
      </div>
    </div>
  );
}
