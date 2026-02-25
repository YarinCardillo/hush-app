import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { SSOAction } from 'matrix-js-sdk';
import { APP_VERSION } from '../utils/constants';
import { useAuth } from '../contexts/AuthContext';
import { getMatrixClient } from '../lib/matrixClient';
import { GUEST_SESSION_KEY } from '../lib/authStorage';

const SUBTITLE_WORDS = ['share', 'your', 'screen.', 'keep', 'your'];

const _TYPEWRITER_POOL = [
  'secrets',
  'aliases',       // was 'identity'
  'data',
  'silence',
  'whispers',      // was 'manifesto'
  'scrolls',       // was 'screen time'
  'cookies',       // was 'browser history'
  'DMs',
  'chats',
  'burners',       // was 'burner phone'
  'typing',        // was 'read receipts' (humor: "keep your typing.")
  'thoughts',      // was 'inner monologue'
  'flings',        // was 'situationship'
  'villain arc',
  'binges',        // was 'guilty pleasures'
  // 'identity',
  // 'manifesto',
  // 'screen time',
  // 'browser history',
  // 'burner phone',
  // 'read receipts',
  // 'inner monologue',
  // 'situationship',

  // 'guilty pleasures',
];

function _buildShuffledSequence() {
  const pool = [..._TYPEWRITER_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return ['privacy', ...pool];
}

const TYPEWRITER_WORDS = _buildShuffledSequence();

/** Width of slot is fixed to first word "privacy." so centering is based on that; longer words overflow to the right */
const FIRST_TYPEWRITER_WORD = 'privacy.';

const TYPE_SPEED_MS   = 65;
const DELETE_SPEED_MS = 40;
const PAUSE_AFTER_MS  = 1400;
const PAUSE_BEFORE_MS = 200;

const wordVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
};

function TypewriterSlot() {
  const sequenceRef = useRef(TYPEWRITER_WORDS);
  const ghostRef = useRef(null);
  const [slotWidthPx, setSlotWidthPx] = useState(null);
  const [wordIndex, setWordIndex] = useState(0);
  const [displayed, setDisplayed] = useState('');
  const [phase, setPhase] = useState('typing');

  useEffect(() => {
    if (!ghostRef.current) return;
    const measure = () => {
      if (ghostRef.current) {
        const w = ghostRef.current.getBoundingClientRect().width;
        setSlotWidthPx(w);
      }
    };
    if (document.fonts?.ready) {
      document.fonts.ready.then(measure);
    } else {
      measure();
    }
  }, []);

  useEffect(() => {
    const word = sequenceRef.current[wordIndex];
    const fullText = word + '.';

    if (phase === 'typing') {
      if (displayed.length < fullText.length) {
        const t = setTimeout(
          () => setDisplayed(fullText.slice(0, displayed.length + 1)),
          TYPE_SPEED_MS,
        );
        return () => clearTimeout(t);
      }
      setPhase('pausing');
      return;
    }

    if (phase === 'pausing') {
      const t = setTimeout(() => setPhase('deleting'), PAUSE_AFTER_MS);
      return () => clearTimeout(t);
    }

    if (phase === 'deleting') {
      if (displayed.length > 0) {
        const t = setTimeout(
          () => setDisplayed((d) => d.slice(0, -1)),
          DELETE_SPEED_MS,
        );
        return () => clearTimeout(t);
      }
      setPhase('waiting');
      return;
    }

    if (phase === 'waiting') {
      const t = setTimeout(() => {
        setWordIndex((i) => {
          const next = i + 1;
          if (next >= sequenceRef.current.length) {
            sequenceRef.current = _buildShuffledSequence();
            return 0;
          }
          return next;
        });
        setPhase('typing');
      }, PAUSE_BEFORE_MS);
      return () => clearTimeout(t);
    }
  }, [phase, displayed, wordIndex]);

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        marginRight: '0.25em',
        whiteSpace: 'nowrap',
        minWidth: slotWidthPx ?? `${FIRST_TYPEWRITER_WORD.length}ch`,
        textAlign: 'left',
      }}
    >
      <span
        ref={ghostRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          visibility: 'hidden',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        {FIRST_TYPEWRITER_WORD}
      </span>
      <motion.span style={{ display: 'inline-block', whiteSpace: 'nowrap' }} variants={wordVariants}>
        {displayed}
        <span className="typewriter-cursor" aria-hidden="true" />
      </motion.span>
    </span>
  );
}

const styles = {
  page: {
    minHeight: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    userSelect: 'none',
    position: 'relative',
    overflowY: 'auto',
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
    marginBottom: '56px',
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
    marginTop: '0px',
    color: 'var(--hush-text-secondary)',
    fontSize: '0.9rem',
    fontWeight: 400,
  },
  e2eeBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '3px 10px',
    background: 'var(--hush-amber-ghost)',
    color: 'var(--hush-amber)',
    fontSize: '0.65rem',
    fontWeight: 500,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    border: '1px solid transparent',
    borderRadius: 0,
    userSelect: 'none',
  },
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
    overflowWrap: 'break-word',
    wordBreak: 'break-word',
  },
  /** Toast: fixed position, no border, auto fade-out */
  errorToast: {
    position: 'fixed',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: 'min(420px, calc(100vw - 32px))',
    padding: '12px 16px',
    background: 'var(--hush-danger-ghost)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--hush-danger)',
    fontSize: '0.85rem',
    overflowWrap: 'break-word',
    wordBreak: 'break-word',
    boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
    zIndex: 1000,
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

/** Maps raw create/join errors to short, user-facing messages. Avoids exposing URLs and stack traces. */
function getFriendlyCreateJoinError(err) {
  const msg = err?.message || String(err);
  if (/404|not found|M_NOT_FOUND/i.test(msg)) return 'Room not found. Check the name or create it first.';
  if (/room full|403|M_FORBIDDEN|full/i.test(msg)) return 'Room is full or you don\'t have access.';
  if (/Room availability|All guest rooms are full|can-create/i.test(msg)) return msg;
  return 'Something went wrong. Please try again.';
}

export default function Home() {
  const navigate = useNavigate();
  const {
    loginAsGuest,
    login,
    register,
    logout,
    fetchLoginFlows,
    startSsoLogin,
    ssoProviders,
    loginFlowsError,
    isAuthenticated,
    isLoading: matrixLoading,
    error: matrixError,
    cryptoError,
    clearCryptoError,
  } = useAuth();
  const [searchParams] = useSearchParams();
  const joinParam = searchParams.get('join');
  // Skip auth choice screen when joining via link — go straight to guest form
  const [authView, setAuthView] = useState(joinParam ? AUTH_VIEW.GUEST : AUTH_VIEW.CHOOSE);
  const [isGuestSession, setIsGuestSession] = useState(() => sessionStorage.getItem(GUEST_SESSION_KEY) === '1');
  const [roomName, setRoomName] = useState('');
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('hush_displayName') || '');
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState(null);
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
  const subtitleGhostRef = useRef(null);
  const [subtitleWidthPx, setSubtitleWidthPx] = useState(null);
  const [dotLeft, setDotLeft] = useState(null);
  const [spotlightEnabled, setSpotlightEnabled] = useState(
    () => (typeof window !== 'undefined' ? !window.matchMedia('(pointer: coarse)').matches : false)
  );

  // Fetch Matrix login flows when showing Login or Register so SSO buttons can be shown
  useEffect(() => {
    if (authView === AUTH_VIEW.LOGIN || authView === AUTH_VIEW.REGISTER) {
      fetchLoginFlows();
    }
  }, [authView, fetchLoginFlows]);

  // Sync error/matrixError to toast and auto-clear after delay
  useEffect(() => {
    const msg = error || matrixError?.message || null;
    setToastMessage(msg);
    if (!msg) return;
    const id = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(id);
  }, [error, matrixError]);

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
    const el = wordmarkRef.current;
    if (!el) return;
    const measure = () => {
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
    // Re-measure when the element resizes (e.g. after late font swap)
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!subtitleGhostRef.current) return;
    const measure = () => {
      if (subtitleGhostRef.current) {
        const w = subtitleGhostRef.current.getBoundingClientRect().width;
        setSubtitleWidthPx(w);
      }
    };
    if (document.fonts?.ready) {
      document.fonts.ready.then(measure);
    } else {
      measure();
    }
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

  const handleJoinSubmit = async (e) => {
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

      // Step 2: Join the room via ?join= param
      if (!joinParam || !/^[a-zA-Z0-9._=-]+$/.test(joinParam)) {
        throw new Error('Invalid room link.');
      }
      const client = getMatrixClient();
      const serverName = import.meta.env.VITE_MATRIX_SERVER_NAME || 'localhost';
      const roomAlias = `#${joinParam}:${serverName}`;

      const joinResponse = await client.joinRoom(roomAlias);
      const matrixRoomId = joinResponse.roomId;

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

      sessionStorage.setItem('hush_matrixRoomId', matrixRoomId);
      sessionStorage.setItem('hush_channelId', matrixRoomId);
      sessionStorage.setItem('hush_roomName', joinParam);
      sessionStorage.setItem('hush_displayName', displayName);

      navigate(`/room/${encodeURIComponent(joinParam)}`);
    } catch (err) {
      setError(getFriendlyCreateJoinError(err));
      if (sessionStorage.getItem(GUEST_SESSION_KEY) === '1') {
        logout().catch(() => {});
      }
    } finally {
      setLoading(false);
    }
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

      // Step 2: Create Matrix room with E2EE
      const client = getMatrixClient();
      let matrixRoomId;

      const canCreateRes = await fetch('/api/rooms/can-create');
      if (canCreateRes.status === 404) {
        throw new Error(
          'Room availability check is not available. Ensure the server is running and up to date.',
        );
      }
      const canCreateData = await canCreateRes.json().catch(() => ({}));
      if (!canCreateData.allowed) {
        throw new Error(canCreateData.reason || 'All guest rooms are full.');
      }

      // Always append a random 8-hex suffix to the alias to avoid collisions
      // and prevent leaking info about existing room names.
      // Display name stays as what the user typed.
      const suffix = Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
      const actualRoomName = `${roomName}-${suffix}`;

      const createResponse = await client.createRoom({
        name: roomName,
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
          {
            type: 'm.room.join_rules',
            state_key: '',
            content: { join_rule: 'public' },
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

      // Store actual room name used (with suffix) for join path and display
      sessionStorage.setItem('hush_actualRoomName', actualRoomName);

      const createdAt = Date.now();
      await client.sendStateEvent(matrixRoomId, 'io.hush.room.created_at', '', { created_at: createdAt });
      try {
        await fetch('/api/rooms/created', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: matrixRoomId, roomName: actualRoomName, createdAt }),
        });
      } catch (e) {
        console.warn('[home] Failed to register room for expiry:', e);
      }

      sessionStorage.setItem('hush_matrixRoomId', matrixRoomId);
      sessionStorage.setItem('hush_channelId', matrixRoomId);
      sessionStorage.setItem('hush_roomName', actualRoomName);
      sessionStorage.setItem('hush_displayName', displayName);

      navigate(`/room/${encodeURIComponent(actualRoomName)}`);
    } catch (err) {
      setError(getFriendlyCreateJoinError(err));
      // Auto-end guest session on create/join failure so the disposable account is transparent
      if (sessionStorage.getItem(GUEST_SESSION_KEY) === '1') {
        logout().catch(() => {});
      }
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

          {/* Subtitle — fixed width so "share your screen. keep your privacy." is centered; longer words overflow right */}
          <motion.div
            style={{
              ...styles.logoSub,
              display: 'inline-block',
              width: subtitleWidthPx ?? 'auto',
              textAlign: 'left',
              overflow: 'visible',
              position: 'relative',
              whiteSpace: 'nowrap',
              marginLeft: '-6px', // positive = shift right, negative = shift left (e.g. '12px' or '-8px')
            }}
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: {
                transition: { staggerChildren: 0.08, delayChildren: 0.3 },
              },
            }}
          >
            <span
              ref={subtitleGhostRef}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                visibility: 'hidden',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}
              aria-hidden="true"
            >
              {SUBTITLE_WORDS.map((word, i) => (
                <span key={i} style={{ display: 'inline-block', marginRight: '0.25em' }}>
                  {word}
                </span>
              ))}
              <span style={{ display: 'inline-block' }}>{FIRST_TYPEWRITER_WORD}</span>
            </span>
            {SUBTITLE_WORDS.map((word, i) => (
              <motion.span
                key={i}
                style={{ display: 'inline-block', marginRight: '0.25em' }}
                variants={wordVariants}
              >
                {word}
              </motion.span>
            ))}
            <TypewriterSlot />
          </motion.div>
        </motion.div>


        {/* E2EE badge — trust signal between logo and form */}
        <motion.div
          style={{ textAlign: 'center', marginBottom: '16px' }}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: 0.6 }}
        >
          <span style={styles.e2eeBadge}>
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            end-to-end encrypted
          </span>
        </motion.div>
        {/* Form card — slides up on mount, glass panel */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
          className="glass"
          style={{ padding: '24px' }}
        >
          {/* Logout only for persistent accounts; never show in guest flow (avoids flash before isGuestSession updates) */}
          {isAuthenticated && !isGuestSession && authView !== AUTH_VIEW.GUEST && (
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
                Logout
              </button>
            </div>
          )}

          {isAuthenticated || authView === AUTH_VIEW.GUEST ? (
            <>
              {authView === AUTH_VIEW.GUEST && !joinParam && (
                <button
                  type="button"
                  className="back-link"
                  onClick={() => { setAuthView(AUTH_VIEW.CHOOSE); setError(''); }}
                >
                  ← Back
                </button>
              )}

              {joinParam ? (
                /* Simplified join form when ?join= is present */
                <form style={styles.form} onSubmit={handleJoinSubmit}>
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

                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={loading || matrixLoading}
                    style={{ width: '100%', padding: '12px' }}
                  >
                    {loading || matrixLoading ? 'connecting...' : 'join room'}
                  </button>
                </form>
              ) : (
                /* Normal create room form */
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
                      placeholder="Choose a room name"
                      value={roomName}
                      onChange={(e) => setRoomName(e.target.value)}
                      required
                      maxLength={50}
                    />
                  </div>

                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={loading || matrixLoading}
                    style={{ width: '100%', padding: '12px' }}
                  >
                    {loading || matrixLoading ? 'connecting...' : 'create room'}
                  </button>
                </form>
              )}
            </>
          ) : authView === AUTH_VIEW.CHOOSE ? (
            <>
              <div className="home-auth-choices" style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '24px', background: 'var(--hush-surface)', padding: '3px', borderRadius: 'var(--radius-md)' }}>
                <button
                  type="button"
                  className="home-auth-choice-btn"
                  disabled
                  title="Sign in is not fully supported yet"
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
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={matrixLoading}
                  style={{ width: '100%', padding: '12px' }}
                >
                  {matrixLoading ? 'Signing in...' : 'Sign in'}
                </button>
              </form>
              {ssoProviders.length > 0 && (
                <>
                  <p style={{ fontSize: '0.85rem', color: 'var(--hush-text-muted)', marginTop: '16px', marginBottom: '8px', textAlign: 'center' }}>or</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {ssoProviders.map((idp) => (
                      <button
                        key={idp.id || 'sso'}
                        type="button"
                        className="btn"
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          background: 'var(--hush-surface)',
                          border: '1px solid var(--hush-border)',
                          color: 'var(--hush-text)',
                          cursor: 'pointer',
                        }}
                        onClick={() => startSsoLogin(idp.id || undefined, SSOAction.LOGIN)}
                      >
                        Continue with {idp.name}
                      </button>
                    ))}
                  </div>
                  {loginFlowsError && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--hush-text-muted)', marginTop: '8px', textAlign: 'center' }}>
                      Unable to load sign-in options
                    </p>
                  )}
                </>
              )}
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
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={matrixLoading}
                  style={{ width: '100%', padding: '12px' }}
                >
                  {matrixLoading ? 'Creating account...' : 'Create account'}
                </button>
              </form>
              {ssoProviders.length > 0 && (
                <>
                  <p style={{ fontSize: '0.85rem', color: 'var(--hush-text-muted)', marginTop: '16px', marginBottom: '8px', textAlign: 'center' }}>or</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {ssoProviders.map((idp) => (
                      <button
                        key={idp.id || 'sso'}
                        type="button"
                        className="btn"
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          background: 'var(--hush-surface)',
                          border: '1px solid var(--hush-border)',
                          color: 'var(--hush-text)',
                          cursor: 'pointer',
                        }}
                        onClick={() => startSsoLogin(idp.id || undefined, SSOAction.REGISTER)}
                      >
                        Continue with {idp.name}
                      </button>
                    ))}
                  </div>
                  {loginFlowsError && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--hush-text-muted)', marginTop: '8px', textAlign: 'center' }}>
                      Unable to load sign-in options
                    </p>
                  )}
                </>
              )}
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
              <span style={{ display: 'inline-block' }}>hush is open source and self-hostable.</span>
              {' '}
              <span style={{ display: 'inline-block' }}>
                <a href="https://github.com/YarinCardillo/hush-app" style={styles.footerLink}>
                  github
                </a>
                {' · '}
                <Link to="/roadmap" style={styles.footerLink}>
                  roadmap
                </Link>
              </span>
            </div>
            <div style={styles.footerMeta}>
              <span style={{ display: 'inline-block' }}>
                <span>v{APP_VERSION}</span>
                <span>{' · '}</span>
                <span>powered by{' '}
                <a href="https://matrix.org/" target="_blank" rel="noopener noreferrer" style={styles.footerLink}>
                  Matrix
                </a>
                </span>
              </span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Error toast: fixed position, auto fade-out after 4s */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            key="toast"
            style={styles.errorToast}
            role="alert"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
