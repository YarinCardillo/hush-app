import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { getServer, createChannel, createInvite, moveChannel, deleteChannel, leaveServer } from '../lib/api';
import modalStyles from './modalStyles';
import ConfirmModal from './ConfirmModal';
import ServerSettingsModal from './ServerSettingsModal';

const CHANNEL_TYPE_TEXT = 'text';
const CHANNEL_TYPE_VOICE = 'voice';
const CHANNEL_TYPE_CATEGORY = 'category';

function loadCollapsedMap(serverId) {
  try {
    const raw = localStorage.getItem(`hush:categories-collapsed:${serverId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCollapsedMap(serverId, map) {
  try {
    localStorage.setItem(`hush:categories-collapsed:${serverId}`, JSON.stringify(map));
  } catch {
    // localStorage not available — silently ignore
  }
}

// Sentinel droppable ID for the uncategorized bucket. Using useSortable with this
// ID (disabled, so non-draggable) lets the null group participate in pointerWithin
// detection identically to named categories — its container rect gets registered,
// the channel drag filter strips it (it's in categoryIdSet), and the inner channel
// rows win, enabling correct SortableContext animation for uncategorized channels.
const UNCATEGORIZED_SENTINEL = '__uncategorized__';

const styles = {
  panel: {
    width: '100%',
    minWidth: 0,
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
    padding: '4px',
    width: '24px',
    height: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    color: 'var(--hush-text-muted)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  serverNameBtn: {
    background: 'none',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
    padding: '0',
    minWidth: 0,
    flex: 1,
    fontFamily: 'var(--font-sans)',
  },
  serverMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    background: 'var(--hush-elevated)',
    border: '1px solid var(--hush-border)',
    borderRadius: 'var(--radius-md)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    zIndex: 100,
    padding: '4px',
    marginTop: '4px',
  },
  serverMenuItem: (danger) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    padding: '8px 10px',
    background: 'none',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    color: danger ? 'var(--hush-danger)' : 'var(--hush-text-secondary)',
    fontSize: '0.85rem',
    fontFamily: 'var(--font-sans)',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out)',
  }),
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

  // Sort categories by position, then add their children
  const categories = channels.filter((ch) => ch.type === CHANNEL_TYPE_CATEGORY).sort(sortFn);
  const ordered = [];
  categories.forEach((cat) => {
    ordered.push({ key: cat.id, label: cat.name ?? 'Category', channels: byParent.get(cat.id) || [] });
  });

  // Uncategorized bucket always at the bottom — persistent droppable target so
  // channels can be dragged out of categories.
  ordered.push({ key: null, label: null, channels: uncategorized });

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

function CategorySection({ group, collapsed = false, onToggleCollapsed, activeChannelId, onChannelSelect, voiceParticipantCounts, isAdmin, onDeleteCategory, onDeleteChannel }) {
  const [hovered, setHovered] = useState(false);
  const channelIds = useMemo(() => group.channels.map((ch) => ch.id), [group.channels]);
  const isCategory = group.key !== null;

  // Named categories are sortable; the null group uses the sentinel ID with
  // disabled=true so it's never draggable but its container rect is registered as
  // a droppable — matching the named-category pattern exactly.
  const {
    attributes: sortableAttributes,
    listeners: sortableListeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: group.key ?? UNCATEGORIZED_SENTINEL, disabled: !isCategory || !isAdmin });

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
            onDelete={() => onDeleteChannel?.(ch)}
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
    // Uncategorized bucket: no visible header, renders exactly like a named category
    // section internally. The ref registers the sentinel droppable rect so
    // pointerWithin returns [UNCATEGORIZED_SENTINEL, channelId] — the filter in
    // collisionDetection strips the sentinel, leaving the specific channel row.
    return <div ref={setNodeRef}>{channelRows}</div>;
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
          onClick={() => onToggleCollapsed?.()}
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
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px',
              color: 'inherit', display: 'flex', alignItems: 'center', opacity: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; }}
            onClick={() => onDeleteCategory?.(group.key, group.label)}
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

function ChannelRowContent({ channel, isActive, onSelect, participantCount, dragStyle, dragRef, dragListeners, isDragging, isAdmin, onDelete }) {
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
      {isAdmin && (
        <button
          type="button"
          title="Delete channel"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px',
            color: 'var(--hush-danger)', display: 'flex', alignItems: 'center', flexShrink: 0, opacity: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; }}
          onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
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
  );
}

function SortableChannelRow({ channel, isActive, onSelect, participantCount, isAdmin, onDelete }) {
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
      isAdmin={isAdmin}
      onDelete={onDelete}
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
  onLeaveServer,
  onDeleteServer,
}) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreateCategoryModal, setShowCreateCategoryModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showServerMenu, setShowServerMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, name, isCategory }
  const [activeId, setActiveId] = useState(null);
  const [localChannels, setLocalChannels] = useState(channels ?? []);
  const isAdmin = myRole === 'admin';
  const serverMenuRef = useRef(null);

  const [collapsedMap, setCollapsedMap] = useState(() => loadCollapsedMap(serverId));

  useEffect(() => {
    setCollapsedMap(loadCollapsedMap(serverId));
  }, [serverId]);

  const handleToggleCollapsed = useCallback((categoryKey) => {
    setCollapsedMap((prev) => {
      const next = { ...prev, [categoryKey]: !prev[categoryKey] };
      saveCollapsedMap(serverId, next);
      return next;
    });
  }, [serverId]);

  // Keep local list in sync with server-sourced prop (after API refresh or initial load)
  useEffect(() => { setLocalChannels(channels ?? []); }, [channels]);

  // Close server dropdown on outside click
  useEffect(() => {
    if (!showServerMenu) return;
    const handleClick = (e) => {
      if (serverMenuRef.current && !serverMenuRef.current.contains(e.target)) {
        setShowServerMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showServerMenu]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleLeaveConfirmed = useCallback(async () => {
    setConfirmLeave(false);
    const token = getToken();
    if (token) {
      try {
        await leaveServer(token, serverId);
        onLeaveServer?.();
      } catch {
        // Leave failed — stay on server
      }
    }
  }, [getToken, serverId, onLeaveServer]);

  const handleDeleteConfirmed = useCallback(async () => {
    if (!confirmDelete) return;
    const token = getToken();
    if (token) {
      try {
        await deleteChannel(token, confirmDelete.id);
        const data = await getServer(token, serverId);
        onChannelsUpdated?.(data);
      } catch {
        // Delete failed — server state unchanged
      }
    }
    setConfirmDelete(null);
  }, [confirmDelete, getToken, serverId, onChannelsUpdated]);

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
    // Include sentinel so the null group's container rect is filtered out during
    // channel drag (same mechanism as named category containers).
    s.add(UNCATEGORIZED_SENTINEL);
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
      // Only real category IDs are valid targets — exclude the sentinel so dragging
      // a category over the uncategorized section falls back to the nearest real
      // category via closestCenter rather than snapping to the sentinel.
      const isRealCat = (h) => categoryIdSet.has(h.id) && h.id !== UNCATEGORIZED_SENTINEL;
      const catHits = pointerWithin(args).filter(isRealCat);
      if (catHits.length > 0) return catHits;
      return closestCenter(args).filter(isRealCat);
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
    // Filter out category container IDs and the UncategorizeZone so the specific
    // channel row underneath wins. If only container hits remain (e.g. empty category
    // header), fall back to the full hit list so drop-into-empty-category still works.
    const channelHits = hits.filter(
      (h) => !categoryIdSet.has(h.id) && h.id !== 'uncategorize-bottom',
    );
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

    if (over.id === 'uncategorize-bottom') {
      targetParentId = null;
      targetPosition = groups.find((g) => g.key === null)?.channels.length ?? 0;
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
      <div style={{ ...styles.header, position: 'relative' }} ref={serverMenuRef}>
        <button
          type="button"
          style={styles.serverNameBtn}
          onClick={() => setShowServerMenu((v) => !v)}
          title="Server menu"
        >
          <span style={styles.serverName}>{serverName ?? 'Server'}</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            style={{
              flexShrink: 0,
              color: 'var(--hush-text-muted)',
              transform: showServerMenu ? 'rotate(180deg)' : 'none',
              transition: 'transform var(--duration-fast) var(--ease-out)',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </>
          )}
        </div>

        {showServerMenu && (
          <div style={styles.serverMenu}>
            <button
              type="button"
              style={styles.serverMenuItem(false)}
              onClick={() => { setShowServerMenu(false); setShowInviteModal(true); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hush-hover)'; e.currentTarget.style.color = 'var(--hush-text)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--hush-text-secondary)'; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
              Invite People
            </button>
            <button
              type="button"
              style={styles.serverMenuItem(false)}
              onClick={() => { setShowServerMenu(false); setShowSettings(true); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hush-hover)'; e.currentTarget.style.color = 'var(--hush-text)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--hush-text-secondary)'; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Server Settings
            </button>
            <div style={{ height: '1px', background: 'var(--hush-border)', margin: '4px 0' }} />
            <button
              type="button"
              style={styles.serverMenuItem(true)}
              onClick={() => { setShowServerMenu(false); setConfirmLeave(true); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--hush-danger) 12%, transparent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Leave Server
            </button>
          </div>
        )}
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
                collapsed={group.key !== null ? (collapsedMap[group.key] ?? false) : undefined}
                onToggleCollapsed={group.key !== null ? () => handleToggleCollapsed(group.key) : undefined}
                activeChannelId={activeChannelId}
                onChannelSelect={onChannelSelect}
                voiceParticipantCounts={voiceParticipantCounts}
                isAdmin={isAdmin}
                onDeleteCategory={(id, name) => setConfirmDelete({ id, name, isCategory: true })}
                onDeleteChannel={(ch) => setConfirmDelete({ id: ch.id, name: ch.name, isCategory: false })}
              />
            ))}
          </SortableContext>
          <UncategorizeZone
            position="bottom"
            visible={activeId !== null && !categoryIdSet.has(activeId) && channelMap.get(activeId)?.parentId != null}
          />
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
      {confirmDelete && (
        <ConfirmModal
          title={confirmDelete.isCategory ? 'Delete category' : 'Delete channel'}
          message={`Are you sure you want to delete "${confirmDelete.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmLeave && (
        <ConfirmModal
          title="Leave server"
          message={`Leave "${serverName}"? You'll need an invite to rejoin.`}
          confirmLabel="Leave"
          onConfirm={handleLeaveConfirmed}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
      {showSettings && (
        <ServerSettingsModal
          getToken={getToken}
          serverId={serverId}
          serverName={serverName}
          isAdmin={isAdmin}
          onClose={() => setShowSettings(false)}
          onLeaveServer={onLeaveServer}
          onDeleteServer={onDeleteServer}
        />
      )}
    </div>
  );
}
