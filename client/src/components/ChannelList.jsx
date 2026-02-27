import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getServer, createChannel, createInvite, moveChannel, deleteChannel } from '../lib/api';
import modalStyles from './modalStyles';

const CHANNEL_TYPE_TEXT = 'text';
const CHANNEL_TYPE_VOICE = 'voice';
const CHANNEL_TYPE_CATEGORY = 'category';

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
    padding: '14px 16px 8px',
    fontSize: '0.72rem',
    fontWeight: 700,
    color: 'var(--hush-text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    cursor: 'pointer',
    userSelect: 'none',
    background: 'var(--hush-elevated)',
  },
  channelRow: (isActive) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 16px',
    cursor: 'pointer',
    background: isActive ? 'var(--hush-elevated)' : 'transparent',
    boxShadow: isActive ? 'inset 2px 0 0 var(--hush-amber)' : 'none',
    color: isActive ? 'var(--hush-text)' : 'var(--hush-text-secondary)',
    fontSize: '0.85rem',
    transition: 'all var(--duration-fast) var(--ease-out)',
  }),
  channelRowHover: {
    background: 'var(--hush-elevated)',
    color: 'var(--hush-text)',
  },
  channelIcon: {
    width: 20,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
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
};

function groupChannelsByParent(channels) {
  const byParent = new Map();
  byParent.set(null, []);
  const channelById = new Map();
  const sortFn = (a, b) => a.position - b.position || (a.name || '').localeCompare(b.name || '');

  channels.forEach((ch) => {
    channelById.set(ch.id, ch);
    if (ch.type === CHANNEL_TYPE_CATEGORY) return; // categories are headers, not rows
    const key = ch.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(ch);
  });

  // Ensure every category-type channel has a group entry (even if empty)
  channels.filter((ch) => ch.type === CHANNEL_TYPE_CATEGORY).forEach((ch) => {
    if (!byParent.has(ch.id)) byParent.set(ch.id, []);
  });

  const uncategorized = (byParent.get(null) || []).sort(sortFn);
  byParent.forEach((list, key) => { if (key !== null) list.sort(sortFn); });

  const ordered = [];
  if (uncategorized.length > 0) ordered.push({ key: null, label: 'Uncategorized', channels: uncategorized });

  // Sort categories by position, then add their children
  const categories = channels.filter((ch) => ch.type === CHANNEL_TYPE_CATEGORY).sort(sortFn);
  categories.forEach((cat) => {
    ordered.push({ key: cat.id, label: cat.name ?? 'Category', channels: byParent.get(cat.id) || [] });
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
        <div style={modalStyles.title}>Create channel</div>
        <form style={modalStyles.form} onSubmit={handleSubmit}>
          <div>
            <label htmlFor="channel-name" style={modalStyles.fieldLabel}>Name</label>
            <input
              id="channel-name"
              name="channel-name"
              className="input"
              type="text"
              placeholder="general"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoComplete="off"
            />
          </div>
          <div>
            <label style={modalStyles.fieldLabel} htmlFor="create-channel-type">Type</label>
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
              <label style={modalStyles.fieldLabel} htmlFor="create-channel-voice-mode">Voice mode</label>
              <select
                id="create-channel-voice-mode"
                className="input"
                value={voiceMode}
                onChange={(e) => setVoiceMode(e.target.value)}
              >
                <option value="quality">Quality</option>
                <option value="low-latency">Low Latency</option>
              </select>
            </div>
          )}
          {error && <div style={modalStyles.error}>{error}</div>}
          <div style={modalStyles.actions}>
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

function CreateCategoryModal({ getToken, serverId, onClose, onCreated }) {
  const [name, setName] = useState('');
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
      const category = await createChannel(token, serverId, { name: trimmed, type: CHANNEL_TYPE_CATEGORY });
      onCreated(category);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create category');
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
        <div style={modalStyles.title}>Create category</div>
        <form style={modalStyles.form} onSubmit={handleSubmit}>
          <div>
            <label htmlFor="category-name" style={modalStyles.fieldLabel}>Name</label>
            <input
              id="category-name"
              name="category-name"
              className="input"
              type="text"
              placeholder="Gaming"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoComplete="off"
            />
          </div>
          {error && <div style={modalStyles.error}>{error}</div>}
          <div style={modalStyles.actions}>
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

function InviteModal({ getToken, serverId, onClose }) {
  const [isOpen, setIsOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getToken();
      if (!token) { setError('Not authenticated'); setLoading(false); return; }
      try {
        const inv = await createInvite(token, serverId);
        if (!cancelled) { setInviteCode(inv.code); setLoading(false); }
      } catch (err) {
        if (!cancelled) { setError(err.message || 'Failed to create invite'); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [getToken, serverId]);

  const inviteLink = inviteCode ? `${window.location.origin}/invite/${inviteCode}` : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard may not be available */ }
  };

  return (
    <div className={`modal-backdrop ${isOpen ? 'modal-backdrop-open' : ''}`} onClick={onClose}>
      <div className={`modal-content ${isOpen ? 'modal-content-open' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.title}>Invite people</div>
        {loading ? (
          <div style={{ color: 'var(--hush-text-secondary)', fontSize: '0.85rem', padding: '16px 0' }}>
            Generating invite link...
          </div>
        ) : error ? (
          <div style={modalStyles.error}>{error}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                className="input"
                readOnly
                value={inviteLink}
                style={{ flex: 1, fontSize: '0.85rem' }}
                onClick={(e) => e.target.select()}
              />
              <button className="btn btn-primary" onClick={handleCopy} style={{ whiteSpace: 'nowrap' }}>
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--hush-text-muted)' }}>
              This invite expires in 7 days and can be used 50 times.
            </div>
          </div>
        )}
        <div style={{ ...modalStyles.actions, marginTop: '16px' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function CategorySection({ group, activeChannelId, onChannelSelect, voiceParticipantCounts, isAdmin, onDeleteCategory }) {
  const [collapsed, setCollapsed] = useState(false);
  const channelIds = useMemo(() => group.channels.map((ch) => ch.id), [group.channels]);
  const isCategory = group.key !== null;

  // Named categories are sortable (and implicitly droppable via useSortable).
  // The uncategorized bucket uses a plain useDroppable since it has no sort identity.
  const {
    attributes: sortableAttributes,
    listeners: sortableListeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
    isOver: isSortableOver,
  } = useSortable({ id: group.key ?? '__never__', disabled: !isCategory || !isAdmin });

  const { setNodeRef: setDropRef, isOver: isDropOver } = useDroppable({
    id: 'uncategorized',
    disabled: isCategory,
  });

  const setNodeRef = isCategory ? setSortableRef : setDropRef;
  const isOver = isCategory ? isSortableOver : isDropOver;

  const channelRows = (
    <SortableContext items={channelIds} strategy={verticalListSortingStrategy}>
      {group.channels.map((ch) => {
        const isActive = activeChannelId === ch.id;
        const isVoice = ch.type === CHANNEL_TYPE_VOICE;
        const rawCount = voiceParticipantCounts?.get(ch.id) ?? 0;
        return (
          <SortableChannelRow
            key={ch.id}
            channel={ch}
            isActive={isActive}
            onSelect={() => onChannelSelect(ch)}
            participantCount={isVoice && rawCount > 0 ? rawCount : null}
            isAdmin={isAdmin}
          />
        );
      })}
    </SortableContext>
  );

  const sectionStyle = {
    willChange: 'transform', // pre-promote GPU layer — prevents font antialiasing shift on drag start
    ...(isOver ? { background: 'var(--hush-hover)' } : undefined),
    ...(isCategory ? {
      transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      transition,
      opacity: isDragging ? 0.5 : 1,
    } : undefined),
  };

  if (!isCategory) {
    return (
      <div ref={setNodeRef} style={sectionStyle}>
        {channelRows}
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={sectionStyle}>
      <div style={{ ...styles.categoryHeader, justifyContent: 'space-between' }}>
        {isAdmin && (
          <span
            {...sortableAttributes}
            {...sortableListeners}
            title="Drag to reorder"
            style={{ cursor: 'grab', width: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--hush-text-muted)', opacity: 0.4, transition: 'opacity var(--duration-fast) var(--ease-out)' }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4'; }}
            aria-hidden
          >
            <svg width="10" height="10" viewBox="0 0 10 14" fill="currentColor">
              <circle cx="2" cy="2" r="1.5" /><circle cx="8" cy="2" r="1.5" />
              <circle cx="2" cy="7" r="1.5" /><circle cx="8" cy="7" r="1.5" />
              <circle cx="2" cy="12" r="1.5" /><circle cx="8" cy="12" r="1.5" />
            </svg>
          </span>
        )}
        <button
          type="button"
          style={{ ...styles.categoryHeader, padding: 0, flex: 1, background: 'none', border: 'none', fontFamily: 'var(--font-sans)' }}
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
        {isAdmin && (
          <button
            type="button"
            title="Delete category"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', color: 'var(--hush-text-muted)', display: 'flex', alignItems: 'center', opacity: 0 }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; }}
            onClick={() => onDeleteCategory?.(group.key)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
          </button>
        )}
      </div>
      {!collapsed && channelRows}
    </div>
  );
}

function ChannelRowContent({ channel, isActive, onSelect, participantCount, dragStyle, dragRef, dragListeners, isDragging }) {
  const [hover, setHover] = useState(false);
  const isVoice = channel.type === CHANNEL_TYPE_VOICE;

  return (
    <div
      ref={dragRef}
      role="button"
      tabIndex={0}
      style={{
        ...styles.channelRow(isActive),
        ...(hover && !isActive ? styles.channelRowHover : {}),
        ...dragStyle,
        opacity: isDragging ? 0.4 : 1,
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
      {...dragListeners}
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
      {isVoice && participantCount != null && (
        <span style={styles.voiceCount}>{participantCount}</span>
      )}
    </div>
  );
}

function SortableChannelRow({ channel, isActive, onSelect, participantCount, isAdmin }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: channel.id, disabled: !isAdmin });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <ChannelRowContent
      channel={channel}
      isActive={isActive}
      onSelect={onSelect}
      participantCount={participantCount}
      dragStyle={style}
      dragRef={setNodeRef}
      dragListeners={isAdmin ? { ...attributes, ...listeners } : {}}
      isDragging={isDragging}
    />
  );
}

function ChannelRow({ channel, isActive, onSelect, participantCount }) {
  return (
    <ChannelRowContent
      channel={channel}
      isActive={isActive}
      onSelect={onSelect}
      participantCount={participantCount}
      dragStyle={{}}
      isDragging={false}
    />
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
  const [showCreateCategoryModal, setShowCreateCategoryModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [localChannels, setLocalChannels] = useState(channels ?? []);
  const isAdmin = myRole === 'admin';

  // Keep local list in sync with server-sourced prop (after API refresh or initial load)
  useEffect(() => { setLocalChannels(channels ?? []); }, [channels]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDeleteCategory = useCallback(async (categoryId) => {
    const token = getToken();
    if (!token) return;
    try {
      await deleteChannel(token, categoryId);
      const data = await getServer(token, serverId);
      onChannelsUpdated?.(data);
    } catch {
      // Delete failed — server state unchanged
    }
  }, [getToken, serverId, onChannelsUpdated]);

  const handleCreated = useCallback(async () => {
    const token = getToken();
    if (!serverId || !token) return;
    try {
      const data = await getServer(token, serverId);
      onChannelsUpdated?.(data);
    } catch {
      // Parent already holds channel state; silent refresh failure is acceptable
    }
  }, [serverId, getToken, onChannelsUpdated]);

  const groups = groupChannelsByParent(localChannels);
  const channelMap = useMemo(() => {
    const m = new Map();
    localChannels.forEach((ch) => m.set(ch.id, ch));
    return m;
  }, [localChannels]);

  const handleDragStart = useCallback((event) => {
    setActiveId(event.active.id);
  }, []);

  const categoryIdSet = useMemo(() => {
    const s = new Set();
    localChannels.forEach((ch) => { if (ch.type === CHANNEL_TYPE_CATEGORY) s.add(ch.id); });
    return s;
  }, [localChannels]);

  const sortedCategoryIds = useMemo(
    () => groups.filter((g) => g.key !== null).map((g) => g.key),
    [groups],
  );

  // Custom collision detection: pointerWithin first (best for nested containers),
  // fallback to rectIntersection when pointer is between items.
  const collisionDetection = useCallback((args) => {
    const hits = pointerWithin(args);
    return hits.length > 0 ? hits : rectIntersection(args);
  }, []);

  const handleDragEnd = useCallback(async (event) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const token = getToken();
    if (!token) return;

    // Category reordering: both active and over are categories
    if (categoryIdSet.has(active.id) && categoryIdSet.has(over.id)) {
      const sortFn = (a, b) => a.position - b.position || (a.name ?? '').localeCompare(b.name ?? '');
      const sortedCategories = localChannels
        .filter((ch) => ch.type === CHANNEL_TYPE_CATEGORY)
        .sort(sortFn);
      const activeIdx = sortedCategories.findIndex((c) => c.id === active.id);
      const overIdx = sortedCategories.findIndex((c) => c.id === over.id);
      if (activeIdx === -1 || overIdx === -1) return;

      // Optimistic update: reorder categories immediately
      const reordered = arrayMove(sortedCategories, activeIdx, overIdx);
      const posMap = new Map(reordered.map((c, i) => [c.id, i]));
      const snapshot = localChannels;
      setLocalChannels((prev) => prev.map((ch) => posMap.has(ch.id) ? { ...ch, position: posMap.get(ch.id) } : ch));

      try {
        await moveChannel(token, active.id, { parentId: null, position: overIdx });
        const data = await getServer(token, serverId);
        onChannelsUpdated?.(data);
      } catch {
        setLocalChannels(snapshot); // revert on error
      }
      return;
    }

    // Channel reordering / re-categorizing
    let targetParentId = null;
    let targetPosition = 0;

    if (over.id === 'uncategorized') {
      targetParentId = null;
      targetPosition = groups.find((g) => g.key === null)?.channels.length ?? 0;
    } else if (categoryIdSet.has(over.id)) {
      targetParentId = over.id;
      targetPosition = groups.find((g) => g.key === over.id)?.channels.length ?? 0;
    } else {
      for (const group of groups) {
        const idx = group.channels.findIndex((ch) => ch.id === over.id);
        if (idx !== -1) {
          targetParentId = group.key;
          targetPosition = idx;
          break;
        }
      }
    }

    // Optimistic update: move channel immediately
    const snapshot = localChannels;
    setLocalChannels((prev) => prev.map((ch) =>
      ch.id === active.id ? { ...ch, parentId: targetParentId, position: targetPosition } : ch,
    ));

    try {
      await moveChannel(token, active.id, { parentId: targetParentId, position: targetPosition });
      const data = await getServer(token, serverId);
      onChannelsUpdated?.(data);
    } catch {
      setLocalChannels(snapshot); // revert on error
    }
  }, [getToken, serverId, groups, localChannels, categoryIdSet, onChannelsUpdated]);

  const draggedChannel = activeId && !categoryIdSet.has(activeId) ? channelMap.get(activeId) : null;

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.serverName}>{serverName ?? 'Server'}</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            type="button"
            style={styles.addBtn}
            title="Invite people"
            onClick={() => setShowInviteModal(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
          </button>
          {isAdmin && (
            <>
              <button
                type="button"
                style={styles.addBtn}
                title="Create category"
                onClick={() => setShowCreateCategoryModal(true)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </button>
              <button
                type="button"
                style={styles.addBtn}
                title="Create channel"
                onClick={() => setShowCreateModal(true)}
              >
                +
              </button>
            </>
          )}
        </div>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div style={styles.list}>
          <SortableContext items={sortedCategoryIds} strategy={verticalListSortingStrategy}>
            {groups.map((group) => (
              <CategorySection
                key={group.key ?? 'uncategorized'}
                group={group}
                activeChannelId={activeChannelId}
                onChannelSelect={onChannelSelect}
                voiceParticipantCounts={voiceParticipantCounts}
                isAdmin={isAdmin}
                onDeleteCategory={handleDeleteCategory}
              />
            ))}
          </SortableContext>
        </div>
        <DragOverlay>
          {draggedChannel ? (
            <ChannelRow
              channel={draggedChannel}
              isActive={false}
              onSelect={() => {}}
              participantCount={
                draggedChannel.type === CHANNEL_TYPE_VOICE
                  ? (voiceParticipantCounts?.get(draggedChannel.id) ?? 0)
                  : null
              }
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      {showCreateModal && (
        <CreateChannelModal
          getToken={getToken}
          serverId={serverId}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}
      {showCreateCategoryModal && (
        <CreateCategoryModal
          getToken={getToken}
          serverId={serverId}
          onClose={() => setShowCreateCategoryModal(false)}
          onCreated={handleCreated}
        />
      )}
      {showInviteModal && (
        <InviteModal
          getToken={getToken}
          serverId={serverId}
          onClose={() => setShowInviteModal(false)}
        />
      )}
    </div>
  );
}
