import { useEffect, useRef } from 'react';

/** Badge styles per role, following the design-system amber/muted palette. */
const ROLE_BADGE_STYLES = {
  owner: {
    background: 'var(--hush-amber-ghost)',
    color: 'var(--hush-amber)',
  },
  admin: {
    background: 'var(--hush-amber-ghost)',
    color: 'var(--hush-amber)',
  },
  mod: {
    background: 'var(--hush-surface)',
    color: 'var(--hush-text-secondary)',
    border: '1px solid var(--hush-border)',
  },
  member: {
    background: 'var(--hush-surface)',
    color: 'var(--hush-text-muted)',
    border: '1px solid var(--hush-border)',
  },
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

const styles = {
  card: (pos) => ({
    position: 'fixed',
    left: pos.left,
    top: pos.top,
    width: CARD_WIDTH,
    background: 'var(--hush-elevated)',
    border: '1px solid var(--hush-border)',
    padding: '16px',
    zIndex: 500,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  }),
  displayName: {
    fontSize: '1rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  username: {
    fontSize: '0.8rem',
    color: 'var(--hush-text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  badge: (role) => ({
    display: 'inline-block',
    fontSize: '0.65rem',
    fontWeight: 500,
    padding: '2px 6px',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    ...(ROLE_BADGE_STYLES[role] ?? ROLE_BADGE_STYLES.member),
  }),
  joinDate: {
    fontSize: '0.75rem',
    color: 'var(--hush-text-muted)',
    marginTop: '4px',
  },
};

/**
 * Floating profile card that appears on left-click of a member row.
 * Visible to all users — no role gate here.
 *
 * @param {{ member: object, position: { x: number, y: number }, onClose: Function }} props
 */
export default function MemberProfileCard({ member, position, onClose }) {
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

  return (
    <div ref={cardRef} style={styles.card(pos)} role="dialog" aria-label="Member profile">
      <div style={styles.displayName}>{member.displayName || member.username || 'Unknown'}</div>
      {member.username && (
        <div style={styles.username}>@{member.username}</div>
      )}
      <span style={styles.badge(role)}>{role}</span>
      {joinDate && <div style={styles.joinDate}>{joinDate}</div>}
    </div>
  );
}
