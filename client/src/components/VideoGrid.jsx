import { useEffect, useRef } from 'react';
import { Track } from 'livekit-client';
import StreamView from './StreamView';
import ScreenShareCard from './ScreenShareCard';
import { MEDIA_SOURCES, STANDBY_AFTER_MS, isScreenShareSource } from '../utils/constants';

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
        participantId: info.participant.identity,
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
/** Extracts initials from a display name — first letter of each word. */
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0][0].toUpperCase();
}

/** Mute icon SVG for overlay on muted participant tiles. */
function MuteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
      <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

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
  participants = [],
  currentUserId,
  currentDisplayName,
  activeSpeakerIds = [],
  isMicOn = true,
}) {
  const { allStreams, orphanAudioConsumers, unwatchedScreens } = buildStreams(
    localTracks, remoteTracks, availableScreens, watchedScreens, localScreenWatched,
  );

  const speakerSet = new Set(activeSpeakerIds);

  // Build set of participant identities that already have a video stream
  const identitiesWithVideo = new Set();
  for (const stream of allStreams) {
    if (stream.type === 'local') {
      identitiesWithVideo.add(currentUserId);
    } else {
      identitiesWithVideo.add(stream.participantId);
    }
  }

  // Participants without video get placeholder tiles
  const audioOnlyParticipants = participants.filter(
    (p) => !identitiesWithVideo.has(p.userId),
  );

  const localScreenCard = isScreenSharing && !localScreenWatched;
  const totalCards = allStreams.length + audioOnlyParticipants.length + unwatchedScreens.length + (localScreenCard ? 1 : 0);
  const gridStyle = getGridStyle(totalCards, breakpoint);
  const heroId = pickHeroId(allStreams);
  const cols = isMobile ? 2 : getColumnCount(totalCards);
  const heroIsAlone = totalCards > 1 && totalCards % cols === 1;
  const orderedStreams = orderWithHeroLast(allStreams, heroId);

  const streamsAreaStyle = {
    overflow: isMobile && totalCards !== 2 ? 'auto' : 'hidden',
    alignItems: isMobile && totalCards !== 2 ? 'start' : 'stretch',
    alignContent: isMobile && totalCards !== 2 ? 'start' : undefined,
    ...gridStyle,
  };

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
      <div className="vg-streams-area" style={streamsAreaStyle}>
        {totalCards === 0 ? (
          <div className="vg-empty" />
        ) : (
          <>
            {orderedStreams.map((stream) => {
              const pid = stream.type === 'local' ? currentUserId : stream.participantId;
              const isSpeaking = (stream.type === 'local' && !isMicOn) ? false : speakerSet.has(pid);
              return (
                <div key={stream.id} style={getTileStyle(stream.id)} className={isSpeaking ? 'vg-tile-speaking' : undefined}>
                  <StreamView
                    track={stream.track}
                    audioTrack={stream.audioTrack}
                    label={stream.label}
                    source={stream.source}
                    isLocal={stream.type === 'local'}
                    objectFit={isMobile ? 'cover' : 'contain'}
                    isSpeaking={isSpeaking}
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
              );
            })}
            {audioOnlyParticipants.map((p) => {
              const isSelf = p.userId === currentUserId;
              const name = isSelf ? 'You' : (p.displayName || 'Anonymous');
              const isMuted = isSelf ? !isMicOn : false;
              const isSpeaking = isMuted ? false : speakerSet.has(p.userId);
              const tileClass = `vg-placeholder-tile${isSpeaking ? ' vg-speaking' : ''}`;
              return (
                <div key={`placeholder-${p.userId}`} style={normalTileStyle}>
                  <div className={tileClass}>
                    <div className="vg-placeholder-avatar">{getInitials(name)}</div>
                    <span className="vg-placeholder-name">{name}</span>
                    {isMuted && (
                      <div className="vg-mute-overlay"><MuteIcon /></div>
                    )}
                  </div>
                </div>
              );
            })}
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
