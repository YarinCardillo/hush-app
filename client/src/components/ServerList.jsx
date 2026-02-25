import { useState, useEffect, useCallback } from 'react';
import { listServers, createServer, joinServer, getInviteByCode } from '../lib/api';
import modalStyles from './modalStyles';

const SERVER_ICON_SIZE = 48;
const STRIP_WIDTH = 72;

const styles = {
  strip: {
    width: STRIP_WIDTH,
    minWidth: STRIP_WIDTH,
    background: 'var(--hush-surface)',
    borderRight: '1px solid transparent',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px 0',
    gap: '8px',
    overflowY: 'auto',
  },
  serverBtn: (isActive) => ({
    width: SERVER_ICON_SIZE,
    height: SERVER_ICON_SIZE,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: isActive ? 'var(--hush-amber)' : 'var(--hush-elevated)',
    color: isActive ? 'var(--hush-on-amber)' : 'var(--hush-text)',
    fontSize: '1rem',
    fontWeight: 500,
    fontFamily: 'var(--font-sans)',
    transition: 'all var(--duration-fast) var(--ease-out)',
    overflow: 'hidden',
    flexShrink: 0,
  }),
  serverBtnHover: {
    background: 'var(--hush-amber)',
    color: 'var(--hush-on-amber)',
  },
  actionBtn: {
    width: SERVER_ICON_SIZE,
    height: SERVER_ICON_SIZE,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--hush-elevated)',
    color: 'var(--hush-live)',
    transition: 'all var(--duration-fast) var(--ease-out)',
    flexShrink: 0,
  },
  empty: {
    padding: '16px',
    textAlign: 'center',
    fontSize: '0.85rem',
    color: 'var(--hush-text-muted)',
  },
};

function getInitials(name) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  }
  return name.slice(0, 2).toUpperCase();
}

function ServerButton({ server, isActive, onSelect }) {
  const [hover, setHover] = useState(false);

  return (
    <button
      type="button"
      style={{
        ...styles.serverBtn(isActive),
        ...(hover && !isActive ? styles.serverBtnHover : {}),
      }}
      title={server.name}
      aria-label={server.name}
      onClick={() => onSelect?.(server)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {server.iconUrl ? (
        <img
          src={server.iconUrl}
          alt=""
          width={SERVER_ICON_SIZE}
          height={SERVER_ICON_SIZE}
          style={{ objectFit: 'cover', width: '100%', height: '100%' }}
        />
      ) : (
        getInitials(server.name)
      )}
    </button>
  );
}

function CreateServerModal({ getToken, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [iconUrl, setIconUrl] = useState('');
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
      const server = await createServer(token, {
        name: trimmed,
        iconUrl: iconUrl.trim() || undefined,
      });
      onCreated(server);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create server');
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
        <div style={modalStyles.title}>Create server</div>
        <form style={modalStyles.form} onSubmit={handleSubmit}>
          <div>
            <label style={modalStyles.fieldLabel}>Server name</label>
            <input
              className="input"
              type="text"
              placeholder="My server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div>
            <label style={modalStyles.fieldLabel}>Icon URL (optional)</label>
            <input
              className="input"
              type="url"
              placeholder="https://..."
              value={iconUrl}
              onChange={(e) => setIconUrl(e.target.value)}
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

function JoinServerModal({ getToken, onClose, onJoined }) {
  const [inviteInput, setInviteInput] = useState('');
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
    const raw = inviteInput.trim();
    if (!raw) {
      setError('Invite code or link is required');
      return;
    }
    const code = raw.replace(/^.*\/invite\/?/i, '').split(/[\s?#]/)[0].trim();
    if (!code) {
      setError('Invalid invite code');
      return;
    }
    const token = getToken();
    if (!token) {
      setError('Not authenticated');
      return;
    }
    setLoading(true);
    try {
      const info = await getInviteByCode(code);
      await joinServer(token, info.serverId, { inviteCode: code });
      onJoined(info);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to join server');
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
        <div style={modalStyles.title}>Join server</div>
        <form style={modalStyles.form} onSubmit={handleSubmit}>
          <div>
            <label style={modalStyles.fieldLabel}>Invite code or link</label>
            <input
              className="input"
              type="text"
              placeholder="Paste invite code or invite link"
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
            />
          </div>
          {error && <div style={modalStyles.error}>{error}</div>}
          <div style={modalStyles.actions}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Joining…' : 'Join'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ServerList({ getToken, selectedServerId, onServerSelect }) {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);

  const fetchServers = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setServers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await listServers(token);
      setServers(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || 'Failed to load servers');
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const handleCreated = (server) => {
    fetchServers();
    onServerSelect?.(server);
  };

  const handleJoined = () => {
    fetchServers();
  };

  return (
    <div style={styles.strip}>
      {loading ? (
        <div style={styles.empty}>…</div>
      ) : error ? (
        <div style={{ ...styles.empty, color: 'var(--hush-danger)' }}>{error}</div>
      ) : (
        servers.map((server) => (
          <ServerButton
            key={server.id}
            server={server}
            isActive={selectedServerId === server.id}
            onSelect={onServerSelect}
          />
        ))
      )}
      <button
        type="button"
        style={styles.actionBtn}
        title="Create server"
        onClick={() => setShowCreateModal(true)}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <button
        type="button"
        style={styles.actionBtn}
        title="Join server"
        onClick={() => setShowJoinModal(true)}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      </button>
      {showCreateModal && (
        <CreateServerModal
          getToken={getToken}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}
      {showJoinModal && (
        <JoinServerModal
          getToken={getToken}
          onClose={() => setShowJoinModal(false)}
          onJoined={handleJoined}
        />
      )}
    </div>
  );
}
