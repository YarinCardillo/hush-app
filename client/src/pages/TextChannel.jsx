import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getDeviceId } from '../hooks/useAuth';
import * as mlsStore from '../lib/mlsStore';
import Chat from '../components/Chat';

/**
 * Text-only channel view: header bar + Chat panel.
 * Used by ServerLayout when currentChannel.type === 'text'.
 */
export default function TextChannel({
  channel,
  serverId,
  getToken,
  wsClient,
  members = [],
  showMembers = false,
  onToggleMembers,
  onToggleDrawer,
  onMobileBack,
  sidebarSlot = null,
  baseUrl = '',
}) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? '';
  const getStore = useCallback(() => {
    return mlsStore.openStore(user?.id ?? '', getDeviceId());
  }, [user?.id]);
  const getHistoryStore = useCallback(() => {
    return mlsStore.openHistoryStore(user?.id ?? '', getDeviceId());
  }, [user?.id]);

  return (
    <div className="tc-root">
      <header className="tc-header">
        <div className="tc-header-left">
          {onMobileBack ? (
            <button
              type="button"
              className="tc-back-btn"
              onClick={onMobileBack}
              aria-label="Back to channels"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          ) : onToggleDrawer ? (
            <button
              type="button"
              className="tc-drawer-toggle"
              onClick={onToggleDrawer}
              aria-label="Toggle channels"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          ) : null}
          <span className="tc-channel-name">#{channel._displayName ?? channel.name ?? ''}</span>
        </div>
        {onToggleMembers && (
          <button
            type="button"
            className="tc-members-toggle"
            onClick={onToggleMembers}
            aria-pressed={showMembers}
          >
            Members
          </button>
        )}
      </header>
      <div className="tc-main">
        <div className="tc-chat-area">
          <Chat
            channelId={channel.id}
            serverId={serverId}
            currentUserId={currentUserId}
            getToken={getToken}
            getStore={getStore}
            getHistoryStore={getHistoryStore}
            wsClient={wsClient}
            members={members}
            baseUrl={baseUrl}
          />
        </div>
        {sidebarSlot}
      </div>
    </div>
  );
}
