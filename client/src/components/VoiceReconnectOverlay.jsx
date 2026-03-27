/**
 * VoiceReconnectOverlay
 *
 * Renders an absolute-positioned overlay within the voice channel container:
 * - While reconnecting: pulsing "Reconnecting to voice..." message.
 * - After 3 failed attempts: "Voice connection lost." with a Rejoin button.
 *
 * @param {{ isReconnecting: boolean, hasFailed: boolean, onRejoin: () => void }} props
 */
export default function VoiceReconnectOverlay({ isReconnecting, hasFailed, onRejoin }) {
  if (!isReconnecting && !hasFailed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(4px)',
        zIndex: 10,
        gap: '16px',
      }}
    >
      {isReconnecting && !hasFailed && (
        <>
          <span
            className="vc-reconnect-pulse"
            style={{
              display: 'inline-block',
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: 'var(--hush-accent, #7c6af7)',
              animation: 'pulse 1.2s ease-in-out infinite',
            }}
            aria-hidden="true"
          />
          <p style={{ color: 'var(--hush-text)', fontSize: '0.95rem', margin: 0 }}>
            Reconnecting to voice...
          </p>
        </>
      )}

      {hasFailed && (
        <>
          <p style={{ color: 'var(--hush-text)', fontSize: '0.95rem', margin: 0 }}>
            Voice connection lost.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRejoin}
            style={{ padding: '8px 20px' }}
          >
            Rejoin
          </button>
        </>
      )}
    </div>
  );
}
