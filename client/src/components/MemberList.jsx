import { useState } from 'react';
import MemberProfileCard from './MemberProfileCard';
import MemberContextMenu from './MemberContextMenu';
import ModerationModal from './ModerationModal';
import { kickUser, banUser, muteUser, changePermissionLevel, changeUserRole } from '../lib/api';
import { JWT_KEY } from '../hooks/useAuth';

// Permission level constants: 0=member, 1=mod, 2=admin, 3=owner
const PERM_MEMBER = 0;
const PERM_MOD = 1;
const PERM_ADMIN = 2;
const PERM_OWNER = 3;

// Human-readable section labels for permission levels (client-side only)
const PERM_LABEL = { [PERM_OWNER]: 'OWNERS', [PERM_ADMIN]: 'ADMIN', [PERM_MOD]: 'MODS', [PERM_MEMBER]: 'MEMBERS' };
// Human-readable badge labels for individual member rows
const PERM_BADGE_LABEL = { [PERM_OWNER]: 'Owner', [PERM_ADMIN]: 'Admin', [PERM_MOD]: 'Mod' };

// Legacy role string → permission level mapping (for backward compat during transition)
const ROLE_TO_LEVEL = { owner: PERM_OWNER, admin: PERM_ADMIN, mod: PERM_MOD, member: PERM_MEMBER };

/**
 * Returns the effective permission level for a member.
 * Prefers permissionLevel (new API) over role string (legacy).
 * @param {object} member
 * @returns {number}
 */
function getMemberLevel(member) {
  if (member.permissionLevel != null) return member.permissionLevel;
  return ROLE_TO_LEVEL[member.role] ?? PERM_MEMBER;
}

// Section order: highest level first (descending)
const LEVEL_ORDER = [PERM_OWNER, PERM_ADMIN, PERM_MOD, PERM_MEMBER];

function getToken() {
  return typeof window !== 'undefined'
    ? (sessionStorage.getItem(JWT_KEY) ?? sessionStorage.getItem('hush_token'))
    : null;
}

/** Returns the stable member ID, supporting both legacy userId and new id fields. */
function getMemberId(m) {
  return m.id ?? m.userId ?? '';
}

/**
 * Groups members into buckets by effective permission level.
 * Uses getMemberLevel() so both new integer API and legacy role strings are handled.
 * @param {Array<object>} members
 * @returns {Map<number, Array<object>>}
 */
function groupByLevel(members) {
  const byLevel = new Map(LEVEL_ORDER.map((l) => [l, []]));
  for (const m of members) {
    const level = getMemberLevel(m);
    // Clamp to valid levels
    const bucket = byLevel.has(level) ? level : PERM_MEMBER;
    byLevel.get(bucket).push(m);
  }
  return byLevel;
}

function sortWithinSection(members, onlineUserIds) {
  return [...members].sort((a, b) => {
    const aOnline = onlineUserIds.has(getMemberId(a));
    const bOnline = onlineUserIds.has(getMemberId(b));
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return (a.displayName || '').localeCompare(b.displayName || '');
  });
}


const ACTION_SUCCESS_MESSAGES = {
  kick: (name) => `${name} was kicked.`,
  ban: (name) => `${name} was banned.`,
  mute: (name) => `${name} was muted.`,
  changeRole: (name) => `${name}'s role was updated.`,
};

/**
 * MemberList — renders grouped member rows for a guild.
 *
 * On desktop: rendered inside the desktop sidebar panel (sidebar-desktop-inner).
 * On mobile: rendered inside the mobile-member-drawer container in ServerLayout.
 * The mobile-member-drawer open/close state is managed by ServerLayout; this
 * component is unaware of the drawer lifecycle.
 *
 * @param {{
 *   members: Array<object>,
 *   onlineUserIds: Set<string>,
 *   currentUserId: string,
 *   myRole: string,
 *   myPermissionLevel: number,
 *   showToast: (message: string, type: string) => void,
 *   onMemberUpdate: () => void,
 *   serverId: string,
 *   onSendMessage: ((member: object) => void) | undefined,
 *   onCloseDrawer: (() => void) | undefined,
 * }} props
 */
export default function MemberList({
  members = [],
  onlineUserIds = new Set(),
  currentUserId = '',
  myRole = 'member',
  myPermissionLevel = 0,
  showToast,
  onMemberUpdate,
  serverId,
  onSendMessage,
  onCloseDrawer,
}) {
  const [selectedMember, setSelectedMember] = useState(null);
  const [profilePosition, setProfilePosition] = useState({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState(null); // { member, x, y } | null
  const [modalAction, setModalAction] = useState(null); // { action, member } | null

  // Derive effective permission level from integer or legacy role string
  const myLevel = myPermissionLevel > 0
    ? myPermissionLevel
    : ({ owner: PERM_OWNER, admin: PERM_ADMIN, mod: PERM_MOD, member: PERM_MEMBER }[myRole] ?? PERM_MEMBER);

  const byLevel = groupByLevel(members);

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
        await kickUser(token, serverId, memberId, data.reason);
        break;
      case 'ban':
        await banUser(token, serverId, memberId, data.reason, data.expiresIn);
        break;
      case 'mute':
        await muteUser(token, serverId, memberId, data.reason, data.expiresIn);
        break;
      case 'changeRole':
        // data.newRole is a string from ModerationModal; convert to integer level
        await changePermissionLevel(
          token,
          serverId,
          memberId,
          ROLE_TO_LEVEL[data.newRole] ?? PERM_MEMBER,
        );
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    const message = ACTION_SUCCESS_MESSAGES[action]?.(displayName) ?? 'Action completed.';
    showToast?.(message, 'success');
    onMemberUpdate?.();
  };

  return (
    <div className="ml-container ml-panel">
      <div className="ml-list">
        {LEVEL_ORDER.map((level) => {
          const list = byLevel.get(level);
          if (!list || list.length === 0) return null;
          const sorted = sortWithinSection(list, onlineUserIds);
          const label = PERM_LABEL[level];
          return (
            <div key={level}>
              <div className="ml-role-header">{label} — {sorted.length}</div>
              {sorted.map((m) => {
                const memberId = getMemberId(m);
                const isOnline = onlineUserIds.has(memberId);
                const isYou = memberId === currentUserId;
                const memberLevel = getMemberLevel(m);
                const badgeLabel = PERM_BADGE_LABEL[memberLevel];
                return (
                  <div
                    key={memberId}
                    className="ml-member-item member-list-row"
                    onClick={(e) => {
                      setSelectedMember(m);
                      setProfilePosition({ x: e.clientX, y: e.clientY });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      // Context menu visible only when actor strictly outranks target
                      if (!isYou && myLevel > memberLevel && myLevel >= PERM_MOD) {
                        setContextMenu({ member: m, x: e.clientX, y: e.clientY });
                      }
                    }}
                  >
                    <div className={`ml-status-dot${isOnline ? ' ml-status-dot--online' : ''}`} aria-hidden />
                    <span className="ml-member-name">
                      {m.displayName || 'Unknown'}
                      {isYou && ' (You)'}
                    </span>
                    {badgeLabel && memberLevel >= PERM_ADMIN && (
                      <span className="ml-badge ml-badge--admin">{badgeLabel}</span>
                    )}
                    {badgeLabel && memberLevel === PERM_MOD && (
                      <span className="ml-badge ml-badge--mod">{badgeLabel}</span>
                    )}
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
          onSendMessage={onSendMessage ? (member) => {
            onCloseDrawer?.();
            onSendMessage(member);
          } : undefined}
          currentUserId={currentUserId}
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
