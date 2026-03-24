import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ServerList from '../components/ServerList';
import ChannelList from '../components/ChannelList';
import MemberList from '../components/MemberList';
import SystemChannel from './SystemChannel';
import TextChannel from './TextChannel';
import VoiceChannel from './VoiceChannel';
import { getInstance, getMyGuilds, getGuildChannels, getGuildMembers, getHandshake } from '../lib/api';
import * as api from '../lib/api';
import { importMetadataKey, fromBase64, decryptGuildMetadata } from '../lib/guildMetadata';
import { createWsClient } from '../lib/ws';
import { useAuth } from '../contexts/AuthContext';
import { JWT_KEY, getDeviceId } from '../hooks/useAuth';
import { useKeyPackageMaintenance } from '../hooks/useKeyPackageMaintenance';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useSidebarResize } from '../hooks/useSidebarResize';
import * as mlsStoreLib from '../lib/mlsStore';
import * as hushCryptoLib from '../lib/hushCrypto';
import * as mlsGroup from '../lib/mlsGroup';
import ConfirmModal from '../components/ConfirmModal';
import Vesper from '../components/Vesper';
import { useToast } from '../hooks/useToast';
import Toast from '../components/Toast';

/**
 * Decode a base64 string to Uint8Array.
 * @param {string} b64
 * @returns {Uint8Array}
 */
function base64ToUint8ArraySL(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

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
  hamburgerBtn: {
    width: 44,
    height: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    color: 'var(--hush-text-secondary)',
    cursor: 'pointer',
    padding: 0,
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
  // Stable ref for navigate — useNavigate() returns a new identity on every
  // navigation in React Router v6, which would cause useEffects that list it
  // as a dependency to re-fire on every route change.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const { token: authToken, user, logout } = useAuth();
  const breakpoint = useBreakpoint();
  const [instanceData, setInstanceData] = useState(null);
  const [handshakeData, setHandshakeData] = useState(null);
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
  const [showDrawer, setShowDrawer] = useState(false);
  const closeDrawer = useCallback(() => setShowDrawer(false), []);
  const toggleDrawer = useCallback(() => setShowDrawer(p => !p), []);
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

  // Close mobile drawer when navigating to a channel
  useEffect(() => {
    if (isMobile) setShowDrawer(false);
  }, [channelId, isMobile]);

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

  // MLS KeyPackage maintenance: replenishes on startup, every 6h, and key_packages.low WS event.
  useKeyPackageMaintenance({
    token: authToken,
    userId: currentUserId,
    deviceId: getDeviceId(),
    threshold: handshakeData?.key_package_low_threshold ?? null,
    wsClient,
  });

  // Subscribe to the active guild's WS channel when wsClient or serverId changes
  const prevServerIdRef = useRef(null);
  useEffect(() => {
    if (!wsClient || !serverId) return;
    const subscribe = () => {
      const prev = prevServerIdRef.current;
      if (prev && prev !== serverId) {
        wsClient.send('unsubscribe.server', { server_id: prev });
      }
      wsClient.send('subscribe.server', { server_id: serverId });
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
        navigateRef.current(`/servers/${serverId}/channels`, { replace: true });
      }
    };
    wsClient.on('channel_deleted', handler);
    return () => wsClient.off('channel_deleted', handler);
  }, [wsClient, channelId, serverId]);

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

  const handleVoiceLeave = useCallback(() => {
    leavingVoiceRef.current = true;
    setOrbPhase('idle');
    setActiveVoiceChannel(null);
    activeVoiceMemberIdsRef.current = [];
    navigateRef.current(`/servers/${serverId}/channels`);
  }, [serverId]);

  // member_kicked: remove from list; toast + navigate self if kicked (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = async (data) => {
      if (!data.user_id) return;
      if (data.server_id && data.server_id !== serverId) return;
      if (data.user_id === currentUserId) {
        // Clean up MLS group state for all text channels and guild metadata group.
        try {
          const textChannelIds = channels.filter((c) => c.type === 'text').map((c) => c.id);
          const db = await mlsStoreLib.openStore(currentUserId, getDeviceId());
          const deps = { db, mlsStore: mlsStoreLib };
          if (textChannelIds.length) await mlsGroup.leaveAllChannelGroups(deps, textChannelIds);
          if (serverId) await mlsGroup.leaveGuildMetadataGroup(deps, serverId);
        } catch (err) {
          console.warn('[mls] Failed to clean up MLS groups on kick:', err);
        }
        const serverName = activeGuildName ?? activeGuild?.name ?? 'the server';
        showToast({ message: `You were removed from ${serverName}`, variant: 'error' });
        setGuilds((prev) => prev.filter((g) => g.id !== serverId));
        setTimeout(() => {
          const nextGuild = guilds.find((g) => g.id !== serverId);
          if (nextGuild) {
            navigateRef.current(`/servers/${nextGuild.id}/channels`);
          } else {
            navigateRef.current('/guilds');
          }
        }, 2500);
        return;
      }
      setMembers((prev) => prev.filter((m) => (m.id ?? m.userId) !== data.user_id));
    };
    wsClient.on('member_kicked', handler);
    return () => wsClient.off('member_kicked', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsClient, currentUserId, serverId, guilds, activeGuild, channels, showToast]);

  // member_banned: remove from list; toast + navigate self if banned (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = async (data) => {
      if (!data.user_id) return;
      if (data.server_id && data.server_id !== serverId) return;
      if (data.user_id === currentUserId) {
        // Clean up MLS group state for all text channels.
        try {
          const textChannelIds = channels.filter((c) => c.type === 'text').map((c) => c.id);
          const db = await mlsStoreLib.openStore(currentUserId, getDeviceId());
          const deps = { db, mlsStore: mlsStoreLib };
          if (textChannelIds.length) await mlsGroup.leaveAllChannelGroups(deps, textChannelIds);
          if (serverId) await mlsGroup.leaveGuildMetadataGroup(deps, serverId);
        } catch (err) {
          console.warn('[mls] Failed to clean up MLS groups on ban:', err);
        }
        const serverName = activeGuildName ?? activeGuild?.name ?? 'the server';
        showToast({ message: `You were banned from ${serverName}`, variant: 'error' });
        setGuilds((prev) => prev.filter((g) => g.id !== serverId));
        setTimeout(() => {
          const nextGuild = guilds.find((g) => g.id !== serverId);
          if (nextGuild) {
            navigateRef.current(`/servers/${nextGuild.id}/channels`);
          } else {
            navigateRef.current('/guilds');
          }
        }, 2500);
        return;
      }
      setMembers((prev) => prev.filter((m) => (m.id ?? m.userId) !== data.user_id));
    };
    wsClient.on('member_banned', handler);
    return () => wsClient.off('member_banned', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsClient, currentUserId, serverId, guilds, activeGuild, channels, showToast]);

  // instance_banned: clear session + hard reload to login
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      const reason = data.reason || 'You have been banned';
      showToast({ message: `Account suspended: ${reason}`, variant: 'error' });
      setTimeout(() => {
        sessionStorage.removeItem(JWT_KEY);
        window.location.href = '/';
      }, 2000);
    };
    wsClient.on('instance_banned', handler);
    return () => wsClient.off('instance_banned', handler);
  }, [wsClient, showToast]);

  // member_muted: disconnect from voice if in a call; show toast to muted user (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (data.server_id !== serverId) return;
      if (data.user_id === currentUserId) {
        if (activeVoiceChannel) {
          handleVoiceLeave();
        }
        showToast({ message: 'You are muted in this server and cannot join voice channels.', variant: 'error' });
      }
    };
    wsClient.on('member_muted', handler);
    return () => wsClient.off('member_muted', handler);
  }, [wsClient, serverId, currentUserId, activeVoiceChannel, handleVoiceLeave, showToast]);

  // member_joined: append new member to the list; join guild metadata group if self (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = async (data) => {
      if (!data.member) return;
      if (data.server_id && data.server_id !== serverId) return;
      const joinedId = data.member.id ?? data.member.userId;
      setMembers((prev) => {
        if (prev.some((m) => (m.id ?? m.userId) === joinedId)) return prev;
        return [...prev, data.member];
      });

      // If self joined a new guild, join its metadata MLS group.
      if (joinedId === currentUserId && data.server_id) {
        const token = getToken();
        if (!token || !currentUserId) return;
        try {
          const db = await mlsStoreLib.openStore(currentUserId, getDeviceId());
          const credential = await mlsStoreLib.getCredential(db);
          if (!credential) return;
          const deps = { db, token, credential, mlsStore: mlsStoreLib, hushCrypto: hushCryptoLib, api };
          await mlsGroup.joinGuildMetadataGroup(deps, data.server_id);
        } catch (err) {
          console.warn('[mls] Failed to join guild metadata group on member_joined:', err);
        }
      }
    };
    wsClient.on('member_joined', handler);
    return () => wsClient.off('member_joined', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsClient, serverId, currentUserId]);

  // member_left: remove from list; navigate self if voluntarily left (guild-scoped)
  // Also cleans up local MLS group state when self leaves.
  useEffect(() => {
    if (!wsClient) return;
    const handler = async (data) => {
      if (!data.user_id) return;
      if (data.server_id && data.server_id !== serverId) return;
      if (data.user_id === currentUserId) {
        // Clean up MLS group state for all text channels in this guild.
        try {
          const textChannelIds = channels.filter((c) => c.type === 'text').map((c) => c.id);
          if (currentUserId) {
            const db = await mlsStoreLib.openStore(currentUserId, getDeviceId());
            const deps = { db, mlsStore: mlsStoreLib };
            if (textChannelIds.length) await mlsGroup.leaveAllChannelGroups(deps, textChannelIds);
            if (serverId) await mlsGroup.leaveGuildMetadataGroup(deps, serverId);
          }
        } catch (err) {
          console.warn('[mls] Failed to clean up MLS groups on leave:', err);
        }
        setGuilds((prev) => prev.filter((g) => g.id !== serverId));
        const nextGuild = guilds.find((g) => g.id !== serverId);
        if (nextGuild) {
          navigateRef.current(`/servers/${nextGuild.id}/channels`, { replace: true });
        } else {
          navigateRef.current('/guilds', { replace: true });
        }
        return;
      }
      setMembers((prev) => prev.filter((m) => (m.id ?? m.userId) !== data.user_id));
    };
    wsClient.on('member_left', handler);
    return () => wsClient.off('member_left', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsClient, serverId, currentUserId, guilds, channels]);

  // ---------------------------------------------------------------------------
  // MLS group lifecycle — mls.commit and mls.add_request WS events
  // ---------------------------------------------------------------------------

  // mls.commit: advance local group epoch when another member sends a commit.
  useEffect(() => {
    if (!wsClient || !currentUserId) return;

    const handler = async (data) => {
      // We sent this commit; our epoch was already advanced locally.
      if (data.sender_id === currentUserId) return;
      if (!data.channel_id || !data.commit_bytes) return;

      const token = getToken();
      if (!token) return;

      try {
        const db = await mlsStoreLib.openStore(currentUserId, getDeviceId());
        const credential = await mlsStoreLib.getCredential(db);
        const deps = { db, token, credential, mlsStore: mlsStoreLib, hushCrypto: hushCryptoLib, api };
        const commitBytes = base64ToUint8ArraySL(data.commit_bytes);
        await mlsGroup.processCommit(deps, data.channel_id, commitBytes);
      } catch (err) {
        console.warn('[mls] Failed to process commit for channel', data.channel_id, err);
        // If processing fails, attempt catchup from server.
        try {
          const token2 = getToken();
          if (!token2) return;
          const db2 = await mlsStoreLib.openStore(currentUserId, getDeviceId());
          const credential2 = await mlsStoreLib.getCredential(db2);
          const deps2 = { db: db2, token: token2, credential: credential2, mlsStore: mlsStoreLib, hushCrypto: hushCryptoLib, api };
          await mlsGroup.catchupCommits(deps2, data.channel_id);
        } catch (catchupErr) {
          console.warn('[mls] Catchup also failed for channel', data.channel_id, catchupErr);
        }
      }
    };

    wsClient.on('mls.commit', handler);
    return () => wsClient.off('mls.commit', handler);
  }, [wsClient, currentUserId]);

  // mls.add_request: commit the leave proposal when another member is removing themselves.
  useEffect(() => {
    if (!wsClient || !currentUserId) return;

    const handler = async (data) => {
      if (data.action !== 'remove') return;
      // Don't process our own removal request.
      if (data.requester_id === currentUserId) return;
      if (!data.channel_id || !data.requester_id) return;

      const token = getToken();
      if (!token) return;

      try {
        const db = await mlsStoreLib.openStore(currentUserId, getDeviceId());
        const credential = await mlsStoreLib.getCredential(db);
        const deps = { db, token, credential, mlsStore: mlsStoreLib, hushCrypto: hushCryptoLib, api };
        await mlsGroup.removeMemberFromChannel(deps, data.channel_id, data.requester_id);
      } catch (err) {
        // Another member may have already committed the removal — not an error.
        console.warn('[mls] Failed to commit remove for', data.requester_id, 'in channel', data.channel_id, err);
      }
    };

    wsClient.on('mls.add_request', handler);
    return () => wsClient.off('mls.add_request', handler);
  }, [wsClient, currentUserId]);

  // ---------------------------------------------------------------------------
  // MLS group joins: join all text channel groups and guild metadata group
  // when entering a guild.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!channels.length || !currentUserId || !authToken || !serverId) return;

    const textChannelIds = channels.filter((c) => c.type === 'text').map((c) => c.id);

    const token = getToken();
    if (!token) return;

    const joinMissingGroups = async () => {
      try {
        const db = await mlsStoreLib.openStore(currentUserId, getDeviceId());
        const credential = await mlsStoreLib.getCredential(db);
        const deps = { db, token, credential, mlsStore: mlsStoreLib, hushCrypto: hushCryptoLib, api };

        // Join guild metadata group (idempotent — returns silently if already joined).
        try {
          const metaEpoch = await mlsStoreLib.getGroupEpoch(db, `guild-meta:${serverId}`);
          if (metaEpoch == null) {
            await mlsGroup.joinGuildMetadataGroup(deps, serverId);
          }
        } catch (err) {
          console.warn('[mls] Failed to join guild metadata group for', serverId, err);
        }

        // Join text channel groups.
        for (const chId of textChannelIds) {
          const epoch = await mlsStoreLib.getGroupEpoch(db, chId);
          if (epoch == null) {
            try {
              await mlsGroup.joinChannelGroup(deps, chId);
            } catch (err) {
              console.warn('[mls] Failed to join group for channel', chId, err);
            }
          }
        }
      } catch (err) {
        console.warn('[mls] joinMissingGroups failed:', err);
      }
    };

    joinMissingGroups();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, currentUserId, authToken, serverId]);

  // ---------------------------------------------------------------------------
  // MLS self-update timer: rotate leaf node key material every 24h.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!currentUserId || !authToken) return;

    const runSelfUpdates = async () => {
      const token = getToken();
      if (!token) return;
      try {
        const db = await mlsStoreLib.openStore(currentUserId, getDeviceId());
        const credential = await mlsStoreLib.getCredential(db);
        if (!credential) return;
        const deps = { db, token, credential, mlsStore: mlsStoreLib, hushCrypto: hushCryptoLib, api };
        const allEpochs = await mlsStoreLib.listAllGroupEpochs(db);
        for (const { key: channelId } of allEpochs) {
          try {
            await mlsGroup.performSelfUpdate(deps, channelId);
          } catch (err) {
            console.warn('[mls] Self-update failed for channel', channelId, err);
          }
        }
      } catch (err) {
        console.warn('[mls] Self-update timer failed:', err);
      }
    };

    const interval = setInterval(runSelfUpdates, 24 * 60 * 60 * 1000); // 24h
    return () => clearInterval(interval);
  }, [currentUserId, authToken]);

  // ---------------------------------------------------------------------------

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
    Promise.all([getMyGuilds(token), getInstance(token), getHandshake()])
      .then(([guildList, inst, shake]) => {
        setGuilds(Array.isArray(guildList) ? guildList : []);
        setInstanceData(inst);
        setHandshakeData(shake);
      })
      .catch(() => {
        setGuilds([]);
        setInstanceData(null);
        setHandshakeData(null);
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
      .catch((err) => {
        if (err?.status === 403) {
          showToast({ message: 'You no longer have access to this server', variant: 'error' });
          setGuilds((prev) => prev.filter((g) => g.id !== serverId));
          navigateRef.current('/guilds', { replace: true });
          return;
        }
        setChannels([]);
        setMembers([]);
      })
      .finally(() => setLoading(false));
  }, [authToken, serverId, showToast]);

  /** Refresh member list after a mod action completes. */
  const handleMemberUpdate = useCallback(() => {
    const token = getToken();
    if (token && serverId) {
      getGuildMembers(token, serverId).then(setMembers).catch(() => {});
    }
  }, [serverId]);

  /** Called by ServerList when user selects a different guild. */
  const handleGuildSelect = useCallback((guild) => {
    setShowDrawer(false);
    navigateRef.current(`/servers/${guild.id}/channels`);
  }, []);

  /** Called by GuildCreateModal on success — refetch guilds and navigate to new guild. */
  const handleGuildCreated = useCallback((newGuild) => {
    const token = getToken();
    if (token) {
      getMyGuilds(token).then((list) => {
        setGuilds(Array.isArray(list) ? list : []);
      }).catch(() => {});
    }
    if (newGuild?.id) {
      navigateRef.current(`/servers/${newGuild.id}/channels`);
    }
  }, []);

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
    // Close mobile drawer synchronously with navigation to avoid a flash
    // where the old drawer lingers for one frame over the new content.
    if (isMobile) setShowDrawer(false);
    navigateRef.current(`/servers/${serverId}/channels/${channel.id}`);
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
    navigateRef.current(`/servers/${serverId}/channels/${channel.id}`);
    activeVoiceMemberIdsRef.current = memberIds;
    setVoiceMountKey((k) => k + 1);
    setActiveVoiceChannel(channel);
  }, [pendingVoiceSwitch, memberIds, serverId]);

  const handleChannelsUpdated = useCallback((updatedChannels) => {
    setChannels(Array.isArray(updatedChannels) ? updatedChannels : []);
  }, []);

  // Derive myRole from activeGuild or guild membership in members list.
  // Also derive myPermissionLevel from the new API field when available.
  const myMember = members.find((m) => (m.id ?? m.userId) === currentUserId);
  const myRole = activeGuild?.myRole ?? myMember?.role ?? 'member';
  const myPermissionLevel = myMember?.permissionLevel
    ?? activeGuild?.permissionLevel
    ?? ({ owner: 3, admin: 2, mod: 1, member: 0 }[myRole] ?? 0);

  /**
   * Returns the raw AES-256-GCM key bytes for a guild's metadata MLS group.
   * Used by ServerList and ChannelList to decrypt guild/channel names.
   * Returns null if the guild has no metadata group state locally.
   *
   * @param {string} guildId
   * @returns {Promise<Uint8Array|null>}
   */
  const getMetadataKey = useCallback(async (guildId) => {
    if (!currentUserId || !guildId) return null;
    try {
      const db = await mlsStoreLib.openStore(currentUserId, getDeviceId());
      if (!db) return null;
      const credential = await mlsStoreLib.getCredential(db);
      if (!credential) return null;
      const deps = { db, token: getToken(), credential, mlsStore: mlsStoreLib, hushCrypto: hushCryptoLib, api };
      const { metadataKeyBytes } = await mlsGroup.exportGuildMetadataKey(deps, guildId);
      return metadataKeyBytes;
    } catch {
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  /**
   * Returns the decrypted guild name for the currently active guild.
   * Used to populate guildName prop in ChannelList.
   */
  const [activeGuildName, setActiveGuildName] = useState(null);

  useEffect(() => {
    if (!activeGuild) { setActiveGuildName(null); return; }
    if (!activeGuild.encryptedMetadata) {
      setActiveGuildName(activeGuild._localName ?? activeGuild.name ?? null);
      return;
    }
    getMetadataKey(activeGuild.id).then(async (keyBytes) => {
      if (!keyBytes) { setActiveGuildName(activeGuild._localName ?? null); return; }
      try {
        const cryptoKey = await importMetadataKey(keyBytes);
        const blob = fromBase64(activeGuild.encryptedMetadata);
        const { name } = await decryptGuildMetadata(cryptoKey, blob);
        setActiveGuildName(name || null);
      } catch {
        setActiveGuildName(activeGuild._localName ?? null);
      }
    }).catch(() => setActiveGuildName(activeGuild._localName ?? null));
  }, [activeGuild, getMetadataKey]);

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
          getMetadataKey={getMetadataKey}
          instanceData={instanceData}
          userRole={myRole}
          userPermissionLevel={myPermissionLevel}
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

  const serverListEl = (
    <ServerList
      getToken={getToken}
      guilds={guilds}
      activeGuild={activeGuild}
      onGuildSelect={handleGuildSelect}
      onGuildCreated={handleGuildCreated}
      getMetadataKey={getMetadataKey}
      instanceData={instanceData}
      userRole={myRole}
      userPermissionLevel={myPermissionLevel}
      compact={isMobile}
    />
  );

  const channelListEl = (
    <ChannelList
      getToken={getToken}
      serverId={serverId}
      guildName={activeGuildName ?? activeGuild?.name}
      instanceData={instanceData}
      channels={channels}
      myRole={myRole}
      myPermissionLevel={myPermissionLevel}
      activeChannelId={channelId}
      onChannelSelect={handleChannelSelect}
      onChannelsUpdated={handleChannelsUpdated}
      voiceParticipants={voiceParticipants}
      showToast={showToast}
      members={members}
    />
  );

  return (
    <div style={layoutStyles.root}>
      {/* ── Left navigation: in-flow on desktop, drawer on mobile ── */}
      {!isMobile && (
        <>
          {serverListEl}
          <div style={{ width: sidebarWidth, flexShrink: 0, display: 'flex', overflow: 'hidden' }}>
            {channelListEl}
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
      {isMobile && (
        <>
          <div
            className={`sidebar-overlay ${showDrawer ? 'sidebar-overlay-open' : ''}`}
            onClick={closeDrawer}
            aria-hidden={!showDrawer}
          />
          <div className={`sidebar-panel-left ${showDrawer ? 'sidebar-panel-open' : ''}`}>
            {serverListEl}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              {channelListEl}
            </div>
          </div>
        </>
      )}
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
              ) : currentChannel?.type === 'system' ? (
                <SystemChannel
                  channel={currentChannel}
                  serverId={serverId}
                  getToken={getToken}
                  wsClient={wsClient}
                  members={members}
                  onToggleDrawer={isMobile ? toggleDrawer : undefined}
                />
              ) : currentChannel?.type === 'text' ? (
                <TextChannel
                  channel={currentChannel}
                  serverId={serverId}
                  getToken={getToken}
                  wsClient={wsClient}
                  members={members}
                  showMembers={showMembers}
                  onToggleMembers={() => togglePanel('members')}
                  onToggleDrawer={isMobile ? toggleDrawer : undefined}
                  sidebarSlot={!isMobile ? (
                    <div className={`sidebar-desktop ${showMembers ? 'sidebar-desktop-open' : ''}`}>
                      <div className="sidebar-desktop-inner">
                        <MemberList
                          members={members}
                          onlineUserIds={onlineUserIds}
                          currentUserId={currentUserId}
                          myRole={myRole}
                          myPermissionLevel={myPermissionLevel}
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
                      {isMobile ? (
                        <button type="button" onClick={toggleDrawer} style={layoutStyles.hamburgerBtn} aria-label="Toggle channels">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                          </svg>
                        </button>
                      ) : (
                        <div />
                      )}
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
                            myPermissionLevel={myPermissionLevel}
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
                  <Vesper
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
                  myPermissionLevel={myPermissionLevel}
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
