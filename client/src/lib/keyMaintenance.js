/**
 * Key maintenance: unified SPK rotation and OPK replenishment.
 *
 * Pure logic module — no React imports. All dependencies are injected for testability.
 * Both operations are silent: errors are swallowed after exponential backoff retries.
 * A module-level flag prevents concurrent maintenance passes.
 *
 * SPK rotation: checks age of the current signed pre-key every time maintenance runs.
 *   - If the SPK is older than SPK_ROTATION_INTERVAL_MS (7 days), a new one is generated.
 *   - Old SPK private key is retained for SPK_GRACE_PERIOD_MS (48h) to serve in-flight X3DH sessions.
 *   - Expired superseded SPKs are pruned from IndexedDB after the grace period.
 *
 * OPK replenishment: checks server-side OPK count against the threshold.
 *   - If count < threshold, generates and uploads a batch of OPK_BATCH_SIZE (100) OPKs.
 */

const SPK_ROTATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SPK_GRACE_PERIOD_MS = 48 * 60 * 60 * 1000; // 48 hours
const OPK_BATCH_SIZE = 100;
export const DEFAULT_OPK_THRESHOLD = 10;
export const SPK_ROTATION_INTERVAL_MS_EXPORT = SPK_ROTATION_INTERVAL_MS;

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000; // Delays: 1s, 4s, 16s (base 4 exponent)

/** Module-level flag prevents concurrent maintenance passes. */
let maintenanceRunning = false;

/**
 * Unified key maintenance pass. Checks SPK age and OPK count.
 * Silently retries on failure (3 attempts, exponential backoff).
 * All errors are swallowed after exhausting retries — caller must not rely on this throwing.
 *
 * @param {string} token - JWT
 * @param {string} userId
 * @param {string} deviceId
 * @param {number|null} opkThreshold - Min OPK count before replenishment; uses DEFAULT_OPK_THRESHOLD if null
 * @param {{ store: object, crypto: object, uploadKeys: Function, getOPKCount: Function }} deps
 * @returns {Promise<void>}
 */
export async function runKeyMaintenance(token, userId, deviceId, opkThreshold, deps) {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  try {
    await withRetry(() => doMaintenance(token, userId, deviceId, opkThreshold, deps));
  } catch (err) {
    console.warn('[keyMaintenance] all retries exhausted', err);
  } finally {
    maintenanceRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

/**
 * Runs one full maintenance pass: SPK rotation check, OPK replenishment check, expired SPK pruning.
 */
async function doMaintenance(token, userId, deviceId, opkThreshold, deps) {
  const { store, crypto, uploadKeys, getOPKCount } = deps;
  const db = await store.openStore(userId, deviceId);
  await maybeRotateSPK(db, token, deviceId, store, crypto, uploadKeys);
  await maybeReplenishOPKs(db, token, deviceId, opkThreshold, store, crypto, uploadKeys, getOPKCount);
  await pruneExpiredSPKs(db, store);
}

/**
 * Rotates the current SPK if it is older than SPK_ROTATION_INTERVAL_MS.
 * Persists the new SPK locally before uploading (fail-safe ordering).
 */
async function maybeRotateSPK(db, token, deviceId, store, crypto, uploadKeys) {
  const currentSPKId = await store.getCurrentSPKId(db);
  const currentSPK = await store.getSignedPreKey(db, currentSPKId);

  // No SPK means initial upload hasn't happened yet — not our responsibility.
  if (!currentSPK) return;

  const age = Date.now() - (currentSPK.createdAt ?? 0);
  if (age < SPK_ROTATION_INTERVAL_MS) return;

  const identity = await store.getIdentity(db);
  if (!identity) return;

  const registrationId = await store.getRegistrationId(db);
  const nextId = await store.getNextSPKId(db);

  // Generate a new pre-key bundle (0 OPKs — we only need a fresh SPK keypair).
  // Note: WASM hardcodes SPK key_id = 1 internally; we track our own counter.
  await crypto.init();
  const bundle = await crypto.generatePreKeyBundle(
    identity.publicKey,
    identity.privateKey,
    registrationId,
    0,
  );

  const newSPKPublic = Array.from(bundle.signed_pre_key ?? bundle.signedPreKey ?? []);
  const newSPKPrivate = Array.from(bundle.signed_pre_key_private ?? bundle.signedPreKeyPrivate ?? []);
  const newSPKSig = Array.from(bundle.signed_pre_key_signature ?? bundle.signedPreKeySignature ?? []);

  // Persist locally FIRST — if upload fails, the retry will find a locally-stored key.
  await store.setSignedPreKey(db, {
    id: nextId,
    publicKey: newSPKPublic,
    privateKey: newSPKPrivate,
    signature: newSPKSig,
    createdAt: Date.now(),
    supersededAt: null,
  });

  // Advance counters before upload attempt to prevent ID conflicts on retry.
  await store.setNextSPKId(db, nextId + 1);
  await store.setCurrentSPKId(db, nextId);

  // Mark old SPK as superseded (private key kept for 48h grace period).
  await store.markSPKSuperseded(db, currentSPKId);

  // Upload new SPK public key to the server.
  const identityKey = Array.from(bundle.identity_key ?? bundle.identityKey ?? []);
  await uploadKeys(token, {
    deviceId,
    identityKey,
    signedPreKey: newSPKPublic,
    signedPreKeySignature: newSPKSig,
    registrationId,
    oneTimePreKeys: [],
  });

  console.info('[keyMaintenance] SPK rotated', { from: currentSPKId, to: nextId });
}

/**
 * Replenishes OPKs if server-side count is below the threshold.
 * Uploads a batch of OPK_BATCH_SIZE OPKs. Private keys are persisted locally before upload.
 */
async function maybeReplenishOPKs(db, token, deviceId, opkThreshold, store, crypto, uploadKeys, getOPKCount) {
  const threshold = opkThreshold ?? DEFAULT_OPK_THRESHOLD;
  const count = await getOPKCount(token, deviceId);

  if (count >= threshold) return;

  const identity = await store.getIdentity(db);
  if (!identity) return;

  const registrationId = await store.getRegistrationId(db);

  await crypto.init();
  const bundle = await crypto.generatePreKeyBundle(
    identity.publicKey,
    identity.privateKey,
    registrationId,
    OPK_BATCH_SIZE,
  );

  const otpks = bundle.one_time_pre_keys ?? bundle.oneTimePreKeys ?? [];

  // Persist OPK private keys locally before upload (fail-safe ordering).
  for (const k of otpks) {
    await store.setOneTimePreKey(db, {
      keyId: k.key_id ?? k.keyId,
      publicKey: Array.from(k.public_key ?? k.publicKey ?? []),
      privateKey: Array.from(k.private_key ?? k.privateKey ?? []),
    });
  }

  // Upload using the CURRENT identity and SPK (not the newly generated ones from the bundle).
  // The server's upload endpoint upserts identity+SPK and inserts OPKs separately.
  const currentSPKId = await store.getCurrentSPKId(db);
  const currentSPK = await store.getSignedPreKey(db, currentSPKId);

  const identityKey = Array.from(bundle.identity_key ?? bundle.identityKey ?? []);
  const signedPreKey = currentSPK?.publicKey ?? Array.from(bundle.signed_pre_key ?? bundle.signedPreKey ?? []);
  const signedPreKeySignature = currentSPK?.signature ?? Array.from(bundle.signed_pre_key_signature ?? bundle.signedPreKeySignature ?? []);

  await uploadKeys(token, {
    deviceId,
    identityKey,
    signedPreKey,
    signedPreKeySignature,
    registrationId,
    oneTimePreKeys: otpks.map((k) => ({
      keyId: k.key_id ?? k.keyId,
      publicKey: Array.from(k.public_key ?? k.publicKey ?? []),
    })),
  });

  console.info('[keyMaintenance] OPKs replenished', { count: OPK_BATCH_SIZE });
}

/**
 * Removes superseded SPK private keys that have passed the 48h grace period.
 * This enforces forward secrecy by deleting stale private key material.
 */
async function pruneExpiredSPKs(db, store) {
  const allSPKs = await store.listSignedPreKeys(db);
  const now = Date.now();

  for (const spk of allSPKs) {
    if (spk.supersededAt !== null && spk.supersededAt !== undefined) {
      if (now - spk.supersededAt > SPK_GRACE_PERIOD_MS) {
        await store.deleteSignedPreKey(db, spk.id);
      }
    }
  }
}

/**
 * Retry helper with exponential backoff (base 4: 1s, 4s, 16s).
 * Throws on final failure so callers can handle it.
 *
 * @param {() => Promise<unknown>} fn
 * @param {number} [attempts=MAX_RETRY_ATTEMPTS]
 * @param {number} [baseDelay=RETRY_BASE_DELAY_MS]
 * @returns {Promise<unknown>}
 */
async function withRetry(fn, attempts = MAX_RETRY_ATTEMPTS, baseDelay = RETRY_BASE_DELAY_MS) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, baseDelay * Math.pow(4, i)));
    }
  }
}
