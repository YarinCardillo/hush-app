import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { APP_VERSION } from '../utils/constants';
import { useAuth } from '../contexts/AuthContext';
import { useInstanceContext } from '../contexts/InstanceContext';
import { slugify } from '../lib/slugify';
import { getHandshake } from '../lib/api';
import { AuthInstanceSelector } from '../components/auth/AuthInstanceSelector.jsx';
import { RegistrationWizard, hasInterruptedRegistration } from '../components/auth/RegistrationWizard';
import { RecoveryPhraseInput } from '../components/auth/RecoveryPhraseInput';
import { PinUnlockScreen } from '../components/auth/PinUnlockScreen';
import { PinSetupModal } from '../components/auth/PinSetupModal';
import { BODY_SCROLL_MODE, useBodyScrollMode } from '../hooks/useBodyScrollMode';
import { useAuthInstanceSelection } from '../hooks/useAuthInstanceSelection.js';

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

const HOME_PAGE_SCROLL_STYLE = {
  height: '100%',
  minHeight: '100dvh',
  overflowY: 'auto',
  overflowX: 'hidden',
  WebkitOverflowScrolling: 'touch',
};

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

/**
 * Auth UI view states. Drives what is shown in the glass card.
 */
const AUTH_VIEW = {
  CHOOSE: 'choose',
  RECOVERY: 'recovery',
  REGISTER_WIZARD: 'register_wizard',
  PIN_UNLOCK: 'pin_unlock',
  PIN_SETUP: 'pin_setup',
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
  useBodyScrollMode(BODY_SCROLL_MODE.SCROLL);

  const navigate = useNavigate();
  const {
    vaultState,
    user,
    performRegister,
    performRecovery,
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

  const [authView, setAuthView] = useState(AUTH_VIEW.CHOOSE);
  const [hasPinSetup, setHasPinSetup] = useState(false);
  const [isPinSetupLoading, setIsPinSetupLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  const {
    selectedInstanceUrl,
    knownInstances,
    chooseInstance,
    rememberSelectedInstance,
  } = useAuthInstanceSelection();

  // Handshake data for the selected auth instance.
  const [handshakeData, setHandshakeData] = useState(null);

  useEffect(() => {
    let cancelled = false;

    getHandshake(selectedInstanceUrl)
      .then((data) => {
        if (!cancelled) setHandshakeData(data);
      })
      .catch(() => {
        if (!cancelled) setHandshakeData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedInstanceUrl]);

  const registrationMode = handshakeData?.registration_mode ?? 'open';
  const caps = handshakeData?.capabilities ?? handshakeData?.Capabilities ?? {};
  const e2eeActive = caps['e2ee.chat'] === true && caps['e2ee.media'] === true;

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

  const { mergedGuilds, registerLocalInstance } = useInstanceContext();

  // ── Resume interrupted registration (iOS page discard recovery) ────────────
  useEffect(() => {
    if (authLoading || vaultState === 'locked' || vaultState === 'unlocked') return;
    hasInterruptedRegistration().then((has) => {
      if (has) setAuthView(AUTH_VIEW.REGISTER_WIZARD);
    });
  }, [authLoading, vaultState]);

  // ── Vault state -> view routing ─────────────────────────────────────────────

  useEffect(() => {
    if (authLoading) return;

    if (vaultState === 'locked') {
      setAuthView(AUTH_VIEW.PIN_UNLOCK);
      return;
    }

    if (vaultState === 'unlocked') {
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
    const instanceUrl = await chooseInstance(selectedInstanceUrl);
    try {
      const result = await performRegister(username, displayName, mnemonic, inviteCode);
      await rememberSelectedInstance(instanceUrl);
      // Use the returned user — React state (setUser) hasn't flushed yet.
      const jwt = sessionStorage.getItem('hush_jwt');
      const authUser = result?.user;
      if (jwt && authUser) {
        registerLocalInstance(jwt, { id: authUser.id, username: authUser.username }).catch((err) => {
          console.warn('[Home] registerLocalInstance after register failed:', err);
        });
      }
      setAuthView(AUTH_VIEW.PIN_SETUP);
    } catch {
      // Error surfaces via authError toast.
    }
  }, [chooseInstance, performRegister, registerLocalInstance, rememberSelectedInstance, selectedInstanceUrl]);

  const handleRecoverySubmit = useCallback(async (mnemonic, revokeOtherDevices) => {
    const instanceUrl = await chooseInstance(selectedInstanceUrl);
    try {
      const result = await performRecovery(mnemonic, revokeOtherDevices);
      await rememberSelectedInstance(instanceUrl);
      const jwt = sessionStorage.getItem('hush_jwt');
      const authUser = result?.user;
      if (jwt && authUser) {
        registerLocalInstance(jwt, { id: authUser.id, username: authUser.username }).catch((err) => {
          console.warn('[Home] registerLocalInstance after recovery failed:', err);
        });
      }
      setAuthView(AUTH_VIEW.PIN_SETUP);
    } catch {
      // Error surfaces via authError toast.
    }
  }, [chooseInstance, performRecovery, registerLocalInstance, rememberSelectedInstance, selectedInstanceUrl]);

  const handlePinUnlock = useCallback(async (pin) => {
    const instanceUrl = await chooseInstance(selectedInstanceUrl);
    const result = await unlockVault(pin);
    await rememberSelectedInstance(instanceUrl);
    // If unlockVault re-authenticated (tab was closed), boot the local instance
    // so guilds appear immediately.
    const authUser = result?.user;
    if (authUser) {
      const jwt = sessionStorage.getItem('hush_jwt');
      if (jwt) {
        registerLocalInstance(jwt, { id: authUser.id, username: authUser.username }).catch((err) => {
          console.warn('[Home] registerLocalInstance after PIN unlock failed:', err);
        });
      }
    }
  }, [chooseInstance, rememberSelectedInstance, selectedInstanceUrl, unlockVault, registerLocalInstance]);

  const handleSwitchAccount = useCallback(() => {
    // Don't wipe the vault yet — user might press Back.
    // Vault is only wiped if the recovery phrase login succeeds
    // (performRecovery will overwrite the vault with the new identity).
    setAuthView(AUTH_VIEW.RECOVERY);
  }, []);

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

  // ── View content ─────────────────────────────────────────────────────────────

  const renderFormContent = () => {
    if (authLoading) {
      return (
        <div className="home-loading">
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
          <div className="home-pin-setup-header">
            <div className="home-section-title">Secure your identity</div>
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
          <div className="home-recovery-header">
            <div className="home-section-title">Sign in</div>
          </div>
          <RecoveryPhraseInput
            onSubmit={handleRecoverySubmit}
            onCancel={() => {
              clearError?.();
              // If vault still exists (user came from PIN screen via "Not you?"),
              // go back to PIN — don't wipe anything.
              setAuthView(vaultState === 'locked' ? AUTH_VIEW.PIN_UNLOCK : AUTH_VIEW.CHOOSE);
            }}
            isRecoveryMode={true}
            isLoading={authLoading}
          />
        </>
      );
    }

    // Default: CHOOSE view
    return (
      <>
        <div className="home-auth-choices">
          <button
            type="button"
            className="home-auth-choice-btn"
            onClick={() => setAuthView(AUTH_VIEW.RECOVERY)}
          >
            Sign in
          </button>
          <Link className="home-auth-choice-btn" to="/link-device?mode=new">
            Link to existing device
          </Link>
        </div>

        {registrationMode !== 'closed' && (
          <p className="home-register-hint">
            New here?{' '}
            <button
              type="button"
              className="home-register-link"
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
    <div className="home-page" onMouseMove={handleMouseMove} style={HOME_PAGE_SCROLL_STYLE}>
      {/* Cursor spotlight */}
      {spotlightEnabled && (
        <div ref={spotlightRef} className="home-spotlight-wrapper">
          <div className="home-spotlight" />
        </div>
      )}

      <div className="home-container">
        {/* Logo */}
        <motion.div
          className="home-logo"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div className="home-logo-inner">
            <div className="home-logo-title" ref={wordmarkRef}>
              hush
              <motion.div
                style={{
                  position: 'absolute',
                  top: '20px',
                  left: dotLeft != null ? `${dotLeft}px` : '38%',
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  background: 'var(--hush-amber)',
                  boxShadow: '0 0 12px var(--hush-amber), 0 0 28px rgba(213, 79, 18, 0.3)',
                }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            <motion.div
              className="home-logo-glow"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0, 0.7, 0.15], scale: [0.8, 1.2, 1] }}
              transition={{ duration: 1.2, delay: 0.2, ease: 'easeOut' }}
            />
          </div>

          {/* Subtitle */}
          <motion.div
            className="home-logo-sub"
            style={{
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
          className="home-e2ee-badge-wrap"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: 0.6 }}
        >
          <span className={`home-e2ee-badge ${e2eeActive ? 'home-e2ee-badge--active' : 'home-e2ee-badge--inactive'}`}>
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
          className="glass home-form-card"
        >
          {authView !== AUTH_VIEW.PIN_SETUP && (
            <AuthInstanceSelector
              value={selectedInstanceUrl}
              instances={knownInstances}
              onSelect={chooseInstance}
              disabled={authLoading}
            />
          )}

          {renderFormContent()}

          <div className="home-footer">
            <div>
              <span style={{ display: 'inline-block' }}>hush is open source and self-hostable.</span>
              {' '}
              <span style={{ display: 'inline-block' }}>
                <a href="https://github.com/YarinCardillo/hush-app" className="home-footer-link">
                  github
                </a>
                {' · '}
                <Link to="/roadmap" className="home-footer-link">
                  roadmap
                </Link>
              </span>
            </div>
            <div className="home-footer-meta">
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
            className="home-error-toast"
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
