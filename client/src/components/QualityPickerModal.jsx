import { useState, useEffect, useRef, useCallback } from 'react';

const EXIT_DURATION_MS = 200;

const styles = {
  title: {
    fontSize: '1rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
    marginBottom: '4px',
  },
  option: (isHovered) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid transparent',
    background: isHovered ? 'var(--hush-elevated)' : 'var(--hush-black)',
    cursor: 'pointer',
    transition: 'all var(--duration-fast) var(--ease-out)',
  }),
  optionLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  optionLabel: {
    fontSize: '0.9rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
  },
  optionDetail: {
    fontSize: '0.75rem',
    color: 'var(--hush-text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  cancelBtn: {
    marginTop: '4px',
    padding: '8px',
    background: 'none',
    border: 'none',
    color: 'var(--hush-text-muted)',
    fontSize: '0.8rem',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  },
};

function OptionRow({ label, detail, onClick }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      style={styles.option(isHovered)}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={styles.optionLeft}>
        <div style={styles.optionLabel}>{label}</div>
        <div style={styles.optionDetail}>{detail}</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--hush-text-muted)" strokeWidth="2">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </div>
  );
}

export default function QualityPickerModal({ onSelect, onCancel }) {
  const [isOpen, setIsOpen] = useState(false);
  const exitTimeoutRef = useRef(null);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
    exitTimeoutRef.current = setTimeout(onCancel, EXIT_DURATION_MS);
  }, [onCancel]);

  useEffect(() => {
    const t = requestAnimationFrame(() => setIsOpen(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
    };
  }, [handleClose]);

  return (
    <div
      className={`modal-backdrop ${isOpen ? 'modal-backdrop-open' : ''}`}
      onClick={handleClose}
    >
      <div
        className={`modal-content ${isOpen ? 'modal-content-open' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={styles.title}>choose stream quality</div>

        <OptionRow
          label="Source"
          detail="native resolution, 60fps"
          onClick={() => onSelect('source')}
        />

        <OptionRow
          label="Lite"
          detail="720p, 30fps"
          onClick={() => onSelect('lite')}
        />

        <button style={styles.cancelBtn} onClick={handleClose}>
          cancel
        </button>
      </div>
    </div>
  );
}
