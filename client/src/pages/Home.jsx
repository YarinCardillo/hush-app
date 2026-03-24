import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { APP_VERSION } from '../utils/constants';
import { useAuth } from '../contexts/AuthContext';
import { useInstanceContext } from '../contexts/InstanceContext';
import { slugify } from '../lib/slugify';
import { GUEST_SESSION_KEY } from '../hooks/useAuth';
import { RegistrationWizard } from '../components/auth/RegistrationWizard';
import { RecoveryPhraseInput } from '../components/auth/RecoveryPhraseInput';
import { PinUnlockScreen } from '../components/auth/PinUnlockScreen';
import { PinSetupModal } from '../components/auth/PinSetupModal';

const SUBTITLE_WORDS = ['share', 'your', 'screen.', 'keep', 'your'];

const _TYPEWRITER_POOL = [
  'secrets',
  'aliases',
  'data',
  'silence',
  'whispers',
  'scrolls',
  'cookies',
  'DMs',
  'chats',
  'burners',
  'typing',
  'thoughts',
  'flings',
  'villain arc',
  'binges',
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
  e2eeBadge: (active) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '3px 10px',
    background: active ? 'var(--hush-amber-ghost)' : 'rgba(85, 85, 104, 0.08)',
    color: active ? 'var(--hush-amber)' : 'var(--hush-text-muted)',
    fontSize: '0.65rem',
    fontWeight: 500,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    border: '1px solid transparent',
    borderRadius: 0,
    userSelect: 'none',
    textDecoration: active ? 'none' : 'line-through',
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
    overflowWrap: 'break-word',
    wordBreak: 'break-word',
  },
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
  footerLink: {
    color: 'var(--hush-amber-dim)',
    textDecoration: 'none',
  },
  sectionTitle: {
    fontSize: '0.75rem',
    fontWeight: 500,
    color: 'var(--hush-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: '12px',
  },
};

/**
 * Auth UI view states. Drives what is shown in the glass card.
 */
const AUTH_VIEW = {
  CHOOSE: 'choose',
  RECOVERY: 'recovery',
  REGISTER_WIZARD: 'register_wizard',
  PIN_UNLOCK: 'pin_unlock',
  PIN_SETUP: 'pin_setup',
  GUEST: 'guest',
};

/** Maps raw auth/join errors to short, user-facing messages. */
function getFriendlyError(err) {
  if (!err) return '';
  const msg = err?.message || String(err);
  if (/not found|404/i.test(msg)) return 'Not found. Please try again.';
  if (/forbidden|403/i.test(msg)) return 'Access denied.';
  if (/conflict|409|already/i.test(msg)) return 'Username already taken. Please choose another.';
  if (/unauthorized|401/i.test(msg)) return 'Invalid credentials.';
  if (/no account found|key not found|unknown key/i.test(msg)) {
    return 'No account found for this recovery phrase. If you have lost all your devices, you will need to create a new account.';
  }
  return msg || 'Something went wrong. Please try again.';
}

export default function Home() {
  const navigate = useNavigate();
  const {
    vaultState,
    user,
    performRegister,
    performRecovery,
    performGuestLogin,
    unlockVault,
    lockVault,
    setPIN,
    performLogout,
    isAuthenticated,
    loading: authLoading,
    error: authError,
    clearError,
  } = useAuth();
  const [searchParams] = useSearchParams();
  const joinParam = searchParams.get('join');

  const [authView, setAuthView] = useState(
    joinParam ? AUTH_VIEW.GUEST : AUTH_VIEW.CHOOSE,
  );
  const [hasPinSetup, setHasPinSetup] = useState(false);
  const [isPinSetupLoading, setIsPinSetupLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const [guestDisplayName, setGuestDisplayName] = useState(
    () => localStorage.getItem('hush_displayName') || '',
  );
  const [guestLoading, setGuestLoading] = useState(false);

  // Handshake data — read from sessionStorage if available (populated by App.jsx).
  const [handshakeData] = useState(() => {
    try {
      const raw = sessionStorage.getItem('hush_handshake');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const registrationMode = handshakeData?.registration_mode ?? 'open';
  const e2eeActive =
    handshakeData?.e2ee?.chat === true && handshakeData?.e2ee?.media === true;

  const spotlightRef = useRef(null);
  const rafRef = useRef(null);
  const posRef = useRef({ x: -1000, y: -1000 });
  const smoothRef = useRef({ x: -1000, y: -1000 });
  const wordmarkRef = useRef(null);
  const subtitleGhostRef = useRef(null);
  const [subtitleWidthPx, setSubtitleWidthPx] = useState(null);
  const [dotLeft, setDotLeft] = useState(null);
  const [spotlightEnabled, setSpotlightEnabled] = useState(
    () => (typeof window !== 'undefined' ? !window.matchMedia('(pointer: coarse)').matches : false),
  );

  // ── Multi-instance state ──────────────────────────────────────────────────

  const { mergedGuilds, bootInstance } = useInstanceContext();

  // ── Vault state -> view routing ─────────────────────────────────────────────

  useEffect(() => {
    if (authLoading) return;

    if (vaultState === 'locked') {
      setAuthView(AUTH_VIEW.PIN_UNLOCK);
      return;
    }

    if (vaultState === 'unlocked' || vaultState === 'guest') {
      // Don't navigate away while PIN setup is in progress — let the user set a PIN first.
      if (authView === AUTH_VIEW.PIN_SETUP) return;

      // Navigate to invite if a joinParam is present.
      if (joinParam) {
        navigate(`/invite/${encodeURIComponent(joinParam)}`, { replace: true });
        return;
      }

      // Navigate to first guild via instance-aware route, or /home for empty state.
      if (mergedGuilds.length > 0) {
        const first = mergedGuilds[0];
        const instanceHost = first.instanceUrl
          ? new URL(first.instanceUrl).host
          : null;
        const guildSlug = slugify(first._localName ?? first.name ?? first.id ?? 'guild');
        if (instanceHost) {
          navigate(`/${instanceHost}/${guildSlug}`, { replace: true });
          return;
        }
      }

      // No guilds or no instance host available — go to the empty state page.
      navigate('/home', { replace: true });
      return;
    }

    // vaultState === 'none' — show login/register
    if (authView === AUTH_VIEW.PIN_UNLOCK || authView === AUTH_VIEW.PIN_SETUP) {
      setAuthView(AUTH_VIEW.CHOOSE);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultState, authLoading, mergedGuilds]);

  // ── Error toast ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const msg = authError ? getFriendlyError(authError) : null;
    setToastMessage(msg);
    if (!msg) return;
    const id = setTimeout(() => {
      setToastMessage(null);
      clearError?.();
    }, 5000);
    return () => clearTimeout(id);
  }, [authError, clearError]);

  // ── Spotlight (cursor follow, desktop only) ─────────────────────────────────

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

  // ── Auth action handlers ────────────────────────────────────────────────────

  const handleRegisterComplete = useCallback(async ({ username, displayName, mnemonic, inviteCode }) => {
    try {
      await performRegister(username, displayName, mnemonic, inviteCode);
      // Boot the current origin as an instance so useInstances tracks it.
      bootInstance(window.location.origin).catch((err) => {
        console.warn('[Home] instance boot after register failed:', err);
      });
      // After successful register, prompt for PIN setup (vault is unlocked but no PIN yet).
      setAuthView(AUTH_VIEW.PIN_SETUP);
    } catch {
      // Error surfaces via authError toast. Wizard stays on SUBMITTING for parent to handle.
    }
  }, [performRegister, bootInstance]);

  const handleRecoverySubmit = useCallback(async (mnemonic, revokeOtherDevices) => {
    try {
      await performRecovery(mnemonic, revokeOtherDevices);
      // Boot the current origin as an instance so useInstances tracks it.
      bootInstance(window.location.origin).catch((err) => {
        console.warn('[Home] instance boot after recovery failed:', err);
      });
      // On success, vaultState becomes 'unlocked' and the useEffect above navigates.
      // If no vault PIN was previously set, prompt for PIN setup.
      setAuthView(AUTH_VIEW.PIN_SETUP);
    } catch {
      // Error surfaces via authError toast.
    }
  }, [performRecovery, bootInstance]);

  const handlePinUnlock = useCallback(async (pin) => {
    await unlockVault(pin);
    // On success, vaultState becomes 'unlocked' and the useEffect navigates.
  }, [unlockVault]);

  const handleSwitchAccount = useCallback(async () => {
    try {
      await performLogout();
    } catch {
      // Best-effort; proceed regardless.
    }
    setAuthView(AUTH_VIEW.RECOVERY);
  }, [performLogout]);

  const handlePinSetup = useCallback(async (pin) => {
    setIsPinSetupLoading(true);
    try {
      await setPIN(pin);
      setHasPinSetup(true);
      // Navigate to invite or /home; vault routing effect handles guild redirect.
      const target = joinParam
        ? `/invite/${encodeURIComponent(joinParam)}`
        : '/home';
      navigate(target, { replace: true });
    } catch (err) {
      // Error shown in PinSetupModal.
      throw err;
    } finally {
      setIsPinSetupLoading(false);
    }
  }, [setPIN, joinParam, navigate]);

  const handlePinSetupSkip = useCallback(() => {
    const target = joinParam
      ? `/invite/${encodeURIComponent(joinParam)}`
      : '/home';
    navigate(target, { replace: true });
  }, [joinParam, navigate]);

  const handleGuestSubmit = useCallback(async (e) => {
    e.preventDefault();
    setGuestLoading(true);
    try {
      localStorage.setItem('hush_displayName', guestDisplayName);
      await performGuestLogin(joinParam || undefined);
    } catch (err) {
      setToastMessage(getFriendlyError(err));
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setGuestLoading(false);
    }
  }, [guestDisplayName, performGuestLogin, joinParam]);

  // ── View content ─────────────────────────────────────────────────────────────

  const renderFormContent = () => {
    if (authLoading) {
      return (
        <div style={{ textAlign: 'center', color: 'var(--hush-text-muted)', padding: '24px 0', fontSize: '0.85rem' }}>
          Loading...
        </div>
      );
    }

    if (authView === AUTH_VIEW.PIN_UNLOCK) {
      return (
        <PinUnlockScreen
          username={user?.username || user?.display_name || 'Your account'}
          avatarUrl={null}
          onUnlock={handlePinUnlock}
          onSwitchAccount={handleSwitchAccount}
        />
      );
    }

    if (authView === AUTH_VIEW.PIN_SETUP) {
      return (
        <>
          <div style={{ marginBottom: '12px' }}>
            <div style={styles.sectionTitle}>Secure your identity</div>
          </div>
          <PinSetupModal
            onSetPin={handlePinSetup}
            onSkip={handlePinSetupSkip}
            isLoading={isPinSetupLoading}
          />
        </>
      );
    }

    if (authView === AUTH_VIEW.REGISTER_WIZARD) {
      return (
        <RegistrationWizard
          onComplete={handleRegisterComplete}
          onCancel={() => { setAuthView(AUTH_VIEW.CHOOSE); clearError?.(); }}
          registrationMode={registrationMode}
          isLoading={authLoading}
          error={authError}
        />
      );
    }

    if (authView === AUTH_VIEW.RECOVERY) {
      return (
        <>
          <div style={{ marginBottom: '8px' }}>
            <div style={styles.sectionTitle}>Sign in with recovery phrase</div>
          </div>
          <RecoveryPhraseInput
            onSubmit={handleRecoverySubmit}
            onCancel={() => { setAuthView(AUTH_VIEW.CHOOSE); clearError?.(); }}
            isRecoveryMode={true}
            isLoading={authLoading}
          />
        </>
      );
    }

    if (authView === AUTH_VIEW.GUEST || joinParam) {
      return (
        <>
          {!joinParam && (
            <button
              type="button"
              className="back-link"
              onClick={() => setAuthView(AUTH_VIEW.CHOOSE)}
            >
              ← Back
            </button>
          )}
          <form style={styles.form} onSubmit={handleGuestSubmit}>
            <div>
              <label htmlFor="guest-display-name" style={styles.fieldLabel}>Your name</label>
              <input
                id="guest-display-name"
                name="display-name"
                className="input"
                type="text"
                placeholder="How others will see you"
                value={guestDisplayName}
                onChange={(e) => setGuestDisplayName(e.target.value)}
                required
                maxLength={30}
                autoComplete="off"
              />
            </div>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={guestLoading || authLoading}
              style={{ width: '100%', padding: '12px' }}
            >
              {guestLoading || authLoading ? 'Connecting...' : joinParam ? 'Join' : 'Try Hush'}
            </button>
          </form>
        </>
      );
    }

    // Default: CHOOSE view
    return (
      <>
        <div
          className="home-auth-choices"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            marginBottom: '16px',
            background: 'var(--hush-surface)',
            padding: '3px',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <button
            type="button"
            className="home-auth-choice-btn"
            onClick={() => setAuthView(AUTH_VIEW.RECOVERY)}
          >
            Sign in with recovery phrase
          </button>
          <button
            type="button"
            className="home-auth-choice-btn"
            onClick={() => setAuthView(AUTH_VIEW.GUEST)}
          >
            Try as guest
          </button>
        </div>

        {registrationMode !== 'closed' && (
          <p style={{ fontSize: '0.82rem', color: 'var(--hush-text-muted)', textAlign: 'center', margin: 0 }}>
            New here?{' '}
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
              onClick={() => setAuthView(AUTH_VIEW.REGISTER_WIZARD)}
            >
              Create an account
            </button>
          </p>
        )}
      </>
    );
  };

  return (
    <div style={styles.page} onMouseMove={handleMouseMove}>
      {/* Cursor spotlight */}
      {spotlightEnabled && (
        <div ref={spotlightRef} style={styles.spotlightWrapper}>
          <div style={styles.spotlight} />
        </div>
      )}

      <div style={styles.container}>
        {/* Logo */}
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

          {/* Subtitle */}
          <motion.div
            style={{
              ...styles.logoSub,
              display: 'inline-block',
              width: subtitleWidthPx ?? 'auto',
              textAlign: 'left',
              overflow: 'visible',
              position: 'relative',
              whiteSpace: 'nowrap',
              marginLeft: '-6px',
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

        {/* E2EE badge */}
        <motion.div
          style={{ textAlign: 'center', marginBottom: '16px' }}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: 0.6 }}
        >
          <span style={styles.e2eeBadge(e2eeActive)}>
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

        {/* Form card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
          className="glass"
          style={{ padding: '24px' }}
        >
          {renderFormContent()}

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
                {' · '}
                <Link to="/mascot-demo" style={styles.footerLink}>
                  meet vesper
                </Link>
              </span>
            </div>
            <div style={styles.footerMeta}>
              <span style={{ display: 'inline-block' }}>v{APP_VERSION}</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Error toast */}
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
