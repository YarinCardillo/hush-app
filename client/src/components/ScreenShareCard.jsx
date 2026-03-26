export default function ScreenShareCard({ peerName, isSelf = false, isLoading = false, onWatch }) {
  const title = isSelf ? "You're sharing" : peerName;
  const hint = isLoading ? 'loading stream...' : isSelf ? 'Tap to watch' : 'click to watch';

  return (
    <div
      className={`ssc-card${isLoading ? ' ssc-card--loading' : ''}`}
      onClick={onWatch}
    >
      {isLoading ? (
        <>
          <div className="ssc-spinner" />
          <div className="ssc-peer-name">{title}</div>
          <div className="ssc-hint">{hint}</div>
        </>
      ) : (
        <>
          <div className="ssc-icon">
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
          <div className="ssc-peer-name">{title}</div>
          <div className="ssc-hint">{hint}</div>
        </>
      )}
    </div>
  );
}
