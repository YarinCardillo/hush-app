import { useState, useEffect } from 'react';

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.6)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  card: {
    background: 'var(--hush-surface)',
    border: '1px solid var(--hush-border)',
    borderRadius: 'var(--radius-xl)',
    padding: '28px',
    width: '380px',
    maxWidth: '90vw',
    maxHeight: '70vh',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    animation: 'modal-enter var(--duration-slow) var(--ease-spring)',
  },
  title: {
    fontSize: '1rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
    marginBottom: '4px',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    overflow: 'auto',
  },
  option: (isHovered, isSelected) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 16px',
    borderRadius: 'var(--radius-md)',
    border: isSelected
      ? '1px solid var(--hush-amber)'
      : '1px solid var(--hush-border)',
    background: isHovered ? 'var(--hush-elevated)' : 'var(--hush-black)',
    cursor: 'pointer',
    transition: 'all var(--duration-fast) var(--ease-out)',
  }),
  optionLabel: {
    fontSize: '0.9rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  selectedDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'var(--hush-amber)',
    flexShrink: 0,
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
  emptyText: {
    fontSize: '0.85rem',
    color: 'var(--hush-text-muted)',
    textAlign: 'center',
    padding: '16px 0',
  },
};

function DeviceOption({ label, isSelected, onSelect }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      style={styles.option(isHovered, isSelected)}
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={styles.optionLabel}>{label || 'Unknown device'}</div>
      {isSelected && <div style={styles.selectedDot} />}
    </div>
  );
}

export default function DevicePickerModal({
  title,
  devices,
  selectedDeviceId,
  onSelect,
  onCancel,
}) {
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
        <div style={styles.title}>{title}</div>

        <div style={styles.list}>
          {devices.length === 0 ? (
            <div style={styles.emptyText}>no devices found</div>
          ) : (
            devices.map((device) => (
              <DeviceOption
                key={device.deviceId}
                label={device.label}
                isSelected={device.deviceId === selectedDeviceId}
                onSelect={() => onSelect(device.deviceId)}
              />
            ))
          )}
        </div>

        <button style={styles.cancelBtn} onClick={onCancel}>
          cancel
        </button>
      </div>
    </div>
  );
}
