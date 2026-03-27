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
    <div className="pin-unlock-container">
      <div className="pin-unlock-identity">
        <div className="pin-unlock-avatar" aria-hidden="true">
          {avatarContent}
        </div>
        <span className="pin-unlock-username">{username}</span>
      </div>

      {errorMessage && (
        <div className="pin-unlock-error" role="alert">
          {errorMessage}
        </div>
      )}

      {attemptCount >= 5 && !errorMessage && (
        <div className="pin-unlock-warning" role="status">
          {MAX_ATTEMPTS - attemptCount} attempt{MAX_ATTEMPTS - attemptCount !== 1 ? 's' : ''} remaining
        </div>
      )}

      <form className="pin-unlock-form" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="pin-input" className="pin-unlock-field-label">
            PIN
          </label>
          <input
            ref={pinInputRef}
            id="pin-input"
            className="input"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
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
          <div className="pin-unlock-countdown" aria-live="polite" aria-atomic="true">
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
        className="pin-unlock-switch"
        onClick={onSwitchAccount}
      >
        Not you? Sign in
      </button>
    </div>
  );
}
