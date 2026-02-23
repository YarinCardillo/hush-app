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
    // crypto.getRandomValues() has a 65536-byte limit per call
    const testSize = 500 * 1024; // 500 KB
    const testData = new Uint8Array(testSize);
    const chunkSize = 65536;
    for (let offset = 0; offset < testSize; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, testSize);
      crypto.getRandomValues(testData.subarray(offset, end));
    }

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
 * Get recommended quality preset based on estimated upload speed.
 * With two presets (source: 20 Mbps, lite: 2.5 Mbps), picks the
 * highest preset the connection can sustain.
 */
export function getRecommendedQuality(uploadMbps) {
  const sorted = Object.entries(QUALITY_PRESETS)
    .sort(([, a], [, b]) => b.bitrate - a.bitrate);

  // Pick highest preset whose bitrate fits within ~80% of upload
  for (const [key, preset] of sorted) {
    const requiredMbps = (preset.bitrate / 1_000_000) * 1.2;
    if (uploadMbps >= requiredMbps) {
      return { key, preset, uploadMbps };
    }
  }

  return {
    key: 'lite',
    preset: QUALITY_PRESETS['lite'],
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

/**
 * Sum outbound video bytesSent from one or more RTCStatsReport (e.g. from track.getRTCStatsReport()).
 * Used to compute live upload bitrate of the stream toward the server.
 */
function sumOutboundVideoBytesSent(reports) {
  let total = 0;
  for (const report of reports) {
    if (!report) continue;
    report.forEach((r) => {
      if (r.type === 'outbound-rtp' && r.kind === 'video' && typeof r.bytesSent === 'number') {
        total += r.bytesSent;
      }
    });
  }
  return total;
}

/**
 * Compute current upload bitrate (Mbps) from local video tracks.
 * Call every 2s with the same prev refs; returns { mbps, bytesSent, timestamp } for next call.
 * First call: pass prevBytesSent and prevTimestamp as null to initialise; mbps will be 0.
 */
export async function measureLiveUploadMbps(localVideoTracks, prevBytesSent, prevTimestamp) {
  if (!localVideoTracks || localVideoTracks.length === 0) {
    return { mbps: 0, bytesSent: 0, timestamp: prevTimestamp };
  }
  const reports = await Promise.all(
    localVideoTracks.map((t) => (t.getRTCStatsReport ? t.getRTCStatsReport() : Promise.resolve(null))),
  );
  const bytesSent = sumOutboundVideoBytesSent(reports);
  const now = performance.now();
  if (prevTimestamp == null || prevBytesSent == null) {
    return { mbps: 0, bytesSent, timestamp: now };
  }
  const deltaSec = (now - prevTimestamp) / 1000;
  const mbps = deltaSec > 0 ? (Math.max(0, bytesSent - prevBytesSent) * 8) / (deltaSec * 1_000_000) : 0;
  return { mbps, bytesSent, timestamp: now };
}
