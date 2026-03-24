import { useState, useRef, useCallback, useEffect } from 'react';
import { isMnemonicValid, getEnglishWordlist } from '../../lib/bip39Identity';

const WORDLIST_SUGGESTION_LIMIT = 5;
const AUTOCOMPLETE_MIN_CHARS = 2;

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
  },
  fieldGroup: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  fieldLabel: {
    fontSize: '0.68rem',
    color: 'var(--hush-text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    zIndex: 100,
    background: 'var(--hush-elevated)',
    border: '1px solid var(--hush-border)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    overflow: 'hidden',
    marginTop: '2px',
  },
  dropdownItem: (active) => ({
    padding: '8px 12px',
    fontSize: '0.85rem',
    fontFamily: 'var(--font-mono)',
    color: 'var(--hush-text)',
    cursor: 'pointer',
    background: active ? 'var(--hush-hover)' : 'transparent',
  }),
  validityBanner: (valid) => ({
    padding: '8px 12px',
    background: valid ? 'rgba(52, 211, 153, 0.08)' : 'var(--hush-danger-ghost)',
    border: `1px solid ${valid ? 'rgba(52, 211, 153, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
    borderRadius: 'var(--radius-sm)',
    color: valid ? 'var(--hush-live)' : 'var(--hush-danger)',
    fontSize: '0.78rem',
    textAlign: 'center',
  }),
  revocationSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px',
    background: 'var(--hush-surface)',
    border: '1px solid var(--hush-border)',
    borderRadius: 'var(--radius-sm)',
  },
  revocationLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    cursor: 'pointer',
  },
  revocationText: {
    fontSize: '0.82rem',
    color: 'var(--hush-text-secondary)',
    lineHeight: 1.5,
  },
  revocationDesc: {
    fontSize: '0.75rem',
    color: 'var(--hush-text-muted)',
    marginTop: '4px',
  },
  actions: {
    display: 'flex',
    gap: '8px',
  },
};

/**
 * 12-word BIP39 recovery phrase input.
 * Supports per-field autocomplete with dropdown suggestions,
 * auto-advance on word selection, and paste-split from field 1.
 *
 * @param {{
 *   onSubmit: (mnemonic: string, revokeOtherDevices: boolean) => void,
 *   onCancel: () => void,
 *   isRecoveryMode?: boolean,
 *   isLoading?: boolean,
 * }} props
 */
export function RecoveryPhraseInput({ onSubmit, onCancel, isRecoveryMode = true, isLoading = false }) {
  const [words, setWords] = useState(() => Array(12).fill(''));
  const [activeIndex, setActiveIndex] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [revokeOtherDevices, setRevokeOtherDevices] = useState(false);
  const inputRefs = useRef(Array(12).fill(null));
  const dropdownRef = useRef(null);

  const mnemonicString = words.join(' ').trim();
  const allFilled = words.every((w) => w.trim().length > 0);
  const isValid = allFilled && isMnemonicValid(mnemonicString);
  const showValidity = allFilled;

  const getSuggestions = useCallback((value) => {
    if (value.length < AUTOCOMPLETE_MIN_CHARS) return [];
    const lower = value.toLowerCase();
    const wordlist = getEnglishWordlist();
    const matches = [];
    for (const word of wordlist) {
      if (word.startsWith(lower)) {
        matches.push(word);
        if (matches.length >= WORDLIST_SUGGESTION_LIMIT) break;
      }
    }
    return matches;
  }, []);

  const setWordAt = useCallback((index, value) => {
    setWords((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const selectSuggestion = useCallback((index, word) => {
    setWordAt(index, word);
    setSuggestions([]);
    setActiveSuggestion(-1);
    // Auto-advance to next field
    const next = index + 1;
    if (next < 12) {
      setTimeout(() => inputRefs.current[next]?.focus(), 0);
    }
  }, [setWordAt]);

  const handleChange = useCallback((index, value) => {
    setWordAt(index, value);
    const newSuggestions = getSuggestions(value);
    setSuggestions(newSuggestions);
    setActiveSuggestion(-1);
    setActiveIndex(index);
  }, [setWordAt, getSuggestions]);

  const handleFocus = useCallback((index) => {
    setActiveIndex(index);
    const value = words[index];
    setSuggestions(getSuggestions(value));
    setActiveSuggestion(-1);
  }, [words, getSuggestions]);

  const handleBlur = useCallback((e) => {
    // Delay so click on dropdown item fires before blur clears suggestions.
    setTimeout(() => {
      if (!dropdownRef.current?.contains(document.activeElement)) {
        setSuggestions([]);
        setActiveIndex(null);
        setActiveSuggestion(-1);
      }
    }, 150);
  }, []);

  const handleKeyDown = useCallback((e, index) => {
    if (suggestions.length === 0) {
      // Space: treat as word separator — auto-advance
      if (e.key === ' ' && words[index].trim().length > 0) {
        e.preventDefault();
        const next = index + 1;
        if (next < 12) {
          setTimeout(() => inputRefs.current[next]?.focus(), 0);
        }
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestion((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestion((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (activeSuggestion >= 0 && suggestions[activeSuggestion]) {
        e.preventDefault();
        selectSuggestion(index, suggestions[activeSuggestion]);
      }
    } else if (e.key === 'Escape') {
      setSuggestions([]);
      setActiveSuggestion(-1);
    } else if (e.key === ' ') {
      e.preventDefault();
      const firstMatch = suggestions[0];
      if (firstMatch) {
        selectSuggestion(index, firstMatch);
      }
    }
  }, [suggestions, activeSuggestion, words, selectSuggestion]);

  const handlePaste = useCallback((e, index) => {
    // Only handle paste-split in field 0 (first field).
    if (index !== 0) return;
    const text = e.clipboardData.getData('text');
    const parts = text.trim().split(/\s+/);
    if (parts.length === 12) {
      e.preventDefault();
      setWords(parts.slice(0, 12));
      setSuggestions([]);
      setTimeout(() => inputRefs.current[11]?.focus(), 0);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    if (!isValid) return;
    onSubmit(mnemonicString, revokeOtherDevices);
  }, [isValid, mnemonicString, revokeOtherDevices, onSubmit]);

  return (
    <div style={styles.container}>
      <div style={styles.grid}>
        {words.map((word, i) => (
          <div key={i} style={styles.fieldGroup}>
            <label
              htmlFor={`recovery-word-${i}`}
              style={styles.fieldLabel}
            >
              {i + 1}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                ref={(el) => { inputRefs.current[i] = el; }}
                id={`recovery-word-${i}`}
                className="input"
                type="text"
                value={word}
                onChange={(e) => handleChange(i, e.target.value)}
                onFocus={() => handleFocus(i)}
                onBlur={handleBlur}
                onKeyDown={(e) => handleKeyDown(e, i)}
                onPaste={(e) => handlePaste(e, i)}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                autoComplete="off"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}
                aria-label={`Word ${i + 1} of 12`}
                aria-autocomplete="list"
                aria-expanded={activeIndex === i && suggestions.length > 0}
              />
              {activeIndex === i && suggestions.length > 0 && (
                <div ref={dropdownRef} style={styles.dropdown} role="listbox">
                  {suggestions.map((suggestion, si) => (
                    <div
                      key={suggestion}
                      style={styles.dropdownItem(si === activeSuggestion)}
                      role="option"
                      aria-selected={si === activeSuggestion}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectSuggestion(i, suggestion);
                      }}
                    >
                      {suggestion}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {showValidity && (
        <div style={styles.validityBanner(isValid)} role="status" aria-live="polite">
          {isValid ? 'Valid phrase' : 'Invalid phrase — check all 12 words'}
        </div>
      )}

      {isRecoveryMode && (
        <div style={styles.revocationSection}>
          <label style={styles.revocationLabel}>
            <input
              type="checkbox"
              checked={revokeOtherDevices}
              onChange={(e) => setRevokeOtherDevices(e.target.checked)}
            />
            <div>
              <div style={styles.revocationText}>Sign out all other devices</div>
              <div style={styles.revocationDesc}>
                Revokes all other linked device keys. Use this if a device is lost or compromised.
              </div>
            </div>
          </label>
        </div>
      )}

      <div style={styles.actions}>
        <button
          type="button"
          className="back-link"
          onClick={onCancel}
        >
          ← Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!isValid || isLoading}
          onClick={handleSubmit}
          style={{ flex: 1, padding: '10px' }}
        >
          {isLoading ? 'Signing in...' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
