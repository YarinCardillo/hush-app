import { useState, useEffect } from 'react';
import modalStyles from './modalStyles';

/**
 * Generic confirmation dialog.
 * Pressing Escape cancels; pressing Enter confirms.
 */
export default function ConfirmModal({ title, message, confirmLabel = 'Confirm', onConfirm, onCancel }) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setIsOpen(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onConfirm, onCancel]);

  return (
    <div
      className={`modal-backdrop ${isOpen ? 'modal-backdrop-open' : ''}`}
      onClick={onCancel}
    >
      <div
        className={`modal-content ${isOpen ? 'modal-content-open' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={modalStyles.title}>{title}</div>
        {message && (
          <p style={{ color: 'var(--hush-text-secondary)', fontSize: '0.85rem', margin: '8px 0 0', lineHeight: 1.5, overflowWrap: 'break-word', wordBreak: 'break-word' }}>
            {message}
          </p>
        )}
        <div style={{ ...modalStyles.actions, marginTop: '20px' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
