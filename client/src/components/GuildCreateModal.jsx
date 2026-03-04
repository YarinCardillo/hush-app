import { useState, useEffect } from 'react';
import { createGuild } from '../lib/api';
import modalStyles from './modalStyles';

/**
 * Guild creation modal — single text input for the guild name.
 * Per user decision: minimal friction, no icon upload or description.
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
      const guild = await createGuild(token, trimmed);
      onCreated(guild);
    } catch (err) {
      setError(err.message || 'Failed to create server.');
    } finally {
      setLoading(false);
    }
  };

  return (
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
          {error && <div style={modalStyles.error}>{error}</div>}
          <div style={modalStyles.actions}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading || !name.trim()}>
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
