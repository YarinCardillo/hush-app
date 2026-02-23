import clientPkg from '../../package.json';

export const API_URL = import.meta.env.VITE_API_URL || '';

/** App version shown in UI; single source of truth: client/package.json "version". */
export const APP_VERSION = clientPkg.version;

export const QUALITY_PRESETS = {
  source: {
    label: 'High',
    description: '1080p, 60fps',
    width: 1920,
    height: 1080,
    frameRate: 60,
    bitrate: 20_000_000, // 20 Mbps for 1080p60
  },
  lite: {
    label: 'Lite',
    description: '720p, 30fps',
    width: 1280,
    height: 720,
    frameRate: 30,
    bitrate: 2_500_000, // 2.5 Mbps
  },
};

/** Minimum frame rate to request for high-fps presets (High = 1080p60). We ask for 60; if the system can't hold it, applyConstraints may fail and we keep the capture's default (encoder degrades gracefully). */
export const SCREEN_SHARE_MIN_FPS = 60;

export const DEFAULT_QUALITY = 'source';

/** Webcam capture and encoding: 720p, 1.5 Mbps. Avoids low quality from previous 480p/500kbps. */
export const WEBCAM_PRESET = {
  width: 1280,
  height: 720,
  frameRate: 30,
  bitrate: 1_500_000, // 1.5 Mbps
};

export const MEDIA_SOURCES = {
  SCREEN: 'screen',
  WEBCAM: 'webcam',
  MIC: 'mic',
  SCREEN_AUDIO: 'screen-audio',
};

export function isScreenShareSource(source) {
  return source === MEDIA_SOURCES.SCREEN || source === MEDIA_SOURCES.SCREEN_AUDIO;
}

export const IS_SCREEN_SHARE_SUPPORTED =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getDisplayMedia;

/** Seconds without focus (viewport or tab) before putting a watched screen stream in stand-by. */
export const STANDBY_AFTER_MS = 5000;
