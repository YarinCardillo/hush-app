import { useState, useRef } from 'react';

const CLIPBOARD_CLEAR_DELAY_MS = 60_000;

const isMobile = () =>
  typeof window !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
    maxWidth: '100%',
    overflow: 'hidden',
  },
  // On narrow screens (< 380px), switch to 2 columns.
  gridNarrow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '8px',
    maxWidth: '100%',
    overflow: 'hidden',
  },
  cell: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 10px',
    background: 'var(--hush-surface)',
    border: '1px solid var(--hush-border)',
    borderRadius: 'var(--radius-sm)',
    minWidth: 0,
    overflow: 'hidden',
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
    fontSize: '0.82rem',
    fontFamily: 'var(--font-mono)',
    fontWeight: 500,
    color: 'var(--hush-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  buttonRow: {
    display: 'flex',
    gap: '8px',
    marginTop: '12px',
  },
  actionButton: {
    flex: 1,
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
  buttonActive: {
    color: 'var(--hush-live)',
    borderColor: 'var(--hush-live)',
  },
};

/**
 * Displays a BIP39 mnemonic in a numbered grid with copy and share buttons.
 * Grid switches from 3 columns to 2 on narrow mobile screens.
 * After copy, clipboard auto-clears after 60 seconds.
 *
 * @param {{ words: string[], onCopyDone?: () => void }} props
 */
export function MnemonicGrid({ words, onCopyDone }) {
  const [copied, setCopied] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 380,
  );
  const clearTimerRef = useRef(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  // Listen for resize to toggle grid columns.
  useState(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setIsNarrow(window.innerWidth < 380);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  });

  const phraseText = words.join(' ');

  const handleCopy = async () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    try {
      await navigator.clipboard.writeText(phraseText);
      setCopied(true);
      clearTimerRef.current = setTimeout(async () => {
        try { await navigator.clipboard.writeText(''); } catch { /* best-effort */ }
        setCopied(false);
        onCopyDone?.();
      }, CLIPBOARD_CLEAR_DELAY_MS);
    } catch { /* clipboard unavailable */ }
  };

  const handleShare = async () => {
    try {
      await navigator.share({ text: phraseText });
    } catch { /* user cancelled or not supported */ }
  };

  return (
    <div>
      <div style={isNarrow ? styles.gridNarrow : styles.grid} role="list" aria-label="Recovery phrase words">
        {words.map((word, i) => (
          <div key={i} style={styles.cell} role="listitem">
            <span style={styles.cellNumber} aria-hidden="true">
              {i + 1}
            </span>
            <span style={styles.cellWord}>{word}</span>
          </div>
        ))}
      </div>

      <div style={styles.buttonRow}>
        <button
          type="button"
          style={{ ...styles.actionButton, ...(copied ? styles.buttonActive : {}) }}
          onClick={handleCopy}
          aria-label="Copy all 12 words to clipboard"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>

        {canShare && isMobile() && (
          <button
            type="button"
            style={styles.actionButton}
            onClick={handleShare}
            aria-label="Share recovery phrase"
          >
            Save to...
          </button>
        )}
      </div>
    </div>
  );
}
