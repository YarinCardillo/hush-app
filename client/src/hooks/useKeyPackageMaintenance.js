/**
 * MLS KeyPackage maintenance hook — replenishes KeyPackages at all trigger points.
 *
 * Trigger 1: on mount (login/startup) — runs immediately when token+userId+deviceId are available.
 * Trigger 2: periodic 6h interval — re-runs maintenance every 6 hours while the app is open.
 * Trigger 3: key_packages.low WS event — server signals KeyPackage count is below threshold.
 *
 * All maintenance is silent — no UI side effects. The hook is safe to call unconditionally;
 * it guards against missing values internally.
 *
 * Mount point: ServerLayout (after wsClient is available and auth is confirmed).
 */

import { useEffect, useRef } from 'react';
import * as mlsStore from '../lib/mlsStore';
import * as hushCrypto from '../lib/hushCrypto';
import { uploadMLSKeyPackages, getKeyPackageCount } from '../lib/api';

const PERIODIC_CHECK_MS = 6 * 60 * 60 * 1000; // 6 hours
const NUM_KEY_PACKAGES = 50;
const DEFAULT_THRESHOLD = 10;

/**
 * Converts a Uint8Array to a lowercase hex string.
 * @param {Uint8Array} uint8Array
 * @returns {string}
 */
function toHex(uint8Array) {
  return Array.from(uint8Array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Replenishes KeyPackages if the server-side count falls below the threshold.
 * Also rotates the last-resort KeyPackage when replenishing.
 * @param {string} token
 * @param {string} userId
 * @param {string} deviceId
 * @param {number} threshold
 * @param {{ mlsStore: object, crypto: object, uploadMLSKeyPackages: Function, getKeyPackageCount: Function }} deps
 * @returns {Promise<void>}
 */
async function replenishKeyPackages(token, userId, deviceId, threshold, deps) {
  const {
    mlsStore: store,
    crypto,
    uploadMLSKeyPackages: doUpload,
    getKeyPackageCount: doGetCount,
  } = deps;

  try {
    const count = await doGetCount(token, deviceId);
    if (count >= threshold) return;

    const db = await store.openStore(userId, deviceId);
    const credential = await store.getCredential(db);
    if (!credential) return; // No credential — key upload flow hasn't run yet.

    // Generate NUM_KEY_PACKAGES regular KeyPackages.
    const kpBytesArray = [];
    for (let i = 0; i < NUM_KEY_PACKAGES; i++) {
      const kp = await crypto.generateKeyPackage(
        credential.signingPrivateKey,
        credential.signingPublicKey,
        credential.credentialBytes,
      );
      const hashRefHex = toHex(kp.hashRefBytes);
      await store.setKeyPackage(db, hashRefHex, {
        keyPackageBytes: kp.keyPackageBytes,
        privateKeyBytes: kp.privateKeyBytes,
        createdAt: Date.now(),
      });
      kpBytesArray.push(kp.keyPackageBytes);
    }

    // Rotate the last-resort KeyPackage.
    const lastResortKP = await crypto.generateKeyPackage(
      credential.signingPrivateKey,
      credential.signingPublicKey,
      credential.credentialBytes,
    );
    const lastResortHashRefHex = toHex(lastResortKP.hashRefBytes);
    await store.setLastResort(db, {
      keyPackageBytes: lastResortKP.keyPackageBytes,
      privateKeyBytes: lastResortKP.privateKeyBytes,
      hashRefHex: lastResortHashRefHex,
    });

    // Upload rotated last-resort.
    await doUpload(token, {
      deviceId,
      keyPackages: [Array.from(lastResortKP.keyPackageBytes)],
      lastResort: true,
    });

    // Upload batch of regular KeyPackages.
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    await doUpload(token, {
      deviceId,
      keyPackages: kpBytesArray.map((kp) => Array.from(kp)),
      expiresAt,
    });
  } catch (err) {
    // Silent — key maintenance errors must never surface to the user.
    // eslint-disable-next-line no-console
    console.warn('[useKeyPackageMaintenance] replenishment failed:', err);
  }
}

/**
 * Mounts KeyPackage maintenance lifecycle. Should be called once in ServerLayout
 * where wsClient, token, and userId are all available.
 *
 * @param {{ token: string|null, userId: string, deviceId: string, threshold: number|null, wsClient: object|null }} opts
 */
export function useKeyPackageMaintenance({ token, userId, deviceId, threshold, wsClient }) {
  const depsRef = useRef({
    mlsStore,
    crypto: hushCrypto,
    uploadMLSKeyPackages,
    getKeyPackageCount,
  });

  // Trigger 1 & 2: run on mount and every 6h.
  useEffect(() => {
    if (!token || !userId || !deviceId) return;

    const resolvedThreshold = threshold ?? DEFAULT_THRESHOLD;
    const deps = depsRef.current;

    replenishKeyPackages(token, userId, deviceId, resolvedThreshold, deps);

    const timer = setInterval(() => {
      replenishKeyPackages(token, userId, deviceId, resolvedThreshold, deps);
    }, PERIODIC_CHECK_MS);

    return () => clearInterval(timer);
  }, [token, userId, deviceId, threshold]);

  // Trigger 3: key_packages.low WS event.
  useEffect(() => {
    if (!wsClient || !token || !userId || !deviceId) return;

    const resolvedThreshold = threshold ?? DEFAULT_THRESHOLD;
    const deps = depsRef.current;

    const handler = () => {
      replenishKeyPackages(token, userId, deviceId, resolvedThreshold, deps);
    };

    wsClient.on('key_packages.low', handler);

    return () => {
      wsClient.off('key_packages.low', handler);
    };
  }, [wsClient, token, userId, deviceId, threshold]);
}
