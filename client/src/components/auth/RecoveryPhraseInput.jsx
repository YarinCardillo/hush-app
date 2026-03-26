import { useState, useRef, useCallback, useEffect } from 'react';
import { isMnemonicValid, getEnglishWordlist } from '../../lib/bip39Identity';

const WORDLIST_SUGGESTION_LIMIT = 5;
const AUTOCOMPLETE_MIN_CHARS = 2;

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
    <div className="rpi-container">
      <div className="rpi-grid">
        {words.map((word, i) => (
          <div key={i} className="rpi-field-group">
            <label
              htmlFor={`recovery-word-${i}`}
              className="rpi-field-label"
            >
              {i + 1}
            </label>
            <div className="rpi-input-wrap">
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
                <div ref={dropdownRef} className="rpi-dropdown" role="listbox">
                  {suggestions.map((suggestion, si) => (
                    <div
                      key={suggestion}
                      className={`rpi-dropdown-item${si === activeSuggestion ? ' rpi-dropdown-item--active' : ''}`}
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
        <div
          className={isValid ? 'rpi-validity-banner--valid' : 'rpi-validity-banner--invalid'}
          role="status"
          aria-live="polite"
        >
          {isValid ? 'Valid phrase' : 'Invalid phrase — check all 12 words'}
        </div>
      )}

      {isRecoveryMode && (
        <div className="rpi-revocation-section">
          <label className="rpi-revocation-label">
            <input
              type="checkbox"
              checked={revokeOtherDevices}
              onChange={(e) => setRevokeOtherDevices(e.target.checked)}
            />
            <div>
              <div className="rpi-revocation-text">Sign out all other devices</div>
              <div className="rpi-revocation-desc">
                Revokes all other linked device keys. Use this if a device is lost or compromised.
              </div>
            </div>
          </label>
        </div>
      )}

      <div className="rpi-actions">
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
