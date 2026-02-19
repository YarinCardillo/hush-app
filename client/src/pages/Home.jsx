import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { APP_VERSION } from '../utils/constants';
import { useAuth } from '../contexts/AuthContext';
import { getMatrixClient } from '../lib/matrixClient';
import { GUEST_SESSION_KEY } from '../lib/authStorage';

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
    '--sx': '-1000px',
    '--sy': '-1000px',
  },
  spotlight: {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    background:
      'radial-gradient(280px circle at var(--sx) var(--sy), rgba(213,79,18,0.06) 0%, rgba(213,79,18,0.02) 45%, transparent 75%)',
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
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    fontStyle: 'italic',
    fontWeight: 400,
    fontSize: '8rem',
    letterSpacing: '0.06em',
    color: 'var(--hush-text)',
    textTransform: 'lowercase',
  },
  logoDot: (left) => ({
    position: 'absolute',
    top: '20px',
    left: left != null ? `${left}px` : '38%',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    background: 'var(--hush-amber)',
    boxShadow: '0 0 12px var(--hush-amber), 0 0 28px rgba(213, 79, 18, 0.3)',
  }),
  logoGlow: {
    position: 'absolute',
    inset: '-30px',
    background: 'radial-gradient(circle, rgba(213, 79, 18, 0.3) 0%, transparent 70%)',
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

const AUTH_VIEW = { CHOOSE: 'choose', LOGIN: 'login', REGISTER: 'register', GUEST: 'guest' };

export default function Home() {
  const navigate = useNavigate();
  const {
    loginAsGuest,
    login,
    register,
    logout,
    isAuthenticated,
    isLoading: matrixLoading,
    error: matrixError,
    cryptoError,
    clearCryptoError,
  } = useAuth();
  const [authView, setAuthView] = useState(AUTH_VIEW.CHOOSE);
  const [isGuestSession, setIsGuestSession] = useState(() => sessionStorage.getItem(GUEST_SESSION_KEY) === '1');
  const [mode, setMode] = useState('create');
  const [roomName, setRoomName] = useState('');
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('hush_displayName') || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerUsername, setRegisterUsername] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState('');
  const [registerDisplayName, setRegisterDisplayName] = useState(() => localStorage.getItem('hush_displayName') || '');

  const spotlightRef = useRef(null);
  const rafRef = useRef(null);
  const posRef = useRef({ x: -1000, y: -1000 });
  const smoothRef = useRef({ x: -1000, y: -1000 });
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
      const s = smoothRef.current;
      s.x += (pos.x - s.x) * 0.08;
      s.y += (pos.y - s.y) * 0.08;
      if (spotlightRef.current) {
        spotlightRef.current.style.setProperty('--sx', `${s.x}px`);
        spotlightRef.current.style.setProperty('--sy', `${s.y}px`);
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

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError('');
    sessionStorage.removeItem(GUEST_SESSION_KEY);
    setIsGuestSession(false);
    if (!loginUsername.trim() || !loginPassword) return;
    await login(loginUsername.trim(), loginPassword);
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setError('');
    sessionStorage.removeItem(GUEST_SESSION_KEY);
    setIsGuestSession(false);
    if (!registerUsername.trim() || !registerPassword || !registerDisplayName.trim()) return;
    if (registerPassword !== registerPasswordConfirm) {
      setError('Passwords do not match');
      return;
    }
    await register(registerUsername.trim(), registerPassword, registerDisplayName.trim());
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      localStorage.setItem('hush_displayName', displayName);

      // Step 1: Authenticate with Matrix as guest
      await loginAsGuest();
      sessionStorage.setItem(GUEST_SESSION_KEY, '1');
      setIsGuestSession(true);

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
      {/* Cursor spotlight — single lerped circle, soft falloff (desktop only) */}
      {spotlightEnabled && (
        <div ref={spotlightRef} style={styles.spotlightWrapper}>
          <div style={styles.spotlight} />
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

        {/* Form card — slides up on mount, glass panel */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
          className="glass"
          style={{ padding: '24px' }}
        >
          {isAuthenticated && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
              <button
                type="button"
                onClick={() => logout()}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--hush-text-muted)',
                  fontSize: '0.8rem',
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                  padding: '4px 0',
                }}
              >
                {isGuestSession ? 'End session' : 'Logout'}
              </button>
            </div>
          )}

          {isAuthenticated || authView === AUTH_VIEW.GUEST ? (
            <>
              {authView === AUTH_VIEW.GUEST && (
                <>
                  <button
                    type="button"
                    className="back-link"
                    onClick={() => { setAuthView(AUTH_VIEW.CHOOSE); setError(''); }}
                  >
                    ← Back
                  </button>
                  <p style={{ fontSize: '0.8rem', color: 'var(--hush-text-muted)', marginBottom: '16px' }}>
                    Temporary session, no account. Your identity will not persist.
                  </p>
                </>
              )}
              <div className="home-room-tabs" style={styles.tabs}>
                <button
                  type="button"
                  style={styles.tab(mode === 'create')}
                  data-active={mode === 'create'}
                  onClick={() => { setMode('create'); setError(''); }}
                >
                  create room
                </button>
                <button
                  type="button"
                  style={styles.tab(mode === 'join')}
                  data-active={mode === 'join'}
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

                {(error || matrixError) && (
                  <div style={styles.error}>{error || matrixError?.message}</div>
                )}

                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={loading || matrixLoading}
                  style={{ width: '100%', padding: '12px' }}
                >
                  {loading || matrixLoading ? 'connecting...' : mode === 'create' ? 'create room' : 'join'}
                </button>
              </form>
            </>
          ) : authView === AUTH_VIEW.CHOOSE ? (
            <>
              <div className="home-auth-choices" style={{ ...styles.tabs, flexDirection: 'column' }}>
                <button
                  type="button"
                  className="home-auth-choice-btn"
                  onClick={() => setAuthView(AUTH_VIEW.LOGIN)}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className="home-auth-choice-btn"
                  onClick={() => setAuthView(AUTH_VIEW.GUEST)}
                >
                  Try as Guest
                </button>
              </div>
            </>
          ) : authView === AUTH_VIEW.LOGIN ? (
            <>
              <button
                type="button"
                className="back-link"
                onClick={() => { setAuthView(AUTH_VIEW.CHOOSE); setError(''); }}
              >
                ← Back
              </button>
              <form style={styles.form} onSubmit={handleLoginSubmit}>
                <div>
                  <label style={styles.fieldLabel}>Username or email</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="alice or alice@example.com"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    required
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label style={styles.fieldLabel}>Password</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="Password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </div>
                {matrixError && <div style={styles.error}>{matrixError.message}</div>}
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={matrixLoading}
                  style={{ width: '100%', padding: '12px' }}
                >
                  {matrixLoading ? 'Signing in...' : 'Sign in'}
                </button>
              </form>
              <p style={{ fontSize: '0.85rem', color: 'var(--hush-text-secondary)', marginTop: '16px', textAlign: 'center' }}>
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  className="back-link"
                  style={{
                    padding: 0,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    font: 'inherit',
                    color: 'var(--hush-amber-dim)',
                  }}
                  onClick={() => setAuthView(AUTH_VIEW.REGISTER)}
                >
                  Sign up
                </button>
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                className="back-link"
                onClick={() => { setAuthView(AUTH_VIEW.CHOOSE); setError(''); }}
              >
                ← Back
              </button>
              <form style={styles.form} onSubmit={handleRegisterSubmit}>
                <div>
                  <label style={styles.fieldLabel}>Username</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="Choose a username (e.g. alice)"
                    value={registerUsername}
                    onChange={(e) => setRegisterUsername(e.target.value)}
                    required
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label style={styles.fieldLabel}>Password</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="Min 8 characters"
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label style={styles.fieldLabel}>Confirm password</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="Repeat your password"
                    value={registerPasswordConfirm}
                    onChange={(e) => setRegisterPasswordConfirm(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label style={styles.fieldLabel}>Display name</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="How others will see you in rooms"
                    value={registerDisplayName}
                    onChange={(e) => setRegisterDisplayName(e.target.value)}
                    required
                    maxLength={30}
                  />
                </div>
                {(error || matrixError) && (
                  <div style={styles.error}>{error || matrixError?.message}</div>
                )}
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={matrixLoading}
                  style={{ width: '100%', padding: '12px' }}
                >
                  {matrixLoading ? 'Creating account...' : 'Create account'}
                </button>
              </form>
              <p style={{ fontSize: '0.85rem', color: 'var(--hush-text-secondary)', marginTop: '16px', textAlign: 'center' }}>
                Already have an account?{' '}
                <button
                  type="button"
                  style={{
                    padding: 0,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    font: 'inherit',
                    color: 'var(--hush-amber-dim)',
                  }}
                  onClick={() => { setAuthView(AUTH_VIEW.LOGIN); setError(''); }}
                >
                  Sign in
                </button>
              </p>
            </>
          )}

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
              <span>·</span>
              <span>powered by Matrix</span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
