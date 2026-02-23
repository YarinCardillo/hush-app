import { useState, useEffect, useRef, useCallback } from 'react';
import { QUALITY_PRESETS } from '../utils/constants';

const EXIT_DURATION_MS = 200;

const styles = {
  title: {
    fontSize: '1rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
    marginBottom: '4px',
  },
  option: (isHovered, isSelected) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderRadius: 'var(--radius-md)',
    border: `1px solid ${isSelected ? 'var(--hush-amber)' : 'transparent'}`,
    background: isSelected ? 'var(--hush-elevated)' : isHovered ? 'var(--hush-elevated)' : 'var(--hush-black)',
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

function OptionRow({ label, detail, recommendedLabel, isSelected, onClick }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      style={styles.option(isHovered, isSelected)}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={styles.optionLeft}>
        <div style={styles.optionLabel}>
          {label}
          {isSelected && (
            <span style={{ fontWeight: 400, color: 'var(--hush-amber)', marginLeft: '6px' }}>
              (current)
            </span>
          )}
          {recommendedLabel != null && (
            <span style={{ fontWeight: 400, color: 'var(--hush-text-muted)', marginLeft: '6px' }}>
              ({recommendedLabel})
            </span>
          )}
        </div>
        <div style={styles.optionDetail}>{detail}</div>
      </div>
      {isSelected ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--hush-amber)" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--hush-text-muted)" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
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

export default function QualityOrWindowModal({
  step,
  currentQualityKey,
  onCancel,
  onGoToQualityStep,
  onSelectQualityPreset,
  onSelectWindow,
  onBack,
  recommendedQualityKey,
  recommendedUploadMbps,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const exitTimeoutRef = useRef(null);
  const isChoice = step === 'choice';
  const isQuality = step === 'quality';

  const handleClose = useCallback(() => {
    setIsOpen(false);
    if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
    exitTimeoutRef.current = setTimeout(onCancel, EXIT_DURATION_MS);
  }, [onCancel]);

  useEffect(() => {
    if (step != null) {
      const t = requestAnimationFrame(() => setIsOpen(true));
      return () => cancelAnimationFrame(t);
    }
  }, [step]);

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

  const handleWindow = () => {
    handleClose();
    onSelectWindow();
  };

  if (step == null) return null;

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
        {isChoice && (
          <>
            <div style={styles.title}>Change quality or window</div>
            <OptionRow
              label="Change quality"
              detail="Stream resolution and framerate"
              onClick={() => onGoToQualityStep?.()}
            />
            <OptionRow
              label="Change window/screen"
              detail="Pick another display or window to share"
              onClick={handleWindow}
            />
            <button style={styles.cancelBtn} onClick={handleClose}>
              cancel
            </button>
          </>
        )}

        {isQuality && (
          <>
            <div style={styles.title}>choose stream quality</div>
            {Object.entries(QUALITY_PRESETS).map(([key, preset]) => (
              <OptionRow
                key={key}
                label={preset.label}
                detail={preset.description}
                recommendedLabel={recommendedQualityKey === key ? recommendedLabel : null}
                isSelected={key === currentQualityKey}
                onClick={() => onSelectQualityPreset?.(key)}
              />
            ))}
            <button style={styles.cancelBtn} onClick={onBack}>
              back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
