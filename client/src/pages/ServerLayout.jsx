import { useState, useEffect, useCallback, useRef } from 'react';
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
import { useSidebarResize } from '../hooks/useSidebarResize';
import ConfirmModal from '../components/ConfirmModal';
import HushOrb from '../components/HushOrb';

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
    position: 'relative',
  },
  memberPanel: {
    position: 'absolute',
    right: 0,
    top: 48,
    bottom: 0,
    width: 240,
    overflow: 'hidden',
  },
  channelArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'hidden',
  },
  voiceWrapper: (visible) => ({
    display: visible ? 'flex' : 'none',
    flex: 1,
    flexDirection: 'column',
    minHeight: 0,
    overflow: 'hidden',
  }),
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
  resizeHandle: {
    width: '4px',
    flexShrink: 0,
    cursor: 'col-resize',
    background: 'transparent',
    transition: 'background var(--duration-fast) var(--ease-out)',
    zIndex: 10,
  },
  channelAreaHeader: {
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
  const [showMembers, setShowMembers] = useState(() => breakpoint !== 'mobile');

  // Persistent voice session — survives channel/server navigation until Leave is clicked.
  const [activeVoiceChannel, setActiveVoiceChannel] = useState(null);
  const [activeVoiceServerId, setActiveVoiceServerId] = useState(null);
  const [pendingVoiceSwitch, setPendingVoiceSwitch] = useState(null); // channel to switch to after confirmation
  // Member IDs captured at join time for the voice channel's server.
  // When on a different server we can't derive them from current `members`.
  const activeVoiceMemberIdsRef = useRef([]);

  const { width: sidebarWidth, handleMouseDown: handleSidebarResize } = useSidebarResize();

  const currentUserId = user?.id ?? '';
  const isMobile = breakpoint === 'mobile';

  // Whether the user is currently viewing the active voice channel.
  const isViewingVoice = activeVoiceChannel != null && channelId === activeVoiceChannel.id;

  // Member IDs to pass to VoiceChannel: live when on same server, captured otherwise.
  const memberIds = members.map((m) => m.userId);
  const voiceRecipientIds =
    serverId === activeVoiceServerId ? memberIds : activeVoiceMemberIdsRef.current;

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

  // TODO(Phase-F, 2026-02-26): Subscribe to membership-change WS events to refresh members in real-time.
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

  const currentChannel = serverData?.channels?.find((c) => c.id === channelId);

  // Auto-join when navigating directly to a voice channel URL.
  useEffect(() => {
    if (currentChannel?.type === 'voice' && currentChannel.id !== activeVoiceChannel?.id) {
      activeVoiceMemberIdsRef.current = memberIds;
      setActiveVoiceChannel(currentChannel);
      setActiveVoiceServerId(serverId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChannel?.id, currentChannel?.type]);

  const handleServerSelect = (server) => {
    if (server?.id) {
      navigate(`/server/${server.id}`, { replace: true });
    }
  };

  const handleChannelSelect = (channel) => {
    if (!channel?.id || !serverId) return;
    // Switching to a different voice channel while already in one → ask first.
    if (channel.type === 'voice' && activeVoiceChannel && channel.id !== activeVoiceChannel.id) {
      setPendingVoiceSwitch(channel);
      return;
    }
    navigate(`/server/${serverId}/channel/${channel.id}`);
    if (channel.type === 'voice') {
      activeVoiceMemberIdsRef.current = memberIds;
      setActiveVoiceChannel(channel);
      setActiveVoiceServerId(serverId);
    }
  };

  const handleVoiceSwitchConfirmed = useCallback(() => {
    const channel = pendingVoiceSwitch;
    setPendingVoiceSwitch(null);
    if (!channel) return;
    navigate(`/server/${serverId}/channel/${channel.id}`);
    activeVoiceMemberIdsRef.current = memberIds;
    setActiveVoiceChannel(channel);
    setActiveVoiceServerId(serverId);
  }, [pendingVoiceSwitch, serverId, memberIds, navigate]);

  const handleChannelsUpdated = (data) => {
    setServerData(data);
  };

  const handleVoiceLeave = useCallback(() => {
    setActiveVoiceChannel(null);
    setActiveVoiceServerId(null);
    activeVoiceMemberIdsRef.current = [];
    navigate(`/server/${serverId}`);
  }, [navigate, serverId]);

  // Called after the user successfully leaves or deletes the server.
  const handleServerLeft = useCallback(() => {
    setActiveVoiceChannel(null);
    setActiveVoiceServerId(null);
    activeVoiceMemberIdsRef.current = [];
    navigate('/');
  }, [navigate]);

  return (
    <div style={layoutStyles.root}>
      <ServerList
        getToken={getToken}
        selectedServerId={serverId}
        onServerSelect={handleServerSelect}
      />
      {serverId && (
        <>
          <div style={{ width: sidebarWidth, flexShrink: 0, display: 'flex', overflow: 'hidden' }}>
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
              onLeaveServer={handleServerLeft}
              onDeleteServer={handleServerLeft}
            />
          </div>
          <div
            style={layoutStyles.resizeHandle}
            onMouseDown={handleSidebarResize}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hush-border)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize channel list"
          />
        </>
      )}
      <div style={layoutStyles.main}>
        <div style={layoutStyles.contentRow}>
          <div style={layoutStyles.channelArea}>
            {/* Persistent voice session: always mounted while active, hidden when not viewing. */}
            {activeVoiceChannel && (
              <div style={layoutStyles.voiceWrapper(isViewingVoice)}>
                <VoiceChannel
                  key={activeVoiceChannel.id}
                  channel={activeVoiceChannel}
                  serverId={activeVoiceServerId}
                  getToken={getToken}
                  wsClient={wsClient}
                  recipientUserIds={voiceRecipientIds}
                  showMembers={showMembers}
                  onToggleMembers={() => setShowMembers((v) => !v)}
                  onLeave={handleVoiceLeave}
                />
              </div>
            )}

            {/* Persistent header for non-text, non-voice states (keeps Members button visible). */}
            {!isViewingVoice && serverId && currentChannel?.type !== 'text' && (
              <header style={layoutStyles.channelAreaHeader}>
                <div />
                <button
                  type="button"
                  style={layoutStyles.membersToggle}
                  onClick={() => setShowMembers((v) => !v)}
                  aria-pressed={showMembers}
                >
                  Members
                </button>
              </header>
            )}

            {!isViewingVoice && (
              loading ? (
                <div style={layoutStyles.placeholder}>Loading…</div>
              ) : currentChannel?.type === 'text' ? (
                <TextChannel
                  key={currentChannel.id}
                  channel={currentChannel}
                  serverId={serverId}
                  getToken={getToken}
                  wsClient={wsClient}
                  recipientUserIds={memberIds}
                  showMembers={showMembers}
                  onToggleMembers={() => setShowMembers((v) => !v)}
                />
              ) : currentChannel && currentChannel.type !== 'voice' ? (
                <div style={layoutStyles.placeholder}>Unknown channel type</div>
              ) : (
                <div style={layoutStyles.placeholder}>
                  <HushOrb
                    phase="idle"
                    label={serverId ? 'select a channel' : 'select a server'}
                  />
                </div>
              )
            )}
          </div>

          {serverId && isMobile ? (
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
          ) : serverId && showMembers ? (
            <div style={layoutStyles.memberPanel}>
              <MemberList
                members={members}
                onlineUserIds={onlineUserIds}
                currentUserId={currentUserId}
              />
            </div>
          ) : null}
        </div>
      </div>
      {pendingVoiceSwitch && (
        <ConfirmModal
          title="Switch voice channel"
          message={`You are currently connected to "${activeVoiceChannel?.name}". Switch to "${pendingVoiceSwitch.name}"?`}
          confirmLabel="Switch"
          onConfirm={handleVoiceSwitchConfirmed}
          onCancel={() => setPendingVoiceSwitch(null)}
        />
      )}
    </div>
  );
}
