import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ServerList from '../components/ServerList';
import ChannelList from '../components/ChannelList';
import MemberList from '../components/MemberList';
import TextChannel from './TextChannel';
import VoiceChannel from './VoiceChannel';
import { getInstance, getMyGuilds, getGuildChannels, getGuildMembers } from '../lib/api';
import { createWsClient } from '../lib/ws';
import { useAuth } from '../contexts/AuthContext';
import { JWT_KEY } from '../hooks/useAuth';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useSidebarResize } from '../hooks/useSidebarResize';
import ConfirmModal from '../components/ConfirmModal';
import HushOrb from '../components/HushOrb';
import { useToast } from '../hooks/useToast';
import Toast from '../components/Toast';

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
  channelArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  voiceWrapper: (visible) => ({
    display: visible ? 'flex' : 'none',
    flex: 1,
    flexDirection: 'column',
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
    zIndex: 1,
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
  const params = useParams();
  const serverId = params.serverId ?? null;
  // Extract channelId from the splat: "channels/uuid" → "uuid"
  const splat = params['*'] ?? '';
  const channelId = splat.startsWith('channels/') ? splat.slice('channels/'.length) : undefined;
  const navigate = useNavigate();
  const { token: authToken, user, logout } = useAuth();
  const breakpoint = useBreakpoint();
  const [instanceData, setInstanceData] = useState(null);
  const [guilds, setGuilds] = useState([]);
  const [activeGuild, setActiveGuild] = useState(null);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [wsClient, setWsClient] = useState(null);
  const [onlineUserIds, setOnlineUserIds] = useState(() => new Set());
  const [members, setMembers] = useState([]);
  const [openPanel, setOpenPanel] = useState(null); // 'members' | 'chat' | 'participants' | null
  const togglePanel = useCallback((name) => setOpenPanel((prev) => prev === name ? null : name), []);
  const showMembers = openPanel === 'members';
  const showChatPanel = openPanel === 'chat';
  const showParticipantsPanel = openPanel === 'participants';

  // Persistent voice session — survives channel navigation until Leave is clicked.
  const [activeVoiceChannel, setActiveVoiceChannel] = useState(null);
  const [voiceMountKey, setVoiceMountKey] = useState(0);
  const [pendingVoiceSwitch, setPendingVoiceSwitch] = useState(null);
  const activeVoiceMemberIdsRef = useRef([]);
  const leavingVoiceRef = useRef(false);

  const [orbPhase, setOrbPhase] = useState('idle');

  // Voice participants per channel (server-authoritative via LiveKit webhooks).
  const [voiceParticipants, setVoiceParticipants] = useState(() => new Map());

  const { width: sidebarWidth, handleMouseDown: handleSidebarResize } = useSidebarResize();

  const currentUserId = user?.id ?? '';
  const isMobile = breakpoint === 'mobile';
  const { toasts, show: showToast } = useToast();

  const isViewingVoice = activeVoiceChannel != null && channelId === activeVoiceChannel.id;

  const handleOrbPhaseChange = useCallback((phase) => {
    setOrbPhase((prev) => {
      if (!isViewingVoice) return 'idle';
      if (leavingVoiceRef.current) return 'idle';
      const guard = phase === 'idle' && (prev === 'waiting' || prev === 'activating');
      if (guard) return prev;
      if (phase === 'idle') leavingVoiceRef.current = false;
      return phase;
    });
  }, [isViewingVoice]);

  useEffect(() => {
    if (!isViewingVoice) setOrbPhase('idle');
  }, [isViewingVoice]);

  useEffect(() => {
    leavingVoiceRef.current = false;
  }, [channelId]);

  const memberIds = members.map((m) => m.id ?? m.userId);

  // WS client lifecycle
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

  // Subscribe to the active guild's WS channel when wsClient or serverId changes
  const prevServerIdRef = useRef(null);
  useEffect(() => {
    if (!wsClient || !serverId) return;
    const subscribe = () => {
      const prev = prevServerIdRef.current;
      if (prev && prev !== serverId) {
        wsClient.send('unsubscribe.server', { serverId: prev });
      }
      wsClient.send('subscribe.server', { serverId });
      prevServerIdRef.current = serverId;
    };
    // Send immediately (no-ops if not connected yet) and also on open
    subscribe();
    wsClient.on('open', subscribe);
    return () => wsClient.off('open', subscribe);
  }, [wsClient, serverId]);

  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => setOnlineUserIds(new Set(data.user_ids ?? []));
    wsClient.on('presence.update', handler);
    return () => wsClient.off('presence.update', handler);
  }, [wsClient]);

  // Voice state updates from LiveKit webhooks
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      const { channel_id, participants } = data;
      if (!channel_id) return;
      setVoiceParticipants((prev) => {
        const next = new Map(prev);
        if (!participants || participants.length === 0) {
          next.delete(channel_id);
        } else {
          next.set(channel_id, participants);
        }
        return next;
      });
    };
    wsClient.on('voice_state_update', handler);
    return () => wsClient.off('voice_state_update', handler);
  }, [wsClient]);

  // channel_created: append to local channel list (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (!data.channel) return;
      if (data.server_id && data.server_id !== serverId) return;
      setChannels((prev) => {
        if (prev.some((ch) => ch.id === data.channel.id)) return prev;
        return [...prev, data.channel];
      });
    };
    wsClient.on('channel_created', handler);
    return () => wsClient.off('channel_created', handler);
  }, [wsClient, serverId]);

  // channel_deleted: remove from local list, tear down voice, redirect if viewing (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (!data.channel_id) return;
      if (data.server_id && data.server_id !== serverId) return;
      setChannels((prev) => prev.filter((ch) => ch.id !== data.channel_id));
      setActiveVoiceChannel((prev) => {
        if (prev?.id === data.channel_id) {
          activeVoiceMemberIdsRef.current = [];
          return null;
        }
        return prev;
      });
      if (channelId === data.channel_id) {
        navigate(`/servers/${serverId}/channels`, { replace: true });
      }
    };
    wsClient.on('channel_deleted', handler);
    return () => wsClient.off('channel_deleted', handler);
  }, [wsClient, channelId, serverId, navigate]);

  // channel_moved: refetch channel list for correct ordering (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (data.server_id && data.server_id !== serverId) return;
      const token = getToken();
      if (token && serverId) getGuildChannels(token, serverId).then(setChannels).catch(() => {});
    };
    wsClient.on('channel_moved', handler);
    return () => wsClient.off('channel_moved', handler);
  }, [wsClient, serverId]);

  // instance_updated: refresh instance metadata
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      setInstanceData((prev) => {
        if (!prev) return prev;
        const updated = { ...prev };
        if (data.name !== undefined) updated.name = data.name;
        if (data.icon_url !== undefined) updated.iconUrl = data.icon_url;
        if (data.registration_mode !== undefined) updated.registrationMode = data.registration_mode;
        return updated;
      });
    };
    wsClient.on('instance_updated', handler);
    return () => wsClient.off('instance_updated', handler);
  }, [wsClient]);

  // member_kicked: remove from list; redirect self if kicked (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (!data.user_id) return;
      if (data.server_id && data.server_id !== serverId) return;
      if (data.user_id === currentUserId) {
        logout();
        return;
      }
      setMembers((prev) => prev.filter((m) => (m.id ?? m.userId) !== data.user_id));
    };
    wsClient.on('member_kicked', handler);
    return () => wsClient.off('member_kicked', handler);
  }, [wsClient, currentUserId, serverId, logout]);

  // member_banned: remove from list; redirect self if banned (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (!data.user_id) return;
      if (data.server_id && data.server_id !== serverId) return;
      if (data.user_id === currentUserId) {
        logout();
        return;
      }
      setMembers((prev) => prev.filter((m) => (m.id ?? m.userId) !== data.user_id));
    };
    wsClient.on('member_banned', handler);
    return () => wsClient.off('member_banned', handler);
  }, [wsClient, currentUserId, serverId, logout]);

  // member_joined: append new member to the list (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (!data.member) return;
      if (data.server_id && data.server_id !== serverId) return;
      setMembers((prev) => {
        const memberId = data.member.id ?? data.member.userId;
        if (prev.some((m) => (m.id ?? m.userId) === memberId)) return prev;
        return [...prev, data.member];
      });
    };
    wsClient.on('member_joined', handler);
    return () => wsClient.off('member_joined', handler);
  }, [wsClient, serverId]);

  // member_left: remove from list (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (!data.user_id) return;
      if (data.server_id && data.server_id !== serverId) return;
      setMembers((prev) => prev.filter((m) => (m.id ?? m.userId) !== data.user_id));
    };
    wsClient.on('member_left', handler);
    return () => wsClient.off('member_left', handler);
  }, [wsClient, serverId]);

  // role_changed / member_role_changed: update member's role (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (!data.user_id || !data.new_role) return;
      if (data.server_id && data.server_id !== serverId) return;
      setMembers((prev) =>
        prev.map((m) =>
          (m.id ?? m.userId) === data.user_id ? { ...m, role: data.new_role } : m
        )
      );
      if (data.user_id === currentUserId) {
        setActiveGuild((prev) => prev ? { ...prev, myRole: data.new_role } : prev);
      }
    };
    wsClient.on('role_changed', handler);
    wsClient.on('member_role_changed', handler);
    return () => {
      wsClient.off('role_changed', handler);
      wsClient.off('member_role_changed', handler);
    };
  }, [wsClient, currentUserId, serverId]);

  // Fetch guilds + instance data on auth
  useEffect(() => {
    if (!authToken) return;
    const token = getToken();
    if (!token) return;
    Promise.all([getMyGuilds(token), getInstance(token)])
      .then(([guildList, inst]) => {
        setGuilds(Array.isArray(guildList) ? guildList : []);
        setInstanceData(inst);
      })
      .catch(() => {
        setGuilds([]);
        setInstanceData(null);
      });
  }, [authToken]);

  // Keep activeGuild in sync with serverId param and guilds list
  useEffect(() => {
    if (!serverId || guilds.length === 0) {
      setActiveGuild(null);
      return;
    }
    const found = guilds.find((g) => g.id === serverId) ?? null;
    setActiveGuild(found);
  }, [serverId, guilds]);

  // Fetch channels + members when serverId changes (guild switch)
  useEffect(() => {
    if (!authToken || !serverId) return;
    const token = getToken();
    if (!token) return;

    // Clear stale state immediately to prevent channel lookup across guilds
    setChannels([]);
    setActiveVoiceChannel(null);
    activeVoiceMemberIdsRef.current = [];
    setMembers([]);
    setLoading(true);

    Promise.all([getGuildChannels(token, serverId), getGuildMembers(token, serverId)])
      .then(([chans, mems]) => {
        setChannels(Array.isArray(chans) ? chans : []);
        setMembers(Array.isArray(mems) ? mems : []);
      })
      .catch(() => {
        setChannels([]);
        setMembers([]);
      })
      .finally(() => setLoading(false));
  }, [authToken, serverId]);

  /** Refresh member list after a mod action completes. */
  const handleMemberUpdate = useCallback(() => {
    const token = getToken();
    if (token && serverId) {
      getGuildMembers(token, serverId).then(setMembers).catch(() => {});
    }
  }, [serverId]);

  /** Called by ServerList when user selects a different guild. */
  const handleGuildSelect = useCallback((guild) => {
    navigate(`/servers/${guild.id}/channels`);
  }, [navigate]);

  /** Called by GuildCreateModal on success — refetch guilds and navigate to new guild. */
  const handleGuildCreated = useCallback((newGuild) => {
    const token = getToken();
    if (token) {
      getMyGuilds(token).then((list) => {
        setGuilds(Array.isArray(list) ? list : []);
      }).catch(() => {});
    }
    if (newGuild?.id) {
      navigate(`/servers/${newGuild.id}/channels`);
    }
  }, [navigate]);

  const currentChannel = channels.find((c) => c.id === channelId);

  const hasOrbTopHeader = isViewingVoice || (!isViewingVoice && !currentChannel);

  // Auto-join when navigating directly to a voice channel URL.
  if (currentChannel?.type === 'voice' && currentChannel.id !== activeVoiceChannel?.id && !leavingVoiceRef.current) {
    activeVoiceMemberIdsRef.current = memberIds;
    setVoiceMountKey((k) => k + 1);
    setActiveVoiceChannel(currentChannel);
  }

  const handleChannelSelect = (channel) => {
    if (!channel?.id) return;
    if (channel.type === 'voice' && activeVoiceChannel && channel.id !== activeVoiceChannel.id) {
      setPendingVoiceSwitch(channel);
      return;
    }
    navigate(`/servers/${serverId}/channels/${channel.id}`);
    if (channel.type === 'voice') {
      activeVoiceMemberIdsRef.current = memberIds;
      setVoiceMountKey((k) => k + 1);
      setActiveVoiceChannel(channel);
    }
  };

  const handleVoiceSwitchConfirmed = useCallback(() => {
    const channel = pendingVoiceSwitch;
    setPendingVoiceSwitch(null);
    if (!channel) return;
    navigate(`/servers/${serverId}/channels/${channel.id}`);
    activeVoiceMemberIdsRef.current = memberIds;
    setVoiceMountKey((k) => k + 1);
    setActiveVoiceChannel(channel);
  }, [pendingVoiceSwitch, memberIds, serverId, navigate]);

  const handleChannelsUpdated = useCallback((updatedChannels) => {
    setChannels(Array.isArray(updatedChannels) ? updatedChannels : []);
  }, []);

  const handleVoiceLeave = useCallback(() => {
    leavingVoiceRef.current = true;
    setOrbPhase('idle');
    setActiveVoiceChannel(null);
    activeVoiceMemberIdsRef.current = [];
    navigate(`/servers/${serverId}/channels`);
  }, [navigate, serverId]);

  // Derive myRole from activeGuild or guild membership in members list
  const myRole = activeGuild?.myRole
    ?? members.find((m) => (m.id ?? m.userId) === currentUserId)?.role
    ?? 'member';

  // No guild selected — show empty state with guild strip and welcome message
  if (!serverId) {
    return (
      <div style={layoutStyles.root}>
        <ServerList
          getToken={getToken}
          guilds={guilds}
          activeGuild={null}
          onGuildSelect={handleGuildSelect}
          onGuildCreated={handleGuildCreated}
          instanceData={instanceData}
          userRole={myRole}
        />
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--hush-text-muted)',
          fontSize: '0.9rem',
          textAlign: 'center',
          padding: '24px',
          background: 'var(--hush-black)',
        }}>
          Create a server or join one with an invite link.
        </div>
        <Toast toasts={toasts} />
      </div>
    );
  }

  return (
    <div style={layoutStyles.root}>
      <ServerList
        getToken={getToken}
        guilds={guilds}
        activeGuild={activeGuild}
        onGuildSelect={handleGuildSelect}
        onGuildCreated={handleGuildCreated}
        instanceData={instanceData}
        userRole={myRole}
      />
      <>
        <div style={{ width: sidebarWidth, flexShrink: 0, display: 'flex', overflow: 'hidden' }}>
          <ChannelList
            getToken={getToken}
            serverId={serverId}
            guildName={activeGuild?.name}
            instanceData={instanceData}
            channels={channels}
            myRole={myRole}
            activeChannelId={channelId}
            onChannelSelect={handleChannelSelect}
            onChannelsUpdated={handleChannelsUpdated}
            voiceParticipants={voiceParticipants}
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
      <div style={layoutStyles.main}>
        <div style={layoutStyles.contentRow}>
          <div style={layoutStyles.channelArea}>
            {activeVoiceChannel && (
              <div style={layoutStyles.voiceWrapper(isViewingVoice)}>
                <VoiceChannel
                  key={`${activeVoiceChannel.id}-${voiceMountKey}`}
                  channel={activeVoiceChannel}
                  serverId={serverId}
                  getToken={getToken}
                  wsClient={wsClient}
                  recipientUserIds={activeVoiceMemberIdsRef.current}
                  members={members}
                  onlineUserIds={onlineUserIds}
                  myRole={myRole}
                  showToast={showToast}
                  onMemberUpdate={handleMemberUpdate}
                  showMembers={showMembers}
                  showChatPanel={showChatPanel}
                  showParticipantsPanel={showParticipantsPanel}
                  onTogglePanel={togglePanel}
                  onLeave={handleVoiceLeave}
                  onOrbPhaseChange={handleOrbPhaseChange}
                  serverParticipants={voiceParticipants.get(activeVoiceChannel.id) ?? []}
                />
              </div>
            )}

            {!isViewingVoice && (
              loading ? (
                <div style={{ ...layoutStyles.placeholder, position: 'relative', zIndex: 1 }}>Loading…</div>
              ) : currentChannel?.type === 'text' ? (
                <TextChannel
                  key={currentChannel.id}
                  channel={currentChannel}
                  serverId={serverId}
                  getToken={getToken}
                  wsClient={wsClient}
                  recipientUserIds={memberIds}
                  members={members}
                  showMembers={showMembers}
                  onToggleMembers={() => togglePanel('members')}
                  sidebarSlot={!isMobile ? (
                    <div className={`sidebar-desktop ${showMembers ? 'sidebar-desktop-open' : ''}`}>
                      <div className="sidebar-desktop-inner">
                        <MemberList
                          members={members}
                          onlineUserIds={onlineUserIds}
                          currentUserId={currentUserId}
                          myRole={myRole}
                          showToast={showToast}
                          onMemberUpdate={handleMemberUpdate}
                          serverId={serverId}
                        />
                      </div>
                    </div>
                  ) : null}
                />
              ) : currentChannel && currentChannel.type !== 'voice' ? (
                <div style={{ ...layoutStyles.placeholder, position: 'relative', zIndex: 1 }}>Unknown channel type</div>
              ) : (
                <>
                  {!currentChannel && (
                    <header style={layoutStyles.channelAreaHeader}>
                      <div />
                      <button
                        type="button"
                        style={layoutStyles.membersToggle}
                        onClick={() => togglePanel('members')}
                        aria-pressed={showMembers}
                      >
                        Members
                      </button>
                    </header>
                  )}
                  <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                    <div style={{ flex: 1 }} />
                    {!isMobile && (
                      <div className={`sidebar-desktop ${showMembers ? 'sidebar-desktop-open' : ''}`}>
                        <div className="sidebar-desktop-inner">
                          <MemberList
                            members={members}
                            onlineUserIds={onlineUserIds}
                            currentUserId={currentUserId}
                            myRole={myRole}
                            showToast={showToast}
                            onMemberUpdate={handleMemberUpdate}
                            serverId={serverId}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )
            )}

            {!loading && (!currentChannel || currentChannel.type === 'voice') && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                paddingTop: hasOrbTopHeader ? 48 : 0,
                paddingBottom: 69,
                paddingRight: (!isMobile && (
                  isViewingVoice
                    ? (showMembers || showChatPanel || showParticipantsPanel)
                    : showMembers
                )) ? 260 : 0,
                transition: 'padding-right var(--duration-fast) var(--ease-out)',
                pointerEvents: 'none',
              }}>
                <div style={{ pointerEvents: 'auto' }}>
                  <HushOrb
                    phase={orbPhase}
                    label={isViewingVoice ? undefined : 'select a channel'}
                  />
                </div>
              </div>
            )}
          </div>

          {!isViewingVoice && isMobile && (
            <>
              <div
                className={`sidebar-overlay ${showMembers ? 'sidebar-overlay-open' : ''}`}
                onClick={() => setOpenPanel(null)}
                aria-hidden={!showMembers}
              />
              <div className={`sidebar-panel-right ${showMembers ? 'sidebar-panel-open' : ''}`}>
                <MemberList
                  members={members}
                  onlineUserIds={onlineUserIds}
                  currentUserId={currentUserId}
                  myRole={myRole}
                  showToast={showToast}
                  onMemberUpdate={handleMemberUpdate}
                  serverId={serverId}
                />
              </div>
            </>
          )}
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
      <Toast toasts={toasts} />
    </div>
  );
}
