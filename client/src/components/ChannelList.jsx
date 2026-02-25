import { useState, useEffect, useCallback } from 'react';
import { getServer, createChannel, deleteChannel } from '../lib/api';

const CHANNEL_TYPE_TEXT = 'text';
const CHANNEL_TYPE_VOICE = 'voice';

const styles = {
  panel: {
    width: '260px',
    minWidth: '260px',
    background: 'var(--hush-surface)',
    borderRight: '1px solid transparent',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '12px 16px',
    borderBottom: '1px solid transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: '48px',
  },
  serverName: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: 'var(--hush-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 0',
  },
  categoryHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '8px 16px 4px',
    fontSize: '0.7rem',
    fontWeight: 600,
    color: 'var(--hush-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    cursor: 'pointer',
    userSelect: 'none',
  },
  channelRow: (isActive) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 16px',
    cursor: 'pointer',
    background: isActive ? 'var(--hush-elevated)' : 'transparent',
    color: isActive ? 'var(--hush-text)' : 'var(--hush-text-secondary)',
    fontSize: '0.85rem',
    transition: 'all var(--duration-fast) var(--ease-out)',
  }),
  channelRowHover: {
    background: 'var(--hush-elevated)',
    color: 'var(--hush-text)',
  },
  channelIcon: {
    flexShrink: 0,
    color: 'inherit',
  },
  channelName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  voiceCount: {
    fontSize: '0.75rem',
    color: 'var(--hush-text-muted)',
  },
  addBtn: {
    padding: '4px 8px',
    background: 'none',
    border: 'none',
    color: 'var(--hush-text-muted)',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontFamily: 'var(--font-sans)',
  },
  modalTitle: {
    fontSize: '1rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
    marginBottom: '12px',
  },
  fieldLabel: {
    display: 'block',
    marginBottom: '4px',
    fontSize: '0.8rem',
    color: 'var(--hush-text-secondary)',
    fontWeight: 500,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  error: {
    fontSize: '0.85rem',
    color: 'var(--hush-danger)',
  },
};

function groupChannelsByParent(channels) {
  const byParent = new Map();
  byParent.set(null, []);
  const channelById = new Map();
  const parentIds = new Set(channels.map((ch) => ch.parentId).filter(Boolean));
  channels.forEach((ch) => {
    channelById.set(ch.id, ch);
    const key = ch.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(ch);
  });
  const uncategorized = (byParent.get(null) || []).filter((ch) => !parentIds.has(ch.id));
  uncategorized.sort((a, b) => a.position - b.position || (a.name || '').localeCompare(b.name || ''));
  byParent.forEach((list, key) => {
    if (key !== null) list.sort((a, b) => a.position - b.position || (a.name || '').localeCompare(b.name || ''));
  });
  const ordered = [];
  if (uncategorized.length > 0) ordered.push({ key: null, label: 'Uncategorized', channels: uncategorized });
  byParent.forEach((list, key) => {
    if (key !== null) {
      const parent = channelById.get(key);
      ordered.push({ key, label: parent?.name ?? 'Category', channels: list });
    }
  });
  return ordered;
}

function CreateChannelModal({ getToken, serverId, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [type, setType] = useState(CHANNEL_TYPE_TEXT);
  const [voiceMode, setVoiceMode] = useState('quality');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setIsOpen(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    const token = getToken();
    if (!token) {
      setError('Not authenticated');
      return;
    }
    setLoading(true);
    try {
      const body = { name: trimmed, type };
      if (type === CHANNEL_TYPE_VOICE) body.voiceMode = voiceMode;
      const channel = await createChannel(token, serverId, body);
      onCreated(channel);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create channel');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`modal-backdrop ${isOpen ? 'modal-backdrop-open' : ''}`}
      onClick={onClose}
    >
      <div
        className={`modal-content ${isOpen ? 'modal-content-open' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={styles.modalTitle}>Create channel</div>
        <form style={styles.form} onSubmit={handleSubmit}>
          <div>
            <label style={styles.fieldLabel}>Name</label>
            <input
              className="input"
              type="text"
              placeholder="general"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div>
            <label style={styles.fieldLabel} htmlFor="create-channel-type">Type</label>
            <select
              id="create-channel-type"
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value={CHANNEL_TYPE_TEXT}>Text</option>
              <option value={CHANNEL_TYPE_VOICE}>Voice</option>
            </select>
          </div>
          {type === CHANNEL_TYPE_VOICE && (
            <div>
              <label style={styles.fieldLabel} htmlFor="create-channel-voice-mode">Voice mode</label>
              <select
                id="create-channel-voice-mode"
                className="input"
                value={voiceMode}
                onChange={(e) => setVoiceMode(e.target.value)}
              >
                <option value="quality">Quality</option>
                <option value="performance">Performance</option>
              </select>
            </div>
          )}
          {error && <div style={styles.error}>{error}</div>}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CategorySection({ group, activeChannelId, onChannelSelect, voiceParticipantCounts }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <button
        type="button"
        style={styles.categoryHeader}
        onClick={() => setCollapsed((c) => !c)}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform var(--duration-fast) var(--ease-out)' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        {group.label}
      </button>
      {!collapsed &&
        group.channels.map((ch) => {
          const isActive = activeChannelId === ch.id;
          const isVoice = ch.type === CHANNEL_TYPE_VOICE;
          const count = voiceParticipantCounts?.get(ch.id) ?? 0;
          return (
            <ChannelRow
              key={ch.id}
              channel={ch}
              isActive={isActive}
              onSelect={() => onChannelSelect(ch)}
              participantCount={isVoice ? count : null}
            />
          );
        })}
    </div>
  );
}

function ChannelRow({ channel, isActive, onSelect, participantCount }) {
  const [hover, setHover] = useState(false);
  const isVoice = channel.type === CHANNEL_TYPE_VOICE;

  return (
    <div
      role="button"
      tabIndex={0}
      style={{
        ...styles.channelRow(isActive),
        ...(hover && !isActive ? styles.channelRowHover : {}),
      }}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span style={styles.channelIcon} aria-hidden>
        {isVoice ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        ) : (
          <span style={{ opacity: 0.8 }}>#</span>
        )}
      </span>
      <span style={styles.channelName}>{channel.name}</span>
      {isVoice && (
        <span style={styles.voiceCount}>
          {participantCount != null ? participantCount : '—'}
        </span>
      )}
    </div>
  );
}

export default function ChannelList({
  getToken,
  serverId,
  serverName,
  channels,
  myRole,
  activeChannelId,
  onChannelSelect,
  onChannelsUpdated,
  voiceParticipantCounts,
}) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchServer = useCallback(async () => {
    if (!serverId || !getToken()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getServer(getToken(), serverId);
      onChannelsUpdated?.(data);
    } catch (err) {
      setError(err.message || 'Failed to load channels');
    } finally {
      setLoading(false);
    }
  }, [serverId, getToken, onChannelsUpdated]);

  const handleCreated = () => {
    fetchServer();
  };

  const groups = groupChannelsByParent(channels ?? []);

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.serverName}>{serverName ?? 'Server'}</span>
        {myRole === 'admin' && (
          <button
            type="button"
            style={styles.addBtn}
            title="Create channel"
            onClick={() => setShowCreateModal(true)}
          >
            +
          </button>
        )}
      </div>
      <div style={styles.list}>
        {loading ? (
          <div style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--hush-text-muted)' }}>…</div>
        ) : error ? (
          <div style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--hush-danger)' }}>{error}</div>
        ) : (
          groups.map((group) => (
            <CategorySection
              key={group.key ?? 'uncategorized'}
              group={group}
              activeChannelId={activeChannelId}
              onChannelSelect={onChannelSelect}
              voiceParticipantCounts={voiceParticipantCounts}
            />
          ))
        )}
      </div>
      {showCreateModal && (
        <CreateChannelModal
          getToken={getToken}
          serverId={serverId}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
