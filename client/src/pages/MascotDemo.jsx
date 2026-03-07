import { useState } from 'react';
import Vesper from '../components/Vesper';

const phases = ['idle', 'waiting', 'activating'];

const styles = {
  root: {
    minHeight: '100vh',
    background: 'var(--hush-black, #0a0a0a)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '48px 24px',
    fontFamily: 'var(--font-sans, system-ui)',
  },
  title: {
    color: 'var(--hush-text, #e0e0e0)',
    fontSize: '1.4rem',
    fontWeight: 600,
    marginBottom: 8,
  },
  subtitle: {
    color: 'var(--hush-text-muted, #666)',
    fontSize: '0.85rem',
    fontFamily: 'var(--font-mono, monospace)',
    letterSpacing: '0.08em',
    marginBottom: 48,
  },
  grid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 48,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    padding: '32px 24px',
    borderRadius: 16,
    border: '1px solid var(--hush-border, #222)',
    background: 'var(--hush-surface, #111)',
    minWidth: 240,
  },
  phaseLabel: {
    fontSize: '0.75rem',
    fontFamily: 'var(--font-mono, monospace)',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--hush-text-secondary, #888)',
    padding: '4px 12px',
    borderRadius: 6,
    background: 'var(--hush-elevated, #1a1a1a)',
  },
};

export default function MascotDemo() {
  const [activePhase, setActivePhase] = useState(null);

  return (
    <div style={styles.root}>
      <h1 style={styles.title}>HushOrb Animation States</h1>
      <p style={styles.subtitle}>hover any orb to see the hover eye state</p>

      <div style={styles.grid}>
        {phases.map((phase) => (
          <div key={phase} style={styles.card}>
            <span style={styles.phaseLabel}>{phase}</span>
            <Vesper phase={phase} />
          </div>
        ))}
      </div>

      <div style={{ marginTop: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <p style={{ color: 'var(--hush-text-muted, #666)', fontSize: '0.8rem', fontFamily: 'var(--font-mono, monospace)' }}>
          interactive: click to cycle phases
        </p>
        <button
          type="button"
          onClick={() => {
            const idx = activePhase === null ? 0 : (phases.indexOf(activePhase) + 1) % phases.length;
            setActivePhase(phases[idx]);
          }}
          style={{
            padding: '8px 20px',
            fontSize: '0.8rem',
            fontFamily: 'var(--font-mono, monospace)',
            background: 'var(--hush-elevated, #1a1a1a)',
            border: '1px solid var(--hush-border, #333)',
            borderRadius: 8,
            color: 'var(--hush-text, #e0e0e0)',
            cursor: 'pointer',
            letterSpacing: '0.06em',
          }}
        >
          {activePhase ?? 'start'} &rarr; {phases[(phases.indexOf(activePhase ?? 'activating') + 1) % phases.length]}
        </button>
        <div style={{ ...styles.card, marginTop: 8 }}>
          <span style={styles.phaseLabel}>interactive: {activePhase ?? 'idle'}</span>
          <Vesper phase={activePhase ?? 'idle'} />
        </div>
      </div>
    </div>
  );
}
