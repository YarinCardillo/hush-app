export const API_URL = import.meta.env.VITE_API_URL || '';

export const QUALITY_PRESETS = {
  '4K': {
    label: '4K (2160p)',
    width: 3840,
    height: 2160,
    frameRate: 30,
    bitrate: 15_000_000, // 15 Mbps
    minUpload: 18, // Mbps recommended upload
  },
  '1440p': {
    label: '1440p (2K)',
    width: 2560,
    height: 1440,
    frameRate: 30,
    bitrate: 8_000_000,
    minUpload: 10,
  },
  '1080p': {
    label: '1080p (Full HD)',
    width: 1920,
    height: 1080,
    frameRate: 30,
    bitrate: 4_500_000,
    minUpload: 6,
  },
  '1080p60': {
    label: '1080p 60fps',
    width: 1920,
    height: 1080,
    frameRate: 60,
    bitrate: 6_000_000,
    minUpload: 8,
  },
  '720p': {
    label: '720p (HD)',
    width: 1280,
    height: 720,
    frameRate: 30,
    bitrate: 2_500_000,
    minUpload: 3,
  },
  '480p': {
    label: '480p (SD)',
    width: 854,
    height: 480,
    frameRate: 30,
    bitrate: 1_000_000,
    minUpload: 1.5,
  },
};

export const DEFAULT_QUALITY = '1080p';

export const MEDIA_SOURCES = {
  SCREEN: 'screen',
  WEBCAM: 'webcam',
  MIC: 'mic',
  SCREEN_AUDIO: 'screen-audio',
};
