import { useState, useEffect, useCallback, useRef } from 'react';
import { generateIdentityMnemonic } from '../../lib/bip39Identity';
import { checkUsernameAvailable } from '../../lib/api';
import { MnemonicGrid } from './MnemonicGrid';
import { MnemonicConfirm } from './MnemonicConfirm';

const STEP = {
  INVITE_CODE: 'INVITE_CODE',
  USERNAME: 'USERNAME',
  MNEMONIC_DISPLAY: 'MNEMONIC_DISPLAY',
  MNEMONIC_CONFIRM: 'MNEMONIC_CONFIRM',
  SUBMITTING: 'SUBMITTING',
};

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;
const USERNAME_CHECK_DEBOUNCE_MS = 500;

/** Returns inline color for username hint based on validation state. */
function usernameHintStyle(state) {
  return {
    fontSize: '0.72rem',
    marginTop: '4px',
    color:
      state === 'ok'
        ? 'var(--hush-live)'
        : state === 'taken' || state === 'invalid'
        ? 'var(--hush-danger)'
        : 'var(--hush-text-muted)',
    fontFamily: 'var(--font-mono)',
  };
}

/** Returns inline style for a step dot based on active/done state. */
function stepDotStyle(active, done) {
  return {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: active
      ? 'var(--hush-amber)'
      : done
      ? 'var(--hush-text-muted)'
      : 'var(--hush-border)',
    transition: 'background var(--duration-normal)',
  };
}

/** Returns an array of visible step indices (excluding INVITE_CODE when not invite_only). */
function getVisibleSteps(registrationMode) {
  const steps = [];
  if (registrationMode === 'invite_only') steps.push(STEP.INVITE_CODE);
  steps.push(STEP.USERNAME, STEP.MNEMONIC_DISPLAY, STEP.MNEMONIC_CONFIRM);
  return steps;
}

function hasAdvancedPastUsername(step, visibleSteps) {
  const usernameIndex = visibleSteps.indexOf(STEP.USERNAME);
  const currentIndex = visibleSteps.indexOf(step);
  return usernameIndex !== -1 && currentIndex > usernameIndex;
}

/**
 * Multi-step registration wizard.
 *
 * @param {{
 *   onComplete: (data: { username: string, displayName: string, mnemonic: string, inviteCode?: string }) => Promise<void>,
 *   onCancel: () => void,
 *   registrationMode?: 'open' | 'invite_only' | 'closed',
 *   instanceUrl?: string,
 *   instanceName?: string,
 *   onInstanceLockedChange?: (locked: boolean) => void,
 *   isLoading?: boolean,
 *   error?: Error|null,
 * }} props
 */
const REG_SESSION_KEY = 'hush_reg_wizard';
const REG_IDB_NAME = 'hush-reg-wizard';
const REG_IDB_STORE = 'state';
const REG_STATE_TTL_MS = 10 * 60_000; // 10 minutes — users need time to write down 12 words

function createFreshMnemonicState() {
  const mnemonic = generateIdentityMnemonic();
  return {
    mnemonic,
    mnemonicWords: mnemonic.split(' '),
  };
}

function normalizeRestoredStep(step, visibleSteps, initialStep, pastDisplayStep) {
  if (pastDisplayStep) return STEP.MNEMONIC_CONFIRM;
  if (step === STEP.SUBMITTING) return STEP.MNEMONIC_CONFIRM;
  return visibleSteps.includes(step) ? step : initialStep;
}

/**
 * Open a tiny IDB database for registration wizard state.
 * Survives iOS page discards where sessionStorage is wiped.
 */
function openRegIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(REG_IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(REG_IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveWizardStateToIDB(state) {
  try {
    const db = await openRegIDB();
    const tx = db.transaction(REG_IDB_STORE, 'readwrite');
    tx.objectStore(REG_IDB_STORE).put({ ...state, savedAt: Date.now() }, 'wizard');
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  } catch { /* best-effort */ }
}

async function loadWizardStateFromIDB() {
  try {
    const db = await openRegIDB();
    const tx = db.transaction(REG_IDB_STORE, 'readonly');
    const req = tx.objectStore(REG_IDB_STORE).get('wizard');
    const result = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
    db.close();
    if (!result) return null;
    if (result.savedAt && Date.now() - result.savedAt > REG_STATE_TTL_MS) {
      await clearWizardStateFromIDB();
      return null;
    }
    return result;
  } catch { return null; }
}

async function clearWizardStateFromIDB() {
  try {
    const db = await openRegIDB();
    const tx = db.transaction(REG_IDB_STORE, 'readwrite');
    tx.objectStore(REG_IDB_STORE).delete('wizard');
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  } catch { /* best-effort */ }
}

/** Check if there's an interrupted registration in IDB (called from Home.jsx on mount). */
export async function hasInterruptedRegistration() {
  const state = await loadWizardStateFromIDB();
  return state !== null;
}

function loadSavedWizardState() {
  try {
    const raw = sessionStorage.getItem(REG_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.savedAt && Date.now() - parsed.savedAt > REG_STATE_TTL_MS) {
      sessionStorage.removeItem(REG_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch { return null; }
}

function saveWizardState(state) {
  try { sessionStorage.setItem(REG_SESSION_KEY, JSON.stringify({ ...state, savedAt: Date.now() })); } catch { /* best-effort */ }
  saveWizardStateToIDB(state); // async, fire-and-forget from caller's perspective
}

function clearWizardState() {
  try { sessionStorage.removeItem(REG_SESSION_KEY); } catch { /* best-effort */ }
  clearWizardStateFromIDB(); // async, fire-and-forget
}

export function RegistrationWizard({
  onComplete,
  onCancel,
  registrationMode = 'open',
  instanceUrl = '',
  instanceName,
  onInstanceLockedChange,
  isLoading = false,
  error,
}) {
  const visibleSteps = getVisibleSteps(registrationMode);
  const initialStep = visibleSteps[0];

  // Try sessionStorage first (sync), then IDB fallback (async) for iOS page discards.
  const syncSaved = useRef(loadSavedWizardState()).current;
  const syncSavedPastDisplayStep = Boolean(syncSaved?.pastDisplayStep);
  const syncSavedPastUsernameStep = Boolean(
    syncSaved?.pastUsernameStep || hasAdvancedPastUsername(syncSaved?.step, visibleSteps),
  );
  const initialMnemonicState = useRef(
    syncSaved?.mnemonic
      ? { mnemonic: syncSaved.mnemonic, mnemonicWords: syncSaved.mnemonic.split(' ') }
      : createFreshMnemonicState(),
  ).current;

  const [step, setStep] = useState(
    normalizeRestoredStep(syncSaved?.step, visibleSteps, initialStep, syncSavedPastDisplayStep),
  );
  const [inviteCode, setInviteCode] = useState(syncSaved?.inviteCode ?? '');
  const [username, setUsername] = useState(syncSaved?.username ?? '');
  const [displayName, setDisplayName] = useState(syncSaved?.displayName ?? '');
  const [mnemonic, setMnemonic] = useState(initialMnemonicState.mnemonic);
  const [mnemonicWords, setMnemonicWords] = useState(initialMnemonicState.mnemonicWords);
  const [challengePositions, setChallengePositions] = useState(syncSaved?.challengePositions ?? null);
  const [pastUsernameStep, setPastUsernameStep] = useState(syncSavedPastUsernameStep);
  const [pastDisplayStep, setPastDisplayStep] = useState(syncSavedPastDisplayStep);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [localError, setLocalError] = useState('');
  const [ignoreExternalError, setIgnoreExternalError] = useState(false);
  const idbRestoredRef = useRef(false);
  const confirmHistoryGuardRef = useRef(false);

  // Async IDB fallback: if sessionStorage was empty (iOS page discard), try IDB.
  useEffect(() => {
    if (syncSaved || idbRestoredRef.current) return;
    idbRestoredRef.current = true;
    loadWizardStateFromIDB().then((idbState) => {
      if (!idbState) return;
      const restoredPastDisplayStep = Boolean(idbState.pastDisplayStep);
      const restoredPastUsernameStep = Boolean(
        idbState.pastUsernameStep || hasAdvancedPastUsername(idbState.step, visibleSteps),
      );
      setStep(
        normalizeRestoredStep(idbState.step, visibleSteps, initialStep, restoredPastDisplayStep),
      );
      setPastUsernameStep(restoredPastUsernameStep);
      setPastDisplayStep(restoredPastDisplayStep);
      setInviteCode(idbState.inviteCode ?? '');
      setUsername(idbState.username ?? '');
      setDisplayName(idbState.displayName ?? '');
      if (idbState.mnemonic) {
        setMnemonic(idbState.mnemonic);
        setMnemonicWords(idbState.mnemonic.split(' '));
      }
      setChallengePositions(idbState.challengePositions?.length === 3 ? idbState.challengePositions : null);
    });
  }, [initialStep, syncSaved, visibleSteps]);

  // Persist wizard state on every change — dual-write to sessionStorage + IDB.
  useEffect(() => {
    saveWizardState({
      step,
      inviteCode,
      username,
      displayName,
      mnemonic,
      challengePositions,
      pastUsernameStep,
      pastDisplayStep,
    });
  }, [
    step,
    inviteCode,
    username,
    displayName,
    mnemonic,
    challengePositions,
    pastUsernameStep,
    pastDisplayStep,
  ]);

  useEffect(() => {
    setIgnoreExternalError(false);
  }, [error]);

  useEffect(() => {
    onInstanceLockedChange?.(pastUsernameStep);
  }, [onInstanceLockedChange, pastUsernameStep]);

  useEffect(() => {
    return () => {
      onInstanceLockedChange?.(false);
    };
  }, [onInstanceLockedChange]);

  // Username availability state: 'idle' | 'checking' | 'ok' | 'taken' | 'invalid' | 'error'
  const [usernameState, setUsernameState] = useState('idle');
  const [usernameRetryKey, setUsernameRetryKey] = useState(0);
  const debounceRef = useRef(null);

  const currentStepIndex = visibleSteps.indexOf(step);
  const totalDots = visibleSteps.length;

  const restartWizard = useCallback(() => {
    const nextMnemonicState = createFreshMnemonicState();
    clearWizardState();
    setInviteCode('');
    setUsername('');
    setDisplayName('');
    setMnemonic(nextMnemonicState.mnemonic);
    setMnemonicWords(nextMnemonicState.mnemonicWords);
    setChallengePositions(null);
    setPastUsernameStep(false);
    setPastDisplayStep(false);
    setSavedConfirmed(false);
    setIgnoreExternalError(true);
    setLocalError('');
    setStep(initialStep);
  }, [initialStep]);

  // Username validation and debounced check.
  useEffect(() => {
    if (!username) {
      setUsernameState('idle');
      return;
    }
    if (!USERNAME_PATTERN.test(username)) {
      setUsernameState('invalid');
      return;
    }
    setUsernameState('checking');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const controller = new AbortController();
    debounceRef.current = setTimeout(async () => {
      try {
        const available = await checkUsernameAvailable(
          username.trim(), instanceUrl, controller.signal,
        );
        if (!controller.signal.aborted) {
          setUsernameState(available ? 'ok' : 'taken');
        }
      } catch {
        if (!controller.signal.aborted) {
          setUsernameState('error');
        }
      }
    }, USERNAME_CHECK_DEBOUNCE_MS);

    return () => {
      controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [instanceUrl, username, usernameRetryKey]);

  const retryUsernameCheck = useCallback(() => {
    if (usernameState === 'error') {
      setUsernameRetryKey((k) => k + 1);
    }
  }, [usernameState]);

  const goBack = useCallback(() => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex < 0) {
      clearWizardState();
      onCancel();
      return;
    }
    setStep(visibleSteps[prevIndex]);
    setLocalError('');
  }, [currentStepIndex, visibleSteps, onCancel]);

  const goNext = useCallback(() => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < visibleSteps.length) {
      setStep(visibleSteps[nextIndex]);
      setLocalError('');
    }
  }, [currentStepIndex, visibleSteps]);

  const handleInviteNext = useCallback(() => {
    if (!inviteCode.trim()) {
      setLocalError('Please enter an invite code.');
      return;
    }
    setLocalError('');
    goNext();
  }, [inviteCode, goNext]);

  const handleUsernameNext = useCallback(() => {
    const trimmedUsername = username.trim();
    const targetInstance = instanceName || 'this instance';

    if (!trimmedUsername) {
      setLocalError('Please enter a username.');
      return;
    }
    if (!USERNAME_PATTERN.test(trimmedUsername)) {
      setLocalError('Username must be 3-20 characters: letters, numbers, and underscores only.');
      return;
    }
    if (usernameState === 'checking') {
      setLocalError(`Checking username availability on ${targetInstance}.`);
      return;
    }
    if (usernameState === 'taken') {
      setLocalError(`Username already taken on ${targetInstance}.`);
      return;
    }
    if (usernameState === 'error') {
      setLocalError(`Could not check username availability on ${targetInstance}. Verify the instance and try again.`);
      return;
    }
    if (usernameState !== 'ok') {
      setLocalError('Choose a valid username to continue.');
      return;
    }
    setPastUsernameStep(true);
    setLocalError('');
    goNext();
  }, [goNext, instanceName, username, usernameState]);

  const handleMnemonicDisplayNext = useCallback(() => {
    if (!savedConfirmed) return;
    setPastDisplayStep(true);
    setStep(STEP.MNEMONIC_CONFIRM);
    setLocalError('');
  }, [savedConfirmed]);

  const handleConfirmComplete = useCallback(async () => {
    setLocalError('');
    setStep(STEP.SUBMITTING);
    try {
      await onComplete({
        username: username.trim(),
        displayName: displayName.trim() || username.trim(),
        mnemonic,
        inviteCode: inviteCode.trim() || undefined,
      });
      clearWizardState();
    } catch (err) {
      setStep(STEP.MNEMONIC_CONFIRM);
      setLocalError(err?.message || 'Failed to create account. Please try again.');
    }
  }, [username, displayName, mnemonic, inviteCode, onComplete]);

  useEffect(() => {
    if (step !== STEP.MNEMONIC_CONFIRM) {
      confirmHistoryGuardRef.current = false;
      return undefined;
    }

    if (!confirmHistoryGuardRef.current) {
      window.history.pushState({ hushRegConfirmGuard: Date.now() }, '', window.location.href);
      confirmHistoryGuardRef.current = true;
    }

    const handlePopState = () => {
      restartWizard();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [restartWizard, step]);

  const displayedError = (!ignoreExternalError ? error?.message : '') || localError;

  return (
    <div className="rw-container">
      {/* Step indicator dots */}
      <div className="rw-step-indicator" aria-hidden="true">
        {visibleSteps.map((s, i) => (
          <div
            key={s}
            style={stepDotStyle(i === currentStepIndex, i < currentStepIndex)}
          />
        ))}
      </div>

      {displayedError && step !== STEP.SUBMITTING && (
        <div className="rw-error" role="alert">
          {displayedError}
        </div>
      )}

      {step === STEP.INVITE_CODE && (
        <InviteCodeStep
          value={inviteCode}
          onChange={setInviteCode}
          onNext={handleInviteNext}
          onCancel={onCancel}
        />
      )}

      {step === STEP.USERNAME && (
        <UsernameStep
          username={username}
          displayName={displayName}
          instanceName={instanceName}
          usernameState={usernameState}
          onUsernameChange={setUsername}
          onDisplayNameChange={setDisplayName}
          onRetry={retryUsernameCheck}
          onNext={handleUsernameNext}
          onBack={goBack}
        />
      )}

      {step === STEP.MNEMONIC_DISPLAY && (
        <MnemonicDisplayStep
          words={mnemonicWords}
          savedConfirmed={savedConfirmed}
          onSavedConfirmedChange={setSavedConfirmed}
          onNext={handleMnemonicDisplayNext}
          onBack={goBack}
        />
      )}

      {step === STEP.MNEMONIC_CONFIRM && (
        <MnemonicConfirm
          words={mnemonicWords}
          onConfirm={handleConfirmComplete}
          onStartOver={restartWizard}
          challengePositions={challengePositions}
          onPositionsSelected={setChallengePositions}
        />
      )}

      {step === STEP.SUBMITTING && (
        <div className="rw-loading">
          <div aria-label="Creating account" role="status">Creating your account...</div>
          {displayedError && (
            <div className="rw-error" role="alert">
              {displayedError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-step components ──────────────────────────────────────────────────────

function InviteCodeStep({ value, onChange, onNext, onCancel }) {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') onNext();
  };

  return (
    <div className="rw-inner">
      <div>
        <p className="rw-heading">Enter invite code</p>
        <p className="rw-subheading">This server requires an invite to register.</p>
      </div>
      <div>
        <label htmlFor="invite-code" className="rw-field-label">Invite code</label>
        <input
          id="invite-code"
          className="input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter your invite code"
          autoComplete="off"
          autoFocus
        />
      </div>
      <div className="rw-actions">
        <button type="button" className="back-link" onClick={onCancel}>
          ← Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!value.trim()}
          onClick={onNext}
          style={{ flex: 1, padding: '10px' }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function UsernameStep({
  username,
  displayName,
  instanceName,
  usernameState,
  onUsernameChange,
  onDisplayNameChange,
  onRetry,
  onNext,
  onBack,
}) {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') onNext();
  };

  const targetInstance = instanceName || 'this instance';
  const isError = usernameState === 'error';
  const usernameHint =
    usernameState === 'invalid'
      ? '3–20 characters: letters, numbers, underscores only'
      : usernameState === 'checking'
      ? `Checking availability on ${targetInstance}...`
      : usernameState === 'taken'
      ? `Username already taken on ${targetInstance}`
      : usernameState === 'ok'
      ? `Available on ${targetInstance}`
      : isError
      ? `Could not reach ${targetInstance}. Tap to retry.`
      : null;

  return (
    <div className="rw-inner">
      <div>
        <p className="rw-heading">Choose a username</p>
        <p className="rw-subheading">Your username is your identity on this server.</p>
      </div>
      <div>
        <label htmlFor="reg-username" className="rw-field-label">Username</label>
        <input
          id="reg-username"
          className="input"
          type="text"
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. alice"
          autoComplete="username"
          autoFocus
        />
        {usernameHint && (
          <div
            role={isError ? 'button' : undefined}
            tabIndex={isError ? 0 : undefined}
            onClick={isError ? onRetry : undefined}
            onKeyDown={isError ? (e) => { if (e.key === 'Enter') onRetry(); } : undefined}
            style={{
              ...usernameHintStyle(usernameState),
              ...(isError ? { cursor: 'pointer', textDecoration: 'underline' } : {}),
            }}
            aria-live="polite"
          >
            {usernameHint}
          </div>
        )}
      </div>
      <div>
        <label htmlFor="reg-display-name" className="rw-field-label">
          Display name{' '}
          <span style={{ color: 'var(--hush-text-ghost)', fontWeight: 400 }}>(optional)</span>
        </label>
        <input
          id="reg-display-name"
          className="input"
          type="text"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="How others see you"
          maxLength={30}
          autoComplete="off"
        />
      </div>
      <div className="rw-actions">
        <button type="button" className="back-link" onClick={onBack}>
          ← Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!username.trim() || usernameState !== 'ok'}
          onClick={onNext}
          style={{ flex: 1, padding: '10px' }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function MnemonicDisplayStep({ words, savedConfirmed, onSavedConfirmedChange, onNext, onBack }) {
  return (
    <div className="rw-inner">
      <div>
        <p className="rw-heading">Your recovery phrase</p>
        <p className="rw-subheading">Write these 12 words down and keep them safe.</p>
      </div>

      <div className="rw-warning-box">
        <div className="rw-warning-title">
          <span aria-hidden="true">⚠</span>
          Important: save this before continuing
        </div>
        <p style={{ margin: 0, fontSize: '0.78rem' }}>
          This is your recovery phrase. Write it down and store it in a safe place.
          If you lose this phrase and all your devices, your account is permanently
          irrecoverable. Hush cannot help you recover it.
        </p>
      </div>

      <MnemonicGrid words={words} />

      <label className="rw-checkbox-row">
        <input
          type="checkbox"
          checked={savedConfirmed}
          onChange={(e) => onSavedConfirmedChange(e.target.checked)}
        />
        I have saved my recovery phrase
      </label>

      <div className="rw-actions">
        <button type="button" className="back-link" onClick={onBack}>
          ← Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!savedConfirmed}
          onClick={onNext}
          style={{ flex: 1, padding: '10px' }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
