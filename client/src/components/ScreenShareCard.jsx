import { useState } from 'react';

const styles = {
  container: (isHovered, isLoading) => ({
    position: 'relative',
    background: 'var(--hush-surface)',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-lg)',
    aspectRatio: '16 / 9',
    width: '100%',
    maxHeight: '75vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    cursor: isLoading ? 'wait' : 'pointer',
    transition: 'border-color var(--duration-fast) var(--ease-out)',
    opacity: isLoading ? 0.6 : 1,
    pointerEvents: isLoading ? 'none' : 'auto',
  }),
  icon: {
    width: '48px',
    height: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  peerName: {
    fontSize: '0.9rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
  },
  hint: {
    fontSize: '0.75rem',
    color: 'var(--hush-text-muted)',
  },
  spinner: {
    width: '24px',
    height: '24px',
    border: '2px solid transparent',
    borderTopColor: 'var(--hush-primary)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};

export default function ScreenShareCard({ peerName, isLoading = false, onWatch }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      style={styles.container(isHovered, isLoading)}
      onClick={onWatch}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isLoading ? (
        <>
          <div style={styles.spinner} />
          <div style={styles.peerName}>{peerName}</div>
          <div style={styles.hint}>loading stream...</div>
        </>
      ) : (
        <>
          <div style={styles.icon}>
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--hush-text-ghost)"
              strokeWidth="1.5"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <div style={styles.peerName}>{peerName}</div>
          <div style={styles.hint}>click to watch</div>
        </>
      )}
    </div>
  );
}
