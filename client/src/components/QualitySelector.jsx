import { QUALITY_PRESETS } from '../utils/constants';

const styles = {
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  item: (isActive) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid transparent',
    background: isActive ? 'var(--hush-amber-ghost)' : 'var(--hush-black)',
    cursor: 'pointer',
    transition: 'all var(--duration-fast) var(--ease-out)',
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
    color: 'var(--hush-text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  active: {
    fontSize: '0.65rem',
    fontWeight: 500,
    color: 'var(--hush-amber)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
};

export default function QualitySelector({ currentQuality, onSelect }) {
  const presetEntries = Object.entries(QUALITY_PRESETS);

  return (
    <div style={styles.list}>
      {presetEntries.map(([key, preset]) => {
        const isActive = key === currentQuality;

        return (
          <div
            key={key}
            style={styles.item(isActive)}
            onClick={() => onSelect(key)}
          >
            <div style={styles.itemLeft}>
              <span style={styles.itemLabel}>{preset.label}</span>
              <span style={styles.itemDetail}>{preset.description}</span>
            </div>
            {isActive && <span style={styles.active}>Active</span>}
          </div>
        );
      })}
    </div>
  );
}
