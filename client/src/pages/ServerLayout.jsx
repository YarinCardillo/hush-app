import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ServerList from '../components/ServerList';
import ChannelList from '../components/ChannelList';
import MemberList from '../components/MemberList';
import TextChannel from './TextChannel';
import VoiceChannel from './VoiceChannel';
import { getInstance, getMembers, getChannels } from '../lib/api';
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
  const { channelId } = useParams();
  const navigate = useNavigate();
  const { token: authToken, user, logout } = useAuth();
  const breakpoint = useBreakpoint();
  const [instanceData, setInstanceData] = useState(null);
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

  // channel_created: append to local channel list
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (!data.channel) return;
      setChannels((prev) => {
        if (prev.some((ch) => ch.id === data.channel.id)) return prev;
        return [...prev, data.channel];
      });
    };
    wsClient.on('channel_created', handler);
    return () => wsClient.off('channel_created', handler);
  }, [wsClient]);

  // channel_deleted: remove from local list, tear down voice, redirect if viewing
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (!data.channel_id) return;
      setChannels((prev) => prev.filter((ch) => ch.id !== data.channel_id));
      setActiveVoiceChannel((prev) => {
        if (prev?.id === data.channel_id) {
          activeVoiceMemberIdsRef.current = [];
          return null;
        }
        return prev;
      });
      if (channelId === data.channel_id) {
        navigate('/channels', { replace: true });
      }
    };
    wsClient.on('channel_deleted', handler);
    return () => wsClient.off('channel_deleted', handler);
  }, [wsClient, channelId, navigate]);

  // channel_moved: refetch channel list for correct ordering
  useEffect(() => {
    if (!wsClient) return;
    const handler = () => {
      const token = getToken();
      if (token) getChannels(token).then(setChannels).catch(() => {});
    };
    wsClient.on('channel_moved', handler);
    return () => wsClient.off('channel_moved', handler);
  }, [wsClient]);

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

  // member_kicked: remove from list; redirect self if kicked
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (!data.user_id) return;
      if (data.user_id === currentUserId) {
        logout();
        return;
      }
      setMembers((prev) => prev.filter((m) => (m.id ?? m.userId) !== data.user_id));
    };
    wsClient.on('member_kicked', handler);
    return () => wsClient.off('member_kicked', handler);
  }, [wsClient, currentUserId, logout]);

  // member_banned: remove from list; redirect self if banned
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (!data.user_id) return;
      if (data.user_id === currentUserId) {
        logout();
        return;
      }
      setMembers((prev) => prev.filter((m) => (m.id ?? m.userId) !== data.user_id));
    };
    wsClient.on('member_banned', handler);
    return () => wsClient.off('member_banned', handler);
  }, [wsClient, currentUserId, logout]);

  // role_changed: update member's role in the list
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (!data.user_id || !data.new_role) return;
      setMembers((prev) =>
        prev.map((m) =>
          (m.id ?? m.userId) === data.user_id ? { ...m, role: data.new_role } : m
        )
      );
    };
    wsClient.on('role_changed', handler);
    return () => wsClient.off('role_changed', handler);
  }, [wsClient]);

  // message_deleted: handled inside Chat component which owns the messages list.
  // ServerLayout only needs to propagate the WS client; Chat subscribes directly.

  // Fetch members when token is available
  useEffect(() => {
    if (!authToken) return;
    const token = getToken();
    if (token) getMembers(token).then(setMembers).catch(() => setMembers([]));
  }, [authToken]);

  /** Refresh member list after a mod action completes. */
  const handleMemberUpdate = useCallback(() => {
    const token = getToken();
    if (token) getMembers(token).then(setMembers).catch(() => {});
  }, []);

  // Fetch instance data and channels on mount
  useEffect(() => {
    if (!authToken) return;
    const token = getToken();
    if (!token) return;
    setLoading(true);
    Promise.all([getInstance(token), getChannels(token)])
      .then(([inst, chans]) => {
        setInstanceData(inst);
        setChannels(Array.isArray(chans) ? chans : []);
      })
      .catch(() => {
        setInstanceData(null);
        setChannels([]);
      })
      .finally(() => setLoading(false));
  }, [authToken]);

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
    navigate(`/channels/${channel.id}`);
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
    navigate(`/channels/${channel.id}`);
    activeVoiceMemberIdsRef.current = memberIds;
    setVoiceMountKey((k) => k + 1);
    setActiveVoiceChannel(channel);
  }, [pendingVoiceSwitch, memberIds, navigate]);

  const handleChannelsUpdated = useCallback((updatedChannels) => {
    setChannels(Array.isArray(updatedChannels) ? updatedChannels : []);
  }, []);

  const handleVoiceLeave = useCallback(() => {
    leavingVoiceRef.current = true;
    setOrbPhase('idle');
    setActiveVoiceChannel(null);
    activeVoiceMemberIdsRef.current = [];
    navigate('/channels');
  }, [navigate]);

  return (
    <div style={layoutStyles.root}>
      <ServerList
        getToken={getToken}
        instanceData={instanceData}
      />
      <>
        <div style={{ width: sidebarWidth, flexShrink: 0, display: 'flex', overflow: 'hidden' }}>
          <ChannelList
            getToken={getToken}
            instanceName={instanceData?.name}
            instanceData={instanceData}
            channels={channels}
            myRole={instanceData?.myRole}
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
                  getToken={getToken}
                  wsClient={wsClient}
                  recipientUserIds={activeVoiceMemberIdsRef.current}
                  members={members}
                  onlineUserIds={onlineUserIds}
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
                          myRole={instanceData?.myRole ?? 'member'}
                          showToast={showToast}
                          onMemberUpdate={handleMemberUpdate}
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
                            myRole={instanceData?.myRole ?? 'member'}
                            showToast={showToast}
                            onMemberUpdate={handleMemberUpdate}
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
                  myRole={instanceData?.myRole ?? 'member'}
                  showToast={showToast}
                  onMemberUpdate={handleMemberUpdate}
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
