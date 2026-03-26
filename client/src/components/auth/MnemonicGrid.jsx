import { useState, useRef } from 'react';

const CLIPBOARD_CLEAR_DELAY_MS = 60_000;

const isMobile = () =>
  typeof window !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

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
    <div className="mg-wrapper">
      <div
        className={`mg-grid${isNarrow ? ' mg-grid--narrow' : ''}`}
        role="list"
        aria-label="Recovery phrase words"
      >
        {words.map((word, i) => (
          <div key={i} className="mg-cell" role="listitem">
            <span className="mg-cell-number" aria-hidden="true">
              {i + 1}
            </span>
            <span className="mg-cell-word">{word}</span>
          </div>
        ))}
      </div>

      <div className="mg-button-row">
        <button
          type="button"
          className={`mg-action-btn${copied ? ' mg-action-btn--active' : ''}`}
          onClick={handleCopy}
          aria-label="Copy all 12 words to clipboard"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>

        {canShare && isMobile() && (
          <button
            type="button"
            className="mg-action-btn"
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
