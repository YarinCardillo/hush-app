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
    padding: '80px 24px 48px',
    fontFamily: 'var(--font-sans, system-ui)',
  },
  title: {
    color: 'var(--hush-text, #e0e0e0)',
    fontSize: '2rem',
    fontWeight: 300,
    letterSpacing: '-0.02em',
    marginBottom: 12,
  },
  subtitle: {
    color: 'var(--hush-text-muted, #555568)',
    fontSize: '0.85rem',
    fontWeight: 400,
    marginBottom: 64,
    textAlign: 'center',
    maxWidth: 360,
    lineHeight: 1.5,
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
    border: '1px solid transparent',
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
    background: 'var(--hush-elevated, #1a1a1a)',
  },
};

export default function MascotDemo() {
  const [activePhase, setActivePhase] = useState(null);

  return (
    <div style={styles.root}>
      <h1 style={styles.title}>Meet Vesper</h1>
      <p style={styles.subtitle}>
        the quiet presence that makes a server feel alive.
        not a bot. not a feature. just here.
      </p>

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
            border: '1px solid transparent',
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
