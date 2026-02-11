import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../utils/constants';
import { isE2ESupported } from '../lib/encryption';

const styles = {
  page: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  },
  container: {
    width: '100%',
    maxWidth: '420px',
  },
  logo: {
    marginBottom: '40px',
    textAlign: 'center',
  },
  logoTitle: {
    fontSize: '2.2rem',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    background: 'linear-gradient(135deg, #e8e8f0 0%, #6c5ce7 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  logoSub: {
    marginTop: '8px',
    color: 'var(--text-secondary)',
    fontSize: '0.9rem',
    fontWeight: 300,
  },
  tabs: {
    display: 'flex',
    gap: '2px',
    marginBottom: '24px',
    background: 'var(--bg-secondary)',
    padding: '3px',
    borderRadius: 'var(--radius-md)',
  },
  tab: (active) => ({
    flex: 1,
    padding: '10px',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--bg-elevated)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontFamily: 'var(--font-body)',
    fontSize: '0.85rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 150ms ease',
  }),
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  fieldLabel: {
    display: 'block',
    marginBottom: '4px',
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    fontWeight: 500,
  },
  error: {
    padding: '10px 14px',
    background: 'var(--danger-subtle)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--danger)',
    fontSize: '0.85rem',
  },
  e2eNote: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    background: 'var(--accent-subtle)',
    borderRadius: 'var(--radius-md)',
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    marginTop: '8px',
  },
  footer: {
    marginTop: '32px',
    textAlign: 'center',
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
  },
  footerLink: {
    color: 'var(--accent)',
    textDecoration: 'none',
  },
};

export default function Home() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('create'); // 'create' | 'join'
  const [roomName, setRoomName] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('hush_displayName') || '');
  const [error, setError] = useState('');
  const [poolFull, setPoolFull] = useState(null); // Pool-full response from server
  const [loading, setLoading] = useState(false);
  const [e2eSupported] = useState(isE2ESupported);
  const [serverStatus, setServerStatus] = useState(null);

  // Fetch server status on mount
  useEffect(() => {
    fetch(`${API_URL}/api/status`)
      .then((r) => r.json())
      .then(setServerStatus)
      .catch(() => {}); // Fail silently
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setPoolFull(null);
    setLoading(true);

    try {
      // Save display name for next time
      localStorage.setItem('hush_displayName', displayName);

      const endpoint = mode === 'create' ? '/api/rooms/create' : '/api/rooms/join';

      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, password, displayName }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Handle pool-full with dedicated UI
        if (data.error === 'FREE_POOL_FULL') {
          setPoolFull(data);
          return;
        }
        throw new Error(data.error || 'Something went wrong');
      }

      // Store auth token
      sessionStorage.setItem('hush_token', data.token);
      sessionStorage.setItem('hush_peerId', data.peerId);
      sessionStorage.setItem('hush_roomName', data.roomName);

      navigate(`/room/${encodeURIComponent(data.roomName)}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Capacity bar for free pool
  const freePool = serverStatus?.pools?.free;
  const capacityPercent = freePool
    ? Math.round((freePool.active / freePool.max) * 100)
    : 0;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.logo}>
          <div style={styles.logoTitle}>Hush</div>
          <div style={styles.logoSub}>Stream without limits. Privacy by default.</div>
        </div>

        <div style={styles.tabs}>
          <button
            style={styles.tab(mode === 'create')}
            onClick={() => { setMode('create'); setError(''); }}
          >
            Create Room
          </button>
          <button
            style={styles.tab(mode === 'join')}
            onClick={() => { setMode('join'); setError(''); }}
          >
            Join Room
          </button>
        </div>

        <form style={styles.form} onSubmit={handleSubmit}>
          <div>
            <label style={styles.fieldLabel}>Your Name</label>
            <input
              className="input"
              type="text"
              placeholder="How others will see you"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={30}
            />
          </div>

          <div>
            <label style={styles.fieldLabel}>Room Name</label>
            <input
              className="input"
              type="text"
              placeholder={mode === 'create' ? 'Choose a room name' : 'Enter room name'}
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              required
              maxLength={50}
            />
          </div>

          <div>
            <label style={styles.fieldLabel}>
              {mode === 'create' ? 'Set Password' : 'Room Password'}
            </label>
            <input
              className="input"
              type="password"
              placeholder={mode === 'create' ? 'Min 4 characters' : 'Enter password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={4}
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}

          {/* Pool-full transparent message */}
          {poolFull && (
            <div style={{
              padding: '16px',
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px' }}>
                {poolFull.message}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                Posti free: {poolFull.pools?.active ?? '?'}/{poolFull.pools?.max ?? '?'} occupati
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => { setPoolFull(null); handleSubmit(new Event('submit')); }}
                  style={{ width: '100%', fontSize: '0.8rem' }}
                >
                  Riprova
                </button>
                <a
                  href="https://github.com/hush-app/hush#self-hosting-docker"
                  target="_blank"
                  rel="noopener"
                  className="btn btn-secondary"
                  style={{ width: '100%', fontSize: '0.8rem', textDecoration: 'none', textAlign: 'center' }}
                >
                  Self-hosting (gratis, illimitato)
                </a>
              </div>
            </div>
          )}

          <button
            className="btn btn-primary"
            type="submit"
            disabled={loading}
            style={{ marginTop: '8px', width: '100%', padding: '12px' }}
          >
            {loading ? 'Connecting...' : mode === 'create' ? 'Create & Enter' : 'Join Room'}
          </button>
        </form>

        {/* Server capacity indicator — fully transparent */}
        {freePool && (
          <div style={{
            marginTop: '16px',
            padding: '10px 14px',
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Stanze free attive
              </span>
              <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                {freePool.active}/{freePool.max}
              </span>
            </div>
            <div style={{
              width: '100%',
              height: '4px',
              background: 'var(--bg-primary)',
              borderRadius: '2px',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${capacityPercent}%`,
                height: '100%',
                background: capacityPercent > 80 ? 'var(--warning)' : 'var(--live)',
                borderRadius: '2px',
                transition: 'width 300ms ease',
              }} />
            </div>
          </div>
        )}

        <div style={styles.e2eNote}>
          <span className="badge badge-e2e">
            {e2eSupported ? 'E2E Ready' : 'E2E Unavailable'}
          </span>
          <span>
            {e2eSupported
              ? 'End-to-end encryption available in this browser'
              : 'Use Chrome/Edge for E2E encryption. DTLS/SRTP still active.'}
          </span>
        </div>

        <div style={styles.footer}>
          Hush is open source and self-hostable.{' '}
          <a href="https://github.com/hush-app/hush" style={styles.footerLink}>
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
