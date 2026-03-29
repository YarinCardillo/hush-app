import { useState, useEffect } from 'react';

/**
 * RTT thresholds for connection quality levels.
 * @type {{ good: number, degraded: number }}
 */
const THRESHOLDS = { good: 100, degraded: 250 };

/**
 * Maps RTT to a quality level with color.
 * @param {number|null} rtt - Round-trip time in ms, or null if unknown.
 * @returns {{ level: 'good'|'degraded'|'poor'|'unknown', bars: number, color: string }}
 */
function classify(rtt) {
  if (rtt == null) return { level: 'unknown', bars: 0, color: 'var(--hush-text-muted)' };
  if (rtt <= THRESHOLDS.good) return { level: 'good', bars: 4, color: 'var(--hush-live)' };
  if (rtt <= THRESHOLDS.degraded) return { level: 'degraded', bars: 2, color: 'var(--hush-amber)' };
  return { level: 'poor', bars: 1, color: 'var(--hush-danger)' };
}

/**
 * Subscribes to the WS client's RTT events and returns live connection quality.
 *
 * @param {object|null} wsClient - The WS client from createWsClient().
 * @returns {{ rtt: number|null, level: string, bars: number, color: string, isReconnecting: boolean }}
 */
export function useConnectionQuality(wsClient) {
  const [rtt, setRtt] = useState(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    if (!wsClient) return;

    const onRtt = (data) => setRtt(data.rtt);
    const onReconnecting = () => { setIsReconnecting(true); setRtt(null); };
    const onReconnected = () => setIsReconnecting(false);
    const onOpen = () => setIsReconnecting(false);

    wsClient.on('rtt', onRtt);
    wsClient.on('reconnecting', onReconnecting);
    wsClient.on('reconnected', onReconnected);
    wsClient.on('open', onOpen);

    return () => {
      wsClient.off('rtt', onRtt);
      wsClient.off('reconnecting', onReconnecting);
      wsClient.off('reconnected', onReconnected);
      wsClient.off('open', onOpen);
    };
  }, [wsClient]);

  const quality = classify(rtt);
  return { rtt, ...quality, isReconnecting };
}
