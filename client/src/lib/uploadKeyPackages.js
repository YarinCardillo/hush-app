/**
 * MLS key upload after auth: generates credential and KeyPackages via WASM,
 * persists private keys locally in IndexedDB, and uploads public material
 * to /api/mls/credentials and /api/mls/key-packages.
 *
 * Pure logic; all deps (mlsStore, crypto, uploadCredential, uploadKeyPackages)
 * are passed in for testability.
 *
 * @module uploadKeyPackages
 */

const NUM_KEY_PACKAGES = 50;

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
 * Runs after successful login/register. Generates MLS credential + KeyPackages,
 * stores private keys in IndexedDB, and uploads public material to the server.
 *
 * On first call: generates credential + 50 KeyPackages + 1 last-resort.
 * On subsequent calls: credential already exists — generates and uploads KeyPackages only.
 *
 * @param {string} token - JWT
 * @param {string} userId - User UUID
 * @param {string} deviceId - Stable device ID
 * @param {{ mlsStore: object, crypto: object, uploadCredential: Function, uploadKeyPackages: Function }} deps
 * @returns {Promise<void>}
 */
export async function uploadKeyPackagesAfterAuth(token, userId, deviceId, deps) {
  const {
    mlsStore,
    crypto,
    uploadCredential,
    uploadKeyPackages: doUploadKeyPackages,
  } = deps;

  const db = await mlsStore.openStore(userId, deviceId);
  let credential = await mlsStore.getCredential(db);

  if (!credential) {
    await crypto.init();
    credential = await crypto.generateCredential(`${userId}:${deviceId}`);
    await mlsStore.setCredential(db, credential);
    await uploadCredential(token, {
      deviceId,
      credentialBytes: Array.from(credential.credentialBytes),
      signingPublicKey: Array.from(credential.signingPublicKey),
    });
  }

  // Generate NUM_KEY_PACKAGES regular KeyPackages.
  const kpBytesArray = [];
  for (let i = 0; i < NUM_KEY_PACKAGES; i++) {
    const kp = await crypto.generateKeyPackage(
      credential.signingPrivateKey,
      credential.signingPublicKey,
      credential.credentialBytes,
    );
    const hashRefHex = toHex(kp.hashRefBytes);
    await mlsStore.setKeyPackage(db, hashRefHex, {
      keyPackageBytes: kp.keyPackageBytes,
      privateKeyBytes: kp.privateKeyBytes,
      createdAt: Date.now(),
    });
    kpBytesArray.push(kp.keyPackageBytes);
  }

  // Generate 1 last-resort KeyPackage (stored separately, never consumed).
  const lastResortKP = await crypto.generateKeyPackage(
    credential.signingPrivateKey,
    credential.signingPublicKey,
    credential.credentialBytes,
  );
  const lastResortHashRefHex = toHex(lastResortKP.hashRefBytes);
  await mlsStore.setLastResort(db, {
    keyPackageBytes: lastResortKP.keyPackageBytes,
    privateKeyBytes: lastResortKP.privateKeyBytes,
    hashRefHex: lastResortHashRefHex,
  });

  // Upload last-resort separately (server handles it as read-only fallback).
  await doUploadKeyPackages(token, {
    deviceId,
    keyPackages: [Array.from(lastResortKP.keyPackageBytes)],
    lastResort: true,
  });

  // Upload batch of regular KeyPackages with 30-day expiry.
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  await doUploadKeyPackages(token, {
    deviceId,
    keyPackages: kpBytesArray.map((kp) => Array.from(kp)),
    expiresAt,
  });
}
