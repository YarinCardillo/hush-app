import { useState } from 'react';
import MemberProfileCard from './MemberProfileCard';
import MemberContextMenu from './MemberContextMenu';
import ModerationModal from './ModerationModal';
import { kickUser, banUser, muteUser, changeUserRole } from '../lib/api';
import { JWT_KEY } from '../hooks/useAuth';

const ROLE_ORDER = ['owner', 'admin', 'mod', 'member'];
const ROLE_LABELS = { owner: 'OWNER', admin: 'ADMIN', mod: 'MODS', member: 'MEMBERS' };

const ROLE_RANK = { owner: 3, admin: 2, mod: 1, member: 0 };

function roleAtLeast(role, required) {
  return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[required] ?? 0);
}

function getToken() {
  return typeof window !== 'undefined'
    ? (sessionStorage.getItem(JWT_KEY) ?? sessionStorage.getItem('hush_token'))
    : null;
}

/** Returns the stable member ID, supporting both legacy userId and new id fields. */
function getMemberId(m) {
  return m.id ?? m.userId ?? '';
}

function groupByRole(members) {
  const byRole = { owner: [], admin: [], mod: [], member: [] };
  for (const m of members) {
    const role = ROLE_ORDER.includes(m.role) ? m.role : 'member';
    byRole[role].push(m);
  }
  return byRole;
}

function sortWithinSection(members, onlineUserIds) {
  return [...members].sort((a, b) => {
    const aOnline = onlineUserIds.has(getMemberId(a));
    const bOnline = onlineUserIds.has(getMemberId(b));
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return (a.displayName || '').localeCompare(b.displayName || '');
  });
}

const styles = {
  panel: {
    width: '100%',
    height: '100%',
    flexShrink: 0,
    background: 'var(--hush-surface)',
    borderLeft: '1px solid var(--hush-border)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 0',
  },
  sectionHeader: {
    padding: '8px 12px 4px',
    fontSize: '0.7rem',
    fontWeight: 600,
    color: 'var(--hush-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    fontSize: '0.85rem',
    color: 'var(--hush-text)',
    cursor: 'pointer',
    userSelect: 'none',
  },
  dot: (online) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
    background: online ? 'var(--hush-live)' : 'var(--hush-text-muted)',
    boxShadow: online ? '0 0 6px var(--hush-live-glow)' : 'none',
  }),
  name: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  badgeAdmin: {
    fontSize: '0.65rem',
    padding: '2px 6px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--hush-amber-ghost)',
    color: 'var(--hush-amber)',
    flexShrink: 0,
  },
  badgeMod: {
    fontSize: '0.65rem',
    padding: '2px 6px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--hush-surface)',
    color: 'var(--hush-text-secondary)',
    border: '1px solid var(--hush-border)',
    flexShrink: 0,
  },
};

const ACTION_SUCCESS_MESSAGES = {
  kick: (name) => `${name} was kicked.`,
  ban: (name) => `${name} was banned.`,
  mute: (name) => `${name} was muted.`,
  changeRole: (name) => `${name}'s role was updated.`,
};

/**
 * @param {{
 *   members: Array<object>,
 *   onlineUserIds: Set<string>,
 *   currentUserId: string,
 *   myRole: string,
 *   showToast: (message: string, type: string) => void,
 *   onMemberUpdate: () => void,
 * }} props
 */
export default function MemberList({
  members = [],
  onlineUserIds = new Set(),
  currentUserId = '',
  myRole = 'member',
  showToast,
  onMemberUpdate,
}) {
  const [selectedMember, setSelectedMember] = useState(null);
  const [profilePosition, setProfilePosition] = useState({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState(null); // { member, x, y } | null
  const [modalAction, setModalAction] = useState(null); // { action, member } | null

  const byRole = groupByRole(members);

  /**
   * Dispatches the moderation API call for the given action.
   * Clears the modal and shows a toast on completion.
   */
  const handleModAction = async (action, member, data) => {
    const token = getToken();
    if (!token) throw new Error('Not authenticated');

    const memberId = getMemberId(member);
    const displayName = member.displayName || member.username || 'User';

    switch (action) {
      case 'kick':
        await kickUser(token, memberId, data.reason);
        break;
      case 'ban':
        await banUser(token, memberId, data.reason, data.expiresIn);
        break;
      case 'mute':
        await muteUser(token, memberId, data.reason, data.expiresIn);
        break;
      case 'changeRole':
        await changeUserRole(token, memberId, data.newRole, data.reason);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    const message = ACTION_SUCCESS_MESSAGES[action]?.(displayName) ?? 'Action completed.';
    showToast?.(message, 'success');
    onMemberUpdate?.();
  };

  return (
    <div style={styles.panel}>
      <div style={styles.list}>
        {ROLE_ORDER.map((role) => {
          const list = byRole[role];
          if (!list || list.length === 0) return null;
          const sorted = sortWithinSection(list, onlineUserIds);
          const label = ROLE_LABELS[role];
          return (
            <div key={role}>
              <div style={styles.sectionHeader}>{label} — {sorted.length}</div>
              {sorted.map((m) => {
                const memberId = getMemberId(m);
                const isOnline = onlineUserIds.has(memberId);
                const isYou = memberId === currentUserId;
                return (
                  <div
                    key={memberId}
                    style={styles.row}
                    className="member-list-row"
                    onClick={(e) => {
                      setSelectedMember(m);
                      setProfilePosition({ x: e.clientX, y: e.clientY });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      // Context menu only visible to mod+ and not on self
                      if (!isYou && roleAtLeast(myRole, 'mod')) {
                        setContextMenu({ member: m, x: e.clientX, y: e.clientY });
                      }
                    }}
                    onMouseEnter={(el) => { el.currentTarget.style.background = 'var(--hush-elevated)'; }}
                    onMouseLeave={(el) => { el.currentTarget.style.background = 'none'; }}
                  >
                    <div style={styles.dot(isOnline)} aria-hidden />
                    <span style={styles.name}>
                      {m.displayName || 'Unknown'}
                      {isYou && ' (You)'}
                    </span>
                    {m.role === 'owner' && <span style={styles.badgeAdmin}>Owner</span>}
                    {m.role === 'admin' && <span style={styles.badgeAdmin}>Admin</span>}
                    {m.role === 'mod' && <span style={styles.badgeMod}>Mod</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {selectedMember && (
        <MemberProfileCard
          member={selectedMember}
          position={profilePosition}
          onClose={() => setSelectedMember(null)}
        />
      )}

      {contextMenu && (
        <MemberContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          member={contextMenu.member}
          myRole={myRole}
          onAction={(action) => {
            setModalAction({ action, member: contextMenu.member });
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {modalAction && (
        <ModerationModal
          action={modalAction.action}
          member={modalAction.member}
          onConfirm={async (data) => {
            await handleModAction(modalAction.action, modalAction.member, data);
            setModalAction(null);
          }}
          onClose={() => setModalAction(null)}
        />
      )}
    </div>
  );
}
