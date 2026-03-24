import { useState, useRef, useEffect, useCallback } from 'react';

const MAX_ATTEMPTS = 10;

/** Progressive delay in ms by failure count threshold. */
const PIN_DELAY_TABLE = [
  { threshold: 9, delayMs: 60_000 },
  { threshold: 7, delayMs: 30_000 },
  { threshold: 5, delayMs: 5_000 },
  { threshold: 3, delayMs: 1_000 },
];

function getDelayMs(failureCount) {
  for (const { threshold, delayMs } of PIN_DELAY_TABLE) {
    if (failureCount >= threshold) return delayMs;
  }
  return 0;
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    alignItems: 'center',
  },
  identity: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
  },
  avatar: {
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    background: 'var(--hush-elevated)',
    border: '2px solid var(--hush-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.4rem',
    color: 'var(--hush-text-muted)',
    overflow: 'hidden',
  },
  username: {
    fontSize: '0.95rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
  },
  form: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  fieldLabel: {
    display: 'block',
    marginBottom: '4px',
    fontSize: '0.78rem',
    color: 'var(--hush-text-secondary)',
    fontWeight: 500,
  },
  errorMessage: {
    padding: '10px 14px',
    background: 'var(--hush-danger-ghost)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--hush-danger)',
    fontSize: '0.82rem',
    textAlign: 'center',
  },
  warningMessage: {
    padding: '10px 14px',
    background: 'rgba(213, 79, 18, 0.08)',
    border: '1px solid rgba(213, 79, 18, 0.2)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--hush-amber)',
    fontSize: '0.82rem',
    textAlign: 'center',
  },
  switchLink: {
    background: 'none',
    border: 'none',
    padding: 0,
    color: 'var(--hush-text-muted)',
    fontSize: '0.78rem',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    textDecoration: 'underline',
    marginTop: '4px',
    alignSelf: 'center',
  },
  countdown: {
    fontSize: '0.75rem',
    color: 'var(--hush-text-muted)',
    fontFamily: 'var(--font-mono)',
    textAlign: 'center',
  },
};

/**
 * PIN unlock screen for a locked vault.
 *
 * @param {{
 *   username: string,
 *   avatarUrl?: string,
 *   onUnlock: (pin: string) => Promise<void>,
 *   onSwitchAccount: () => void,
 *   attemptCount?: number,
 * }} props
 */
export function PinUnlockScreen({ username, avatarUrl, onUnlock, onSwitchAccount, attemptCount: externalAttemptCount = 0 }) {
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [localAttemptCount, setLocalAttemptCount] = useState(externalAttemptCount);
  const [delayRemaining, setDelayRemaining] = useState(0);
  const [isDelayed, setIsDelayed] = useState(false);
  const pinInputRef = useRef(null);
  const countdownRef = useRef(null);

  const attemptCount = externalAttemptCount || localAttemptCount;
  const remainingAttempts = MAX_ATTEMPTS - attemptCount;

  useEffect(() => {
    pinInputRef.current?.focus();
  }, []);

  // Handle progressive delay countdown display.
  const startDelay = useCallback((delayMs) => {
    if (delayMs <= 0) return;

    setIsDelayed(true);
    setDelayRemaining(Math.ceil(delayMs / 1000));

    countdownRef.current = setInterval(() => {
      setDelayRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current);
          setIsDelayed(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!pin || isLoading || isDelayed) return;

    setIsLoading(true);
    setErrorMessage('');

    try {
      await onUnlock(pin);
      // On success, parent transitions the view.
    } catch (err) {
      const newCount = localAttemptCount + 1;
      setLocalAttemptCount(newCount);

      if (err?.code === 'VAULT_WIPED') {
        setErrorMessage('Too many failed attempts. Vault has been wiped. Please sign in with your recovery phrase.');
        return;
      }

      const delayMs = getDelayMs(newCount);
      if (delayMs > 0) {
        startDelay(delayMs);
        setErrorMessage(
          `Incorrect PIN — wait ${Math.ceil(delayMs / 1000)}s before trying again ` +
          `(${MAX_ATTEMPTS - newCount} attempt${MAX_ATTEMPTS - newCount !== 1 ? 's' : ''} remaining)`
        );
      } else {
        setErrorMessage(
          `Incorrect PIN (${MAX_ATTEMPTS - newCount} attempt${MAX_ATTEMPTS - newCount !== 1 ? 's' : ''} remaining)`
        );
      }
      setPin('');
    } finally {
      setIsLoading(false);
    }
  }, [pin, isLoading, isDelayed, onUnlock, localAttemptCount, startDelay]);

  const avatarContent = avatarUrl
    ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    : username?.charAt(0).toUpperCase() ?? '?';

  return (
    <div style={styles.container}>
      <div style={styles.identity}>
        <div style={styles.avatar} aria-hidden="true">
          {avatarContent}
        </div>
        <span style={styles.username}>{username}</span>
      </div>

      {errorMessage && (
        <div style={styles.errorMessage} role="alert">
          {errorMessage}
        </div>
      )}

      {attemptCount >= 5 && !errorMessage && (
        <div style={styles.warningMessage} role="status">
          {MAX_ATTEMPTS - attemptCount} attempt{MAX_ATTEMPTS - attemptCount !== 1 ? 's' : ''} remaining
        </div>
      )}

      <form style={styles.form} onSubmit={handleSubmit}>
        <div>
          <label htmlFor="pin-input" style={styles.fieldLabel}>
            PIN
          </label>
          <input
            ref={pinInputRef}
            id="pin-input"
            className="input"
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Enter your PIN"
            minLength={4}
            autoComplete="off"
            disabled={isLoading || isDelayed}
            aria-label="Vault PIN"
          />
        </div>

        {isDelayed && (
          <div style={styles.countdown} aria-live="polite" aria-atomic="true">
            Wait {delayRemaining}s before retrying
          </div>
        )}

        <button
          className="btn btn-primary"
          type="submit"
          disabled={!pin || pin.length < 4 || isLoading || isDelayed}
          style={{ width: '100%', padding: '12px' }}
        >
          {isLoading ? 'Unlocking...' : 'Unlock'}
        </button>
      </form>

      <button
        type="button"
        style={styles.switchLink}
        onClick={onSwitchAccount}
      >
        Not you? Sign in with recovery phrase
      </button>
    </div>
  );
}
