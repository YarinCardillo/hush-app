import { useState, useEffect } from 'react';
import modalStyles from './modalStyles';

/** Duration presets shared by ban and mute actions. `value` is seconds; null = permanent. */
const DURATION_PRESETS = [
  { label: '1 hour', value: 3600 },
  { label: '24 hours', value: 86400 },
  { label: '7 days', value: 604800 },
  { label: '30 days', value: 2592000 },
  { label: 'Permanent', value: null },
];

const ROLE_OPTIONS = [
  { label: 'Member', value: 'member' },
  { label: 'Mod', value: 'mod' },
  { label: 'Admin', value: 'admin' },
];

const ACTION_LABELS = {
  kick: 'Kick',
  ban: 'Ban',
  mute: 'Mute',
  changeRole: 'Change Role',
};

const selectStyles = {
  width: '100%',
  padding: '9px 12px',
  background: 'var(--hush-black)',
  border: '1px solid transparent',
  color: 'var(--hush-text)',
  fontFamily: 'var(--font-sans)',
  fontSize: '0.9rem',
  cursor: 'pointer',
};

const textareaStyles = {
  width: '100%',
  padding: '9px 12px',
  background: 'var(--hush-black)',
  border: '1px solid transparent',
  color: 'var(--hush-text)',
  fontFamily: 'var(--font-sans)',
  fontSize: '0.9rem',
  resize: 'vertical',
  minHeight: '72px',
  boxSizing: 'border-box',
};

/**
 * Modal dialog for executing a moderation action.
 * Enforces a required reason field before the confirm button is enabled.
 *
 * @param {{
 *   action: 'kick'|'ban'|'mute'|'changeRole',
 *   member: object,
 *   onConfirm: (data: { reason: string, expiresIn?: number|null, newRole?: string }) => Promise<void>,
 *   onClose: Function
 * }} props
 */
export default function ModerationModal({ action, member, onConfirm, onClose }) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState(null); // null = permanent
  const [newRole, setNewRole] = useState('member');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const hasDuration = action === 'ban' || action === 'mute';
  const hasRoleSelector = action === 'changeRole';

  const actionLabel = ACTION_LABELS[action] ?? action;
  const displayName = member?.displayName || member?.username || 'this user';
  const isReasonValid = reason.trim().length > 0;

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

  const handleConfirm = async () => {
    if (!isReasonValid || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const payload = { reason: reason.trim() };
      if (hasDuration) payload.expiresIn = duration;
      if (hasRoleSelector) payload.newRole = newRole;
      await onConfirm(payload);
    } catch (err) {
      setError(err?.message || 'Action failed. Please try again.');
      setSubmitting(false);
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
        <div style={modalStyles.title}>
          {actionLabel} {displayName}
        </div>

        <div style={modalStyles.form}>
          {/* Reason — required for all actions */}
          <div>
            <label htmlFor="mod-reason" style={modalStyles.fieldLabel}>
              Reason (required)
            </label>
            <textarea
              id="mod-reason"
              style={textareaStyles}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the reason for this action"
              disabled={submitting}
            />
          </div>

          {/* Duration selector for ban / mute */}
          {hasDuration && (
            <div>
              <label htmlFor="mod-duration" style={modalStyles.fieldLabel}>
                Duration
              </label>
              <select
                id="mod-duration"
                style={selectStyles}
                value={duration === null ? 'permanent' : String(duration)}
                onChange={(e) => {
                  const v = e.target.value;
                  setDuration(v === 'permanent' ? null : Number(v));
                }}
                disabled={submitting}
              >
                {DURATION_PRESETS.map((p) => (
                  <option key={p.label} value={p.value === null ? 'permanent' : String(p.value)}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Role selector for changeRole */}
          {hasRoleSelector && (
            <div>
              <label htmlFor="mod-role" style={modalStyles.fieldLabel}>
                New Role
              </label>
              <select
                id="mod-role"
                style={selectStyles}
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                disabled={submitting}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <p style={modalStyles.error}>{error}</p>}
        </div>

        <div style={{ ...modalStyles.actions, marginTop: '20px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={action === 'kick' || action === 'ban' ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={handleConfirm}
            disabled={!isReasonValid || submitting}
          >
            {submitting ? 'Sending…' : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
