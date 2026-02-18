import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { APP_VERSION } from '../utils/constants';
import { useAuth } from '../contexts/AuthContext';
import { getMatrixClient } from '../lib/matrixClient';

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
  spotlightWrapper: {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 0,
    '--ox': '-1000px',
    '--oy': '-1000px',
    '--ix': '-1000px',
    '--iy': '-1000px',
  },
  spotlightOuter: {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    background:
      'radial-gradient(600px circle at var(--ox) var(--oy), rgba(212,160,83,0.04), transparent 100%)',
  },
  spotlightInner: {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    background:
      'radial-gradient(200px circle at var(--ix) var(--iy), rgba(212,160,83,0.08), transparent 100%)',
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
  const {
    loginAsGuest,
    isLoading: matrixLoading,
    error: matrixError,
    cryptoError,
    clearCryptoError,
  } = useAuth();
  const [mode, setMode] = useState('create');
  const [roomName, setRoomName] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('hush_displayName') || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const spotlightRef = useRef(null);
  const rafRef = useRef(null);
  const posRef = useRef({ x: -1000, y: -1000 });
  const smoothOuterRef = useRef({ x: -1000, y: -1000 });
  const smoothInnerRef = useRef({ x: -1000, y: -1000 });
  const wordmarkRef = useRef(null);
  const [dotLeft, setDotLeft] = useState(null);
  const [spotlightEnabled, setSpotlightEnabled] = useState(
    () => (typeof window !== 'undefined' ? !window.matchMedia('(pointer: coarse)').matches : false)
  );

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
    const m = window.matchMedia('(pointer: coarse)');
    const update = () => setSpotlightEnabled(!m.matches);
    update();
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!spotlightEnabled) return;
    const loop = () => {
      const pos = posRef.current;
      const so = smoothOuterRef.current;
      const si = smoothInnerRef.current;
      so.x += (pos.x - so.x) * 0.06;
      so.y += (pos.y - so.y) * 0.06;
      si.x += (pos.x - si.x) * 0.1;
      si.y += (pos.y - si.y) * 0.1;
      if (spotlightRef.current) {
        spotlightRef.current.style.setProperty('--ox', `${so.x}px`);
        spotlightRef.current.style.setProperty('--oy', `${so.y}px`);
        spotlightRef.current.style.setProperty('--ix', `${si.x}px`);
        spotlightRef.current.style.setProperty('--iy', `${si.y}px`);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [spotlightEnabled]);

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
    posRef.current.x = e.clientX;
    posRef.current.y = e.clientY;
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      localStorage.setItem('hush_displayName', displayName);

      // Step 1: Authenticate with Matrix as guest
      await loginAsGuest();

      if (matrixError) {
        throw new Error(`Matrix authentication failed: ${matrixError}`);
      }

      // Step 2: Create or join Matrix room with E2EE
      const client = getMatrixClient();
      let matrixRoomId;
      let effectiveRoomName = roomName; // Track actual room name used (may have suffix)

      if (mode === 'create') {
        let actualRoomName = roomName;
        let createResponse;
        let retryAttempts = 0;
        const maxRetries = 3;

        // Try to create room, handling collisions with stale encrypted rooms
        while (retryAttempts < maxRetries) {
          try {
            createResponse = await client.createRoom({
              name: actualRoomName,
              room_alias_name: actualRoomName,
              visibility: 'private',
              preset: 'trusted_private_chat',
              initial_state: [
                {
                  type: 'm.room.encryption',
                  state_key: '',
                  content: { algorithm: 'm.megolm.v1.aes-sha2' },
                },
                {
                  type: 'm.room.guest_access',
                  state_key: '',
                  content: { guest_access: 'can_join' },
                },
              ],
            });

            matrixRoomId = createResponse.room_id;

            // Wait for room to appear in client's room list (sync may take a moment)
            let attempts = 0;
            const maxAttempts = 50;
            while (!client.getRoom(matrixRoomId) && attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 100));
              attempts++;
            }

            const roomInClient = client.getRoom(matrixRoomId);
            if (!roomInClient) {
              console.error('[home] Created room not in client after', attempts, 'attempts');
              throw new Error('Failed to create Matrix room: room not found after creation');
            }

            break; // Success - exit retry loop

          } catch (err) {

            // Check if error is due to alias collision or encrypted room
            const isCollision = err.errcode === 'M_ROOM_IN_USE' ||
                               (err.data && err.data.errcode === 'M_ROOM_IN_USE');

            if (isCollision && retryAttempts < maxRetries - 1) {
              // Generate random 4-character hex suffix
              const suffix = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
              actualRoomName = `${roomName}-${suffix}`;
              retryAttempts++;
              continue;
            }

            // If not a collision or max retries exceeded, rethrow
            throw err;
          }
        }

        // Store actual room name used (may have suffix) for join path and display
        sessionStorage.setItem('hush_actualRoomName', actualRoomName);
        effectiveRoomName = actualRoomName;
      } else {
        const serverName = import.meta.env.VITE_MATRIX_SERVER_NAME || 'localhost';
        const roomAlias = `#${roomName}:${serverName}`;

        const joinResponse = await client.joinRoom(roomAlias);
        matrixRoomId = joinResponse.roomId;

        // Wait for room to appear in client's room list
        let attempts = 0;
        const maxAttempts = 50;
        while (!client.getRoom(matrixRoomId) && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }

        const roomInClient = client.getRoom(matrixRoomId);
        if (!roomInClient) {
          throw new Error('Failed to join Matrix room: room not found after join');
        }
      }

      sessionStorage.setItem('hush_matrixRoomId', matrixRoomId);
      sessionStorage.setItem('hush_roomName', effectiveRoomName);
      sessionStorage.setItem('hush_displayName', displayName);
      sessionStorage.setItem('hush_roomPassword', password);

      navigate(`/room/${encodeURIComponent(effectiveRoomName)}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (cryptoError) {
    return (
      <div
        style={{
          ...styles.page,
          flexDirection: 'column',
          gap: '24px',
          textAlign: 'center',
          padding: '24px',
        }}
      >
        <div style={{ color: 'var(--hush-danger)', fontSize: '1rem', maxWidth: '360px' }}>
          {cryptoError}
        </div>
        <div style={{ color: 'var(--hush-text-secondary)', fontSize: '0.85rem', maxWidth: '360px' }}>
          Your browser may not support WebAssembly. Please use a modern Chromium-based browser.
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={clearCryptoError}
          style={{ padding: '10px 20px' }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={styles.page} onMouseMove={handleMouseMove}>
      <style>{`
        @keyframes moving-border-spin {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to { transform: translate(-50%, -50%) rotate(360deg); }
        }
      `}</style>

      {/* Cursor spotlight — two-layer lerped follow (desktop only) */}
      {spotlightEnabled && (
        <div ref={spotlightRef} style={styles.spotlightWrapper}>
          <div style={styles.spotlightOuter} />
          <div style={styles.spotlightInner} />
        </div>
      )}

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

            {(error || matrixError) && (
              <div style={styles.error}>{error || matrixError?.message}</div>
            )}

            {/* CTA button with moving border */}
            <div style={styles.movingBorderWrapper}>
              <div style={styles.movingBorderTrack}>
                <div style={styles.movingBorderGradient} />
              </div>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={loading || matrixLoading}
                style={styles.ctaButton}
              >
                {loading || matrixLoading ? 'connecting...' : mode === 'create' ? 'create room' : 'join'}
              </button>
            </div>
          </form>

          <div style={styles.footer}>
            <div>
              hush is open source and self-hostable.{' '}
              <a href="https://github.com/YarinCardillo/hush-app" style={styles.footerLink}>
                GitHub
              </a>
              {' · '}
              <Link to="/roadmap" style={styles.footerLink}>
                Roadmap
              </Link>
            </div>
            <div style={styles.footerMeta}>
              <span>v{APP_VERSION}</span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
