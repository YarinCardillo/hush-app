import { useState, useCallback } from 'react';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  description: {
    fontSize: '0.85rem',
    color: 'var(--hush-text-secondary)',
    lineHeight: 1.6,
    margin: 0,
  },
  modeToggle: {
    display: 'flex',
    gap: '2px',
    background: 'var(--hush-surface)',
    padding: '3px',
    borderRadius: 'var(--radius-sm)',
  },
  modeBtn: (active) => ({
    flex: 1,
    padding: '8px',
    fontSize: '0.8rem',
    fontFamily: 'var(--font-sans)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    background: active ? 'var(--hush-elevated)' : 'transparent',
    color: active ? 'var(--hush-text)' : 'var(--hush-text-muted)',
    transition: 'background var(--duration-fast), color var(--duration-fast)',
  }),
  fieldLabel: {
    display: 'block',
    marginBottom: '4px',
    fontSize: '0.78rem',
    color: 'var(--hush-text-secondary)',
    fontWeight: 500,
  },
  strengthBar: {
    height: '3px',
    borderRadius: 0,
    background: 'var(--hush-surface)',
    marginTop: '6px',
    overflow: 'hidden',
  },
  strengthFill: (level) => ({
    height: '100%',
    width: `${(level / 4) * 100}%`,
    background: level < 2 ? 'var(--hush-danger)' : level < 3 ? 'var(--hush-amber)' : 'var(--hush-live)',
    transition: 'width var(--duration-normal)',
  }),
  strengthLabel: (level) => ({
    fontSize: '0.68rem',
    marginTop: '3px',
    color: level < 2 ? 'var(--hush-danger)' : level < 3 ? 'var(--hush-amber)' : 'var(--hush-live)',
    fontFamily: 'var(--font-mono)',
  }),
  mismatchHint: {
    fontSize: '0.75rem',
    color: 'var(--hush-danger)',
    marginTop: '4px',
  },
  skipWarning: {
    padding: '10px 14px',
    background: 'rgba(213, 79, 18, 0.06)',
    border: '1px solid rgba(213, 79, 18, 0.15)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--hush-text-muted)',
    fontSize: '0.78rem',
    lineHeight: 1.5,
  },
  actions: {
    display: 'flex',
    gap: '8px',
  },
};

/**
 * Computes a simple passphrase strength level (0-4).
 * @param {string} value
 * @returns {number}
 */
function passphraseStrength(value) {
  if (value.length < 6) return 0;
  if (value.length < 9) return 1;
  if (value.length < 12) return 2;
  if (value.length < 16) return 3;
  return 4;
}

const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];

/**
 * First-time PIN or passphrase setup modal.
 *
 * @param {{
 *   onSetPin: (pin: string) => Promise<void>,
 *   onSkip?: () => void,
 *   isLoading?: boolean,
 * }} props
 */
export function PinSetupModal({ onSetPin, onSkip, isLoading = false }) {
  const [mode, setMode] = useState('pin'); // 'pin' | 'passphrase'
  const [value, setValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const isPin = mode === 'pin';
  const minLength = isPin ? 4 : 6;
  const strength = !isPin ? passphraseStrength(value) : null;
  const valueOk = value.length >= minLength;
  const confirmOk = value === confirm && valueOk;
  const mismatch = confirm.length > 0 && value !== confirm;

  const switchMode = useCallback((newMode) => {
    setMode(newMode);
    setValue('');
    setConfirm('');
    setError('');
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!confirmOk) return;
    setError('');
    try {
      await onSetPin(value);
    } catch (err) {
      setError(err?.message || 'Failed to set PIN. Please try again.');
    }
  }, [confirmOk, onSetPin, value]);

  return (
    <div style={styles.container}>
      <p style={styles.description}>
        Your {isPin ? 'PIN' : 'passphrase'} encrypts your identity key on this device.
        You will need it to unlock Hush after closing your browser.
      </p>

      <div style={styles.modeToggle}>
        <button
          type="button"
          style={styles.modeBtn(isPin)}
          onClick={() => switchMode('pin')}
        >
          Use a PIN
        </button>
        <button
          type="button"
          style={styles.modeBtn(!isPin)}
          onClick={() => switchMode('passphrase')}
        >
          Use a passphrase
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <label htmlFor="pin-setup-value" style={styles.fieldLabel}>
            {isPin ? 'PIN (min 4 digits)' : 'Passphrase (min 6 characters)'}
          </label>
          <input
            id="pin-setup-value"
            className="input"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={isPin ? 'Enter a PIN' : 'Enter a passphrase'}
            minLength={minLength}
            inputMode={isPin ? 'numeric' : undefined}
            autoComplete="new-password"
          />
          {!isPin && value.length >= 2 && (
            <>
              <div style={styles.strengthBar}>
                <div style={styles.strengthFill(strength)} />
              </div>
              {strength > 0 && (
                <div style={styles.strengthLabel(strength)}>
                  {STRENGTH_LABELS[strength]}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <label htmlFor="pin-setup-confirm" style={styles.fieldLabel}>
            Confirm {isPin ? 'PIN' : 'passphrase'}
          </label>
          <input
            id="pin-setup-confirm"
            className="input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={`Repeat your ${isPin ? 'PIN' : 'passphrase'}`}
            minLength={minLength}
            inputMode={isPin ? 'numeric' : undefined}
            autoComplete="new-password"
          />
          {mismatch && (
            <div style={styles.mismatchHint} role="alert">
              {isPin ? 'PINs do not match' : 'Passphrases do not match'}
            </div>
          )}
        </div>

        {error && (
          <div
            style={{
              padding: '10px 14px',
              background: 'var(--hush-danger-ghost)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--hush-danger)',
              fontSize: '0.82rem',
            }}
            role="alert"
          >
            {error}
          </div>
        )}

        <div style={styles.actions}>
          {onSkip && (
            <button
              type="button"
              className="back-link"
              onClick={onSkip}
              style={{ flexShrink: 0 }}
            >
              Skip for now
            </button>
          )}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!confirmOk || isLoading}
            style={{ flex: 1, padding: '10px' }}
          >
            {isLoading ? 'Saving...' : `Set ${isPin ? 'PIN' : 'passphrase'}`}
          </button>
        </div>
      </form>

      {onSkip && (
        <div style={styles.skipWarning}>
          Without a PIN, you will need your 12-word recovery phrase every time you open Hush.
        </div>
      )}
    </div>
  );
}
