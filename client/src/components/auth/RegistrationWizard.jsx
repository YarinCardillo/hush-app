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

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  stepIndicator: {
    display: 'flex',
    justifyContent: 'center',
    gap: '8px',
    marginBottom: '4px',
  },
  stepDot: (active, done) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: active
      ? 'var(--hush-amber)'
      : done
      ? 'var(--hush-text-muted)'
      : 'var(--hush-border)',
    transition: 'background var(--duration-normal)',
  }),
  heading: {
    fontSize: '0.9rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
    margin: '0 0 2px 0',
  },
  subheading: {
    fontSize: '0.8rem',
    color: 'var(--hush-text-secondary)',
    margin: 0,
  },
  fieldLabel: {
    display: 'block',
    marginBottom: '4px',
    fontSize: '0.78rem',
    color: 'var(--hush-text-secondary)',
    fontWeight: 500,
  },
  usernameHint: (state) => ({
    fontSize: '0.72rem',
    marginTop: '4px',
    color:
      state === 'ok'
        ? 'var(--hush-live)'
        : state === 'taken' || state === 'invalid'
        ? 'var(--hush-danger)'
        : 'var(--hush-text-muted)',
    fontFamily: 'var(--font-mono)',
  }),
  warningBox: {
    padding: '12px 14px',
    background: 'rgba(213, 79, 18, 0.06)',
    border: '1px solid rgba(213, 79, 18, 0.25)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--hush-text-secondary)',
    fontSize: '0.8rem',
    lineHeight: 1.6,
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  warningTitle: {
    color: 'var(--hush-amber)',
    fontWeight: 500,
    fontSize: '0.82rem',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    fontSize: '0.8rem',
    color: 'var(--hush-text-secondary)',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    marginTop: '4px',
  },
  errorMessage: {
    padding: '10px 14px',
    background: 'var(--hush-danger-ghost)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--hush-danger)',
    fontSize: '0.82rem',
  },
  loadingSpinner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    padding: '24px 0',
    color: 'var(--hush-text-secondary)',
    fontSize: '0.85rem',
  },
};

/** Returns an array of visible step indices (excluding INVITE_CODE when not invite_only). */
function getVisibleSteps(registrationMode) {
  const steps = [];
  if (registrationMode === 'invite_only') steps.push(STEP.INVITE_CODE);
  steps.push(STEP.USERNAME, STEP.MNEMONIC_DISPLAY, STEP.MNEMONIC_CONFIRM);
  return steps;
}

/**
 * Multi-step registration wizard.
 *
 * @param {{
 *   onComplete: (data: { username: string, displayName: string, mnemonic: string, inviteCode?: string }) => Promise<void>,
 *   onCancel: () => void,
 *   registrationMode?: 'open' | 'invite_only' | 'closed',
 *   instanceName?: string,
 *   isLoading?: boolean,
 *   error?: Error|null,
 * }} props
 */
export function RegistrationWizard({ onComplete, onCancel, registrationMode = 'open', instanceName, isLoading = false, error }) {
  const visibleSteps = getVisibleSteps(registrationMode);
  const initialStep = visibleSteps[0];

  const [step, setStep] = useState(initialStep);
  const [inviteCode, setInviteCode] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [mnemonic] = useState(() => generateIdentityMnemonic());
  const [mnemonicWords] = useState(() => mnemonic.split(' '));
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [localError, setLocalError] = useState('');

  // Username availability state: 'idle' | 'checking' | 'ok' | 'taken' | 'invalid'
  const [usernameState, setUsernameState] = useState('idle');
  const debounceRef = useRef(null);

  const currentStepIndex = visibleSteps.indexOf(step);
  const totalDots = visibleSteps.length;

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
    debounceRef.current = setTimeout(async () => {
      try {
        const available = await checkUsernameAvailable(username);
        setUsernameState(available ? 'ok' : 'taken');
      } catch {
        // Network error — allow submission, server will reject if taken.
        setUsernameState('ok');
      }
    }, USERNAME_CHECK_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [username]);

  const goBack = useCallback(() => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex < 0) {
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
    if (!username.trim()) {
      setLocalError('Please enter a username.');
      return;
    }
    if (!USERNAME_PATTERN.test(username)) {
      setLocalError('Username must be 3-20 characters: letters, numbers, and underscores only.');
      return;
    }
    setLocalError('');
    goNext();
  }, [username, goNext]);

  const handleMnemonicDisplayNext = useCallback(() => {
    if (!savedConfirmed) return;
    goNext();
  }, [savedConfirmed, goNext]);

  const handleConfirmComplete = useCallback(() => {
    setStep(STEP.SUBMITTING);
    onComplete({
      username: username.trim(),
      displayName: displayName.trim() || username.trim(),
      mnemonic,
      inviteCode: inviteCode.trim() || undefined,
    });
  }, [username, displayName, mnemonic, inviteCode, onComplete]);

  const displayedError = error?.message || localError;

  return (
    <div style={styles.container}>
      {/* Step indicator dots */}
      <div style={styles.stepIndicator} aria-hidden="true">
        {visibleSteps.map((s, i) => (
          <div
            key={s}
            style={styles.stepDot(i === currentStepIndex, i < currentStepIndex)}
          />
        ))}
      </div>

      {displayedError && step !== STEP.SUBMITTING && (
        <div style={styles.errorMessage} role="alert">
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
          usernameState={usernameState}
          onUsernameChange={setUsername}
          onDisplayNameChange={setDisplayName}
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
          onBack={goBack}
        />
      )}

      {step === STEP.SUBMITTING && (
        <div style={styles.loadingSpinner}>
          <div aria-label="Creating account" role="status">Creating your account...</div>
          {displayedError && (
            <div style={styles.errorMessage} role="alert">
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div>
        <p style={styles.heading}>Enter invite code</p>
        <p style={styles.subheading}>This server requires an invite to register.</p>
      </div>
      <div>
        <label htmlFor="invite-code" style={styles.fieldLabel}>Invite code</label>
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
      <div style={styles.actions}>
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

function UsernameStep({ username, displayName, usernameState, onUsernameChange, onDisplayNameChange, onNext, onBack }) {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') onNext();
  };

  const usernameHint =
    usernameState === 'invalid'
      ? '3–20 characters: letters, numbers, underscores only'
      : usernameState === 'taken'
      ? 'Username already taken'
      : usernameState === 'ok'
      ? 'Available'
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div>
        <p style={styles.heading}>Choose a username</p>
        <p style={styles.subheading}>Your username is your identity on this server.</p>
      </div>
      <div>
        <label htmlFor="reg-username" style={styles.fieldLabel}>Username</label>
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
          <div style={styles.usernameHint(usernameState)} aria-live="polite">
            {usernameHint}
          </div>
        )}
      </div>
      <div>
        <label htmlFor="reg-display-name" style={styles.fieldLabel}>
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
      <div style={styles.actions}>
        <button type="button" className="back-link" onClick={onBack}>
          ← Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!username.trim() || usernameState === 'invalid' || usernameState === 'taken'}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div>
        <p style={styles.heading}>Your recovery phrase</p>
        <p style={styles.subheading}>Write these 12 words down and keep them safe.</p>
      </div>

      <div style={styles.warningBox}>
        <div style={styles.warningTitle}>
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

      <label style={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={savedConfirmed}
          onChange={(e) => onSavedConfirmedChange(e.target.checked)}
        />
        I have saved my recovery phrase
      </label>

      <div style={styles.actions}>
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
