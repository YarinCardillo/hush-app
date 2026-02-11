import { QUALITY_PRESETS } from '../utils/constants';

/**
 * Estimate upload bandwidth by downloading a small test payload.
 * Returns speed in Mbps.
 *
 * Uses the Navigation Timing API and a small fetch to the server
 * as a rough estimate. For more accuracy, we also check
 * RTCPeerConnection stats during active streams.
 */
export async function estimateUploadSpeed() {
  try {
    // Create a 500KB test payload
    const testSize = 500 * 1024; // 500 KB
    const testData = new Uint8Array(testSize);
    crypto.getRandomValues(testData);

    const blob = new Blob([testData]);

    const startTime = performance.now();

    // POST to server health endpoint (it will just discard it)
    await fetch('/api/health', {
      method: 'POST',
      body: blob,
      // Don't cache
      headers: { 'Cache-Control': 'no-cache' },
    });

    const endTime = performance.now();
    const durationSec = (endTime - startTime) / 1000;
    const speedMbps = (testSize * 8) / (durationSec * 1_000_000);

    console.log(`[bandwidth] Upload estimate: ${speedMbps.toFixed(1)} Mbps`);
    return speedMbps;
  } catch (err) {
    console.error('[bandwidth] Estimation failed:', err);
    return 5; // Default fallback: assume 5 Mbps
  }
}

/**
 * Get recommended quality preset based on estimated upload speed
 */
export function getRecommendedQuality(uploadMbps) {
  // Sort presets by bitrate descending
  const sorted = Object.entries(QUALITY_PRESETS)
    .sort(([, a], [, b]) => b.bitrate - a.bitrate);

  for (const [key, preset] of sorted) {
    if (uploadMbps >= preset.minUpload) {
      return { key, preset, uploadMbps };
    }
  }

  // Fallback to lowest
  return {
    key: '480p',
    preset: QUALITY_PRESETS['480p'],
    uploadMbps,
  };
}

/**
 * Get live bandwidth stats from an RTCPeerConnection
 * Call periodically during active streaming
 */
export async function getLiveStats(peerConnection) {
  if (!peerConnection) return null;

  try {
    const stats = await peerConnection.getStats();
    let totalBytesSent = 0;
    let totalBytesReceived = 0;
    let outboundVideo = null;

    stats.forEach((report) => {
      if (report.type === 'outbound-rtp' && report.kind === 'video') {
        outboundVideo = {
          bytesSent: report.bytesSent,
          framesSent: report.framesSent,
          framesPerSecond: report.framesPerSecond,
          qualityLimitationReason: report.qualityLimitationReason,
          timestamp: report.timestamp,
        };
        totalBytesSent += report.bytesSent;
      }
      if (report.type === 'inbound-rtp') {
        totalBytesReceived += report.bytesReceived;
      }
    });

    return { totalBytesSent, totalBytesReceived, outboundVideo };
  } catch {
    return null;
  }
}
