import { QUALITY_PRESETS, IS_SCREEN_SHARE_SUPPORTED } from '../utils/constants';

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '12px 16px',
    background: 'rgba(8, 8, 12, 0.75)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    borderTop: '1px solid var(--hush-border)',
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
    fontFamily: 'var(--font-sans)',
    fontSize: '0.85rem',
    fontWeight: 500,
    cursor: 'pointer',
    ...(variant === 'danger'
      ? {
          background: 'var(--hush-danger-ghost)',
          color: 'var(--hush-danger)',
          border: '1px solid transparent',
        }
      : active
        ? {
            background: 'var(--hush-amber)',
            color: 'var(--hush-black)',
          }
        : {
            background: 'var(--hush-surface)',
            color: 'var(--hush-text)',
            border: '1px solid transparent',
          }
    ),
  }),
  iconBtn: (active) => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '44px',
    height: '44px',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-md)',
    background: active ? 'var(--hush-amber)' : 'var(--hush-surface)',
    color: active ? 'var(--hush-black)' : 'var(--hush-text-secondary)',
    cursor: 'pointer',
  }),
  divider: {
    width: '1px',
    height: '28px',
    background: 'var(--hush-border)',
    margin: '0 4px',
  },
  qualityTag: {
    fontSize: '0.65rem',
    fontFamily: 'var(--font-mono)',
    fontWeight: 500,
    padding: '2px 7px',
    borderRadius: 0,
    background: 'var(--hush-amber-ghost)',
    color: 'var(--hush-amber)',
    letterSpacing: '0.02em',
  },
  /** Compound control: main action + device dropdown. Wrapper so both look like one button. */
  deviceGroup: (active) => ({
    display: 'inline-flex',
    alignItems: 'stretch',
    height: '44px',
    borderRadius: 'var(--radius-md)',
    background: active ? 'var(--hush-amber)' : 'var(--hush-surface)',
    color: active ? 'var(--hush-black)' : 'var(--hush-text-secondary)',
    border: '1px solid transparent',
    overflow: 'hidden',
  }),
  deviceGroupMain: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '44px',
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    padding: 0,
  },
  deviceGroupChevron: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    border: 'none',
    borderLeft: '1px solid rgba(0,0,0,0.12)',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    padding: 0,
  },
};

export default function Controls({
  isReady,
  isScreenSharing,
  isMicOn,
  isWebcamOn,
  quality,
  isMobile = false,
  mediaE2EEUnavailable = false,
  onScreenShare,
  onSwitchScreen,
  onMic,
  onWebcam,
  onMicDeviceSwitch,
  onWebcamDeviceSwitch,
  onLeave,
}) {
  const btnSize = isMobile ? '52px' : '44px';
  const mediaDisabled = mediaE2EEUnavailable;
  const mediaTitle = mediaE2EEUnavailable ? 'Media encryption unavailable' : undefined;

  return (
    <div style={styles.bar}>
      {/* Screen Share */}
      <button
        style={{
          ...styles.btn(isScreenSharing),
          height: btnSize,
          ...(mediaDisabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
        }}
        onClick={onScreenShare}
        disabled={!isReady || !IS_SCREEN_SHARE_SUPPORTED || mediaDisabled}
        title={
          mediaTitle ||
          (!IS_SCREEN_SHARE_SUPPORTED
            ? 'Screen sharing not supported on this device'
            : isScreenSharing
              ? 'Stop sharing'
              : 'Share screen')
        }
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        {!IS_SCREEN_SHARE_SUPPORTED
          ? 'Not Supported'
          : isScreenSharing ? 'Stop' : 'Share'}
        {isScreenSharing && (
          <span style={styles.qualityTag}>{QUALITY_PRESETS[quality]?.label || quality}</span>
        )}
      </button>

      {/* Switch Screen (only visible when sharing) */}
      {isScreenSharing && (
        <button
          style={{ ...styles.iconBtn(false), width: btnSize, height: btnSize }}
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

      {/* Microphone + device switch (always show chevron when device switch available) */}
      {onMicDeviceSwitch ? (
        <div
          style={{
            ...styles.deviceGroup(isMicOn),
            height: btnSize,
            ...(mediaDisabled ? { opacity: 0.6, pointerEvents: 'none' } : {}),
          }}
        >
          <button
            type="button"
            style={{ ...styles.deviceGroupMain, width: btnSize, height: btnSize }}
            onClick={onMic}
            disabled={!isReady || mediaDisabled}
            title={mediaTitle || (isMicOn ? 'Mute mic' : 'Unmute mic')}
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
          <button
            type="button"
            style={{ ...styles.deviceGroupChevron, height: btnSize }}
            onClick={(e) => {
              e.stopPropagation();
              onMicDeviceSwitch();
            }}
            disabled={mediaDisabled}
            title="Change microphone"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      ) : (
        <button
          style={{
            ...styles.iconBtn(isMicOn),
            width: btnSize,
            height: btnSize,
            ...(mediaDisabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
          }}
          onClick={onMic}
          disabled={!isReady || mediaDisabled}
          title={mediaTitle || (isMicOn ? 'Mute mic' : 'Unmute mic')}
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
      )}

      {/* Webcam + device switch (always show chevron when device switch available) */}
      {onWebcamDeviceSwitch ? (
        <div
          style={{
            ...styles.deviceGroup(isWebcamOn),
            height: btnSize,
            ...(mediaDisabled ? { opacity: 0.6, pointerEvents: 'none' } : {}),
          }}
        >
          <button
            type="button"
            style={{ ...styles.deviceGroupMain, width: btnSize, height: btnSize }}
            onClick={onWebcam}
            disabled={!isReady || mediaDisabled}
            title={mediaTitle || (isWebcamOn ? 'Turn off camera' : 'Turn on camera')}
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
          <button
            type="button"
            style={{ ...styles.deviceGroupChevron, height: btnSize }}
            onClick={(e) => {
              e.stopPropagation();
              onWebcamDeviceSwitch();
            }}
            disabled={mediaDisabled}
            title="Change webcam"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      ) : (
        <button
          style={{
            ...styles.iconBtn(isWebcamOn),
            width: btnSize,
            height: btnSize,
            ...(mediaDisabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
          }}
          onClick={onWebcam}
          disabled={!isReady || mediaDisabled}
          title={mediaTitle || (isWebcamOn ? 'Turn off camera' : 'Turn on camera')}
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
      )}

      <div style={styles.divider} />

      {/* Leave */}
      <button
        style={{ ...styles.btn(false, 'danger'), height: btnSize }}
        onClick={onLeave}
      >
        Leave
      </button>
    </div>
  );
}
