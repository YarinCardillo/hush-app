import { useEffect, useRef } from 'react';

const styles = {
  container: {
    position: 'relative',
    background: '#000',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    border: '1px solid var(--border)',
    minHeight: '200px',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
  },
  label: {
    position: 'absolute',
    bottom: '8px',
    left: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    background: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(8px)',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.75rem',
    color: '#e8e8f0',
    fontWeight: 500,
  },
  sourceIcon: {
    width: '12px',
    height: '12px',
    opacity: 0.7,
  },
  localBadge: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    padding: '2px 8px',
    background: 'rgba(108, 92, 231, 0.3)',
    backdropFilter: 'blur(8px)',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.65rem',
    color: 'var(--accent)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
};

export default function StreamView({ track, label, source, isLocal }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (!videoRef.current || !track) return;

    const stream = new MediaStream([track]);
    videoRef.current.srcObject = stream;

    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [track]);

  return (
    <div style={styles.container}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal} // Mute local to avoid feedback
        style={styles.video}
      />

      <div style={styles.label}>
        {source === 'screen' ? (
          <svg style={styles.sourceIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        ) : (
          <svg style={styles.sourceIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" />
          </svg>
        )}
        {label}
      </div>

      {isLocal && <div style={styles.localBadge}>You</div>}
    </div>
  );
}
