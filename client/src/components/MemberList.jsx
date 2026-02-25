const ROLE_ORDER = ['admin', 'mod', 'member'];
const ROLE_LABELS = { admin: 'ADMIN', mod: 'MODS', member: 'MEMBERS' };

function groupByRole(members) {
  const byRole = { admin: [], mod: [], member: [] };
  for (const m of members) {
    const role = ROLE_ORDER.includes(m.role) ? m.role : 'member';
    byRole[role].push(m);
  }
  return byRole;
}

function sortWithinSection(members, onlineUserIds) {
  return [...members].sort((a, b) => {
    const aOnline = onlineUserIds.has(a.userId);
    const bOnline = onlineUserIds.has(b.userId);
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return (a.displayName || '').localeCompare(b.displayName || '');
  });
}

const styles = {
  panel: {
    width: '240px',
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
    cursor: 'default',
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

export default function MemberList({ members = [], onlineUserIds = new Set(), currentUserId = '' }) {
  const byRole = groupByRole(members);

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
                const isOnline = onlineUserIds.has(m.userId);
                const isYou = m.userId === currentUserId;
                return (
                  <div
                    key={m.userId}
                    style={styles.row}
                    className="member-list-row"
                  >
                    <div style={styles.dot(isOnline)} aria-hidden />
                    <span style={styles.name}>
                      {m.displayName || 'Unknown'}
                      {isYou && ' (You)'}
                    </span>
                    {m.role === 'admin' && <span style={styles.badgeAdmin}>Admin</span>}
                    {m.role === 'mod' && <span style={styles.badgeMod}>Mod</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
