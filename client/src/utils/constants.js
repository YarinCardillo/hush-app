export const API_URL = import.meta.env.VITE_API_URL || '';

export const APP_VERSION = '0.5.0';

export const QUALITY_PRESETS = {
  source: {
    label: 'Source',
    description: 'native resolution, 60fps',
    width: null,
    height: null,
    frameRate: 60,
    bitrate: 12_000_000, // 12 Mbps
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

export const DEFAULT_QUALITY = 'source';

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
