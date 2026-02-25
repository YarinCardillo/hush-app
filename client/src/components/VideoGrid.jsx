import { useEffect, useRef } from 'react';
import { Track } from 'livekit-client';
import StreamView from './StreamView';
import ScreenShareCard from './ScreenShareCard';
import { MEDIA_SOURCES, STANDBY_AFTER_MS, isScreenShareSource } from '../utils/constants';

const styles = {
  streamsArea: (isMobile, count) => ({
    flex: 1,
    display: 'grid',
    gap: '6px',
    padding: '6px',
    overflow: isMobile && count !== 2 ? 'auto' : 'hidden',
    alignItems: isMobile && count !== 2 ? 'start' : 'stretch',
    alignContent: isMobile && count !== 2 ? 'start' : undefined,
    justifyItems: 'stretch',
    minHeight: 0,
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
    border: '1px solid transparent',
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

function getColumnCount(count) {
  if (count <= 1) return 1;
  if (count <= 5) return 2;
  return 3;
}

function getGridStyle(count, breakpoint) {
  if (count === 0) return {};
  if (breakpoint === 'mobile') {
    if (count === 1) return { gridTemplateColumns: '1fr' };
    if (count === 2) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr 1fr' };
    return { gridTemplateColumns: '1fr 1fr' };
  }
  const cols = getColumnCount(count);
  const rows = Math.ceil(count / cols);
  if (cols === 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
  return {
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
  };
}

function pickHeroId(streams) {
  if (streams.length === 0) return null;
  const screenShares = streams.filter((s) => isScreenShareSource(s.source));
  if (screenShares.length === 1) return screenShares[0].id;
  const localWebcam = streams.find((s) => s.type === 'local' && !isScreenShareSource(s.source));
  if (localWebcam) return localWebcam.id;
  return streams[0].id;
}

function orderWithHeroLast(streams, heroId) {
  if (!heroId) return streams;
  const hero = streams.find((s) => s.id === heroId);
  if (!hero) return streams;
  return [...streams.filter((s) => s.id !== heroId), hero];
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
    return () => { audio.srcObject = null; };
  }, [track]);
  return <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />;
}

/**
 * Builds stream objects from local and remote track maps.
 * Returns { allStreams, orphanAudioConsumers, unwatchedScreens }.
 */
function buildStreams(localTracks, remoteTracks, availableScreens, watchedScreens, localScreenWatched) {
  const allStreams = [];
  const pairedAudioTracks = new Set();

  for (const [trackSid, info] of localTracks.entries()) {
    if (info.track.kind === 'video') {
      if (info.source === MEDIA_SOURCES.SCREEN && !localScreenWatched) continue;
      let audioTrack = null;
      if (info.source === MEDIA_SOURCES.SCREEN) {
        for (const [, localInfo] of localTracks.entries()) {
          if (localInfo.source === MEDIA_SOURCES.SCREEN_AUDIO) {
            audioTrack = localInfo.track.mediaStreamTrack;
            break;
          }
        }
      }
      allStreams.push({
        id: trackSid,
        type: 'local',
        track: info.track.mediaStreamTrack,
        audioTrack,
        label: info.source === MEDIA_SOURCES.SCREEN ? 'Your Screen' : 'Your Webcam',
        source: info.source,
      });
    }
  }

  for (const [trackSid, info] of remoteTracks.entries()) {
    if (info.kind === 'video') {
      const participantId = info.participant.identity;
      const videoSource = info.source;
      const pairedAudioSource =
        videoSource === Track.Source.ScreenShare ? Track.Source.ScreenShareAudio : Track.Source.Microphone;
      let audioTrack = null;
      for (const [audioSid, audioInfo] of remoteTracks.entries()) {
        if (
          audioInfo.kind === 'audio' &&
          audioInfo.source === pairedAudioSource &&
          audioInfo.participant.identity === participantId
        ) {
          audioTrack = audioInfo.track.mediaStreamTrack;
          pairedAudioTracks.add(audioSid);
          break;
        }
      }
      allStreams.push({
        id: trackSid,
        type: 'remote',
        track: info.track.mediaStreamTrack,
        audioTrack,
        label: info.participant.name || info.participant.identity,
        source: videoSource === Track.Source.ScreenShare ? MEDIA_SOURCES.SCREEN : MEDIA_SOURCES.WEBCAM,
      });
    }
  }

  const orphanAudioConsumers = [];
  for (const [trackSid, info] of remoteTracks.entries()) {
    if (info.kind === 'audio' && !pairedAudioTracks.has(trackSid)) {
      orphanAudioConsumers.push({ id: trackSid, track: info.track.mediaStreamTrack });
    }
  }

  const unwatchedScreens = [];
  for (const [trackSid, info] of availableScreens.entries()) {
    if (info.source === Track.Source.ScreenShare && !watchedScreens.has(trackSid)) {
      unwatchedScreens.push({
        producerId: trackSid,
        peerId: info.participantId,
        peerName: info.participantName,
      });
    }
  }

  return { allStreams, orphanAudioConsumers, unwatchedScreens };
}

/**
 * Video grid: renders StreamView tiles, ScreenShareCards, and orphan audio elements.
 * Extracted from VoiceChannel to keep components under 300 lines.
 */
export default function VideoGrid({
  localTracks,
  remoteTracks,
  availableScreens,
  watchedScreens,
  loadingScreens,
  isScreenSharing,
  localScreenWatched,
  isMobile,
  breakpoint,
  onWatchScreen,
  onUnwatchScreen,
  onWatchLocalScreen,
  onUnwatchLocalScreen,
}) {
  const { allStreams, orphanAudioConsumers, unwatchedScreens } = buildStreams(
    localTracks, remoteTracks, availableScreens, watchedScreens, localScreenWatched,
  );

  const localScreenCard = isScreenSharing && !localScreenWatched;
  const totalCards = allStreams.length + unwatchedScreens.length + (localScreenCard ? 1 : 0);
  const gridStyle = getGridStyle(totalCards, breakpoint);
  const heroId = pickHeroId(allStreams);
  const cols = isMobile ? 2 : getColumnCount(totalCards);
  const heroIsAlone = totalCards > 1 && totalCards % cols === 1;
  const orderedStreams = orderWithHeroLast(allStreams, heroId);

  const normalTileStyle =
    isMobile && totalCards !== 2 ? { aspectRatio: '1', width: '100%', minWidth: 0 } : { display: 'contents' };
  const heroAloneStyle = () => {
    if (isMobile) return { gridColumn: '1 / -1', aspectRatio: '1', width: '100%', minWidth: 0 };
    const widthPct = cols === 2 ? 'calc(50% - 3px)' : 'calc(33.33% - 4px)';
    return { gridColumn: '1 / -1', justifySelf: 'center', width: widthPct, display: 'block', minHeight: 0 };
  };
  const getTileStyle = (streamId) =>
    heroIsAlone && unwatchedScreens.length === 0 && streamId === heroId ? heroAloneStyle() : normalTileStyle;
  const getUnwatchedStyle = (index) =>
    heroIsAlone && index === unwatchedScreens.length - 1 ? heroAloneStyle() : normalTileStyle;
  const getLocalScreenCardStyle = () =>
    heroIsAlone && unwatchedScreens.length === 0 ? heroAloneStyle() : normalTileStyle;

  return (
    <>
      <div style={{ ...styles.streamsArea(isMobile, totalCards), ...gridStyle }}>
        {totalCards === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--hush-text-ghost)"
                strokeWidth="1.5"
              >
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div style={styles.emptyTitle}>no active streams</div>
            <div style={styles.emptyDescription}>click share to start streaming</div>
          </div>
        ) : (
          <>
            {orderedStreams.map((stream) => (
              <div key={stream.id} style={getTileStyle(stream.id)}>
                <StreamView
                  track={stream.track}
                  audioTrack={stream.audioTrack}
                  label={stream.label}
                  source={stream.source}
                  isLocal={stream.type === 'local'}
                  objectFit={isMobile ? 'cover' : 'contain'}
                  onUnwatch={
                    stream.type === 'remote' && stream.source === MEDIA_SOURCES.SCREEN
                      ? () => onUnwatchScreen(stream.id)
                      : stream.type === 'local' && stream.source === MEDIA_SOURCES.SCREEN
                        ? onUnwatchLocalScreen
                        : undefined
                  }
                  standByAfterMs={stream.source === MEDIA_SOURCES.SCREEN ? STANDBY_AFTER_MS : undefined}
                />
              </div>
            ))}
            {localScreenCard && (
              <div key="local-screen-card" style={getLocalScreenCardStyle()}>
                <ScreenShareCard isSelf onWatch={onWatchLocalScreen} />
              </div>
            )}
            {unwatchedScreens.map((screen, index) => (
              <div key={screen.producerId} style={getUnwatchedStyle(index)}>
                <ScreenShareCard
                  peerName={screen.peerName}
                  isLoading={loadingScreens.has(screen.producerId)}
                  onWatch={() => onWatchScreen(screen.producerId)}
                />
              </div>
            ))}
          </>
        )}
      </div>
      {orphanAudioConsumers.map((oa) => (
        <OrphanAudio key={oa.id} track={oa.track} />
      ))}
    </>
  );
}
