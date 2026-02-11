import { QUALITY_PRESETS } from '../utils/constants';

const styles = {
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  item: (isActive, isRecommended) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderRadius: 'var(--radius-sm)',
    border: isActive ? '1px solid var(--accent)' : '1px solid transparent',
    background: isActive ? 'var(--accent-subtle)' : 'var(--bg-primary)',
    cursor: 'pointer',
    transition: 'all 150ms ease',
  }),
  itemLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  itemLabel: {
    fontSize: '0.85rem',
    fontWeight: 500,
  },
  itemDetail: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  recommended: {
    fontSize: '0.65rem',
    fontWeight: 600,
    color: 'var(--live)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  active: {
    fontSize: '0.65rem',
    fontWeight: 600,
    color: 'var(--accent)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  bandwidth: {
    marginTop: '12px',
    padding: '10px 12px',
    background: 'var(--bg-primary)',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
  },
};

export default function QualitySelector({ currentQuality, recommendedQuality, onSelect }) {
  const presetEntries = Object.entries(QUALITY_PRESETS);

  return (
    <div>
      <div style={styles.list}>
        {presetEntries.map(([key, preset]) => {
          const isActive = key === currentQuality;
          const isRecommended = key === recommendedQuality?.key;

          return (
            <div
              key={key}
              style={styles.item(isActive, isRecommended)}
              onClick={() => onSelect(key)}
            >
              <div style={styles.itemLeft}>
                <span style={styles.itemLabel}>{preset.label}</span>
                <span style={styles.itemDetail}>
                  {(preset.bitrate / 1_000_000).toFixed(1)} Mbps | {preset.minUpload} Mbps upload
                </span>
              </div>
              <div>
                {isActive && <span style={styles.active}>Active</span>}
                {isRecommended && !isActive && <span style={styles.recommended}>Best</span>}
              </div>
            </div>
          );
        })}
      </div>

      {recommendedQuality && (
        <div style={styles.bandwidth}>
          Estimated upload: {recommendedQuality.uploadMbps.toFixed(1)} Mbps
        </div>
      )}
    </div>
  );
}
