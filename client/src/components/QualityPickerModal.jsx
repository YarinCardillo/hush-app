import { useState, useEffect } from 'react';

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  card: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '24px',
    width: '340px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  title: {
    fontSize: '0.95rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
    marginBottom: '4px',
  },
  option: (isHovered) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    background: isHovered ? 'var(--bg-secondary)' : 'var(--bg-primary)',
    cursor: 'pointer',
    transition: 'background 150ms ease',
  }),
  optionLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  optionLabel: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  optionDetail: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  cancelBtn: {
    marginTop: '4px',
    padding: '8px',
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: '0.8rem',
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
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
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </div>
  );
}

export default function QualityPickerModal({ nativeWidth, nativeHeight, onSelect, onCancel }) {
  // Dismiss on Escape key
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Choose stream quality</div>

        <OptionRow
          label="Source"
          detail={`${nativeWidth}x${nativeHeight}, 60fps`}
          onClick={() => onSelect('source')}
        />

        <OptionRow
          label="Lite"
          detail="720p, 30fps"
          onClick={() => onSelect('lite')}
        />

        <button style={styles.cancelBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
