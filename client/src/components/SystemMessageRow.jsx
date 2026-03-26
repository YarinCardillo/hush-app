/**
 * SystemMessageRow: renders a single system/moderation event with event-type styling.
 * Used by SystemChannel to display member_joined, member_kicked, role_changed, etc.
 */

const EVENT_CONFIG = {
  member_joined:            { color: '#4ade80', label: 'joined' },
  member_left:              { color: '#8888a0', label: 'left' },
  member_kicked:            { color: '#ef4444', label: 'kicked' },
  member_banned:            { color: '#ef4444', label: 'banned' },
  member_unbanned:          { color: '#4ade80', label: 'unbanned' },
  member_muted:             { color: '#f59e0b', label: 'muted' },
  member_unmuted:           { color: '#4ade80', label: 'unmuted' },
  role_changed:             { color: '#3b82f6', label: 'role changed' },
  server_created:           { color: '#d54f12', label: 'server created' },
  template_partial_failure: { color: '#f59e0b', label: 'setup warning' },
};

const DEFAULT_CONFIG = { color: 'var(--hush-text-muted)', label: 'event' };

function resolveName(id, members) {
  if (!id) return 'Unknown User';
  const m = members.find((mem) => (mem.id ?? mem.userId) === id);
  return m?.displayName || m?.username || 'Unknown User';
}

function formatTimestamp(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      + ' ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function buildMessageText(message, members) {
  const actor = resolveName(message.actorId, members);
  const target = resolveName(message.targetId, members);
  const reason = message.reason ? ` -- Reason: ${message.reason}` : '';

  switch (message.eventType) {
    case 'member_joined':
      return `${actor} joined the server`;
    case 'member_left':
      return `${actor} left the server`;
    case 'member_kicked':
      return `${actor} kicked ${target}${reason}`;
    case 'member_banned':
      return `${actor} banned ${target}${reason}`;
    case 'member_unbanned':
      return `${actor} unbanned ${target}`;
    case 'member_muted':
      return `${actor} muted ${target}${reason}`;
    case 'member_unmuted':
      return `${actor} unmuted ${target}`;
    case 'role_changed': {
      const oldRole = message.metadata?.old_role ?? 'unknown';
      const newRole = message.metadata?.new_role ?? 'unknown';
      return `${actor} changed ${target}'s role from ${oldRole} to ${newRole}`;
    }
    case 'server_created':
      return `${actor} created the server`;
    case 'template_partial_failure':
      return `Server setup: some default channels could not be created`;
    default:
      return `${actor} performed ${message.eventType}`;
  }
}

export default function SystemMessageRow({ message, members = [] }) {
  const config = EVENT_CONFIG[message.eventType] ?? DEFAULT_CONFIG;
  const text = buildMessageText(message, members);

  return (
    <div
      className="sys-msg-row"
      style={{ borderLeft: `4px solid ${config.color}` }}
    >
      <span className="sys-msg-timestamp">{formatTimestamp(message.createdAt)}</span>
      <span className="sys-msg-text">{text}</span>
    </div>
  );
}
