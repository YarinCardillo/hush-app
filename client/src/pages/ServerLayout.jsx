import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ServerList from '../components/ServerList';
import ChannelList from '../components/ChannelList';
import TextChannel from './TextChannel';
import VoiceChannel from './VoiceChannel';
import { getServer } from '../lib/api';
import { createWsClient } from '../lib/ws';

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
  const [wsClient, setWsClient] = useState(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
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
  }, []);

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
          currentChannel.type === 'text' ? (
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
            />
          ) : (
            <div style={layoutStyles.placeholder}>Unknown channel type</div>
          )
        ) : serverId ? (
          <div style={layoutStyles.placeholder}>Select a channel</div>
        ) : (
          <div style={layoutStyles.placeholder}>Select a server</div>
        )}
      </div>
    </div>
  );
}
