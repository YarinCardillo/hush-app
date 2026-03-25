import { useState, useEffect, useCallback } from 'react';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  heading: {
    fontSize: '0.9rem',
    color: 'var(--hush-text-secondary)',
    margin: 0,
  },
  challengeGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  fieldRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  label: {
    fontSize: '0.78rem',
    color: 'var(--hush-text-muted)',
    fontFamily: 'var(--font-mono)',
    minWidth: '56px',
    flexShrink: 0,
  },
  inputWrapper: {
    position: 'relative',
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  statusIcon: (state) => ({
    fontSize: '0.9rem',
    flexShrink: 0,
    color: state === 'correct' ? 'var(--hush-live)' : 'var(--hush-danger)',
    visibility: state === 'idle' ? 'hidden' : 'visible',
  }),
  actions: {
    display: 'flex',
    gap: '8px',
    marginTop: '4px',
  },
};

/** Picks N unique random indices in [0, max). */
function pickRandomPositions(max, count) {
  const pool = Array.from({ length: max }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

/**
 * Asks the user to re-enter 3 randomly selected words from their mnemonic.
 *
 * @param {{
 *   words: string[],
 *   onConfirm: () => void,
 *   onBack: () => void
 * }} props
 */
export function MnemonicConfirm({ words, onConfirm, onBack, challengePositions, onPositionsSelected }) {
  const [positions] = useState(() => {
    if (challengePositions?.length === 3) return challengePositions;
    const picked = pickRandomPositions(words.length, 3);
    onPositionsSelected?.(picked);
    return picked;
  });
  const [inputs, setInputs] = useState(['', '', '']);

  const getFieldState = useCallback(
    (positionIndex, value) => {
      if (!value.trim()) return 'idle';
      const wordIndex = positions[positionIndex];
      return value.trim().toLowerCase() === words[wordIndex].toLowerCase()
        ? 'correct'
        : 'wrong';
    },
    [positions, words],
  );

  const allCorrect = inputs.every((val, i) => getFieldState(i, val) === 'correct');

  const handleChange = (index, value) => {
    setInputs((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleKeyDown = (e, index) => {
    if (e.key === 'Enter' && allCorrect) {
      onConfirm();
    }
  };

  return (
    <div style={styles.container}>
      <p style={styles.heading}>
        Enter the following words to confirm you have saved your recovery phrase.
      </p>

      <div style={styles.challengeGroup}>
        {positions.map((wordIndex, i) => {
          const fieldState = getFieldState(i, inputs[i]);
          return (
            <div key={wordIndex} style={styles.fieldRow}>
              <label
                htmlFor={`confirm-word-${i}`}
                style={styles.label}
                aria-label={`Word number ${wordIndex + 1}`}
              >
                Word #{wordIndex + 1}
              </label>
              <div style={styles.inputWrapper}>
                <input
                  id={`confirm-word-${i}`}
                  className="input"
                  type="text"
                  value={inputs[i]}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, i)}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  autoComplete="off"
                  placeholder="Type the word..."
                  aria-label={`Word ${wordIndex + 1} confirmation`}
                  aria-invalid={fieldState === 'wrong'}
                  style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
                />
                <span
                  style={styles.statusIcon(fieldState)}
                  aria-hidden="true"
                  role="img"
                >
                  {fieldState === 'correct' ? '✓' : '✗'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={styles.actions}>
        <button
          type="button"
          className="back-link"
          onClick={onBack}
        >
          ← Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!allCorrect}
          onClick={onConfirm}
          style={{ flex: 1, padding: '10px' }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
