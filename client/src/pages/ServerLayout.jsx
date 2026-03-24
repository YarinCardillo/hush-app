import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ServerList from '../components/ServerList';
import ChannelList from '../components/ChannelList';
import MemberList from '../components/MemberList';
import SystemChannel from './SystemChannel';
import TextChannel from './TextChannel';
import VoiceChannel from './VoiceChannel';
import { getInstance, getGuildChannels, getGuildMembers, getHandshake } from '../lib/api';
import * as api from '../lib/api';
import { importMetadataKey, fromBase64, decryptGuildMetadata } from '../lib/guildMetadata';
import { useAuth } from '../contexts/AuthContext';
import { useInstanceContext } from '../contexts/InstanceContext';
import { JWT_KEY, getDeviceId } from '../hooks/useAuth';
import { useKeyPackageMaintenance } from '../hooks/useKeyPackageMaintenance';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useSidebarResize } from '../hooks/useSidebarResize';
import * as mlsStoreLib from '../lib/mlsStore';
import * as hushCryptoLib from '../lib/hushCrypto';
import * as mlsGroup from '../lib/mlsGroup';
import { slugify } from '../lib/slugify';
import ConfirmModal from '../components/ConfirmModal';
import Vesper from '../components/Vesper';
import { useToast } from '../hooks/useToast';
import Toast from '../components/Toast';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/**
 * Returns the local instance's fallback token from sessionStorage.
 * Used only when a guild has no instanceUrl (legacy single-instance guilds).
 * @returns {string|null}
 */
function getLocalToken() {
  return typeof window !== 'undefined'
    ? (sessionStorage.getItem(JWT_KEY) ?? sessionStorage.getItem('hush_token'))
    : null;
}

// ── Layout styles ─────────────────────────────────────────────────────────────

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
  offlineBanner: {
    background: 'var(--hush-danger-ghost)',
    color: 'var(--hush-danger)',
    fontSize: '0.8rem',
    padding: '6px 16px',
    textAlign: 'center',
    flexShrink: 0,
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

// ── Main component ────────────────────────────────────────────────────────────

/**
 * ServerLayout — instance-aware guild layout.
 *
 * Supports two URL patterns:
 *   - /:instance/:guildSlug/:channelSlug? — new multi-instance routes
 *   - /servers/:serverId/*               — legacy single-instance routes
 *   - /home                              — no-guild empty state
 *
 * All API calls and WS subscriptions are routed through the active guild's
 * instanceUrl. When the active guild changes instance, the WS subscription
 * switches to that instance's WS client automatically.
 */
export default function ServerLayout() {
  const params = useParams();
  const navigate = useNavigate();
  // Stable ref for navigate — useNavigate() returns a new identity on every
  // navigation in React Router v6, which would cause useEffects that list it
  // as a dependency to re-fire on every route change.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // ── Instance context ────────────────────────────────────────────────────

  const {
    instanceStates,
    mergedGuilds,
    getWsClient,
    getTokenForInstance,
    refreshGuilds,
  } = useInstanceContext();

  // ── Auth ────────────────────────────────────────────────────────────────

  const { token: authToken, user } = useAuth();
  const currentUserId = user?.id ?? '';

  // ── URL param resolution ────────────────────────────────────────────────

  /**
   * Determine the active guild and channel from URL params.
   *
   * Supports two param shapes:
   *   - New: { instance, guildSlug, channelSlug }
   *   - Legacy: { serverId, '*' = 'channels/{channelId}' }
   */
  const { instance: instanceParam, guildSlug, channelSlug, serverId: legacyServerId } = params;
  const legacySplat = params['*'] ?? '';
  const legacyChannelId = legacySplat.startsWith('channels/')
    ? legacySplat.slice('channels/'.length)
    : undefined;

  /**
   * Find the active guild from mergedGuilds.
   *
   * For new-style routes: match by instance host + slug.
   * For legacy routes: match by serverId.
   */
  const activeGuild = useMemo(() => {
    if (legacyServerId) {
      return mergedGuilds.find((g) => g.id === legacyServerId) ?? null;
    }
    if (instanceParam && guildSlug) {
      return mergedGuilds.find((g) => {
        if (!g.instanceUrl) return false;
        try {
          const host = new URL(g.instanceUrl).host;
          if (host !== instanceParam) return false;
        } catch {
          return false;
        }
        const slug = slugify(g._localName ?? g.name ?? g.id ?? '');
        return slug === guildSlug;
      }) ?? null;
    }
    return null;
  }, [mergedGuilds, legacyServerId, instanceParam, guildSlug]);

  /** The guild's server UUID (used in API calls). */
  const serverId = activeGuild?.id ?? legacyServerId ?? null;

  /** The instance URL for routing API and WS calls. */
  const instanceUrl = activeGuild?.instanceUrl ?? null;

  /** Per-instance JWT — falls back to local sessionStorage token for legacy paths. */
  const token = instanceUrl
    ? (getTokenForInstance(instanceUrl) ?? getLocalToken())
    : getLocalToken();

  /**
   * Derive the active channel ID from either URL pattern.
   * New-style: channelSlug is a channel UUID (channels use UUIDs as slugs for now).
   * Legacy-style: parsed from /* splat.
   */
  const channelId = channelSlug ?? legacyChannelId;

  /** Per-instance WS client, or null if not connected / no instance. */
  const wsClient = instanceUrl ? getWsClient(instanceUrl) : null;

  /** Whether the active instance is offline. */
  const isInstanceOffline = instanceUrl
    ? instanceStates.get(instanceUrl)?.connectionState === 'offline'
    : false;

  // ── UI state ────────────────────────────────────────────────────────────

  const breakpoint = useBreakpoint();
  const [instanceData, setInstanceData] = useState(null);
  const [handshakeData, setHandshakeData] = useState(null);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(false);
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

  // ── Resolved guild name ────────────────────────────────────────────────

  /**
   * Returns the raw AES-256-GCM key bytes for a guild's metadata MLS group.
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
      const deps = { db, token, credential, mlsStore: mlsStoreLib, hushCrypto: hushCryptoLib, api };
      const { metadataKeyBytes } = await mlsGroup.exportGuildMetadataKey(deps, guildId);
      return metadataKeyBytes;
    } catch {
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, token]);

  const [activeGuildName, setActiveGuildName] = useState(null);

  useEffect(() => {
    if (!activeGuild) { setActiveGuildName(null); return; }
    if (!activeGuild.encryptedMetadata) {
      setActiveGuildName(activeGuild._localName ?? activeGuild.name ?? null);
      return;
    }
    // Try plaintext JSON decode first (fallback when MLS not bootstrapped).
    const nameFallback = activeGuild._localName ?? activeGuild.name ?? null;
    try {
      const decoded = new TextDecoder().decode(
        Uint8Array.from(atob(activeGuild.encryptedMetadata), c => c.charCodeAt(0))
      );
      const parsed = JSON.parse(decoded);
      if (parsed.n || parsed.name) {
        setActiveGuildName(parsed.n || parsed.name);
        return;
      }
    } catch { /* Not plaintext JSON — try MLS decryption below */ }

    getMetadataKey(activeGuild.id).then(async (keyBytes) => {
      if (!keyBytes) { setActiveGuildName(nameFallback); return; }
      try {
        const cryptoKey = await importMetadataKey(keyBytes);
        const blob = fromBase64(activeGuild.encryptedMetadata);
        const { name } = await decryptGuildMetadata(cryptoKey, blob);
        setActiveGuildName(name || nameFallback);
      } catch {
        setActiveGuildName(nameFallback);
      }
    }).catch(() => setActiveGuildName(nameFallback));
  }, [activeGuild, getMetadataKey]);

  // ── MLS KeyPackage maintenance ─────────────────────────────────────────

  useKeyPackageMaintenance({
    token,
    userId: currentUserId,
    deviceId: getDeviceId(),
    threshold: handshakeData?.key_package_low_threshold ?? null,
    wsClient,
  });

  // ── WS event handlers ─────────────────────────────────────────────────

  // Track the last subscribed serverId so we can unsubscribe on guild switch.
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
      // Extract name from base64 metadata (same as initial fetch processing).
      const ch = { ...data.channel };
      if (!ch.name && ch.encryptedMetadata) {
        try {
          const decoded = new TextDecoder().decode(
            Uint8Array.from(atob(ch.encryptedMetadata), c => c.charCodeAt(0))
          );
          const parsed = JSON.parse(decoded);
          ch.name = parsed.n || parsed.name || '';
        } catch { /* encrypted blob */ }
      }
      setChannels((prev) => {
        if (prev.some((c) => c.id === ch.id)) return prev;
        return [...prev, ch];
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
        navigateToGuild(serverId);
      }
    };
    wsClient.on('channel_deleted', handler);
    return () => wsClient.off('channel_deleted', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsClient, channelId, serverId]);

  // channel_moved: refetch channel list for correct ordering (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = (data) => {
      if (data.server_id && data.server_id !== serverId) return;
      if (token && serverId && instanceUrl) {
        getGuildChannels(token, serverId, instanceUrl).then(setChannels).catch(() => {});
      }
    };
    wsClient.on('channel_moved', handler);
    return () => wsClient.off('channel_moved', handler);
  }, [wsClient, serverId, token, instanceUrl]);

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

  // ── Navigation helpers ────────────────────────────────────────────────

  /**
   * Navigate to a guild using the new instance-aware URL, or legacy URL as fallback.
   * @param {string|null} guildId
   * @param {string|null} [chId]
   */
  const navigateToGuild = useCallback((guildId, chId) => {
    if (!guildId) {
      navigateRef.current('/home', { replace: true });
      return;
    }
    const guild = mergedGuilds.find((g) => g.id === guildId);
    if (guild?.instanceUrl) {
      const host = (() => {
        try { return new URL(guild.instanceUrl).host; } catch { return null; }
      })();
      if (host) {
        const slug = slugify(guild._localName ?? guild.name ?? guildId);
        const path = chId ? `/${host}/${slug}/${chId}` : `/${host}/${slug}`;
        navigateRef.current(path, { replace: true });
        return;
      }
    }
    // Legacy fallback.
    const path = chId
      ? `/servers/${guildId}/channels/${chId}`
      : `/servers/${guildId}/channels`;
    navigateRef.current(path, { replace: true });
  }, [mergedGuilds]);

  const handleVoiceLeave = useCallback(() => {
    leavingVoiceRef.current = true;
    setOrbPhase('idle');
    setActiveVoiceChannel(null);
    activeVoiceMemberIdsRef.current = [];
    navigateToGuild(serverId);
  }, [serverId, navigateToGuild]);

  // ── Guild-level WS events ─────────────────────────────────────────────

  // member_kicked: remove from list; toast + navigate self if kicked (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = async (data) => {
      if (!data.user_id) return;
      if (data.server_id && data.server_id !== serverId) return;
      if (data.user_id === currentUserId) {
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
        setTimeout(() => {
          const nextGuild = mergedGuilds.find((g) => g.id !== serverId);
          if (nextGuild) {
            navigateToGuild(nextGuild.id);
          } else {
            navigateRef.current('/home');
          }
        }, 2500);
        return;
      }
      setMembers((prev) => prev.filter((m) => (m.id ?? m.userId) !== data.user_id));
    };
    wsClient.on('member_kicked', handler);
    return () => wsClient.off('member_kicked', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsClient, currentUserId, serverId, mergedGuilds, activeGuild, channels, showToast]);

  // member_banned: remove from list; toast + navigate self if banned (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = async (data) => {
      if (!data.user_id) return;
      if (data.server_id && data.server_id !== serverId) return;
      if (data.user_id === currentUserId) {
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
        setTimeout(() => {
          const nextGuild = mergedGuilds.find((g) => g.id !== serverId);
          if (nextGuild) {
            navigateToGuild(nextGuild.id);
          } else {
            navigateRef.current('/home');
          }
        }, 2500);
        return;
      }
      setMembers((prev) => prev.filter((m) => (m.id ?? m.userId) !== data.user_id));
    };
    wsClient.on('member_banned', handler);
    return () => wsClient.off('member_banned', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsClient, currentUserId, serverId, mergedGuilds, activeGuild, channels, showToast]);

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

      if (joinedId === currentUserId && data.server_id) {
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
  }, [wsClient, serverId, currentUserId, token]);

  // member_left: remove from list; navigate self if voluntarily left (guild-scoped)
  useEffect(() => {
    if (!wsClient) return;
    const handler = async (data) => {
      if (!data.user_id) return;
      if (data.server_id && data.server_id !== serverId) return;
      if (data.user_id === currentUserId) {
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
        const nextGuild = mergedGuilds.find((g) => g.id !== serverId);
        if (nextGuild) {
          navigateToGuild(nextGuild.id);
        } else {
          navigateRef.current('/home', { replace: true });
        }
        return;
      }
      setMembers((prev) => prev.filter((m) => (m.id ?? m.userId) !== data.user_id));
    };
    wsClient.on('member_left', handler);
    return () => wsClient.off('member_left', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsClient, serverId, currentUserId, mergedGuilds, channels]);

  // ── MLS group lifecycle — mls.commit and mls.add_request WS events ───────

  useEffect(() => {
    if (!wsClient || !currentUserId) return;

    const handler = async (data) => {
      if (data.sender_id === currentUserId) return;
      if (!data.channel_id || !data.commit_bytes) return;

      if (!token) return;

      try {
        const db = await mlsStoreLib.openStore(currentUserId, getDeviceId());
        const credential = await mlsStoreLib.getCredential(db);
        const deps = { db, token, credential, mlsStore: mlsStoreLib, hushCrypto: hushCryptoLib, api };
        const commitBytes = base64ToUint8ArraySL(data.commit_bytes);
        await mlsGroup.processCommit(deps, data.channel_id, commitBytes);
      } catch (err) {
        console.warn('[mls] Failed to process commit for channel', data.channel_id, err);
        try {
          const db2 = await mlsStoreLib.openStore(currentUserId, getDeviceId());
          const credential2 = await mlsStoreLib.getCredential(db2);
          const deps2 = { db: db2, token, credential: credential2, mlsStore: mlsStoreLib, hushCrypto: hushCryptoLib, api };
          await mlsGroup.catchupCommits(deps2, data.channel_id);
        } catch (catchupErr) {
          console.warn('[mls] Catchup also failed for channel', data.channel_id, catchupErr);
        }
      }
    };

    wsClient.on('mls.commit', handler);
    return () => wsClient.off('mls.commit', handler);
  }, [wsClient, currentUserId, token]);

  useEffect(() => {
    if (!wsClient || !currentUserId) return;

    const handler = async (data) => {
      if (data.action !== 'remove') return;
      if (data.requester_id === currentUserId) return;
      if (!data.channel_id || !data.requester_id) return;

      if (!token) return;

      try {
        const db = await mlsStoreLib.openStore(currentUserId, getDeviceId());
        const credential = await mlsStoreLib.getCredential(db);
        const deps = { db, token, credential, mlsStore: mlsStoreLib, hushCrypto: hushCryptoLib, api };
        await mlsGroup.removeMemberFromChannel(deps, data.channel_id, data.requester_id);
      } catch (err) {
        console.warn('[mls] Failed to commit remove for', data.requester_id, 'in channel', data.channel_id, err);
      }
    };

    wsClient.on('mls.add_request', handler);
    return () => wsClient.off('mls.add_request', handler);
  }, [wsClient, currentUserId, token]);

  // ── MLS group joins when entering a guild ─────────────────────────────

  useEffect(() => {
    if (!channels.length || !currentUserId || !authToken || !serverId) return;

    const textChannelIds = channels.filter((c) => c.type === 'text').map((c) => c.id);
    if (!token) return;

    const joinMissingGroups = async () => {
      try {
        const db = await mlsStoreLib.openStore(currentUserId, getDeviceId());
        const credential = await mlsStoreLib.getCredential(db);
        const deps = { db, token, credential, mlsStore: mlsStoreLib, hushCrypto: hushCryptoLib, api };

        try {
          const metaEpoch = await mlsStoreLib.getGroupEpoch(db, `guild-meta:${serverId}`);
          if (metaEpoch == null) {
            await mlsGroup.joinGuildMetadataGroup(deps, serverId);
          }
        } catch (err) {
          console.warn('[mls] Failed to join guild metadata group for', serverId, err);
        }

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
  }, [channels, currentUserId, authToken, serverId, token]);

  // ── MLS self-update timer: rotate leaf node key material every 24h ────

  useEffect(() => {
    if (!currentUserId || !authToken || !token) return;

    const runSelfUpdates = async () => {
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

    const interval = setInterval(runSelfUpdates, 24 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [currentUserId, authToken, token]);

  // ── role_changed / member_role_changed ────────────────────────────────

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
    };
    wsClient.on('role_changed', handler);
    wsClient.on('member_role_changed', handler);
    return () => {
      wsClient.off('role_changed', handler);
      wsClient.off('member_role_changed', handler);
    };
  }, [wsClient, serverId]);

  // ── Fetch instance data and handshake when activeGuild/instanceUrl changes ─

  useEffect(() => {
    if (!token || !instanceUrl) return;
    Promise.all([getInstance(token, instanceUrl), getHandshake(instanceUrl)])
      .then(([inst, shake]) => {
        setInstanceData(inst);
        setHandshakeData(shake);
      })
      .catch(() => {
        setInstanceData(null);
        setHandshakeData(null);
      });
  }, [token, instanceUrl]);

  // ── Fetch channels + members when serverId changes (guild switch) ──────

  useEffect(() => {
    if (!authToken || !serverId) return;
    if (!token) return;

    // Clear stale state immediately to prevent channel lookup across guilds.
    setChannels([]);
    setActiveVoiceChannel(null);
    activeVoiceMemberIdsRef.current = [];
    setMembers([]);
    setLoading(true);

    Promise.all([
      getGuildChannels(token, serverId, instanceUrl ?? undefined),
      getGuildMembers(token, serverId, instanceUrl ?? undefined),
    ])
      .then(([chans, mems]) => {
        // Extract channel names from encryptedMetadata (plaintext JSON fallback
        // when MLS is not bootstrapped, or decrypt with metadata key if available).
        const processed = (Array.isArray(chans) ? chans : []).map(ch => {
          if (ch.name) return ch; // Already has a name
          if (!ch.encryptedMetadata) return ch;
          try {
            // Go serializes []byte as base64. Decode to UTF-8, then parse JSON.
            const decoded = new TextDecoder().decode(
              Uint8Array.from(atob(ch.encryptedMetadata), c => c.charCodeAt(0))
            );
            const parsed = JSON.parse(decoded);
            return { ...ch, name: parsed.n || parsed.name || '' };
          } catch {
            return ch; // Encrypted blob — needs MLS key
          }
        });
        setChannels(processed);
        setMembers(Array.isArray(mems) ? mems : []);
      })
      .catch((err) => {
        if (err?.status === 403) {
          showToast({ message: 'You no longer have access to this server', variant: 'error' });
          navigateRef.current('/home', { replace: true });
          return;
        }
        setChannels([]);
        setMembers([]);
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, serverId, token, instanceUrl, showToast]);

  // ── Callbacks ─────────────────────────────────────────────────────────

  const handleMemberUpdate = useCallback(() => {
    if (token && serverId) {
      getGuildMembers(token, serverId, instanceUrl ?? undefined).then(setMembers).catch(() => {});
    }
  }, [serverId, token, instanceUrl]);

  /**
   * Called by ServerList when user selects a different guild.
   * Uses instance-aware routing for the new-style URL.
   */
  const handleGuildSelect = useCallback((guild) => {
    setShowDrawer(false);
    navigateToGuild(guild.id);
  }, [navigateToGuild]);

  /** Called by GuildCreateModal on success — refresh guilds and navigate to new guild. */
  const handleGuildCreated = useCallback((newGuild) => {
    if (instanceUrl) {
      refreshGuilds(instanceUrl).catch(() => {});
    }
    if (newGuild?.id) {
      navigateToGuild(newGuild.id);
    }
  }, [instanceUrl, refreshGuilds, navigateToGuild]);

  /**
   * getToken accessor passed to child components that still use the prop-based API.
   * Returns the per-instance token for the active guild's instance.
   */
  const getToken = useCallback(() => token, [token]);

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
    if (isMobile) setShowDrawer(false);
    // Navigate to the channel using instance-aware URL pattern.
    if (activeGuild?.instanceUrl && instanceParam) {
      const host = (() => {
        try { return new URL(activeGuild.instanceUrl).host; } catch { return null; }
      })();
      const slug = slugify(activeGuild._localName ?? activeGuild.name ?? activeGuild.id ?? '');
      if (host) {
        navigateRef.current(`/${host}/${slug}/${channel.id}`);
      } else {
        navigateRef.current(`/servers/${serverId}/channels/${channel.id}`);
      }
    } else {
      navigateRef.current(`/servers/${serverId}/channels/${channel.id}`);
    }
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
    if (activeGuild?.instanceUrl && instanceParam) {
      const host = (() => {
        try { return new URL(activeGuild.instanceUrl).host; } catch { return null; }
      })();
      const slug = slugify(activeGuild._localName ?? activeGuild.name ?? activeGuild.id ?? '');
      if (host) {
        navigateRef.current(`/${host}/${slug}/${channel.id}`);
      } else {
        navigateRef.current(`/servers/${serverId}/channels/${channel.id}`);
      }
    } else {
      navigateRef.current(`/servers/${serverId}/channels/${channel.id}`);
    }
    activeVoiceMemberIdsRef.current = memberIds;
    setVoiceMountKey((k) => k + 1);
    setActiveVoiceChannel(channel);
  }, [pendingVoiceSwitch, memberIds, serverId, activeGuild, instanceParam]);

  const handleChannelsUpdated = useCallback((updatedChannels) => {
    setChannels(Array.isArray(updatedChannels) ? updatedChannels : []);
  }, []);

  // Derive myRole from guild membership.
  const myMember = members.find((m) => (m.id ?? m.userId) === currentUserId);
  const myRole = activeGuild?.myRole ?? myMember?.role ?? 'member';
  const myPermissionLevel = myMember?.permissionLevel
    ?? activeGuild?.permissionLevel
    ?? ({ owner: 3, admin: 2, mod: 1, member: 0 }[myRole] ?? 0);

  // ── Render ────────────────────────────────────────────────────────────

  // No guild selected — show empty state with guild strip and welcome message.
  if (!serverId) {
    return (
      <div style={layoutStyles.root}>
        <ServerList
          getToken={getToken}
          guilds={mergedGuilds}
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
      guilds={mergedGuilds}
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
      {/* ── Offline banner ── */}
      {isInstanceOffline && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          zIndex: 20,
          ...layoutStyles.offlineBanner,
        }}>
          {instanceUrl ? new URL(instanceUrl).host : 'Instance'} is offline — read-only mode
        </div>
      )}

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
