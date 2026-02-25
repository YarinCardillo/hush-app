import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ServerList from '../components/ServerList';
import ChannelList from '../components/ChannelList';
import { getServer } from '../lib/api';

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
    ? (sessionStorage.getItem('hush_jwt') ?? sessionStorage.getItem('hush_token'))
    : null;
}

export default function ServerLayout() {
  const { serverId, channelId } = useParams();
  const navigate = useNavigate();
  const [serverData, setServerData] = useState(null);
  const [loading, setLoading] = useState(false);

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
          <div style={layoutStyles.placeholder}>
            <div>
              <div style={{ fontWeight: 500, color: 'var(--hush-text)', marginBottom: '8px' }}>
                #{currentChannel.name}
              </div>
              <div style={{ fontSize: '0.8rem' }}>
                {currentChannel.type === 'voice' ? 'Voice channel' : 'Text channel'}
                {currentChannel.type === 'voice' && currentChannel.voiceMode && ` · ${currentChannel.voiceMode}`}
              </div>
              <div style={{ marginTop: '12px', fontSize: '0.75rem' }}>
                Channel view (Phase E.5)
              </div>
            </div>
          </div>
        ) : serverId ? (
          <div style={layoutStyles.placeholder}>Select a channel</div>
        ) : (
          <div style={layoutStyles.placeholder}>Select a server</div>
        )}
      </div>
    </div>
  );
}
