import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { createGuild, listServerTemplates } from '../lib/api';
import modalStyles from './modalStyles';

/**
 * Guild creation modal — name input + template picker.
 *
 * @param {{
 *   getToken: () => string|null,
 *   onClose: () => void,
 *   onCreated: (guild: object) => void,
 * }} props
 */
export default function GuildCreateModal({ getToken, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Template picker state
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setIsOpen(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Load templates on mount
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    (async () => {
      try {
        const data = await listServerTemplates(token);
        if (Array.isArray(data) && data.length > 0) {
          setTemplates(data);
          const def = data.find(t => t.isDefault);
          setSelectedTemplateId(def ? def.id : data[0].id);
        }
      } catch {
        // Templates are optional — if loading fails, server uses its default
      }
      setTemplatesLoaded(true);
    })();
  }, [getToken]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Server name is required.');
      return;
    }
    const token = getToken();
    if (!token) {
      setError('Not authenticated.');
      return;
    }
    setLoading(true);
    try {
      const guild = await createGuild(token, trimmed, selectedTemplateId);
      onCreated(guild);
    } catch (err) {
      setError(err.message || 'Failed to create server.');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div
      className={`modal-backdrop ${isOpen ? 'modal-backdrop-open' : ''}`}
      onClick={onClose}
    >
      <div
        className={`modal-content ${isOpen ? 'modal-content-open' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={modalStyles.title}>Create a server</div>
        <form style={modalStyles.form} onSubmit={handleSubmit}>
          <div>
            <label htmlFor="guild-name" style={modalStyles.fieldLabel}>Server name</label>
            <input
              id="guild-name"
              name="guild-name"
              className="input"
              type="text"
              placeholder="My server"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              maxLength={100}
              autoComplete="off"
              autoFocus
            />
          </div>

          {/* Template picker — only shown when templates are available */}
          {templatesLoaded && templates.length > 1 && (
            <div style={{ marginTop: '4px' }}>
              <label style={modalStyles.fieldLabel}>Template</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                {templates.map(tmpl => (
                  <label
                    key={tmpl.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '8px 10px', borderRadius: 'var(--radius-md)',
                      background: selectedTemplateId === tmpl.id ? 'var(--hush-bg-hover)' : 'transparent',
                      border: selectedTemplateId === tmpl.id ? '1px solid var(--hush-live)' : '1px solid var(--hush-border)',
                      cursor: 'pointer', transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="radio"
                      name="template"
                      value={tmpl.id}
                      checked={selectedTemplateId === tmpl.id}
                      onChange={() => setSelectedTemplateId(tmpl.id)}
                      style={{ accentColor: 'var(--hush-live)' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: '0.85rem', color: 'var(--hush-text-primary)' }}>
                        {tmpl.name}
                        {tmpl.isDefault && <span style={{ fontSize: '0.7rem', color: 'var(--hush-text-ghost)', marginLeft: '6px' }}>(default)</span>}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--hush-text-ghost)' }}>
                        {tmpl.channels.filter(c => c.type !== 'system').map(c => c.type === 'voice' ? `${c.name} (voice)` : `#${c.name}`).join(', ') || 'system only'}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <div style={modalStyles.error}>{error}</div>}
          <div style={modalStyles.actions}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading || !name.trim()}>
              {loading ? 'Creating\u2026' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
