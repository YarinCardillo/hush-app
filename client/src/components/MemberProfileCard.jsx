import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** Badge styles per role, following the design-system amber/muted palette. */
const ROLE_BADGE_STYLES = {
  owner: { background: 'var(--hush-amber-ghost)', color: 'var(--hush-amber)' },
  admin: { background: 'var(--hush-amber-ghost)', color: 'var(--hush-amber)' },
  mod: { background: 'var(--hush-surface)', color: 'var(--hush-text-secondary)', border: '1px solid var(--hush-border)' },
  member: { background: 'var(--hush-surface)', color: 'var(--hush-text-muted)', border: '1px solid var(--hush-border)' },
};

const CARD_WIDTH = 220;
const CARD_HEIGHT = 120;

function clampPosition(x, y) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    left: Math.min(x, vw - CARD_WIDTH - 8),
    top: Math.min(y, vh - CARD_HEIGHT - 8),
  };
}

function formatJoinDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return `Joined ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}


/**
 * Floating profile card that appears on left-click of a member row.
 * Visible to all users — no role gate here.
 *
 * @param {{
 *   member: object,
 *   position: { x: number, y: number },
 *   onClose: Function,
 *   onSendMessage: ((member: object) => void) | undefined,
 *   currentUserId: string | undefined,
 * }} props
 */
export default function MemberProfileCard({ member, position, onClose, onSendMessage, currentUserId }) {
  const cardRef = useRef(null);
  const pos = clampPosition(position.x, position.y);

  // Dismiss on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (cardRef.current && !cardRef.current.contains(e.target)) {
        onClose();
      }
    };
    // Use capture so the event fires before potential stopPropagation in children
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [onClose]);

  // Dismiss on Escape
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const role = member.role ?? 'member';
  const joinDate = formatJoinDate(member.createdAt ?? member.joinedAt);
  const memberId = member.id ?? member.userId;
  const canSendMessage = onSendMessage && memberId && memberId !== currentUserId;

  return createPortal(
    <div
      ref={cardRef}
      className="mpc-card"
      role="dialog"
      aria-label="Member profile"
      style={{ position: 'fixed', left: pos.left, top: pos.top, width: CARD_WIDTH }}
    >
      <div className="mpc-display-name">{member.displayName || member.username || 'Unknown'}</div>
      {member.username && (
        <div className="mpc-username">@{member.username}</div>
      )}
      <span className="mpc-badge" style={ROLE_BADGE_STYLES[role] ?? ROLE_BADGE_STYLES.member}>{role}</span>
      {joinDate && <div className="mpc-join-date">{joinDate}</div>}
      {canSendMessage && (
        <button
          type="button"
          className="mpc-send-btn"
          data-testid="send-message-btn"
          onClick={() => {
            onSendMessage(member);
            onClose();
          }}
        >
          Send Message
        </button>
      )}
    </div>,
    document.body,
  );
}
