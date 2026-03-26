import { useState, useEffect, useRef, useCallback } from 'react';
import { QUALITY_PRESETS } from '../utils/constants';

const EXIT_DURATION_MS = 200;

function OptionRow({ label, detail, recommendedLabel, onClick }) {
  return (
    <div
      className="qpm-option"
      onClick={onClick}
    >
      <div className="qpm-option-left">
        <div className="qpm-option-label">
          {label}
          {recommendedLabel != null && (
            <span className="qpm-option-label-hint">
              ({recommendedLabel})
            </span>
          )}
        </div>
        <div className="qpm-option-detail">{detail}</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--hush-text-muted)" strokeWidth="2">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </div>
  );
}

function formatRecommended(recommendedQualityKey, recommendedUploadMbps) {
  if (recommendedQualityKey == null || recommendedUploadMbps == null) return null;
  const isLocalhost = recommendedUploadMbps >= 99;
  return isLocalhost
    ? 'Recommended: localhost'
    : `Recommended: ${recommendedUploadMbps.toFixed(0)} Mbps`;
}

export default function QualityPickerModal({
  recommendedQualityKey,
  recommendedUploadMbps,
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

  const recommendedLabel = formatRecommended(recommendedQualityKey, recommendedUploadMbps);

  return (
    <div
      className={`modal-backdrop ${isOpen ? 'modal-backdrop-open' : ''}`}
      onClick={handleClose}
    >
      <div
        className={`modal-content ${isOpen ? 'modal-content-open' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="qpm-title">choose stream quality</div>

        {Object.entries(QUALITY_PRESETS).map(([key, preset]) => (
          <OptionRow
            key={key}
            label={preset.label}
            detail={preset.description}
            recommendedLabel={recommendedQualityKey === key ? recommendedLabel : null}
            onClick={() => onSelect(key)}
          />
        ))}

        <button className="qpm-cancel-btn" onClick={handleClose}>
          cancel
        </button>
      </div>
    </div>
  );
}
