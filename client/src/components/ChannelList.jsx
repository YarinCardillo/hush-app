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
  closestCenter,
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
    boxShadow: isActive ? 'inset 2px 0 0 var(--hush-amber)' : 'none',
    color: isActive ? 'var(--hush-text)' : 'var(--hush-text-secondary)',
    fontSize: '0.85rem',
    transition: 'all var(--duration-fast) var(--ease-out)',
  }),
  channelRowHover: {
    background: 'color-mix(in srgb, var(--hush-elevated) 55%, transparent)',
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

  // Always include the uncategorized bucket even when empty — it must be rendered as a
  // persistent useDroppable target so channels can be dragged out of categories.
  const ordered = [{ key: null, label: null, channels: uncategorized }];

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
  const [hovered, setHovered] = useState(false);
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
      // opacity:0 hides the original; the DragOverlay provides the drag visual.
      opacity: isDragging ? 0 : 1,
    } : undefined),
  };

  if (!isCategory) {
    // Uncategorized bucket: no header, always rendered so the droppable is always
    // registered. Shows a visual drop zone when hovered while empty.
    const isEmpty = group.channels.length === 0;
    return (
      <div
        ref={setNodeRef}
        style={isOver && isEmpty ? {
          minHeight: '36px',
          margin: '0 8px 4px',
          borderRadius: '4px',
          background: 'color-mix(in srgb, var(--hush-hover) 60%, transparent)',
          transition: 'background var(--duration-fast) var(--ease-out)',
        } : undefined}
      >
        {channelRows}
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={sectionStyle}>
      <div
        style={{
          ...styles.categoryHeader,
          justifyContent: 'space-between',
          color: hovered ? 'var(--hush-text)' : 'var(--hush-text-secondary)',
          transition: 'color var(--duration-fast) var(--ease-out)',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {isAdmin && (
          <span
            {...sortableAttributes}
            {...sortableListeners}
            title="Drag to reorder"
            style={{ cursor: 'grab', width: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'inherit', opacity: 0.4, transition: 'opacity var(--duration-fast) var(--ease-out)' }}
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
          style={{ ...styles.categoryHeader, padding: 0, flex: 1, background: 'none', border: 'none', fontFamily: 'var(--font-sans)', color: 'inherit' }}
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
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', color: 'inherit', display: 'flex', alignItems: 'center', opacity: 0 }}
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

// Drop zone for removing a channel from all categories (parentId → null).
// Always rendered with a fixed height so the layout is stable before and after
// a channel drag starts — conditional rendering would cause layout shift, which
// offsets the DragOverlay from the pointer. Toggle visibility via CSS only.
function UncategorizeZone({ position, visible }) {
  const id = position === 'top' ? 'uncategorize-top' : 'uncategorize-bottom';
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !visible });

  return (
    <div
      ref={setNodeRef}
      style={{
        // Fixed height/margin so the layout never shifts when visible toggles
        height: '30px',
        margin: '2px 8px',
        boxSizing: 'border-box',
        borderRadius: '4px',
        padding: '0 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '0.72rem',
        userSelect: 'none',
        cursor: 'default',
        overflow: 'hidden',
        // Visual state controlled via CSS, not conditional rendering
        opacity: visible ? (isOver ? 1 : 0.35) : 0,
        pointerEvents: visible ? 'auto' : 'none',
        color: visible && isOver ? 'var(--hush-amber)' : 'var(--hush-text-muted)',
        background: visible && isOver ? 'color-mix(in srgb, var(--hush-amber) 15%, transparent)' : 'transparent',
        border: `1px ${visible ? 'dashed' : 'solid'} ${
          visible && isOver ? 'var(--hush-amber)' :
          visible ? 'color-mix(in srgb, var(--hush-text-muted) 50%, transparent)' :
          'transparent'
        }`,
        transition: 'opacity var(--duration-fast) var(--ease-out), background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        <line x1="9" y1="12" x2="15" y2="12" />
      </svg>
      No category
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

  // Split category-drag from channel-drag paths so each only considers its own
  // valid target types.
  //
  // IMPORTANT: uses args.active.id (dnd-kit's synchronous active ID) rather than
  // the activeId React state. onDragStart calls setActiveId which is asynchronous —
  // the state update may not be reflected in the first few collision-detection calls,
  // leaving activeId=null and causing the category path to be skipped entirely,
  // which makes category reordering unpredictable.
  const collisionDetection = useCallback((args) => {
    const isDraggingCategory = categoryIdSet.has(args.active.id);

    if (isDraggingCategory) {
      // Only other category IDs are valid targets.
      // closestCenter covers the "pointer below last category rect" case where
      // pointerWithin returns nothing.
      const catHits = pointerWithin(args).filter((h) => categoryIdSet.has(h.id));
      if (catHits.length > 0) return catHits;
      return closestCenter(args).filter((h) => categoryIdSet.has(h.id));
    }

    // Channel drag: prefer the innermost channel row over its category container.
    // CategorySection registers its droppable before inner channel rows, so
    // pointerWithin returns [categoryId, ...] first — filter it out so the specific
    // channel row wins. Keep category hits as fallback for empty-category drops.
    const hits = pointerWithin(args);
    if (hits.length === 0) {
      const rects = rectIntersection(args);
      return rects.length > 0 ? rects : closestCenter(args);
    }
    const channelHits = hits.filter((h) => !categoryIdSet.has(h.id));
    return channelHits.length > 0 ? channelHits : hits;
  }, [categoryIdSet]);

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

    if (over.id === 'uncategorized' || over.id === 'uncategorize-top' || over.id === 'uncategorize-bottom') {
      targetParentId = null;
      const uncatLen = groups.find((g) => g.key === null)?.channels.length ?? 0;
      targetPosition = over.id === 'uncategorize-top' ? 0 : uncatLen;
    } else if (categoryIdSet.has(over.id)) {
      // Dropped directly on a category header → insert at the beginning of that category.
      targetParentId = over.id;
      targetPosition = 0;
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

    // Optimistic update: renumber all channels in every affected group so positions
    // stay contiguous and collision-free (mirroring the server's shift logic).
    const positionUpdates = new Map(); // channelId → { parentId, position }
    const sourceGroup = groups.find((g) => g.channels.some((ch) => ch.id === active.id));
    const sourceGroupKey = sourceGroup?.key ?? null;

    if (sourceGroupKey === targetParentId) {
      // Within-group reorder: use arrayMove to get the new ordering, then renumber.
      const srcIdx = sourceGroup.channels.findIndex((ch) => ch.id === active.id);
      arrayMove(sourceGroup.channels, srcIdx, targetPosition).forEach((ch, i) => {
        positionUpdates.set(ch.id, { parentId: sourceGroupKey, position: i });
      });
    } else {
      // Cross-group move: remove from source, insert at target, renumber both.
      const newSource = (sourceGroup?.channels ?? []).filter((ch) => ch.id !== active.id);
      newSource.forEach((ch, i) => positionUpdates.set(ch.id, { parentId: sourceGroupKey, position: i }));

      const targetGroup = groups.find((g) => g.key === targetParentId);
      const newTarget = [...(targetGroup?.channels ?? [])];
      newTarget.splice(targetPosition, 0, channelMap.get(active.id));
      newTarget.forEach((ch, i) => positionUpdates.set(ch.id, { parentId: targetParentId, position: i }));
    }

    const snapshot = localChannels;
    setLocalChannels((prev) => prev.map((ch) => {
      const upd = positionUpdates.get(ch.id);
      return upd ? { ...ch, ...upd } : ch;
    }));

    try {
      await moveChannel(token, active.id, { parentId: targetParentId, position: targetPosition });
      const data = await getServer(token, serverId);
      onChannelsUpdated?.(data);
    } catch {
      setLocalChannels(snapshot); // revert on error
    }
  }, [getToken, serverId, groups, localChannels, categoryIdSet, onChannelsUpdated]);

  const draggedChannel = activeId && !categoryIdSet.has(activeId) ? channelMap.get(activeId) : null;
  const draggedCategoryGroup = activeId && categoryIdSet.has(activeId)
    ? groups.find((g) => g.key === activeId)
    : null;

  return (
    <div style={{ ...styles.panel, ...(activeId ? { userSelect: 'none' } : undefined) }}>
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
          <UncategorizeZone position="top" visible={activeId !== null && !categoryIdSet.has(activeId)} />
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
          <UncategorizeZone position="bottom" visible={activeId !== null && !categoryIdSet.has(activeId)} />
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
          ) : draggedCategoryGroup ? (
            <div style={{
              ...styles.categoryHeader,
              background: 'var(--hush-elevated)',
              borderRadius: '4px',
              color: 'var(--hush-text)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
              cursor: 'grabbing',
            }}>
              {draggedCategoryGroup.label}
            </div>
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
