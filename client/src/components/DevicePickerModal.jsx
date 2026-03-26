import { useState, useEffect, useRef, useCallback } from 'react';

const EXIT_DURATION_MS = 200;

function DeviceOption({ label, isSelected, onSelect }) {
  return (
    <div
      className={`dpm-option${isSelected ? ' dpm-option--selected' : ''}`}
      onClick={onSelect}
    >
      <div className="dpm-option-label">{label || 'Unknown device'}</div>
      {isSelected && <div className="dpm-selected-dot" />}
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
        <div className="dpm-title">{title}</div>

        <div className="dpm-list">
          {devices.length === 0 ? (
            <div className="dpm-empty-text">no devices found</div>
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

        <button className="dpm-cancel-btn" onClick={handleClose}>
          cancel
        </button>
      </div>
    </div>
  );
}
