import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const MENU_WIDTH = 160;
const MENU_ITEM_HEIGHT = 32;

const ROLE_ORDER = { owner: 3, admin: 2, mod: 1, member: 0 };

/** Returns the numeric rank for a role string. */
function rank(role) {
  return ROLE_ORDER[role] ?? 0;
}

function clampPosition(x, y, itemCount) {
  const menuHeight = itemCount * MENU_ITEM_HEIGHT + 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    left: Math.min(x, vw - MENU_WIDTH - 8),
    top: Math.min(y, vh - menuHeight - 8),
  };
}


/**
 * Resolves which mod actions should appear in the context menu.
 *
 * Rules:
 * - Actor must have rank > target's rank (cannot act on equals or superiors)
 * - Actor cannot act on themselves
 * - Mods see: Kick, Mute
 * - Admins additionally see: Ban, Change Role
 * - Owners additionally see: Ban, Change Role (same as admin for MVP)
 */
function getAvailableActions(myRole, targetRole, isTargetSelf) {
  if (isTargetSelf) return [];
  if (rank(myRole) <= rank(targetRole)) return [];

  const actions = [
    { id: 'kick', label: 'Kick', minRank: 1 },
    { id: 'mute', label: 'Mute', minRank: 1 },
    { id: 'ban', label: 'Ban', minRank: 2 },
    { id: 'changeRole', label: 'Change Role', minRank: 2 },
  ];

  return actions.filter((a) => rank(myRole) >= a.minRank);
}

/**
 * Role-gated context menu for mod actions on a member.
 * Only rendered when the calling component determines the actor is mod+.
 *
 * @param {{ x: number, y: number, member: object, myRole: string, onAction: Function, onClose: Function }} props
 */
export default function MemberContextMenu({ x, y, member, myRole, onAction, onClose }) {
  const menuRef = useRef(null);

  const targetRole = member.role ?? 'member';
  const isTargetSelf = false; // Caller already filters self-right-click if desired
  const actions = getAvailableActions(myRole, targetRole, isTargetSelf);

  const pos = clampPosition(x, y, Math.max(actions.length, 1));

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [onClose]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (actions.length === 0) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="mcc-menu dropdown-menu"
      role="menu"
      aria-label="Member actions"
      style={{ position: 'fixed', left: pos.left, top: pos.top, width: MENU_WIDTH }}
    >
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          className={`mcc-item${a.id === 'kick' || a.id === 'ban' ? ' mcc-item--danger' : ''}`}
          role="menuitem"
          onClick={() => {
            onAction(a.id);
            onClose();
          }}
        >
          {a.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
