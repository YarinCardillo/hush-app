import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * Context menu for guild icon right-click or long-press actions.
 *
 * Rendered via createPortal into document.body so it escapes sidebar overflow.
 * Closes on outside click, Escape key, or when any action is invoked.
 *
 * @param {{
 *   guild: object,
 *   instanceUrl: string,
 *   position: { x: number, y: number },
 *   connectionState: string,
 *   userPermissionLevel: number,
 *   onClose: () => void,
 *   onLeave: (guild: object) => void,
 *   onMute: (guild: object, duration: number|null) => void,
 *   onCopyInvite: (guild: object) => void,
 *   onMarkRead: (guild: object) => void,
 *   onSettings: (guild: object) => void,
 *   onInstanceInfo: (guild: object, instanceUrl: string) => void,
 * }} props
 */
export default function GuildContextMenu({
  guild,
  instanceUrl,
  position,
  connectionState,
  userPermissionLevel = 0,
  onClose,
  onLeave,
  onMute,
  onCopyInvite,
  onMarkRead,
  onSettings,
  onInstanceInfo,
}) {
  const menuRef = useRef(null);

  // Close on outside click or Escape.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    const handlePointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    };
  }, [onClose]);

  const wrap = useCallback((cb) => (e) => {
    e.stopPropagation();
    cb();
    onClose();
  }, [onClose]);

  const instanceDomain = (() => {
    try { return new URL(instanceUrl).hostname; } catch { return instanceUrl; }
  })();

  const isOffline = connectionState !== 'connected';

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Server actions"
      style={{
        position: 'fixed',
        top: position.y,
        left: position.x,
        zIndex: 9999,
        background: 'var(--hush-elevated)',
        border: '1px solid var(--hush-border-hover)',
        minWidth: 200,
        padding: '4px 0',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        fontFamily: 'var(--font-sans)',
        fontSize: '0.85rem',
      }}
    >
      {/* Instance domain label */}
      <div
        style={{
          padding: '6px 14px 4px',
          fontSize: '0.7rem',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--hush-text-muted)',
          userSelect: 'none',
        }}
      >
        {instanceDomain}
        {isOffline && (
          <span style={{ marginLeft: 6, color: 'var(--hush-danger)', fontSize: '0.65rem' }}>
            offline
          </span>
        )}
      </div>

      <div style={{ height: 1, background: 'var(--hush-border)', margin: '4px 0' }} />

      <ContextMenuItem
        onClick={wrap(() => onMarkRead?.(guild))}
        label="Mark as read"
      />

      <ContextMenuItem
        onClick={wrap(() => onCopyInvite?.(guild))}
        label="Copy invite link"
        disabled={isOffline}
      />

      <MuteMenuItem guild={guild} onMute={onMute} onClose={onClose} />

      {userPermissionLevel >= 2 && (
        <ContextMenuItem
          onClick={wrap(() => onSettings?.(guild))}
          label="Server settings"
        />
      )}

      <ContextMenuItem
        onClick={wrap(() => onInstanceInfo?.(guild, instanceUrl))}
        label="Instance info"
      />

      <div style={{ height: 1, background: 'var(--hush-border)', margin: '4px 0' }} />

      <ContextMenuItem
        onClick={wrap(() => onLeave?.(guild))}
        label="Leave server"
        danger
      />
    </div>
  );

  return createPortal(menu, document.body);
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ContextMenuItem({ onClick, label, danger = false, disabled = false }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = danger
            ? 'var(--hush-danger-ghost)'
            : 'var(--hush-hover)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
      style={{
        display: 'block',
        width: '100%',
        padding: '8px 14px',
        background: 'transparent',
        border: 'none',
        textAlign: 'left',
        cursor: disabled ? 'default' : 'pointer',
        color: disabled
          ? 'var(--hush-text-ghost)'
          : danger
          ? 'var(--hush-danger)'
          : 'var(--hush-text)',
        fontFamily: 'var(--font-sans)',
        fontSize: '0.85rem',
      }}
    >
      {label}
    </button>
  );
}

/** Duration options for notification muting. */
const MUTE_DURATIONS = [
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '8 hours', ms: 8 * 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: 'Forever', ms: null },
];

/**
 * Mute notifications sub-menu item.
 * Hovering the row reveals a flyout with duration options.
 */
function MuteMenuItem({ guild, onMute, onClose }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="true"
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          padding: '8px 14px',
          background: open ? 'var(--hush-hover)' : 'transparent',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          color: 'var(--hush-text)',
          fontFamily: 'var(--font-sans)',
          fontSize: '0.85rem',
        }}
      >
        Mute notifications
        <span style={{ color: 'var(--hush-text-muted)', fontSize: '0.75rem' }}>▶</span>
      </button>
      {open && (
        <div
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          style={{
            position: 'absolute',
            left: '100%',
            top: 0,
            background: 'var(--hush-elevated)',
            border: '1px solid var(--hush-border-hover)',
            minWidth: 140,
            padding: '4px 0',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 10000,
          }}
        >
          {MUTE_DURATIONS.map(({ label, ms }) => (
            <ContextMenuItem
              key={label}
              label={label}
              onClick={() => {
                onMute?.(guild, ms);
                onClose();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
