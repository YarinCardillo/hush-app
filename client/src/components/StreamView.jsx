import { useEffect, useRef, useState } from 'react';

const styles = {
  container: (isFullscreen) => ({
    position: 'relative',
    background: 'var(--hush-black)',
    borderRadius: isFullscreen ? 0 : 'var(--radius-md)',
    overflow: 'hidden',
    /* NO border — video containers are windows, not cards */
    aspectRatio: isFullscreen ? 'auto' : '16 / 9',
    width: '100%',
    maxWidth: '100%',
    maxHeight: isFullscreen ? '100%' : '75vh',
  }),
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
  },
  label: {
    position: 'absolute',
    bottom: '10px',
    left: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 12px',
    background: 'rgba(12, 12, 18, 0.7)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.75rem',
    color: 'var(--hush-text)',
    fontWeight: 500,
  },
  sourceIcon: {
    width: '12px',
    height: '12px',
    opacity: 0.7,
  },
  localBadge: {
    position: 'absolute',
    top: '10px',
    right: '10px',
    padding: '2px 8px',
    background: 'var(--hush-amber-glow)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.6rem',
    fontWeight: 600,
    color: 'var(--hush-amber)',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  unwatchBtn: (isVisible) => ({
    position: 'absolute',
    top: '10px',
    right: '10px',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(12, 12, 18, 0.7)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--hush-text)',
    cursor: 'pointer',
    transition: 'opacity var(--duration-fast) var(--ease-out)',
    zIndex: 2,
    opacity: isVisible ? 1 : 0,
    pointerEvents: isVisible ? 'auto' : 'none',
  }),
  fullscreenBtn: (isActive) => ({
    position: 'absolute',
    top: '10px',
    left: '10px',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(12, 12, 18, 0.7)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--hush-text)',
    cursor: 'pointer',
    transition: 'opacity var(--duration-fast) var(--ease-out)',
    zIndex: 2,
    opacity: isActive ? 1 : 0.4,
  }),
};

export default function StreamView({ track, audioTrack, label, source, isLocal, onUnwatch }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const containerRef = useRef(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!videoRef.current || !track) return;

    const video = videoRef.current;
    const stream = new MediaStream([track]);
    video.srcObject = stream;

    const tryPlay = async () => {
      try {
        await video.play();
      } catch {
        video.muted = true;
        try {
          await video.play();
        } catch (retryErr) {
          console.error('[StreamView] Playback failed:', retryErr);
        }
      }
    };

    tryPlay();

    return () => {
      video.srcObject = null;
    };
  }, [track]);

  useEffect(() => {
    console.log('[StreamView] Audio effect:', {
      hasAudioRef: !!audioRef.current,
      hasAudioTrack: !!audioTrack,
      audioTrackState: audioTrack?.readyState,
      audioTrackMuted: audioTrack?.muted,
      isLocal,
      label,
    });

    if (!audioRef.current || !audioTrack || isLocal) return;

    const audio = audioRef.current;
    audio.srcObject = new MediaStream([audioTrack]);
    console.log('[StreamView] Audio srcObject set for:', label);

    const tryPlay = async () => {
      try {
        await audio.play();
        console.log('[StreamView] Audio playing for:', label);
      } catch (err) {
        console.warn('[StreamView] Audio autoplay blocked:', err.name, '- waiting for user interaction');
        const resume = () => {
          audio.play()
            .then(() => console.log('[StreamView] Audio resumed after interaction'))
            .catch((e) => console.error('[StreamView] Audio resume failed:', e));
          document.removeEventListener('touchstart', resume);
          document.removeEventListener('click', resume);
        };
        document.addEventListener('touchstart', resume, { once: true });
        document.addEventListener('click', resume, { once: true });
      }
    };
    tryPlay();

    return () => {
      audio.srcObject = null;
    };
  }, [audioTrack, isLocal, label]);

  useEffect(() => {
    const handleChange = () => {
      const el = containerRef.current;
      setIsFullscreen(
        document.fullscreenElement === el ||
        document.webkitFullscreenElement === el
      );
    };

    document.addEventListener('fullscreenchange', handleChange);
    document.addEventListener('webkitfullscreenchange', handleChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleChange);
      document.removeEventListener('webkitfullscreenchange', handleChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;

    const isCurrentlyFull =
      document.fullscreenElement === el ||
      document.webkitFullscreenElement === el;

    if (isCurrentlyFull) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    } else if (el.requestFullscreen) {
      await el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    } else if (videoRef.current?.webkitEnterFullscreen) {
      videoRef.current.webkitEnterFullscreen();
    }
  };

  return (
    <div
      ref={containerRef}
      style={styles.container(isFullscreen)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        style={styles.video}
      />

      {/* Always render audio element so ref is available when useEffect runs */}
      {!isLocal && (
        <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />
      )}

      <button
        style={styles.fullscreenBtn(isHovered || isFullscreen)}
        onClick={toggleFullscreen}
        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      >
        {isFullscreen ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 14 10 14 10 20" />
            <polyline points="20 10 14 10 14 4" />
            <line x1="14" y1="10" x2="21" y2="3" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        )}
      </button>

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

      {!isLocal && onUnwatch && (
        <button
          style={styles.unwatchBtn(isHovered)}
          onClick={(e) => { e.stopPropagation(); onUnwatch(); }}
          title="Stop watching"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}
