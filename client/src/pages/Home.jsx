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
    userSelect: 'none',
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
    fontFamily: 'var(--font-sans)',
    fontSize: '2.4rem',
    fontWeight: 300,
    letterSpacing: '-0.03em',
    color: 'var(--hush-text)',
    textTransform: 'lowercase',
  },
  logoAccent: {
    color: 'var(--hush-amber)',
  },
  logoSub: {
    marginTop: '8px',
    color: 'var(--hush-text-secondary)',
    fontSize: '0.9rem',
    fontWeight: 400,
  },
  tabs: {
    display: 'flex',
    gap: '2px',
    marginBottom: '24px',
    background: 'var(--hush-surface)',
    padding: '3px',
    borderRadius: 'var(--radius-md)',
  },
  tab: (active) => ({
    flex: 1,
    padding: '10px',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--hush-elevated)' : 'transparent',
    color: active ? 'var(--hush-text)' : 'var(--hush-text-secondary)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.85rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all var(--duration-fast) var(--ease-out)',
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
    color: 'var(--hush-text-secondary)',
    fontWeight: 500,
  },
  error: {
    padding: '10px 14px',
    background: 'var(--hush-danger-ghost)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--hush-danger)',
    fontSize: '0.85rem',
  },
  e2eNote: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    background: 'var(--hush-encrypted-ghost)',
    borderRadius: 'var(--radius-md)',
    fontSize: '0.8rem',
    color: 'var(--hush-text-secondary)',
    marginTop: '8px',
  },
  footer: {
    marginTop: '32px',
    textAlign: 'center',
    fontSize: '0.75rem',
    color: 'var(--hush-text-muted)',
  },
  footerLink: {
    color: 'var(--hush-amber-dim)',
    textDecoration: 'none',
  },
};

export default function Home() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('create');
  const [roomName, setRoomName] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('hush_displayName') || '');
  const [error, setError] = useState('');
  const [poolFull, setPoolFull] = useState(null);
  const [loading, setLoading] = useState(false);
  const [e2eSupported] = useState(isE2ESupported);
  const [serverStatus, setServerStatus] = useState(null);

  useEffect(() => {
    fetch(`${API_URL}/api/status`)
      .then((r) => r.json())
      .then(setServerStatus)
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setPoolFull(null);
    setLoading(true);

    try {
      localStorage.setItem('hush_displayName', displayName);

      const endpoint = mode === 'create' ? '/api/rooms/create' : '/api/rooms/join';

      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, password, displayName }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === 'FREE_POOL_FULL') {
          setPoolFull(data);
          return;
        }
        throw new Error(data.error || 'Something went wrong');
      }

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

  const freePool = serverStatus?.pools?.free;
  const capacityPercent = freePool
    ? Math.round((freePool.active / freePool.max) * 100)
    : 0;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.logo}>
          <div style={styles.logoTitle}>
            <span style={styles.logoAccent}>h</span>ush
          </div>
          <div style={styles.logoSub}>share your screen. keep your privacy.</div>
        </div>

        <div style={styles.tabs}>
          <button
            style={styles.tab(mode === 'create')}
            onClick={() => { setMode('create'); setError(''); }}
          >
            create room
          </button>
          <button
            style={styles.tab(mode === 'join')}
            onClick={() => { setMode('join'); setError(''); }}
          >
            join
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

          {poolFull && (
            <div style={{
              padding: '16px',
              background: 'var(--hush-elevated)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--hush-border)',
            }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 500, marginBottom: '8px' }}>
                {poolFull.message}
              </div>
              <div style={{
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--hush-text-secondary)',
                marginBottom: '12px',
              }}>
                {poolFull.pools?.active ?? '?'}/{poolFull.pools?.max ?? '?'} slots used
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => { setPoolFull(null); handleSubmit(new Event('submit')); }}
                  style={{ width: '100%', fontSize: '0.8rem' }}
                >
                  try again
                </button>
                <a
                  href="https://github.com/YarinCardillo/hush-app#self-hosting-docker"
                  target="_blank"
                  rel="noopener"
                  className="btn btn-secondary"
                  style={{ width: '100%', fontSize: '0.8rem', textDecoration: 'none', textAlign: 'center' }}
                >
                  self-host (free, unlimited)
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
            {loading ? 'connecting...' : mode === 'create' ? 'create room' : 'join'}
          </button>
        </form>

        {freePool && (
          <div style={{
            marginTop: '16px',
            padding: '12px 14px',
            background: 'var(--hush-surface)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--hush-border)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                color: 'var(--hush-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}>
                free pool
              </span>
              <span style={{
                fontSize: '0.7rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--hush-text-secondary)',
              }}>
                {freePool.active}/{freePool.max}
              </span>
            </div>
            <div style={{
              width: '100%',
              height: '3px',
              background: 'var(--hush-black)',
              borderRadius: '2px',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${capacityPercent}%`,
                height: '100%',
                background: capacityPercent > 80 ? 'var(--hush-amber)' : 'var(--hush-live)',
                borderRadius: '2px',
                transition: 'width 400ms var(--ease-out)',
              }} />
            </div>
          </div>
        )}

        <div style={styles.e2eNote}>
          <span className="badge badge-e2e">
            {e2eSupported ? 'e2e encrypted' : 'e2e unavailable'}
          </span>
          <span>
            {e2eSupported
              ? 'End-to-end encryption available'
              : 'Use Chrome/Edge for E2E. DTLS/SRTP still active.'}
          </span>
        </div>

        <div style={styles.footer}>
          hush is open source and self-hostable.{' '}
          <a href="https://github.com/YarinCardillo/hush-app" style={styles.footerLink}>
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
