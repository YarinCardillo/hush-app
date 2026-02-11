import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { connectSocket, disconnectSocket, socketRequest } from '../lib/socket';
import { useMediasoup } from '../hooks/useMediasoup';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useDevices } from '../hooks/useDevices';
import { DEFAULT_QUALITY, MEDIA_SOURCES, isScreenShareSource } from '../utils/constants';
import { estimateUploadSpeed, getRecommendedQuality } from '../lib/bandwidthEstimator';
import { isE2ESupported, deriveKeyFromFragment } from '../lib/encryption';
import StreamView from '../components/StreamView';
import ScreenShareCard from '../components/ScreenShareCard';
import Controls from '../components/Controls';
import QualitySelector from '../components/QualitySelector';
import QualityPickerModal from '../components/QualityPickerModal';
import DevicePickerModal from '../components/DevicePickerModal';

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
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    padding: '4px 8px',
    borderRadius: 'var(--radius-sm)',
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
  sidebar: (isMobile) => ({
    ...(isMobile
      ? {
          position: 'fixed',
          top: '48px',
          right: 0,
          bottom: 0,
          width: '280px',
          zIndex: 50,
          boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
        }
      : {
          width: '260px',
          flexShrink: 0,
          borderLeft: '1px solid var(--hush-border)',
        }),
    background: 'var(--hush-surface)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
    padding: '16px',
  }),
  sidebarOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 49,
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

function getGridStyle(count, breakpoint) {
  if (count === 0) return {};
  if (breakpoint === 'mobile') {
    return { gridTemplateColumns: '1fr' };
  }
  if (count === 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
  if (count === 2) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
  if (count <= 4) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
  if (count <= 6) return { gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr' };
  return { gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(auto-fill, 1fr)' };
}

export default function Room() {
  const navigate = useNavigate();
  const { roomName } = useParams();
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const [connected, setConnected] = useState(false);
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isWebcamOn, setIsWebcamOn] = useState(false);
  const [showQualityPanel, setShowQualityPanel] = useState(false);
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  const [showMicPicker, setShowMicPicker] = useState(false);
  const [showWebcamPicker, setShowWebcamPicker] = useState(false);

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
    availableScreens,
    watchedScreens,
    addAvailableScreen,
    watchScreen,
    unwatchScreen,
    setE2EKey,
    isE2EActive,
  } = useMediasoup();

  const {
    audioDevices,
    videoDevices,
    selectedMicId,
    selectedWebcamId,
    selectMic,
    selectWebcam,
    hasSavedMic,
    hasSavedWebcam,
    requestPermission,
  } = useDevices();

  useEffect(() => {
    // Preserve E2E key fragment across auth redirects
    const hash = window.location.hash.slice(1);
    if (hash) {
      sessionStorage.setItem('hush_e2eFragment', hash);
    }

    const token = sessionStorage.getItem('hush_token');
    if (!token) {
      // Save room name so Home page can pre-fill it
      if (hash) {
        sessionStorage.setItem('hush_pendingRoom', decodeURIComponent(roomName));
      }
      navigate('/');
      return;
    }

    // Derive E2E key from URL hash fragment (async but fast)
    const fragment = hash || sessionStorage.getItem('hush_e2eFragment');
    const e2eReady = (async () => {
      if (fragment && isE2ESupported()) {
        try {
          const keyBytes = await deriveKeyFromFragment(
            fragment, decodeURIComponent(roomName)
          );
          setE2EKey(keyBytes);
        } catch (err) {
          console.warn('[e2e] Key derivation failed, continuing without E2E:', err);
        }
      }
    })();

    const socket = connectSocket(token);

    socket.on('connect', async () => {
      setConnected(true);
      console.log('[room] Connected');

      // Reset local media state (stale after reconnect)
      setIsScreenSharing(false);
      setIsMicOn(false);
      setIsWebcamOn(false);
      setShowQualityPicker(false);

      try {
        // Ensure E2E key is ready before initializing transports
        await e2eReady;
        await initDevice();

        const { peers: existingPeers } = await socketRequest('getPeers');
        setPeers(existingPeers);

        for (const peer of existingPeers) {
          for (const producer of peer.producers) {
            if (isScreenShareSource(producer.appData?.source)) {
              addAvailableScreen(producer.id, peer.id, producer.kind, producer.appData);
            } else {
              await consumeProducer(producer.id, peer.id);
            }
          }
        }
      } catch (err) {
        console.error('[room] Reconnection failed:', err);
        if (err.message === 'Room not found') {
          sessionStorage.removeItem('hush_token');
          navigate('/');
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
  }, [navigate, initDevice, setPeers, consumeProducer, addAvailableScreen, setE2EKey, roomName]);

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
      setShowQualityPicker(true);
    }
  };

  const handleQualityPick = async (qualityKey) => {
    setShowQualityPicker(false);
    setQuality(qualityKey);

    // Capture and produce in one shot — no delay for track to die
    const capture = await captureScreen();
    if (!capture) return;

    try {
      const result = await produceScreen(capture.stream, qualityKey);
      if (!result) return;

      setIsScreenSharing(true);
      result.stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setIsScreenSharing(false);
      });
    } catch (err) {
      console.error('[room] Screen share failed:', err);
      capture.stream.getTracks().forEach((t) => t.stop());
    }
  };

  const handleMic = async () => {
    if (isMicOn) {
      for (const [id, producer] of producers.entries()) {
        if (producer.appData?.source === MEDIA_SOURCES.MIC) {
          await stopProducer(id);
        }
      }
      setIsMicOn(false);
    } else if (!hasSavedMic) {
      // First time: request permission to get device labels, then show picker
      await requestPermission('audio');
      setShowMicPicker(true);
    } else {
      await startMic(selectedMicId);
      setIsMicOn(true);
    }
  };

  const handleMicDevicePick = async (deviceId) => {
    setShowMicPicker(false);
    selectMic(deviceId);
    await startMic(deviceId);
    setIsMicOn(true);
  };

  const handleWebcam = async () => {
    if (isWebcamOn) {
      for (const [id, producer] of producers.entries()) {
        if (producer.appData?.source === MEDIA_SOURCES.WEBCAM) {
          await stopProducer(id);
        }
      }
      setIsWebcamOn(false);
    } else if (!hasSavedWebcam) {
      await requestPermission('video');
      setShowWebcamPicker(true);
    } else {
      await startWebcam(selectedWebcamId);
      setIsWebcamOn(true);
    }
  };

  const handleWebcamDevicePick = async (deviceId) => {
    setShowWebcamPicker(false);
    selectWebcam(deviceId);
    await startWebcam(deviceId);
    setIsWebcamOn(true);
  };

  const handleMicDeviceSwitch = async () => {
    // Stop current mic, show picker, user picks new device → starts new mic
    if (isMicOn) {
      for (const [id, producer] of producers.entries()) {
        if (producer.appData?.source === MEDIA_SOURCES.MIC) {
          await stopProducer(id);
        }
      }
      setIsMicOn(false);
    }
    await requestPermission('audio');
    setShowMicPicker(true);
  };

  const handleWebcamDeviceSwitch = async () => {
    if (isWebcamOn) {
      for (const [id, producer] of producers.entries()) {
        if (producer.appData?.source === MEDIA_SOURCES.WEBCAM) {
          await stopProducer(id);
        }
      }
      setIsWebcamOn(false);
    }
    await requestPermission('video');
    setShowWebcamPicker(true);
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
    sessionStorage.removeItem('hush_e2eFragment');
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
        producerId: data.consumer.producerId,
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

  // Derive unwatched remote screen shares
  const unwatchedScreens = [];
  for (const [producerId, info] of availableScreens.entries()) {
    if (info.appData?.source === MEDIA_SOURCES.SCREEN && !watchedScreens.has(producerId)) {
      const peer = peers.find((p) => p.id === info.peerId);
      unwatchedScreens.push({
        producerId,
        peerId: info.peerId,
        peerName: peer?.displayName || 'Remote',
      });
    }
  }

  const totalCards = allStreams.length + unwatchedScreens.length;
  const gridStyle = getGridStyle(totalCards, breakpoint);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span
            style={{
              position: 'relative',
              fontFamily: 'var(--font-sans)',
              fontSize: '1.1rem',
              fontWeight: 200,
              color: 'var(--hush-text)',
              letterSpacing: '-0.03em',
              userSelect: 'none',
            }}
          >
            hush
            <span
              style={{
                position: 'absolute',
                top: '-1px',
                left: '53%',
                width: '5px',
                height: '5px',
                borderRadius: '50%',
                background: 'var(--hush-amber)',
              }}
            />
          </span>
          <span style={styles.roomTitle}>{decodeURIComponent(roomName)}</span>
          <span className="badge badge-live">
            <span className="live-dot" />
            Live
          </span>
          {isE2EActive && (
            <span className="badge badge-e2e">e2e</span>
          )}
        </div>
        <div style={styles.headerRight}>
          <button
            style={styles.participantCount}
            title="Room panel"
            onClick={() => setShowQualityPanel(!showQualityPanel)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {peers.length + 1}
          </button>
        </div>
      </div>

      <div style={styles.main}>
        <div style={{ ...styles.streamsArea, ...gridStyle }}>
          {totalCards === 0 ? (
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
            <>
              {allStreams.map((stream) => (
                <StreamView
                  key={stream.id}
                  track={stream.track}
                  audioTrack={stream.audioTrack}
                  label={stream.label}
                  source={stream.source}
                  isLocal={stream.type === 'local'}
                  onUnwatch={
                    stream.type === 'remote' && stream.source === MEDIA_SOURCES.SCREEN
                      ? () => unwatchScreen(stream.producerId)
                      : undefined
                  }
                />
              ))}
              {unwatchedScreens.map((screen) => (
                <ScreenShareCard
                  key={screen.producerId}
                  peerName={screen.peerName}
                  onWatch={() => watchScreen(screen.producerId)}
                />
              ))}
            </>
          )}
        </div>

        {showQualityPanel && (
          <>
            {isMobile && (
              <div
                style={styles.sidebarOverlay}
                onClick={() => setShowQualityPanel(false)}
              />
            )}
            <div style={styles.sidebar(isMobile)}>
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

              {isScreenSharing && (
                <div style={styles.sidebarSection}>
                  <div style={styles.sidebarLabel}>Stream Quality</div>
                  <QualitySelector
                    currentQuality={quality}
                    onSelect={handleQualityChange}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {orphanAudioConsumers.map((oa) => (
        <OrphanAudio key={oa.id} track={oa.track} />
      ))}

      {showQualityPicker && (
        <QualityPickerModal
          onSelect={handleQualityPick}
          onCancel={() => setShowQualityPicker(false)}
        />
      )}

      {showMicPicker && (
        <DevicePickerModal
          title="choose microphone"
          devices={audioDevices}
          selectedDeviceId={selectedMicId}
          onSelect={handleMicDevicePick}
          onCancel={() => setShowMicPicker(false)}
        />
      )}

      {showWebcamPicker && (
        <DevicePickerModal
          title="choose webcam"
          devices={videoDevices}
          selectedDeviceId={selectedWebcamId}
          onSelect={handleWebcamDevicePick}
          onCancel={() => setShowWebcamPicker(false)}
        />
      )}

      <Controls
        isReady={isReady}
        isScreenSharing={isScreenSharing}
        isMicOn={isMicOn}
        isWebcamOn={isWebcamOn}
        quality={quality}
        isMobile={isMobile}
        onScreenShare={handleScreenShare}
        onSwitchScreen={handleSwitchScreen}
        onMic={handleMic}
        onWebcam={handleWebcam}
        onMicDeviceSwitch={handleMicDeviceSwitch}
        onWebcamDeviceSwitch={handleWebcamDeviceSwitch}
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
