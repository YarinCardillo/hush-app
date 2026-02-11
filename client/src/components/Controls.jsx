const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '12px 16px',
    background: 'var(--bg-secondary)',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
  },
  btn: (active, variant = 'default') => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    height: '44px',
    padding: '0 16px',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-body)',
    fontSize: '0.85rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 150ms ease',
    ...(variant === 'danger'
      ? {
          background: 'var(--danger)',
          color: 'white',
        }
      : active
        ? {
            background: 'var(--accent)',
            color: 'white',
            boxShadow: '0 0 16px rgba(108, 92, 231, 0.3)',
          }
        : {
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }
    ),
  }),
  iconBtn: (active) => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '44px',
    height: '44px',
    border: active ? 'none' : '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    background: active ? 'var(--accent)' : 'var(--bg-elevated)',
    color: active ? 'white' : 'var(--text-primary)',
    cursor: 'pointer',
    transition: 'all 150ms ease',
  }),
  divider: {
    width: '1px',
    height: '28px',
    background: 'var(--border)',
    margin: '0 4px',
  },
  qualityTag: {
    fontSize: '0.7rem',
    fontFamily: 'var(--font-mono)',
    padding: '2px 6px',
    background: 'rgba(108, 92, 231, 0.15)',
    borderRadius: '4px',
    color: 'var(--accent)',
  },
};

export default function Controls({
  isReady,
  isScreenSharing,
  isMicOn,
  isWebcamOn,
  quality,
  onScreenShare,
  onSwitchScreen,
  onMic,
  onWebcam,
  onLeave,
}) {
  return (
    <div style={styles.bar}>
      {/* Screen Share */}
      <button
        style={styles.btn(isScreenSharing)}
        onClick={onScreenShare}
        disabled={!isReady}
        title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        {isScreenSharing ? 'Stop Share' : 'Share Screen'}
        {isScreenSharing && <span style={styles.qualityTag}>{quality}</span>}
      </button>

      {/* Switch Screen (only visible when sharing) */}
      {isScreenSharing && (
        <button
          style={styles.iconBtn(false)}
          onClick={onSwitchScreen}
          title="Switch screen/window"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16 3 21 3 21 8" />
            <line x1="4" y1="20" x2="21" y2="3" />
            <polyline points="21 16 21 21 16 21" />
            <line x1="15" y1="15" x2="21" y2="21" />
          </svg>
        </button>
      )}

      <div style={styles.divider} />

      {/* Microphone */}
      <button
        style={styles.iconBtn(isMicOn)}
        onClick={onMic}
        disabled={!isReady}
        title={isMicOn ? 'Mute mic' : 'Unmute mic'}
      >
        {isMicOn ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .51-.06 1-.16 1.47" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        )}
      </button>

      {/* Webcam */}
      <button
        style={styles.iconBtn(isWebcamOn)}
        onClick={onWebcam}
        disabled={!isReady}
        title={isWebcamOn ? 'Turn off camera' : 'Turn on camera'}
      >
        {isWebcamOn ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        )}
      </button>

      <div style={styles.divider} />

      {/* Leave */}
      <button
        style={styles.btn(false, 'danger')}
        onClick={onLeave}
      >
        Leave
      </button>
    </div>
  );
}
