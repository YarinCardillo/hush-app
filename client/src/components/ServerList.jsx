import { useState, useCallback, useEffect, useRef } from 'react';
import UserSettingsModal from './UserSettingsModal';
import GuildCreateModal from './GuildCreateModal';
import { decryptGuildMetadata, fromBase64, importMetadataKey } from '../lib/guildMetadata';

const ICON_SIZE = 48;
const STRIP_WIDTH = 72;

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
  guildBtn: (isActive, bgColor) => ({
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
};

/**
 * Vertical guild icon strip sidebar.
 *
 * @param {{
 *   getToken: () => string|null,
 *   guilds: Array<object>,
 *   activeGuild: object|null,
 *   onGuildSelect: (guild: object) => void,
 *   onGuildCreated: (guild: object) => void,
 *   getMetadataKey: (guildId: string) => Promise<Uint8Array|null>,
 *   instanceData: object|null,
 *   userPermissionLevel: number,
 * }} props
 */
export default function ServerList({
  getToken,
  guilds = [],
  activeGuild = null,
  onGuildSelect,
  onGuildCreated,
  getMetadataKey = null,
  instanceData,
  userRole = 'member',
  userPermissionLevel = 0,
  compact = false,
}) {
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // Map<guildId, { name: string, icon: string|null }> — decrypted metadata cache
  const [metadataCache, setMetadataCache] = useState(new Map());
  const decryptingRef = useRef(new Set());

  // Decrypt guild metadata when guilds or keys change.
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
          const keyBytes = await getMetadataKey(guildId);
          if (!keyBytes) return;
          const cryptoKey = await importMetadataKey(keyBytes);
          const blob = fromBase64(guild.encryptedMetadata);
          const { name, icon } = await decryptGuildMetadata(cryptoKey, blob);
          setMetadataCache((prev) => {
            const next = new Map(prev);
            next.set(guildId, { name, icon });
            return next;
          });
        } catch (err) {
          console.warn('[ServerList] Failed to decrypt guild metadata for', guildId, err);
        } finally {
          decryptingRef.current.delete(guildId);
        }
      })();
    }
  }, [guilds, getMetadataKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Returns the display name for a guild — from decrypted metadata cache,
   * or from _localName (set by GuildCreateModal before upload), or falls back
   * to the guild UUID as last resort.
   * @param {object} guild
   * @returns {string}
   */
  const getGuildDisplayName = useCallback((guild) => {
    const cached = metadataCache.get(guild.id);
    if (cached?.name) return cached.name;
    if (guild._localName) return guild._localName;
    if (guild.name) return guild.name; // backward compat during migration
    return guild.id.slice(0, 8); // UUID prefix as last resort
  }, [metadataCache]);

  // Allow guild creation based on permission level and instance policy.
  // Supports both new permissionLevel integers and legacy role strings during transition.
  const isAdminOrHigher = userPermissionLevel >= 2 || userRole === 'admin' || userRole === 'owner';
  const policy = instanceData?.guildDiscovery ?? instanceData?.serverCreationPolicy ?? 'open';
  const showAddButton = policy === 'admin_only' ? isAdminOrHigher : true;

  const handleGuildCreated = useCallback((newGuild) => {
    setShowCreateModal(false);
    onGuildCreated?.(newGuild);
  }, [onGuildCreated]);

  return (
    <div style={{ ...styles.strip, ...(compact ? { width: 56, minWidth: 56 } : {}) }}>
      {guilds.map((guild) => {
        const isActive = guild.id === activeGuild?.id;
        const bg = guildColor(guild.id);
        const displayName = getGuildDisplayName(guild);
        return (
          <button
            key={guild.id}
            type="button"
            style={styles.guildBtn(isActive, bg)}
            title={displayName}
            aria-label={displayName}
            aria-pressed={isActive}
            onClick={() => onGuildSelect?.(guild)}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.opacity = '0.8'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
          >
            {getInitials(displayName)}
          </button>
        );
      })}

      {guilds.length > 0 && showAddButton && (
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
        />
      )}
    </div>
  );
}
