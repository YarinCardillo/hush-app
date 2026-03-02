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
  channelArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'hidden',
    position: 'relative', // needed for the persistent HushOrb overlay
  },
  voiceWrapper: (visible) => ({
    display: visible ? 'flex' : 'none',
    flex: 1,
    flexDirection: 'column',
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
    zIndex: 1, // sits above the absolute HushOrb overlay; video tiles cover the orb naturally
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
  const [openPanel, setOpenPanel] = useState(null); // 'members' | 'chat' | 'participants' | null
  const togglePanel = useCallback((name) => setOpenPanel((prev) => prev === name ? null : name), []);
  const showMembers = openPanel === 'members';
  const showChatPanel = openPanel === 'chat';
  const showParticipantsPanel = openPanel === 'participants';

  // Persistent voice session — survives channel/server navigation until Leave is clicked.
  const [activeVoiceChannel, setActiveVoiceChannel] = useState(null);
  const [activeVoiceServerId, setActiveVoiceServerId] = useState(null);
  // Increment on each voice join so VoiceChannel remounts and effect (connectRoom) runs on re-entry.
  const [voiceMountKey, setVoiceMountKey] = useState(0);
  const [pendingVoiceSwitch, setPendingVoiceSwitch] = useState(null); // channel to switch to after confirmation
  // Member IDs captured at join time for the voice channel's server.
  // When on a different server we can't derive them from current `members`.
  const activeVoiceMemberIdsRef = useRef([]);
  // Set in handleVoiceLeave so the next onOrbPhaseChange('idle') from unmounting VoiceChannel
  // is accepted (isViewingVoice is still true until state commits).
  const leavingVoiceRef = useRef(false);

  // Orb phase is lifted here so a single persistent <HushOrb> element can smoothly
  // transition between voice states (idle/waiting/activating) and the idle placeholder
  // without unmounting and remounting across navigation.
  const [orbPhase, setOrbPhase] = useState('idle');

  // Voice participants per channel (server-authoritative via LiveKit webhooks).
  // Map<channelId, Array<{ userId, displayName }>>
  const [voiceParticipants, setVoiceParticipants] = useState(() => new Map());

  const { width: sidebarWidth, handleMouseDown: handleSidebarResize } = useSidebarResize();

  const currentUserId = user?.id ?? '';
  const isMobile = breakpoint === 'mobile';

  // Whether the user is currently viewing the active voice channel.
  const isViewingVoice = activeVoiceChannel != null && channelId === activeVoiceChannel.id;

  // When not viewing voice or when leaving: always show idle. Prevents hidden VoiceChannel
  // from overwriting with waiting/activating, and ensures orb resets on leave.
  const handleOrbPhaseChange = useCallback((phase) => {
    setOrbPhase((prev) => {
      if (!isViewingVoice) return 'idle';
      if (leavingVoiceRef.current) return 'idle';
      const guard = phase === 'idle' && (prev === 'waiting' || prev === 'activating');
      const next = guard ? prev : phase;
      if (guard) return prev;
      if (phase === 'idle') leavingVoiceRef.current = false;
      return phase;
    });
  }, [isViewingVoice]);

  // When not viewing the voice channel (navigated away or left), show placeholder orb.
  useEffect(() => {
    if (!isViewingVoice) {
      setOrbPhase('idle');
    }
  }, [isViewingVoice]);

  // Reset the leaving-voice guard only after the URL has actually changed.
  // navigate() updates channelId asynchronously; if we reset earlier (e.g. when
  // isViewingVoice flips), the stale channelId still points to the voice channel
  // and the render-time auto-join would re-activate it.
  useEffect(() => {
    leavingVoiceRef.current = false;
  }, [channelId]);

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

  // Subscribe to server-level WS events for voice state updates.
  useEffect(() => {
    if (!wsClient || !serverId) return;
    const subscribe = () => {
      try { wsClient.send('subscribe.server', { server_id: serverId }); } catch { /* not connected yet */ }
    };
    subscribe();
    wsClient.on('open', subscribe);
    return () => {
      wsClient.off('open', subscribe);
      try { wsClient.send('unsubscribe.server', { server_id: serverId }); } catch { /* disconnected */ }
    };
  }, [wsClient, serverId]);

  // Listen for voice_state_update events from backend (LiveKit webhook-driven).
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

  // True when a 48px header is visible at the top of channelArea:
  // VoiceChannel always renders its own 48px header; the non-voice, non-text state
  // renders channelAreaHeader (48px) only when a server is selected but no channel.
  const hasOrbTopHeader = isViewingVoice || (!isViewingVoice && !!serverId && !currentChannel);

  // Auto-join when navigating directly to a voice channel URL.
  // Synchronous state update during render avoids a one-frame flash where
  // channelAreaHeader shows before VoiceChannel's header takes over.
  // Guard: skip when the user is actively leaving voice — otherwise the stale
  // channelId in the URL (not yet updated by navigate()) would re-activate the channel.
  if (currentChannel?.type === 'voice' && currentChannel.id !== activeVoiceChannel?.id && !leavingVoiceRef.current) {
    activeVoiceMemberIdsRef.current = memberIds;
    setVoiceMountKey((k) => k + 1);
    setActiveVoiceChannel(currentChannel);
    setActiveVoiceServerId(serverId);
  }

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
      setVoiceMountKey((k) => k + 1);
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
    setVoiceMountKey((k) => k + 1);
    setActiveVoiceChannel(channel);
    setActiveVoiceServerId(serverId);
  }, [pendingVoiceSwitch, serverId, memberIds, navigate]);

  const handleChannelsUpdated = (data) => {
    setServerData(data);
  };

  const handleVoiceLeave = useCallback(() => {
    // Voice participant state is now server-authoritative (LiveKit webhook).
    // No client-side count manipulation needed.
    // So the next onOrbPhaseChange('idle') from unmounting VoiceChannel is accepted.
    leavingVoiceRef.current = true;
    // Reset orbPhase before unmounting VoiceChannel so the persistent HushOrb
    // can transition smoothly from the current phase (e.g. waiting) to idle.
    setOrbPhase('idle');
    setActiveVoiceChannel(null);
    setActiveVoiceServerId(null);
    activeVoiceMemberIdsRef.current = [];
    navigate(`/server/${serverId}`);
  }, [navigate, serverId]);

  // Called after the user successfully leaves or deletes the server.
  const handleServerLeft = useCallback(() => {
    setOrbPhase('idle');
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
              voiceParticipants={voiceParticipants}
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
                  key={`${activeVoiceChannel.id}-${voiceMountKey}`}
                  channel={activeVoiceChannel}
                  serverId={activeVoiceServerId}
                  getToken={getToken}
                  wsClient={wsClient}
                  recipientUserIds={voiceRecipientIds}
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
                        />
                      </div>
                    </div>
                  ) : null}
                />
              ) : currentChannel && currentChannel.type !== 'voice' ? (
                <div style={{ ...layoutStyles.placeholder, position: 'relative', zIndex: 1 }}>Unknown channel type</div>
              ) : (
                <>
                  {/* Header with Members toggle for non-text, non-voice states */}
                  {serverId && !currentChannel && (
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
                  {/* Spacer that lets the desktop sidebar take in-flow width on the right */}
                  <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                    <div style={{ flex: 1 }} />
                    {!isMobile && (
                      <div className={`sidebar-desktop ${showMembers ? 'sidebar-desktop-open' : ''}`}>
                        <div className="sidebar-desktop-inner">
                          <MemberList
                            members={members}
                            onlineUserIds={onlineUserIds}
                            currentUserId={currentUserId}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )
            )}

            {/*
              Persistent HushOrb overlay — single DOM instance that survives navigation.
              VoiceChannel reports its phase via onOrbPhaseChange; handleVoiceLeave resets
              to 'idle' before unmounting, giving the CSS @property tokens time to transition.
              z-index: 0 keeps it below voiceWrapper (z-index: 1), so video tiles cover it
              naturally while the transparent VideoGrid empty state lets it show through.
            */}
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
                    label={isViewingVoice ? undefined : (serverId ? 'select a channel' : 'select a server')}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Mobile overlay — fixed position, doesn't affect layout */}
          {serverId && !isViewingVoice && isMobile && (
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
    </div>
  );
}
