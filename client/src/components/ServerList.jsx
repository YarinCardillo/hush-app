import { useState, useCallback, useEffect, useRef, useContext } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import UserSettingsModal from './UserSettingsModal';
import GuildCreateModal from './GuildCreateModal';
import GuildContextMenu from './GuildContextMenu';
import { buildGuildInviteLink } from '../lib/inviteLinks';
import { decryptGuildMetadata, fromBase64, importMetadataKey } from '../lib/guildMetadata';
import { InstanceContext } from '../contexts/InstanceContext.jsx';
import { createGuildInvite, searchUsersForDM, createOrFindDM } from '../lib/api';

// Icon size and strip width are now defined in CSS (.sl-guild-btn, .sl-strip).
// These constants are kept for any remaining inline fallback usage.
const ICON_SIZE = 40;
const STRIP_WIDTH = 64;

/** LocalStorage key for grouped sidebar toggle. */
const LS_GROUPED_KEY = 'hush_grouped_sidebar';

/**
 * Palette of muted background colors for guild icons.
 * Chosen to work well against the dark surface and with white initials.
 */
const GUILD_COLORS = [
  '#4a6fa5', // steel blue
  '#5a7f5c', // muted green
  '#7a5f9e', // muted purple
  '#9e6050', // muted rust
  '#5a7f8f', // muted teal
  '#9e7a40', // muted gold
  '#7a4a6f', // muted mauve
  '#4a7a6f', // muted cyan
  '#8f5a5a', // muted rose
  '#5a5a9e', // muted indigo
];

/**
 * Deterministic color for a guild based on the first 8 chars of its ID.
 * @param {string} id - Guild UUID
 * @returns {string} CSS color value
 */
function guildColor(id) {
  if (!id) return GUILD_COLORS[0];
  let hash = 0;
  const slice = id.slice(0, 8);
  for (let i = 0; i < slice.length; i++) {
    hash = (hash * 31 + slice.charCodeAt(i)) & 0xffffffff;
  }
  return GUILD_COLORS[Math.abs(hash) % GUILD_COLORS.length];
}

/**
 * Returns 1–2 uppercase initials from a guild name.
 * @param {string} name
 * @returns {string}
 */
function getInitials(name) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * Extracts the hostname from an instance URL for display.
 * @param {string} url
 * @returns {string}
 */
function instanceDomain(url) {
  if (!url) return '';
  try { return new URL(url).hostname; } catch { return url; }
}

// Styles removed — see sl-* classes in global.css

// ── SortableGuildIcon ─────────────────────────────────────────────────────────

/**
 * A draggable guild icon using @dnd-kit/sortable.
 * Supports right-click context menu and mobile long-press (500ms).
 *
 * @param {{
 *   guild: object,
 *   isActive: boolean,
 *   isOffline: boolean,
 *   displayName: string,
 *   unreadCount: number,
 *   onGuildSelect: function,
 *   onContextMenu: function,
 *   onLongPress: function,
 * }} props
 */
function SortableGuildIcon({
  guild,
  isActive,
  isOffline,
  displayName,
  unreadCount = 0,
  onGuildSelect,
  onContextMenu,
  onLongPress,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: guild.id,
  });

  const bg = guildColor(guild.id);
  const domain = instanceDomain(guild.instanceUrl);
  const tooltip = domain ? `${displayName}\n${domain}` : displayName;

  const longPressTimerRef = useRef(null);
  const touchStartRef = useRef(null);

  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    longPressTimerRef.current = setTimeout(() => {
      onLongPress?.(guild, { x: touch.clientX, y: touch.clientY });
    }, 500);
  }, [guild, onLongPress]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartRef.current = null;
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);
    if (dx > 10 || dy > 10) cancelLongPress();
  }, [cancelLongPress]);

  const hasUnread = !isActive && unreadCount > 0;

  const className = [
    'sl-guild-btn',
    isActive && 'sl-guild-btn--active',
    hasUnread && 'sl-guild-btn--unread',
    isOffline && 'sl-guild-btn--offline',
    isDragging && 'sl-guild-btn--dragging',
  ].filter(Boolean).join(' ');

  const style = {
    background: bg,
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    cursor: isDragging ? 'grabbing' : 'pointer',
  };

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={className}
      style={style}
      title={tooltip}
      aria-label={hasUnread ? `${displayName} (${unreadCount} unread)` : displayName}
      aria-pressed={isActive}
      onClick={() => !isDragging && onGuildSelect?.(guild)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(guild, { x: e.clientX, y: e.clientY });
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={cancelLongPress}
      onTouchMove={handleTouchMove}
      {...attributes}
      {...listeners}
    >
      <span className="sl-guild-pill" aria-hidden="true" />
      {getInitials(displayName)}
      {isOffline && <span className="sl-offline-dot" aria-label="offline" />}
      {hasUnread && (
        <span className="sl-unread-badge" aria-hidden="true">
          {badgeLabel}
        </span>
      )}
    </button>
  );
}

// ── DmButton ──────────────────────────────────────────────────────────────────

/**
 * DM icon button at the top of the server strip. Tapping opens the DM list view.
 * Shows real DM conversations with cursor-based unread count sum.
 * Includes "New DM" inline user search.
 *
 * @param {{
 *   dmGuilds: object[],
 *   onGuildSelect: function,
 *   onDmOpen: function,
 *   getToken: function,
 * }} props
 */
function DmButton({ dmGuilds, onDmOpen, isActive }) {
  const totalUnread = dmGuilds.reduce(
    (sum, g) => sum + (g.channels?.[0]?.unreadCount ?? 0),
    0,
  );

  return (
    <div className="sl-dm-section" data-testid="dm-section">
      <button
        type="button"
        className={`sl-dm-btn${isActive ? ' sl-dm-btn--expanded' : ''}`}
        title="Direct Messages"
        aria-label={`Direct Messages${totalUnread > 0 ? ` (${totalUnread} unread)` : ''}`}
        onClick={onDmOpen}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {totalUnread > 0 && (
          <span className="sl-unread-badge">
            {totalUnread > 9 ? '9+' : totalUnread}
          </span>
        )}
      </button>
    </div>
  );
}

// ── GroupSection ──────────────────────────────────────────────────────────────

/**
 * Renders either a flat list or an instance-labeled group of guild icons.
 */
function GroupSection({
  group,
  activeGuild,
  isGrouped,
  isGuildOffline,
  getGuildDisplayName,
  onGuildSelect,
  onContextMenu,
  onLongPress,
}) {
  return (
    <>
      {isGrouped && group.type === 'group' && group.instanceUrl !== '__default__' && (
        <div className="sl-instance-label" title={group.instanceUrl}>
          {instanceDomain(group.instanceUrl)}
        </div>
      )}
      {group.guilds.map((guild) => {
        const unreadCount = Array.isArray(guild.channels)
          ? guild.channels.reduce((sum, ch) => sum + (ch.unreadCount ?? 0), 0)
          : 0;
        return (
          <SortableGuildIcon
            key={guild.id}
            guild={guild}
            isActive={guild.id === activeGuild?.id}
            isOffline={isGuildOffline(guild)}
            displayName={getGuildDisplayName(guild)}
            unreadCount={unreadCount}
            onGuildSelect={onGuildSelect}
            onContextMenu={onContextMenu}
            onLongPress={onLongPress}
          />
        );
      })}
    </>
  );
}

// ── ServerList ────────────────────────────────────────────────────────────────

/**
 * Vertical guild icon strip sidebar with multi-instance support.
 *
 * When wrapped in InstanceProvider, reads mergedGuilds, instanceStates,
 * guildOrder and setGuildOrder from context. Otherwise falls back to the
 * `guilds` prop for single-instance backward compatibility.
 *
 * @param {{
 *   getToken: () => string|null,
 *   guilds?: Array<object>,
 *   activeGuild?: object|null,
 *   onGuildSelect: (guild: object) => void,
 *   onGuildCreated: (guild: object) => void,
 *   getMetadataKey?: (guildId: string) => Promise<Uint8Array|null>,
 *   instanceData?: object|null,
 *   userRole?: string,
 *   userPermissionLevel?: number,
 *   compact?: boolean,
 * }} props
 */
export default function ServerList({
  getToken,
  guilds: guildsProp = [],
  activeGuild = null,
  onGuildSelect,
  onGuildCreated,
  onDmOpen,
  isDmActive = false,
  getMetadataKey = null,
  instanceData,
  userRole = 'member',
  userPermissionLevel = 0,
  compact = false,
}) {
  // Read InstanceContext without throwing — null when InstanceProvider is absent.
  const instanceCtx = useContext(InstanceContext);

  const mergedGuildsFromCtx = instanceCtx?.mergedGuilds ?? null;
  const getTokenForInstance = instanceCtx?.getTokenForInstance ?? null;
  const instanceStates = instanceCtx?.instanceStates ?? new Map();
  const guildOrderFromCtx = instanceCtx?.guildOrder ?? [];
  const setGuildOrder = instanceCtx?.setGuildOrder ?? null;

  // Multi-instance guilds take precedence over legacy prop.
  const guilds = mergedGuildsFromCtx ?? guildsProp;

  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  /** Map<guildId, { name: string, icon: string|null }> — decrypted metadata cache */
  const [metadataCache, setMetadataCache] = useState(new Map());
  const decryptingRef = useRef(new Set());

  /** Active context menu: { guild, position: { x, y } } | null */
  const [contextMenu, setContextMenu] = useState(null);

  /** Whether guilds are displayed grouped by instance domain. */
  const [isGrouped] = useState(
    () => localStorage.getItem(LS_GROUPED_KEY) === 'true',
  );

  /**
   * Local drag-and-drop order (array of guild IDs).
   * Seeded from context guildOrder on mount; updated on drag-end.
   */
  const [localOrder, setLocalOrder] = useState([]);

  // Sync local order from context when IDB order loads.
  useEffect(() => {
    if (guildOrderFromCtx.length > 0) {
      setLocalOrder(guildOrderFromCtx);
    }
  }, [guildOrderFromCtx]);

  // DnD sensors: 5px activation distance prevents accidental drags on click.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── Metadata decryption ───────────────────────────────────────────────────

  useEffect(() => {
    if (!getMetadataKey || guilds.length === 0) return;

    for (const guild of guilds) {
      const guildId = guild.id;
      if (!guild.encryptedMetadata) continue;
      if (metadataCache.has(guildId)) continue;
      if (decryptingRef.current.has(guildId)) continue;

      decryptingRef.current.add(guildId);
      (async () => {
        try {
          // Check if metadata is plaintext JSON fallback (not AES-GCM encrypted).
          // Plaintext blobs start with '{' (0x7b), encrypted start with 0x01 version byte.
          const raw = fromBase64(guild.encryptedMetadata);
          if (raw.length > 0 && raw[0] === 0x7b) {
            // Plaintext JSON — parse directly, skip MLS decryption.
            const parsed = JSON.parse(new TextDecoder().decode(raw));
            setMetadataCache((prev) => {
              const next = new Map(prev);
              next.set(guildId, { name: parsed.n || parsed.name || '', icon: parsed.icon || null });
              return next;
            });
            return;
          }
          const keyBytes = await getMetadataKey(guildId);
          if (!keyBytes) return;
          const cryptoKey = await importMetadataKey(keyBytes);
          const { name, icon } = await decryptGuildMetadata(cryptoKey, raw);
          setMetadataCache((prev) => {
            const next = new Map(prev);
            next.set(guildId, { name, icon });
            return next;
          });
        } catch (err) {
          // Silently ignore — metadata may not be decryptable yet (MLS group not joined).
        } finally {
          decryptingRef.current.delete(guildId);
        }
      })();
    }
  }, [guilds, getMetadataKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Display name resolution ───────────────────────────────────────────────

  const getGuildDisplayName = useCallback((guild) => {
    const cached = metadataCache.get(guild.id);
    if (cached?.name) return cached.name;
    if (guild._localName) return guild._localName;
    if (guild.name) return guild.name;
    return guild.id.slice(0, 8);
  }, [metadataCache]);

  // ── Guild ordering ────────────────────────────────────────────────────────

  /**
   * Returns guilds sorted by localOrder. New guilds not in localOrder append
   * at the end in their original array order.
   */
  const getSortedGuilds = useCallback(() => {
    if (localOrder.length === 0) return guilds;
    const orderIndex = new Map(localOrder.map((id, i) => [id, i]));
    return [...guilds].sort((a, b) => {
      const ai = orderIndex.get(a.id) ?? Infinity;
      const bi = orderIndex.get(b.id) ?? Infinity;
      return ai - bi;
    });
  }, [guilds, localOrder]);

  // ── DnD handlers ─────────────────────────────────────────────────────────

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const currentOrder = getSortedGuilds().map((g) => g.id);
    const oldIndex = currentOrder.indexOf(String(active.id));
    const newIndex = currentOrder.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = arrayMove(currentOrder, oldIndex, newIndex);
    setLocalOrder(newOrder);
    // Fire-and-forget persist via context.
    setGuildOrder?.(newOrder);
  }, [getSortedGuilds, setGuildOrder]);

  // ── Context menu handlers ─────────────────────────────────────────────────

  const handleContextMenu = useCallback((guild, position) => {
    setContextMenu({ guild, position });
  }, []);

  const handleLongPress = useCallback((guild, position) => {
    setContextMenu({ guild, position });
  }, []);

  const handleContextMenuClose = useCallback(() => setContextMenu(null), []);

  const handleMute = useCallback((guild, durationMs) => {
    const key = `hush_muted_${guild.id}`;
    if (durationMs === null) {
      localStorage.setItem(key, 'forever');
    } else {
      localStorage.setItem(key, String(Date.now() + durationMs));
    }
  }, []);

  const handleCopyInvite = useCallback(async (guild) => {
    try {
      const baseUrl = guild.instanceUrl ?? '';
      const token = guild.instanceUrl && getTokenForInstance
        ? getTokenForInstance(guild.instanceUrl)
        : getToken();
      if (!token) return;

      const invite = await createGuildInvite(token, guild.id, {}, baseUrl);
      const guildName = metadataCache.get(guild.id)?.name ?? guild.name ?? guild.id;
      const inviteLink = buildGuildInviteLink(window.location.origin, guild.instanceUrl, invite.code, guildName);
      await navigator.clipboard.writeText(inviteLink);
    } catch {
      // Clipboard API not available in this environment — silently skip.
    }
  }, [getToken, getTokenForInstance, metadataCache]);

  const handleMarkRead = useCallback((_guild) => {
    // Phase U scaffolding — unread tracking wired in a later plan.
  }, []);

  const handleInstanceInfo = useCallback((guild, url) => {
    const state = instanceStates.get(url);
    const domain = instanceDomain(url);
    const status = state?.connectionState ?? 'unknown';
    alert(`Instance: ${domain}\nStatus: ${status}`);
  }, [instanceStates]);

  // ── Guild creation ────────────────────────────────────────────────────────

  const handleGuildCreated = useCallback((newGuild) => {
    setShowCreateModal(false);
    onGuildCreated?.(newGuild);
  }, [onGuildCreated]);

  // ── Add button visibility ─────────────────────────────────────────────────

  const isAdminOrHigher = userPermissionLevel >= 2 || userRole === 'admin' || userRole === 'owner';
  const policy = instanceData?.guildDiscovery ?? instanceData?.serverCreationPolicy ?? 'open';
  const showAddButton = policy === 'admin_only' ? isAdminOrHigher : true;

  // ── Offline detection ─────────────────────────────────────────────────────

  const isGuildOffline = useCallback((guild) => {
    const url = guild.instanceUrl;
    if (!url) return false;
    const state = instanceStates.get(url);
    return state ? state.connectionState !== 'connected' : false;
  }, [instanceStates]);

  // ── Render preparation ────────────────────────────────────────────────────

  const sorted = getSortedGuilds();
  const dmGuilds = sorted.filter((g) => g.isDm === true);
  const regularGuilds = sorted.filter((g) => g.isDm !== true);
  const guildIds = regularGuilds.map((g) => g.id);

  // Build groups for grouped view (by instanceUrl) or a single flat group.
  const renderGroups = (() => {
    if (!isGrouped) {
      return [{ type: 'flat', instanceUrl: null, guilds: regularGuilds }];
    }
    const groups = new Map();
    for (const guild of regularGuilds) {
      const key = guild.instanceUrl ?? '__default__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(guild);
    }
    return Array.from(groups.entries()).map(([url, gs]) => ({
      type: 'group',
      instanceUrl: url,
      guilds: gs,
    }));
  })();

  const contextMenuState = contextMenu
    ? instanceStates.get(contextMenu.guild.instanceUrl)?.connectionState ?? 'connected'
    : 'connected';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="sl-strip"
      style={compact ? { width: 56, minWidth: 56 } : undefined}
      data-testid="server-list"
    >
      {/* Direct Messages section pinned at top */}
      <DmButton dmGuilds={dmGuilds} onDmOpen={onDmOpen} isActive={isDmActive} />

      {dmGuilds.length > 0 && regularGuilds.length > 0 && (
        <div className="sl-separator" />
      )}

      {/* Guild icon list with drag-and-drop */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={guildIds} strategy={verticalListSortingStrategy}>
          {renderGroups.map((group) => (
            <GroupSection
              key={group.instanceUrl ?? 'flat'}
              group={group}
              activeGuild={activeGuild}
              isGrouped={isGrouped}
              isGuildOffline={isGuildOffline}
              getGuildDisplayName={getGuildDisplayName}
              onGuildSelect={onGuildSelect}
              onContextMenu={handleContextMenu}
              onLongPress={handleLongPress}
            />
          ))}
        </SortableContext>
      </DndContext>

      {regularGuilds.length > 0 && showAddButton && (
        <div className="sl-separator" />
      )}

      {showAddButton && (
        <button
          type="button"
          className="sl-add-btn"
          title="Create a server"
          aria-label="Create a server"
          onClick={() => setShowCreateModal(true)}
        >
          +
        </button>
      )}

      <button
        type="button"
        className="sl-settings-btn"
        title="User settings"
        onClick={() => setShowUserSettings(true)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {showUserSettings && (
        <UserSettingsModal onClose={() => setShowUserSettings(false)} />
      )}

      {showCreateModal && (
        <GuildCreateModal
          getToken={getToken}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleGuildCreated}
          activeInstanceUrl={activeGuild?.instanceUrl ?? null}
        />
      )}

      {contextMenu && (
        <GuildContextMenu
          guild={contextMenu.guild}
          instanceUrl={contextMenu.guild.instanceUrl ?? ''}
          position={contextMenu.position}
          connectionState={contextMenuState}
          userPermissionLevel={userPermissionLevel}
          onClose={handleContextMenuClose}
          onLeave={(guild) => {
            console.info('[ServerList] Leave guild:', guild.id);
            handleContextMenuClose();
          }}
          onMute={handleMute}
          onCopyInvite={handleCopyInvite}
          onMarkRead={handleMarkRead}
          onSettings={(guild) => onGuildSelect?.(guild)}
          onInstanceInfo={handleInstanceInfo}
        />
      )}
    </div>
  );
}
