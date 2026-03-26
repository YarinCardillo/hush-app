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
import { decryptGuildMetadata, fromBase64, importMetadataKey } from '../lib/guildMetadata';
import { InstanceContext } from '../contexts/InstanceContext.jsx';
import { searchUsersForDM, createOrFindDM } from '../lib/api';

const ICON_SIZE = 48;
const STRIP_WIDTH = 72;

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

const styles = {
  strip: {
    width: STRIP_WIDTH,
    minWidth: STRIP_WIDTH,
    background: 'var(--hush-surface)',
    borderRight: '1px solid transparent',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px 0',
    gap: '8px',
    overflowY: 'auto',
  },
  guildBtn: (isActive, bgColor, isOffline) => ({
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: '50%',
    border: isActive ? '2px solid var(--hush-amber)' : '2px solid transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: bgColor,
    color: '#fff',
    fontSize: '0.85rem',
    fontWeight: 600,
    fontFamily: 'var(--font-sans)',
    letterSpacing: '0.02em',
    transition: 'border-color var(--duration-fast) var(--ease-out), opacity var(--duration-fast) var(--ease-out)',
    overflow: 'hidden',
    flexShrink: 0,
    boxSizing: 'border-box',
    opacity: isOffline ? 0.5 : 1,
    pointerEvents: 'auto',
    position: 'relative',
  }),
  addBtn: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: '50%',
    border: '1px dashed var(--hush-border)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    color: 'var(--hush-text-muted)',
    fontSize: '1.5rem',
    fontWeight: 300,
    transition: 'border-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out)',
    flexShrink: 0,
  },
  divider: {
    width: 32,
    height: 1,
    background: 'var(--hush-border)',
    flexShrink: 0,
  },
  instanceLabel: {
    fontSize: '0.6rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--hush-text-muted)',
    textAlign: 'center',
    padding: '2px 0',
    maxWidth: ICON_SIZE + 8,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  settingsBtn: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--hush-elevated)',
    color: 'var(--hush-text-secondary)',
    transition: 'all var(--duration-fast) var(--ease-out)',
    flexShrink: 0,
    marginTop: 'auto',
  },
  dmSection: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    paddingBottom: 4,
  },
  dmBtn: (isExpanded) => ({
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: '50%',
    border: isExpanded ? '2px solid var(--hush-amber)' : '2px solid transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--hush-elevated)',
    color: isExpanded ? 'var(--hush-amber)' : 'var(--hush-text-secondary)',
    transition: 'all var(--duration-fast) var(--ease-out)',
    flexShrink: 0,
    position: 'relative',
  }),
  offlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: 'var(--hush-text-ghost)',
    border: '2px solid var(--hush-surface)',
  },
};

// ── SortableGuildIcon ─────────────────────────────────────────────────────────

/**
 * A draggable guild icon using @dnd-kit/sortable.
 * Supports right-click context menu and mobile long-press (500ms).
 */
function SortableGuildIcon({
  guild,
  isActive,
  isOffline,
  displayName,
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

  const style = {
    ...styles.guildBtn(isActive, bg, isOffline),
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    boxShadow: isDragging ? '0 4px 16px rgba(0,0,0,0.5)' : undefined,
    zIndex: isDragging ? 100 : undefined,
    cursor: isDragging ? 'grabbing' : 'pointer',
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      title={tooltip}
      aria-label={displayName}
      aria-pressed={isActive}
      onClick={() => !isDragging && onGuildSelect?.(guild)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(guild, { x: e.clientX, y: e.clientY });
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={cancelLongPress}
      onTouchMove={handleTouchMove}
      onMouseEnter={(e) => {
        if (!isActive && !isDragging) {
          e.currentTarget.style.opacity = isOffline ? '0.35' : '0.8';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = isOffline ? '0.5' : '1';
      }}
      {...attributes}
      {...listeners}
    >
      {getInitials(displayName)}
      {isOffline && <span style={styles.offlineDot} aria-label="offline" />}
    </button>
  );
}

// ── DmSection ─────────────────────────────────────────────────────────────────

/**
 * Collapsible Direct Messages section at the top of the sidebar.
 * Shows real DM conversations with cursor-based unread count sum.
 * Includes "New DM" inline user search.
 *
 * @param {{
 *   dmGuilds: object[],
 *   onGuildSelect: function,
 *   getToken: function,
 * }} props
 */
function DmSection({ dmGuilds, onGuildSelect, getToken }) {
  const [expanded, setExpanded] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);

  // Cursor-based unread count sum across all DM guilds (identical to guild unread logic).
  const totalUnread = dmGuilds.reduce(
    (sum, g) => sum + (g.channels?.[0]?.unreadCount ?? 0),
    0,
  );

  const handleSearchChange = (e) => {
    const q = e.target.value;
    setSearchQuery(q);
    clearTimeout(searchTimerRef.current);
    if (!q.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const token = getToken?.();
        if (!token) return;
        const results = await searchUsersForDM(token, q.trim());
        setSearchResults(Array.isArray(results) ? results : []);
      } catch (err) {
        console.error('[DmSection] searchUsersForDM failed:', err);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const handleSelectUser = async (user) => {
    try {
      const token = getToken?.();
      if (!token) return;
      const dmGuild = await createOrFindDM(token, user.id);
      setShowSearch(false);
      setSearchQuery('');
      setSearchResults([]);
      onGuildSelect?.(dmGuild);
    } catch (err) {
      console.error('[DmSection] createOrFindDM failed:', err);
    }
  };

  // Cleanup debounce timer on unmount.
  useEffect(() => () => clearTimeout(searchTimerRef.current), []);

  return (
    <div style={styles.dmSection} data-testid="dm-section">
      <button
        type="button"
        style={styles.dmBtn(expanded)}
        title="Direct Messages"
        aria-label={`Direct Messages${totalUnread > 0 ? ` (${totalUnread} unread)` : ''}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Chat bubble icon (Lucide-style) */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {totalUnread > 0 && (
          <span style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            background: 'var(--hush-danger)',
            color: '#fff',
            fontSize: '0.6rem',
            fontWeight: 600,
            borderRadius: '50%',
            width: 16,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid var(--hush-surface)',
          }}>
            {totalUnread > 9 ? '9+' : totalUnread}
          </span>
        )}
      </button>

      {expanded && (
        <div style={{
          width: '100%',
          background: 'var(--hush-elevated)',
          borderTop: '1px solid var(--hush-border)',
        }}>
          {/* New DM button */}
          <div style={{ padding: '4px 8px' }}>
            {!showSearch ? (
              <button
                type="button"
                data-testid="new-dm-btn"
                onClick={() => setShowSearch(true)}
                style={{
                  width: '100%',
                  padding: '4px 8px',
                  background: 'var(--hush-surface)',
                  border: '1px solid var(--hush-border)',
                  color: 'var(--hush-text-muted)',
                  fontSize: '0.7rem',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                + New Message
              </button>
            ) : (
              <div style={{ position: 'relative' }}>
                <input
                  autoFocus
                  type="text"
                  placeholder="Find a user..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setShowSearch(false);
                      setSearchQuery('');
                      setSearchResults([]);
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '4px 8px',
                    background: 'var(--hush-surface)',
                    border: '1px solid var(--hush-amber)',
                    color: 'var(--hush-text)',
                    fontSize: '0.75rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                {(searchResults.length > 0 || searching) && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: 'var(--hush-elevated)',
                    border: '1px solid var(--hush-border)',
                    zIndex: 200,
                    maxHeight: 160,
                    overflowY: 'auto',
                  }}>
                    {searching && (
                      <div style={{ padding: '6px 8px', fontSize: '0.7rem', color: 'var(--hush-text-muted)' }}>
                        Searching...
                      </div>
                    )}
                    {searchResults.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        data-testid={`dm-search-result-${user.id}`}
                        onClick={() => handleSelectUser(user)}
                        style={{
                          display: 'block',
                          width: '100%',
                          padding: '6px 8px',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--hush-text)',
                          fontSize: '0.75rem',
                          textAlign: 'left',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hush-surface)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        {user.displayName || user.username}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* DM conversation list */}
          {dmGuilds.length === 0 ? (
            <div style={{
              padding: '8px',
              fontSize: '0.7rem',
              color: 'var(--hush-text-muted)',
              textAlign: 'center',
            }}>
              No direct messages yet
            </div>
          ) : (
            dmGuilds.map((guild) => {
              const displayName = guild.otherUser?.displayName
                || guild.otherUser?.username
                || 'Direct Message';
              const initial = displayName.charAt(0).toUpperCase();
              const unread = guild.channels?.[0]?.unreadCount ?? 0;

              return (
                <button
                  key={guild.id}
                  type="button"
                  data-testid={`dm-guild-${guild.id}`}
                  onClick={() => onGuildSelect?.(guild)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '6px 8px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--hush-text)',
                    fontSize: '0.8rem',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hush-surface)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {/* Avatar circle with initial */}
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: 'var(--hush-amber-ghost)',
                    color: 'var(--hush-amber)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    flexShrink: 0,
                  }}>
                    {initial}
                  </div>
                  <span style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}>
                    {displayName}
                  </span>
                  {unread > 0 && (
                    <span style={{
                      background: 'var(--hush-danger)',
                      color: '#fff',
                      fontSize: '0.6rem',
                      fontWeight: 600,
                      borderRadius: '50%',
                      width: 16,
                      height: 16,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
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
        <div style={styles.instanceLabel} title={group.instanceUrl}>
          {instanceDomain(group.instanceUrl)}
        </div>
      )}
      {group.guilds.map((guild) => (
        <SortableGuildIcon
          key={guild.id}
          guild={guild}
          isActive={guild.id === activeGuild?.id}
          isOffline={isGuildOffline(guild)}
          displayName={getGuildDisplayName(guild)}
          onGuildSelect={onGuildSelect}
          onContextMenu={onContextMenu}
          onLongPress={onLongPress}
        />
      ))}
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
  getMetadataKey = null,
  instanceData,
  userRole = 'member',
  userPermissionLevel = 0,
  compact = false,
}) {
  // Read InstanceContext without throwing — null when InstanceProvider is absent.
  const instanceCtx = useContext(InstanceContext);

  const mergedGuildsFromCtx = instanceCtx?.mergedGuilds ?? null;
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
      await navigator.clipboard.writeText(
        `${window.location.origin}/invite?guild=${guild.id}`,
      );
    } catch {
      // Clipboard API not available in this environment — silently skip.
    }
  }, []);

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
      style={{ ...styles.strip, ...(compact ? { width: 56, minWidth: 56 } : {}) }}
      data-testid="server-list"
    >
      {/* Direct Messages section pinned at top */}
      <DmSection dmGuilds={dmGuilds} onGuildSelect={onGuildSelect} getToken={getToken} />

      {dmGuilds.length > 0 && regularGuilds.length > 0 && (
        <div style={styles.divider} />
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
        <div style={styles.divider} />
      )}

      {showAddButton && (
        <button
          type="button"
          style={styles.addBtn}
          title="Create a server"
          aria-label="Create a server"
          onClick={() => setShowCreateModal(true)}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--hush-amber)';
            e.currentTarget.style.color = 'var(--hush-amber)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--hush-border)';
            e.currentTarget.style.color = 'var(--hush-text-muted)';
          }}
        >
          +
        </button>
      )}

      <button
        type="button"
        style={styles.settingsBtn}
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
