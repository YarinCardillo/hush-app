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
      className="gcm-context-menu dropdown-menu"
      style={{ top: position.y, left: position.x }}
    >
      {/* Instance domain label */}
      <div className="gcm-context-instance-label">
        {instanceDomain}
        {isOffline && (
          <span className="gcm-context-offline-tag">offline</span>
        )}
      </div>

      <div className="gcm-context-divider" />

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

      <div className="gcm-context-divider" />

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
      className={`gcm-context-item${danger ? ' gcm-context-item--danger' : ''}`}
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
        className={`gcm-mute-trigger${open ? ' gcm-mute-trigger--open' : ''}`}
      >
        Mute notifications
        <span style={{ color: 'var(--hush-text-muted)', fontSize: '0.75rem' }}>&#x25B6;</span>
      </button>
      {open && (
        <div
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className="gcm-mute-submenu dropdown-menu"
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
