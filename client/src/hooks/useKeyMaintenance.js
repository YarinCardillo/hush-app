/**
 * Key maintenance hook — wires runKeyMaintenance to all trigger points.
 *
 * Trigger 1: on mount (login/startup) — runs immediately when token+userId+deviceId are available.
 * Trigger 2: periodic 6h interval — re-runs maintenance every 6 hours while the app is open.
 * Trigger 3: keys.low WS event — server signals OPK count is below threshold.
 * Trigger 4: keys.spk_stale WS event — server signals the current SPK is outdated.
 *
 * All maintenance is silent — no UI side effects. The hook is safe to call unconditionally;
 * it guards against missing values internally.
 *
 * Mount point: ServerLayout (after wsClient is available and auth is confirmed).
 */

import { useEffect, useRef } from 'react';
import { runKeyMaintenance, DEFAULT_OPK_THRESHOLD } from '../lib/keyMaintenance';
import * as signalStore from '../lib/signalStore';
import * as hushCrypto from '../lib/hushCrypto';
import { uploadKeys, getOPKCount } from '../lib/api';

const PERIODIC_CHECK_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Mounts key maintenance lifecycle. Should be called once in ServerLayout
 * where wsClient, token, and userId are all available.
 *
 * @param {{ token: string|null, userId: string, deviceId: string, opkThreshold: number|null, wsClient: object|null }} opts
 */
export function useKeyMaintenance({ token, userId, deviceId, opkThreshold, wsClient }) {
  // Stable ref — deps never change after mount, so no re-subscription needed.
  const depsRef = useRef({ store: signalStore, crypto: hushCrypto, uploadKeys, getOPKCount });

  // Trigger 1 & 2: run on mount and every 6h.
  useEffect(() => {
    if (!token || !userId || !deviceId) return;

    const threshold = opkThreshold ?? DEFAULT_OPK_THRESHOLD;
    const deps = depsRef.current;

    runKeyMaintenance(token, userId, deviceId, threshold, deps);

    const timer = setInterval(() => {
      runKeyMaintenance(token, userId, deviceId, threshold, deps);
    }, PERIODIC_CHECK_MS);

    return () => clearInterval(timer);
  }, [token, userId, deviceId, opkThreshold]);

  // Trigger 3 & 4: keys.low and keys.spk_stale WS events.
  useEffect(() => {
    if (!wsClient || !token || !userId || !deviceId) return;

    const threshold = opkThreshold ?? DEFAULT_OPK_THRESHOLD;
    const deps = depsRef.current;

    const handler = () => {
      runKeyMaintenance(token, userId, deviceId, threshold, deps);
    };

    wsClient.on('keys.low', handler);
    wsClient.on('keys.spk_stale', handler);

    return () => {
      wsClient.off('keys.low', handler);
      wsClient.off('keys.spk_stale', handler);
    };
  }, [wsClient, token, userId, deviceId, opkThreshold]);
}
