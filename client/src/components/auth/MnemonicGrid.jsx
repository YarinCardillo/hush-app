import { useState, useRef } from 'react';

const CLIPBOARD_CLEAR_DELAY_MS = 60_000;

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
  },
  cell: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    background: 'var(--hush-surface)',
    border: '1px solid var(--hush-border)',
    borderRadius: 'var(--radius-sm)',
  },
  cellNumber: {
    fontSize: '0.7rem',
    color: 'var(--hush-text-muted)',
    fontFamily: 'var(--font-mono)',
    minWidth: '14px',
    textAlign: 'right',
    flexShrink: 0,
  },
  cellWord: {
    fontSize: '0.85rem',
    fontFamily: 'var(--font-mono)',
    fontWeight: 500,
    color: 'var(--hush-text)',
  },
  copyButton: {
    width: '100%',
    marginTop: '12px',
    padding: '10px',
    background: 'none',
    border: '1px solid var(--hush-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--hush-text-secondary)',
    fontSize: '0.8rem',
    fontFamily: 'var(--font-sans)',
    cursor: 'pointer',
    transition: 'color var(--duration-fast), border-color var(--duration-fast)',
  },
  copyButtonCopied: {
    color: 'var(--hush-live)',
    borderColor: 'var(--hush-live)',
  },
};

/**
 * Displays a BIP39 mnemonic in a numbered 3x4 grid with a copy button.
 * After copy, clipboard auto-clears after 60 seconds.
 *
 * @param {{ words: string[], onCopyDone?: () => void }} props
 */
export function MnemonicGrid({ words, onCopyDone }) {
  const [copied, setCopied] = useState(false);
  const clearTimerRef = useRef(null);

  const handleCopy = async () => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
    }

    try {
      await navigator.clipboard.writeText(words.join(' '));
      setCopied(true);

      clearTimerRef.current = setTimeout(async () => {
        try {
          await navigator.clipboard.writeText('');
        } catch {
          // Clipboard clear is best-effort.
        }
        setCopied(false);
        onCopyDone?.();
      }, CLIPBOARD_CLEAR_DELAY_MS);
    } catch {
      // Clipboard unavailable — silently ignore.
    }
  };

  return (
    <div>
      <div style={styles.grid} role="list" aria-label="Recovery phrase words">
        {words.map((word, i) => (
          <div key={i} style={styles.cell} role="listitem">
            <span style={styles.cellNumber} aria-hidden="true">
              {i + 1}
            </span>
            <span style={styles.cellWord}>{word}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        style={{
          ...styles.copyButton,
          ...(copied ? styles.copyButtonCopied : {}),
        }}
        onClick={handleCopy}
        aria-label="Copy all 12 words to clipboard"
      >
        {copied ? 'Copied' : 'Copy recovery phrase'}
      </button>
    </div>
  );
}
