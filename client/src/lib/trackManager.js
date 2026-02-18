/**
 * Local and remote track publishing, subscription, quality, and click-to-watch.
 * Used by useRoom; receives room and refs to avoid holding React state.
 */

import { RoomEvent, Track, LocalVideoTrack, LocalAudioTrack } from 'livekit-client';
import { QUALITY_PRESETS, DEFAULT_QUALITY, MEDIA_SOURCES } from '../utils/constants';

/**
 * Registers room event listeners for remote track and screen share updates.
 * @param {import('livekit-client').Room} room
 * @param {{ remoteTracksRef: import('react').MutableRefObject<Map>, availableScreensRef: import('react').MutableRefObject<Map>, watchedScreensRef: import('react').MutableRefObject<Set> }} refs
 * @param {() => void} scheduleRemoteTracksUpdate
 * @param {() => void} scheduleScreensUpdate
 */
export function attachRemoteTrackListeners(room, refs, scheduleRemoteTracksUpdate, scheduleScreensUpdate) {
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    refs.remoteTracksRef.current.set(track.sid, {
      track,
      participant,
      kind: track.kind,
      source: publication.source,
    });
    scheduleRemoteTracksUpdate();
  });

  room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
    refs.remoteTracksRef.current.delete(track.sid);
    scheduleRemoteTracksUpdate();
  });

  room.on(RoomEvent.TrackPublished, (publication, participant) => {
    if (
      publication.source === Track.Source.ScreenShare &&
      publication.kind === Track.Kind.Video
    ) {
      refs.availableScreensRef.current.set(publication.trackSid, {
        trackSid: publication.trackSid,
        participantId: participant.identity,
        participantName: participant.name || participant.identity,
        kind: publication.kind,
        source: publication.source,
        publication,
      });
      scheduleScreensUpdate();
    }
    if (publication.kind === Track.Kind.Audio) {
      publication.setSubscribed(true);
    }
  });

  room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
    if (publication.source === Track.Source.ScreenShare) {
      refs.availableScreensRef.current.delete(publication.trackSid);
      refs.watchedScreensRef.current.delete(publication.trackSid);
      scheduleScreensUpdate();
    }
    refs.remoteTracksRef.current.delete(publication.trackSid);
    scheduleRemoteTracksUpdate();
  });
}

/**
 * @param {import('livekit-client').Room} room
 * @param {{ localTracksRef: import('react').MutableRefObject<Map> }} refs
 * @param {{ qualityKey?: string, onTrackEnded?: () => void }} options
 */
export async function publishScreen(room, refs, options = {}) {
  const qualityKey = options.qualityKey ?? DEFAULT_QUALITY;
  const quality = QUALITY_PRESETS[qualityKey];
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { cursor: 'always', frameRate: { ideal: quality.frameRate } },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const videoTrack = stream.getVideoTracks()[0];
  const audioTrack = stream.getAudioTracks()[0];
  if (!videoTrack || videoTrack.readyState !== 'live') {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }
  if (quality.width && quality.height) {
    try {
      await videoTrack.applyConstraints({
        width: { ideal: quality.width },
        height: { ideal: quality.height },
        frameRate: { ideal: quality.frameRate },
      });
    } catch (err) {
      console.warn('[livekit] Could not apply track constraints:', err);
    }
  }
  const localVideoTrack = new LocalVideoTrack(videoTrack);
  await room.localParticipant.publishTrack(localVideoTrack, {
    source: Track.Source.ScreenShare,
    videoEncoding: { maxBitrate: quality.bitrate },
  });
  refs.localTracksRef.current.set(localVideoTrack.sid, {
    track: localVideoTrack,
    source: MEDIA_SOURCES.SCREEN,
  });
  if (options.onTrackEnded) {
    videoTrack.addEventListener('ended', options.onTrackEnded);
  }
  if (audioTrack && audioTrack.readyState === 'live') {
    try {
      const localAudioTrack = new LocalAudioTrack(audioTrack);
      await room.localParticipant.publishTrack(localAudioTrack, {
        source: Track.Source.ScreenShareAudio,
      });
      refs.localTracksRef.current.set(localAudioTrack.sid, {
        track: localAudioTrack,
        source: MEDIA_SOURCES.SCREEN_AUDIO,
      });
    } catch (audioErr) {
      console.warn('[livekit] Screen audio publish failed (non-fatal):', audioErr?.message);
    }
  }
  return stream;
}

/**
 * @param {import('livekit-client').Room} room
 * @param {{ localTracksRef: import('react').MutableRefObject<Map> }} refs
 */
export async function unpublishScreen(room, refs) {
  for (const [trackSid, info] of refs.localTracksRef.current.entries()) {
    if (info.source === MEDIA_SOURCES.SCREEN || info.source === MEDIA_SOURCES.SCREEN_AUDIO) {
      info.track.stop();
      await room.localParticipant.unpublishTrack(info.track);
      refs.localTracksRef.current.delete(trackSid);
    }
  }
}

/**
 * @param {import('livekit-client').Room} room
 * @param {{ localTracksRef: import('react').MutableRefObject<Map> }} refs
 * @param {string} qualityKey
 * @param {() => Promise<void>} unpublishScreenCb
 */
export async function switchScreenSource(room, refs, qualityKey, unpublishScreenCb) {
  const quality = QUALITY_PRESETS[qualityKey];
  const screenEntry = Array.from(refs.localTracksRef.current.entries()).find(
    ([, info]) => info.source === MEDIA_SOURCES.SCREEN,
  );
  if (!screenEntry) throw new Error('No active screen share');
  const [, info] = screenEntry;
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { cursor: 'always', frameRate: { ideal: quality.frameRate } },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const newTrack = stream.getVideoTracks()[0];
  if (quality.width && quality.height) {
    try {
      await newTrack.applyConstraints({
        width: { ideal: quality.width },
        height: { ideal: quality.height },
        frameRate: { ideal: quality.frameRate },
      });
    } catch (err) {
      console.warn('[livekit] Could not apply track constraints:', err);
    }
  }
  await info.track.replaceTrack(newTrack);
  if (unpublishScreenCb) {
    newTrack.addEventListener('ended', unpublishScreenCb);
  }
  return stream;
}

/**
 * @param {import('livekit-client').Room} room
 * @param {{ localTracksRef: import('react').MutableRefObject<Map> }} refs
 * @param {string} qualityKey
 */
export async function changeQuality(room, refs, qualityKey) {
  const quality = QUALITY_PRESETS[qualityKey];
  if (!quality) return;
  const screenEntry = Array.from(refs.localTracksRef.current.entries()).find(
    ([, info]) => info.source === MEDIA_SOURCES.SCREEN,
  );
  if (!screenEntry) return;
  const [, info] = screenEntry;
  const track = info.track.mediaStreamTrack;
  if (track && track.readyState === 'live') {
    if (quality.width && quality.height) {
      await track.applyConstraints({
        width: { ideal: quality.width },
        height: { ideal: quality.height },
        frameRate: { ideal: quality.frameRate },
      });
    } else {
      await track.applyConstraints({ frameRate: { ideal: quality.frameRate } });
    }
  }
}

/**
 * @param {import('livekit-client').Room} room
 * @param {{ localTracksRef: import('react').MutableRefObject<Map> }} refs
 * @param {string|null} deviceId
 */
export async function publishWebcam(room, refs, deviceId = null) {
  const videoConstraints = { width: 640, height: 480, frameRate: 30 };
  if (deviceId) videoConstraints.deviceId = { exact: deviceId };
  const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
  const videoTrack = stream.getVideoTracks()[0];
  const localVideoTrack = new LocalVideoTrack(videoTrack);
  await room.localParticipant.publishTrack(localVideoTrack, {
    source: Track.Source.Camera,
    videoEncoding: { maxBitrate: 500000 },
  });
  refs.localTracksRef.current.set(localVideoTrack.sid, {
    track: localVideoTrack,
    source: MEDIA_SOURCES.WEBCAM,
  });
}

/**
 * @param {import('livekit-client').Room} room
 * @param {{ localTracksRef: import('react').MutableRefObject<Map> }} refs
 */
export async function unpublishWebcam(room, refs) {
  for (const [trackSid, info] of refs.localTracksRef.current.entries()) {
    if (info.source === MEDIA_SOURCES.WEBCAM) {
      info.track.stop();
      await room.localParticipant.unpublishTrack(info.track);
      refs.localTracksRef.current.delete(trackSid);
    }
  }
}

/**
 * @param {import('livekit-client').Room} room
 * @param {{ localTracksRef: import('react').MutableRefObject<Map>, audioContextRef: import('react').MutableRefObject<AudioContext|null>, noiseGateNodeRef: import('react').MutableRefObject<AudioWorkletNode|null>, rawMicStreamRef: import('react').MutableRefObject<MediaStream|null>, cleanupMicPipeline: () => void }} refs
 * @param {string|null} deviceId
 */
export async function publishMic(room, refs, deviceId = null) {
  const audioConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) audioConstraints.deviceId = { exact: deviceId };
  const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
  refs.rawMicStreamRef.current = stream;
  const audioContext = new AudioContext();
  refs.audioContextRef.current = audioContext;
  const source = audioContext.createMediaStreamSource(stream);
  const hasWorklet = typeof audioContext.audioWorklet !== 'undefined';
  let destination;
  if (hasWorklet) {
    try {
      await audioContext.audioWorklet.addModule(
        new URL('./noiseGateWorklet.js', import.meta.url),
      );
      const workletNode = new AudioWorkletNode(audioContext, 'noise-gate-processor');
      refs.noiseGateNodeRef.current = workletNode;
      destination = audioContext.createMediaStreamDestination();
      source.connect(workletNode);
      workletNode.connect(destination);
      workletNode.port.postMessage({ type: 'updateParams', enabled: true, threshold: -50 });
    } catch (err) {
      console.warn('[livekit] AudioWorklet failed, publishing raw audio:', err);
      destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
    }
  } else {
    destination = audioContext.createMediaStreamDestination();
    source.connect(destination);
  }
  const processedTrack = destination.stream.getAudioTracks()[0];
  const localAudioTrack = new LocalAudioTrack(processedTrack);
  await room.localParticipant.publishTrack(localAudioTrack, {
    source: Track.Source.Microphone,
  });
  refs.localTracksRef.current.set(localAudioTrack.sid, {
    track: localAudioTrack,
    source: MEDIA_SOURCES.MIC,
  });
}

/**
 * @param {import('livekit-client').Room} room
 * @param {{ localTracksRef: import('react').MutableRefObject<Map>, rawMicStreamRef: import('react').MutableRefObject<MediaStream|null>, cleanupMicPipeline: () => void }} refs
 */
export async function unpublishMic(room, refs) {
  for (const [trackSid, info] of refs.localTracksRef.current.entries()) {
    if (info.source === MEDIA_SOURCES.MIC) {
      info.track.stop();
      await room.localParticipant.unpublishTrack(info.track);
      refs.localTracksRef.current.delete(trackSid);
    }
  }
  refs.cleanupMicPipeline();
}

/**
 * @param {import('livekit-client').Room} room
 * @param {{ availableScreensRef: import('react').MutableRefObject<Map>, watchedScreensRef: import('react').MutableRefObject<Set>, loadingScreensRef: import('react').MutableRefObject<Set> }} refs
 * @param {string} trackSid
 * @param {() => void} scheduleScreensUpdate
 */
export async function watchScreen(room, refs, trackSid, scheduleScreensUpdate) {
  const screenInfo = refs.availableScreensRef.current.get(trackSid);
  if (!screenInfo) return;
  refs.loadingScreensRef.current.add(trackSid);
  scheduleScreensUpdate?.();
  try {
    await screenInfo.publication.setSubscribed(true);
    const participant = Array.from(room.remoteParticipants.values()).find(
      (p) => p.identity === screenInfo.participantId,
    );
    if (participant) {
      for (const [, pub] of participant.audioTrackPublications) {
        if (pub.source === Track.Source.ScreenShareAudio) {
          await pub.setSubscribed(true);
          break;
        }
      }
    }
    refs.watchedScreensRef.current.add(trackSid);
  } finally {
    refs.loadingScreensRef.current.delete(trackSid);
    scheduleScreensUpdate?.();
  }
}

/**
 * @param {import('livekit-client').Room} room
 * @param {{ availableScreensRef: import('react').MutableRefObject<Map>, watchedScreensRef: import('react').MutableRefObject<Set> }} refs
 * @param {string} trackSid
 * @param {() => void} [scheduleScreensUpdate]
 */
export async function unwatchScreen(room, refs, trackSid, scheduleScreensUpdate) {
  const screenInfo = refs.availableScreensRef.current.get(trackSid);
  if (!screenInfo) return;
  await screenInfo.publication.setSubscribed(false);
  const participant = Array.from(room.remoteParticipants.values()).find(
    (p) => p.identity === screenInfo.participantId,
  );
  if (participant) {
    for (const [, pub] of participant.audioTrackPublications) {
      if (pub.source === Track.Source.ScreenShareAudio) {
        await pub.setSubscribed(false);
        break;
      }
    }
  }
  refs.watchedScreensRef.current.delete(trackSid);
  scheduleScreensUpdate?.();
}
