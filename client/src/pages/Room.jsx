import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { connectSocket, disconnectSocket, socketRequest } from '../lib/socket';
import { useMediasoup } from '../hooks/useMediasoup';
import { QUALITY_PRESETS, DEFAULT_QUALITY, MEDIA_SOURCES } from '../utils/constants';
import { estimateUploadSpeed, getRecommendedQuality } from '../lib/bandwidthEstimator';
import StreamView from '../components/StreamView';
import Controls from '../components/Controls';
import QualitySelector from '../components/QualitySelector';
import QualityPickerModal from '../components/QualityPickerModal';

const styles = {
  page: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    height: '48px',
    background: 'var(--hush-surface)',
    borderBottom: '1px solid var(--hush-border)',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  roomTitle: {
    fontSize: '0.95rem',
    fontWeight: 600,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  participantCount: {
    fontSize: '0.8rem',
    color: 'var(--hush-text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  main: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  streamsArea: {
    flex: 1,
    display: 'grid',
    gap: '6px',
    padding: '6px',
    overflow: 'auto',
    alignContent: 'center',
    justifyItems: 'center',
  },
  sidebar: {
    width: '260px',
    background: 'var(--hush-surface)',
    borderLeft: '1px solid var(--hush-border)',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    overflow: 'auto',
    padding: '16px',
  },
  sidebarSection: {
    marginBottom: '20px',
  },
  sidebarLabel: {
    fontSize: '0.7rem',
    fontWeight: 600,
    color: 'var(--hush-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '8px',
  },
  peerItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 0',
    fontSize: '0.85rem',
  },
  peerDot: (isStreaming) => ({
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: isStreaming ? 'var(--hush-live)' : 'var(--hush-text-muted)',
    boxShadow: isStreaming ? '0 0 6px var(--hush-live-glow)' : 'none',
  }),
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: 'var(--hush-text-muted)',
    gap: '16px',
    textAlign: 'center',
    padding: '40px',
  },
  emptyIcon: {
    width: '56px',
    height: '56px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-lg)',
    background: 'var(--hush-surface)',
    border: '1px solid var(--hush-border)',
  },
  emptyTitle: {
    fontSize: '1rem',
    fontWeight: 500,
    color: 'var(--hush-text-secondary)',
  },
  emptyDescription: {
    fontSize: '0.85rem',
    color: 'var(--hush-text-muted)',
    maxWidth: '280px',
  },
};

function getGridStyle(count) {
  if (count === 0) return {};
  if (count === 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
  if (count === 2) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
  if (count <= 4) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
  if (count <= 6) return { gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr' };
  return { gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(auto-fill, 1fr)' };
}

export default function Room() {
  const navigate = useNavigate();
  const { roomName } = useParams();
  const [connected, setConnected] = useState(false);
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isWebcamOn, setIsWebcamOn] = useState(false);
  const [showQualityPanel, setShowQualityPanel] = useState(false);
  const [pendingCapture, setPendingCapture] = useState(null);

  const {
    isReady,
    error,
    producers,
    consumers,
    peers,
    initDevice,
    captureScreen,
    produceScreen,
    switchScreenSource,
    changeQuality,
    startWebcam,
    startMic,
    stopProducer,
    consumeProducer,
    setPeers,
  } = useMediasoup();

  useEffect(() => {
    const token = sessionStorage.getItem('hush_token');
    if (!token) {
      navigate('/');
      return;
    }

    const socket = connectSocket(token);

    socket.on('connect', async () => {
      setConnected(true);
      console.log('[room] Connected');

      await initDevice();

      const { peers: existingPeers } = await socketRequest('getPeers');
      setPeers(existingPeers);

      for (const peer of existingPeers) {
        for (const producer of peer.producers) {
          await consumeProducer(producer.id, peer.id);
        }
      }
    });

    socket.on('disconnect', () => {
      setConnected(false);
      console.log('[room] Disconnected');
    });

    estimateUploadSpeed().then((speed) => {
      const rec = getRecommendedQuality(speed);
      setQuality(rec.key);
    });

    return () => {
      disconnectSocket();
    };
  }, [navigate, initDevice, setPeers, consumeProducer]);

  const handleScreenShare = async () => {
    if (isScreenSharing) {
      for (const [id, producer] of producers.entries()) {
        if (
          producer.appData?.source === MEDIA_SOURCES.SCREEN ||
          producer.appData?.source === MEDIA_SOURCES.SCREEN_AUDIO
        ) {
          await stopProducer(id);
        }
      }
      setIsScreenSharing(false);
    } else {
      const capture = await captureScreen();
      if (!capture) return;

      const result = await produceScreen(capture.stream, quality);
      if (!result) return;

      setIsScreenSharing(true);
      result.stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setIsScreenSharing(false);
      });

      setPendingCapture(capture);
    }
  };

  const handleQualityPick = async (qualityKey) => {
    setPendingCapture(null);
    if (qualityKey !== quality) {
      setQuality(qualityKey);
      await changeQuality(qualityKey);
    }
  };

  const handleCaptureCancelled = () => {
    setPendingCapture(null);
  };

  const handleMic = async () => {
    if (isMicOn) {
      for (const [id, producer] of producers.entries()) {
        if (producer.appData?.source === MEDIA_SOURCES.MIC) {
          await stopProducer(id);
        }
      }
      setIsMicOn(false);
    } else {
      await startMic();
      setIsMicOn(true);
    }
  };

  const handleWebcam = async () => {
    if (isWebcamOn) {
      for (const [id, producer] of producers.entries()) {
        if (producer.appData?.source === MEDIA_SOURCES.WEBCAM) {
          await stopProducer(id);
        }
      }
      setIsWebcamOn(false);
    } else {
      await startWebcam();
      setIsWebcamOn(true);
    }
  };

  const handleSwitchScreen = async () => {
    try {
      await switchScreenSource(quality);
    } catch (err) {
      console.error('Switch failed:', err);
    }
  };

  const handleQualityChange = async (newQuality) => {
    setQuality(newQuality);
    if (isScreenSharing) {
      await changeQuality(newQuality);
    }
    setShowQualityPanel(false);
  };

  const handleLeave = () => {
    disconnectSocket();
    sessionStorage.removeItem('hush_token');
    sessionStorage.removeItem('hush_peerId');
    sessionStorage.removeItem('hush_roomName');
    navigate('/');
  };

  const allStreams = [];
  const pairedAudioTracks = new Set();

  for (const [id, producer] of producers.entries()) {
    if (producer.kind === 'video') {
      let audioTrack = null;

      if (producer.appData?.source === MEDIA_SOURCES.SCREEN) {
        for (const [, p] of producers.entries()) {
          if (p.appData?.source === MEDIA_SOURCES.SCREEN_AUDIO && p.track) {
            audioTrack = p.track;
            break;
          }
        }
      }

      allStreams.push({
        id,
        type: 'local',
        track: producer.track,
        audioTrack,
        label: producer.appData?.source === MEDIA_SOURCES.SCREEN ? 'Your Screen' : 'Your Webcam',
        source: producer.appData?.source,
      });
    }
  }

  for (const [id, data] of consumers.entries()) {
    if (data.consumer.kind === 'video') {
      const videoPeerId = data.peerId;
      const videoSource = data.appData?.source;

      const pairedAudioSource = videoSource === MEDIA_SOURCES.SCREEN
        ? MEDIA_SOURCES.SCREEN_AUDIO
        : MEDIA_SOURCES.MIC;

      let audioTrack = null;
      for (const [audioId, audioData] of consumers.entries()) {
        if (
          audioData.consumer.kind === 'audio' &&
          audioData.appData?.source === pairedAudioSource &&
          audioData.peerId === videoPeerId
        ) {
          audioTrack = audioData.consumer.track;
          pairedAudioTracks.add(audioId);
          break;
        }
      }

      const peer = peers.find((p) =>
        p.producers?.some((pr) => pr.id === data.consumer.producerId)
      );

      allStreams.push({
        id,
        type: 'remote',
        track: data.consumer.track,
        audioTrack,
        label: peer?.displayName || 'Remote',
        source: data.appData?.source || 'unknown',
      });
    }
  }

  const orphanAudioConsumers = [];
  for (const [id, data] of consumers.entries()) {
    if (data.consumer.kind === 'audio' && !pairedAudioTracks.has(id)) {
      orphanAudioConsumers.push({ id, track: data.consumer.track });
    }
  }

  const streamCount = allStreams.length;
  const gridStyle = getGridStyle(streamCount);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '1.1rem',
              fontWeight: 300,
              color: 'var(--hush-amber)',
              letterSpacing: '-0.03em',
              userSelect: 'none',
            }}
          >
            h
          </span>
          <span style={styles.roomTitle}>{decodeURIComponent(roomName)}</span>
          <span className="badge badge-live">
            <span className="live-dot" />
            Live
          </span>
        </div>
        <div style={styles.headerRight}>
          <div style={styles.participantCount}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {peers.length + 1}
          </div>
          <button
            className="btn btn-icon"
            title="Quality settings"
            onClick={() => setShowQualityPanel(!showQualityPanel)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      <div style={styles.main}>
        <div style={{ ...styles.streamsArea, ...gridStyle }}>
          {streamCount === 0 ? (
            <div style={styles.empty}>
              <div style={styles.emptyIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--hush-text-ghost)" strokeWidth="1.5">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <div style={styles.emptyTitle}>no active streams</div>
              <div style={styles.emptyDescription}>
                click share to start streaming
              </div>
            </div>
          ) : (
            allStreams.map((stream) => (
              <StreamView
                key={stream.id}
                track={stream.track}
                audioTrack={stream.audioTrack}
                label={stream.label}
                source={stream.source}
                isLocal={stream.type === 'local'}
              />
            ))
          )}
        </div>

        {showQualityPanel && (
          <div style={styles.sidebar}>
            <div style={styles.sidebarSection}>
              <div style={styles.sidebarLabel}>Stream Quality</div>
              <QualitySelector
                currentQuality={quality}
                onSelect={handleQualityChange}
              />
            </div>

            <div style={styles.sidebarSection}>
              <div style={styles.sidebarLabel}>Participants ({peers.length + 1})</div>
              <div style={styles.peerItem}>
                <div style={styles.peerDot(isScreenSharing)} />
                <span>You</span>
              </div>
              {peers.map((peer) => (
                <div key={peer.id} style={styles.peerItem}>
                  <div style={styles.peerDot(peer.producers?.length > 0)} />
                  <span>{peer.displayName}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {orphanAudioConsumers.map((oa) => (
        <OrphanAudio key={oa.id} track={oa.track} />
      ))}

      {pendingCapture && (
        <QualityPickerModal
          nativeWidth={pendingCapture.nativeWidth}
          nativeHeight={pendingCapture.nativeHeight}
          onSelect={handleQualityPick}
          onCancel={handleCaptureCancelled}
        />
      )}

      <Controls
        isReady={isReady}
        isScreenSharing={isScreenSharing}
        isMicOn={isMicOn}
        isWebcamOn={isWebcamOn}
        quality={quality}
        onScreenShare={handleScreenShare}
        onSwitchScreen={handleSwitchScreen}
        onMic={handleMic}
        onWebcam={handleWebcam}
        onLeave={handleLeave}
      />
    </div>
  );
}

function OrphanAudio({ track }) {
  const audioRef = useRef(null);

  useEffect(() => {
    if (!audioRef.current || !track) return;
    const audio = audioRef.current;
    audio.srcObject = new MediaStream([track]);

    const tryPlay = async () => {
      try {
        await audio.play();
      } catch {
        const resume = () => {
          audio.play().catch(() => {});
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
  }, [track]);

  return <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />;
}
