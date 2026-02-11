import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { API_URL, APP_VERSION } from '../utils/constants';
import { isE2ESupported, generateKeyFragment } from '../lib/encryption';

const SUBTITLE_WORDS = ['share', 'your', 'screen.', 'keep', 'your', 'privacy.'];

const wordVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
};

const styles = {
  page: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    userSelect: 'none',
    position: 'relative',
  },
  spotlight: {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 0,
    background:
      'radial-gradient(400px circle at var(--sx, -1000px) var(--sy, -1000px), rgba(212, 160, 83, 0.07), transparent 100%)',
  },
  grain: {
    position: 'fixed',
    inset: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: 1,
    opacity: 0.03,
  },
  container: {
    width: '100%',
    maxWidth: '420px',
    position: 'relative',
    zIndex: 2,
  },
  logo: {
    marginBottom: '40px',
    textAlign: 'center',
  },
  logoInner: {
    position: 'relative',
    display: 'inline-block',
  },
  logoTitle: {
    fontFamily: 'var(--font-sans)',
    fontSize: '2.4rem',
    fontWeight: 200,
    letterSpacing: '-0.03em',
    color: 'var(--hush-text)',
    textTransform: 'lowercase',
  },
  logoDot: (left) => ({
    position: 'absolute',
    top: '-3px',
    left: left != null ? `${left}px` : '38%',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: 'var(--hush-amber)',
  }),
  logoGlow: {
    position: 'absolute',
    inset: '-30px',
    background: 'radial-gradient(circle, rgba(212, 160, 83, 0.3) 0%, transparent 70%)',
    borderRadius: '50%',
    zIndex: -1,
    pointerEvents: 'none',
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
  movingBorderWrapper: {
    position: 'relative',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    marginTop: '8px',
  },
  movingBorderTrack: {
    position: 'absolute',
    inset: 0,
    borderRadius: 'inherit',
    overflow: 'hidden',
  },
  movingBorderGradient: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: '300%',
    paddingBottom: '300%',
    background:
      'conic-gradient(from 0deg, transparent 0%, transparent 60%, rgba(232, 184, 102, 0.5) 80%, rgba(255, 255, 255, 0.15) 85%, rgba(232, 184, 102, 0.5) 90%, transparent 100%)',
    animation: 'moving-border-spin 4s linear infinite',
  },
  ctaButton: {
    position: 'relative',
    width: 'calc(100% - 2px)',
    padding: '12px',
    margin: '1px',
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
  footerMeta: {
    marginTop: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontSize: '0.65rem',
    fontFamily: 'var(--font-mono)',
    color: 'var(--hush-text-ghost)',
    letterSpacing: '0.02em',
  },
  statusDot: (online) => ({
    display: 'inline-block',
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: online ? 'var(--hush-live)' : 'var(--hush-danger)',
    flexShrink: 0,
  }),
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
  const [serverOnline, setServerOnline] = useState(null);

  const spotlightRef = useRef(null);
  const rafRef = useRef(null);
  const wordmarkRef = useRef(null);
  const [dotLeft, setDotLeft] = useState(null);

  // Pre-fill room name when redirected from a direct invite link
  useEffect(() => {
    const pendingRoom = sessionStorage.getItem('hush_pendingRoom');
    if (pendingRoom) {
      setRoomName(pendingRoom);
      setMode('join');
      sessionStorage.removeItem('hush_pendingRoom');
    }
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/api/status`)
      .then((r) => r.json())
      .then((data) => {
        setServerStatus(data);
        setServerOnline(true);
      })
      .catch(() => {
        setServerOnline(false);
      });
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    const measure = () => {
      const el = wordmarkRef.current;
      if (!el) return;
      const textNode = el.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;
      const range = document.createRange();
      range.setStart(textNode, 1);
      range.setEnd(textNode, 2);
      const uRect = range.getBoundingClientRect();
      const parentRect = el.getBoundingClientRect();
      const uCenter = uRect.left + uRect.width / 2 - parentRect.left;
      setDotLeft(uCenter - 5);
    };
    document.fonts.ready.then(measure);
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      if (spotlightRef.current) {
        spotlightRef.current.style.setProperty('--sx', `${e.clientX}px`);
        spotlightRef.current.style.setProperty('--sy', `${e.clientY}px`);
      }
      rafRef.current = null;
    });
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

      const roomPath = `/room/${encodeURIComponent(data.roomName)}`;

      if (mode === 'create') {
        // Generate E2E key fragment — lives only in the URL hash, never sent to server
        const fragment = generateKeyFragment();
        navigate(`${roomPath}#${fragment}`);
      } else {
        // Restore E2E fragment from invite link redirect (if any)
        const savedFragment = sessionStorage.getItem('hush_e2eFragment');
        const hash = savedFragment ? `#${savedFragment}` : '';
        sessionStorage.removeItem('hush_e2eFragment');
        navigate(`${roomPath}${hash}`);
      }
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
    <div style={styles.page} onMouseMove={handleMouseMove}>
      <style>{`
        @keyframes moving-border-spin {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to { transform: translate(-50%, -50%) rotate(360deg); }
        }
      `}</style>

      {/* Cursor spotlight — follows mouse via CSS custom properties */}
      <div ref={spotlightRef} style={styles.spotlight} />

      {/* Background grain — SVG feTurbulence at 3% opacity */}
      <svg style={styles.grain} xmlns="http://www.w3.org/2000/svg">
        <filter id="hush-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.65"
            numOctaves="3"
            stitchTiles="stitch"
          />
        </filter>
        <rect width="100%" height="100%" filter="url(#hush-grain)" />
      </svg>

      <div style={styles.container}>
        {/* Logo — fade in with amber glow pulse */}
        <motion.div
          style={styles.logo}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div style={styles.logoInner}>
            <div style={{ ...styles.logoTitle, position: 'relative' }} ref={wordmarkRef}>
              hush
              <motion.div
                style={styles.logoDot(dotLeft)}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            <motion.div
              style={styles.logoGlow}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0, 0.7, 0.15], scale: [0.8, 1.2, 1] }}
              transition={{ duration: 1.2, delay: 0.2, ease: 'easeOut' }}
            />
          </div>

          {/* Subtitle — word by word staggered reveal */}
          <motion.div
            style={styles.logoSub}
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: {
                transition: { staggerChildren: 0.08, delayChildren: 0.3 },
              },
            }}
          >
            {SUBTITLE_WORDS.map((word, i) => (
              <motion.span
                key={i}
                style={{ display: 'inline-block', marginRight: '0.25em' }}
                variants={wordVariants}
              >
                {word}
              </motion.span>
            ))}
          </motion.div>
        </motion.div>

        {/* Form card — slides up on mount */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
        >
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

            {/* CTA button with moving border */}
            <div style={styles.movingBorderWrapper}>
              <div style={styles.movingBorderTrack}>
                <div style={styles.movingBorderGradient} />
              </div>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={loading}
                style={styles.ctaButton}
              >
                {loading ? 'connecting...' : mode === 'create' ? 'create room' : 'join'}
              </button>
            </div>
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
                ? 'Share the invite link to enable end-to-end encryption'
                : 'Use Chrome/Edge for E2E. DTLS/SRTP still active.'}
            </span>
          </div>

          <div style={styles.footer}>
            <div>
              hush is open source and self-hostable.{' '}
              <a href="https://github.com/YarinCardillo/hush-app" style={styles.footerLink}>
                GitHub
              </a>
            </div>
            <div style={styles.footerMeta}>
              <span>v{APP_VERSION}</span>
              {serverOnline !== null && (
                <>
                  <span style={{ opacity: 0.3 }}>·</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={styles.statusDot(serverOnline)} />
                    {serverOnline ? 'online' : 'offline'}
                  </span>
                </>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
