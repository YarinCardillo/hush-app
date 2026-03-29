import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_AUTH_INSTANCE_URL,
  getInstanceDisplayName,
} from '../../lib/authInstanceStore';

const SHELL_STYLE = {
  marginTop: '14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const LABEL_STYLE = {
  fontSize: '0.78rem',
  color: 'var(--hush-text-muted)',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
};

const BUTTON_STYLE = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '10px',
  padding: '9px 11px',
  borderRadius: '12px',
  border: '1px solid var(--hush-border)',
  background: 'color-mix(in srgb, var(--hush-surface) 82%, transparent)',
  color: 'var(--hush-text)',
  cursor: 'pointer',
};

const PANEL_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '10px',
  borderRadius: '14px',
  border: '1px solid var(--hush-border)',
  background: 'color-mix(in srgb, var(--hush-surface) 92%, transparent)',
  boxShadow: '0 18px 50px rgba(0, 0, 0, 0.18)',
};

const LIST_BUTTON_STYLE = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '10px',
  padding: '9px 11px',
  borderRadius: '12px',
  border: '1px solid var(--hush-border)',
  background: 'transparent',
  color: 'var(--hush-text)',
  cursor: 'pointer',
};

export function AuthInstanceSelector({ value, instances, onSelect, disabled = false }) {
  const rootRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
        setError('');
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  const commitSelection = useCallback(async (candidate) => {
    if (disabled) return;

    setIsSaving(true);
    setError('');
    try {
      await onSelect(candidate);
      setDraft('');
      setIsOpen(false);
    } catch (err) {
      setError(err?.message || 'Enter a valid instance URL.');
    } finally {
      setIsSaving(false);
    }
  }, [disabled, onSelect]);

  const handleSubmit = useCallback(async (event) => {
    event.preventDefault();
    if (!draft.trim()) {
      setError('Enter an instance URL.');
      return;
    }
    await commitSelection(draft);
  }, [commitSelection, draft]);

  return (
    <div ref={rootRef} style={SHELL_STYLE}>
      <div style={LABEL_STYLE}>
        <span>Instance</span>
      </div>

      <button
        type="button"
        style={BUTTON_STYLE}
        onClick={() => setIsOpen((open) => !open)}
        disabled={disabled}
        title={value}
      >
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '0.92rem',
          }}
        >
          {getInstanceDisplayName(value)}
        </span>
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ color: 'var(--hush-text-muted)', flexShrink: 0 }}
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      </button>

      {isOpen && (
        <div style={PANEL_STYLE}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {instances.map((instance) => {
              const isActive = instance.url === value;
              const isDefault = instance.url === DEFAULT_AUTH_INSTANCE_URL;

              return (
                <button
                  key={instance.url}
                  type="button"
                  style={{
                    ...LIST_BUTTON_STYLE,
                    borderColor: isActive ? 'var(--hush-amber)' : 'var(--hush-border)',
                    background: isActive
                      ? 'color-mix(in srgb, var(--hush-amber) 10%, transparent)'
                      : 'transparent',
                  }}
                  onClick={() => commitSelection(instance.url)}
                  disabled={isSaving}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '1px' }}>
                    <span style={{ fontSize: '0.92rem' }}>{getInstanceDisplayName(instance.url)}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--hush-text-muted)' }}>
                      {isDefault ? 'Pinned default' : instance.lastUsedAt ? `Last used ${new Date(instance.lastUsedAt).toLocaleDateString()}` : 'Saved instance'}
                    </span>
                  </span>
                  {isActive && <span style={{ color: 'var(--hush-amber)' }}>Current</span>}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              className="input"
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add custom instance"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
              disabled={isSaving}
            />
            <button type="submit" className="btn btn-secondary" disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Add custom instance'}
            </button>
          </form>

          {error && (
            <div style={{ color: 'var(--hush-danger)', fontSize: '0.82rem' }}>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
