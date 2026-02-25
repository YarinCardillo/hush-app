import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ServerList from '../components/ServerList';
import ChannelList from '../components/ChannelList';
import MemberList from '../components/MemberList';
import TextChannel from './TextChannel';
import VoiceChannel from './VoiceChannel';
import { getServer, getServerMembers } from '../lib/api';
import { createWsClient } from '../lib/ws';
import { useAuth } from '../contexts/AuthContext';
import { JWT_KEY } from '../hooks/useAuth';
import { useBreakpoint } from '../hooks/useBreakpoint';

const layoutStyles = {
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    background: 'var(--hush-black)',
  },
  contentRow: {
    flex: 1,
    display: 'flex',
    flexDirection: 'row',
    minWidth: 0,
    overflow: 'hidden',
  },
  channelArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'hidden',
  },
  channelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    height: '48px',
    background: 'var(--hush-surface)',
    borderBottom: '1px solid var(--hush-border)',
    flexShrink: 0,
  },
  channelHeaderTitle: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: 'var(--hush-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
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
  },
  placeholder: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    color: 'var(--hush-text-muted)',
    fontSize: '0.9rem',
    textAlign: 'center',
  },
};

function getToken() {
  return typeof window !== 'undefined'
    ? (sessionStorage.getItem(JWT_KEY) ?? sessionStorage.getItem('hush_token'))
    : null;
}

export default function ServerLayout() {
  const { serverId, channelId } = useParams();
  const navigate = useNavigate();
  const { token: authToken, user } = useAuth();
  const breakpoint = useBreakpoint();
  const [serverData, setServerData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [wsClient, setWsClient] = useState(null);
  const [onlineUserIds, setOnlineUserIds] = useState(() => new Set());
  const [members, setMembers] = useState([]);
  const [showMembers, setShowMembers] = useState(true);

  const currentUserId = user?.id ?? '';
  const isMobile = breakpoint === 'mobile';

  useEffect(() => {
    if (!authToken) return;
    const base = typeof location !== 'undefined' ? location.origin.replace(/^http/, 'ws') : '';
    const url = base ? `${base}/ws` : undefined;
    if (!url) return;
    const client = createWsClient({ url, getToken });
    client.connect();
    setWsClient(client);
    return () => {
      client.disconnect();
      setWsClient(null);
    };
  }, [authToken]);

  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => setOnlineUserIds(new Set(data.user_ids ?? []));
    wsClient.on('presence.update', handler);
    return () => wsClient.off('presence.update', handler);
  }, [wsClient]);

  useEffect(() => {
    if (!serverId || !authToken) return;
    const token = getToken();
    getServerMembers(token, serverId).then(setMembers).catch(() => setMembers([]));
  }, [serverId, authToken]);

  const fetchServerData = useCallback(async (sid) => {
    const token = getToken();
    if (!sid || !token) return;
    setLoading(true);
    try {
      const data = await getServer(token, sid);
      setServerData(data);
    } catch {
      setServerData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (serverId) {
      fetchServerData(serverId);
    } else {
      setServerData(null);
    }
  }, [serverId, fetchServerData]);

  const handleServerSelect = (server) => {
    if (server?.id) {
      navigate(`/server/${server.id}`, { replace: true });
    }
  };

  const handleChannelSelect = (channel) => {
    if (channel?.id && serverId) {
      navigate(`/server/${serverId}/channel/${channel.id}`);
    }
  };

  const handleChannelsUpdated = (data) => {
    setServerData(data);
  };

  const currentChannel = serverData?.channels?.find((c) => c.id === channelId);

  return (
    <div style={layoutStyles.root}>
      <ServerList
        getToken={getToken}
        selectedServerId={serverId}
        onServerSelect={handleServerSelect}
      />
      {serverId && (
        <ChannelList
          getToken={getToken}
          serverId={serverId}
          serverName={serverData?.server?.name}
          channels={serverData?.channels}
          myRole={serverData?.myRole}
          activeChannelId={channelId}
          onChannelSelect={handleChannelSelect}
          onChannelsUpdated={handleChannelsUpdated}
          // TODO(Phase-E.5, 2026-02-25): Wire up real voice participant counts from LiveKit
          voiceParticipantCounts={null}
        />
      )}
      <div style={layoutStyles.main}>
        {loading ? (
          <div style={layoutStyles.placeholder}>Loading…</div>
        ) : channelId && currentChannel ? (
          <>
            <div style={layoutStyles.channelHeader}>
              <span style={layoutStyles.channelHeaderTitle}>
                {currentChannel.type === 'text' ? '#' : ''}{currentChannel.name}
              </span>
              <button
                type="button"
                style={layoutStyles.membersToggle}
                onClick={() => setShowMembers((v) => !v)}
                aria-pressed={showMembers}
              >
                Members
              </button>
            </div>
            <div style={layoutStyles.contentRow}>
              <div style={layoutStyles.channelArea}>
                {currentChannel.type === 'text' ? (
                  <TextChannel
                    key={currentChannel.id}
                    channel={currentChannel}
                    serverId={serverId}
                    getToken={getToken}
                    wsClient={wsClient}
                    recipientUserIds={serverData?.memberIds ?? []}
                  />
                ) : currentChannel.type === 'voice' ? (
                  <VoiceChannel
                    key={currentChannel.id}
                    channel={currentChannel}
                    serverId={serverId}
                    getToken={getToken}
                    wsClient={wsClient}
                    recipientUserIds={serverData?.memberIds ?? []}
                  />
                ) : (
                  <div style={layoutStyles.placeholder}>Unknown channel type</div>
                )}
              </div>
              {isMobile ? (
                <>
                  <div
                    className={`sidebar-overlay ${showMembers ? 'sidebar-overlay-open' : ''}`}
                    onClick={() => setShowMembers(false)}
                    aria-hidden={!showMembers}
                  />
                  <div className={`sidebar-panel-right ${showMembers ? 'sidebar-panel-open' : ''}`}>
                    <MemberList
                      members={members}
                      onlineUserIds={onlineUserIds}
                      currentUserId={currentUserId}
                    />
                  </div>
                </>
              ) : showMembers ? (
                <MemberList
                  members={members}
                  onlineUserIds={onlineUserIds}
                  currentUserId={currentUserId}
                />
              ) : null}
            </div>
          </>
        ) : serverId ? (
          <div style={layoutStyles.placeholder}>Select a channel</div>
        ) : (
          <div style={layoutStyles.placeholder}>Select a server</div>
        )}
      </div>
    </div>
  );
}
