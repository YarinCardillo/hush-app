/**
 * Signal Protocol state in IndexedDB.
 * Store prefix: hush-signal-${userId}-${deviceId} (one DB per local user+device).
 * Stores: identity, registrationId, sessions (per remote user+device),
 *         signedPreKeys (private), otpPrivateKeys (private, deleted after use),
 *         messages (encrypted plaintext cache per message ID, B.5).
 */

const DB_NAME_PREFIX = 'hush-signal-';
const STORE_IDENTITY = 'identity';
const STORE_SESSIONS = 'sessions';
const STORE_PREKEYS = 'prekeys';
const STORE_SIGNED_PREKEYS = 'signedPreKeys';
const STORE_OTP_PRIVATE = 'otpPrivateKeys';
const STORE_MESSAGES = 'messages';
const DB_VERSION = 3;
const MSG_CACHE_IV_BYTES = 12;

/**
 * Opens the Signal store for the given user and device.
 * @param {string} userId - Local user ID (UUID)
 * @param {string} deviceId - Local device ID
 * @returns {Promise<IDBDatabase>}
 */
export function openStore(userId, deviceId) {
  const dbName = `${DB_NAME_PREFIX}${userId}-${deviceId}`;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_IDENTITY)) {
        db.createObjectStore(STORE_IDENTITY, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_PREKEYS)) {
        db.createObjectStore(STORE_PREKEYS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_SIGNED_PREKEYS)) {
        db.createObjectStore(STORE_SIGNED_PREKEYS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_OTP_PRIVATE)) {
        db.createObjectStore(STORE_OTP_PRIVATE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        db.createObjectStore(STORE_MESSAGES, { keyPath: 'key' });
      }
    };
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<void>}
 */
function put(db, storeName, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put({ ...value, key });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {string} key
 * @returns {Promise<unknown|null>}
 */
function get(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {string} key
 * @returns {Promise<void>}
 */
function del(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const IDENTITY_KEY = 'identity';
const REGISTRATION_ID_KEY = 'registrationId';

/**
 * @param {IDBDatabase} db
 * @returns {Promise<{ publicKey: Uint8Array, privateKey: Uint8Array }|null>}
 */
export async function getIdentity(db) {
  const row = await get(db, STORE_IDENTITY, IDENTITY_KEY);
  if (!row?.publicKey || !row?.privateKey) return null;
  return {
    publicKey: new Uint8Array(row.publicKey),
    privateKey: new Uint8Array(row.privateKey),
  };
}

/**
 * @param {IDBDatabase} db
 * @param {{ publicKey: Uint8Array | number[], privateKey: Uint8Array | number[] }} identity
 */
export async function setIdentity(db, identity) {
  await put(db, STORE_IDENTITY, IDENTITY_KEY, {
    publicKey: Array.from(identity.publicKey),
    privateKey: Array.from(identity.privateKey),
  });
}

/**
 * @param {IDBDatabase} db
 * @returns {Promise<number|null>}
 */
export async function getRegistrationId(db) {
  const row = await get(db, STORE_IDENTITY, REGISTRATION_ID_KEY);
  return row?.value ?? null;
}

/**
 * @param {IDBDatabase} db
 * @param {number} id
 */
export async function setRegistrationId(db, id) {
  await put(db, STORE_IDENTITY, REGISTRATION_ID_KEY, { value: id });
}

// ---------------------------------------------------------------------------
// Sessions (with AD)
// ---------------------------------------------------------------------------

/**
 * @param {string} remoteUserId
 * @param {string} remoteDeviceId
 * @returns {string}
 */
function sessionKey(remoteUserId, remoteDeviceId) {
  return `session-${remoteUserId}-${remoteDeviceId}`;
}

/**
 * @param {IDBDatabase} db
 * @param {string} remoteUserId
 * @param {string} remoteDeviceId
 * @returns {Promise<{ state: Uint8Array, ad: Uint8Array }|null>}
 */
export async function getSession(db, remoteUserId, remoteDeviceId) {
  const row = await get(db, STORE_SESSIONS, sessionKey(remoteUserId, remoteDeviceId));
  if (!row?.state) return null;
  return {
    state: new Uint8Array(row.state),
    ad: row.ad ? new Uint8Array(row.ad) : new Uint8Array(0),
  };
}

/**
 * @param {IDBDatabase} db
 * @param {string} remoteUserId
 * @param {string} remoteDeviceId
 * @param {Uint8Array | number[]} stateBytes
 * @param {Uint8Array | number[]} ad - Associated Data (66 bytes: IK_A || IK_B)
 */
export async function setSession(db, remoteUserId, remoteDeviceId, stateBytes, ad) {
  await put(db, STORE_SESSIONS, sessionKey(remoteUserId, remoteDeviceId), {
    state: Array.from(stateBytes),
    ad: Array.from(ad),
  });
}

// ---------------------------------------------------------------------------
// Signed Pre-Keys (private key persistence for X3DH responder)
// ---------------------------------------------------------------------------

/**
 * @param {IDBDatabase} db
 * @param {{ id: number, publicKey: number[], privateKey: number[], signature: number[], createdAt?: number, supersededAt?: number|null }} spk
 */
export async function setSignedPreKey(db, spk) {
  await put(db, STORE_SIGNED_PREKEYS, `spk-${spk.id}`, {
    id: spk.id,
    publicKey: spk.publicKey,
    privateKey: spk.privateKey,
    signature: spk.signature,
    createdAt: spk.createdAt ?? Date.now(),
    supersededAt: spk.supersededAt ?? null,
  });
}

/**
 * @param {IDBDatabase} db
 * @param {number} id
 * @returns {Promise<{ id: number, publicKey: number[], privateKey: number[], signature: number[], createdAt: number, supersededAt: number|null }|null>}
 */
export async function getSignedPreKey(db, id) {
  const row = await get(db, STORE_SIGNED_PREKEYS, `spk-${id}`);
  if (!row?.privateKey) return null;
  return {
    id: row.id,
    publicKey: row.publicKey,
    privateKey: row.privateKey,
    signature: row.signature,
    createdAt: row.createdAt ?? null,
    supersededAt: row.supersededAt ?? null,
  };
}

/**
 * List all signed pre-keys from IndexedDB. Used for grace-period pruning.
 * @param {IDBDatabase} db
 * @returns {Promise<Array<{ id: number, publicKey: number[], privateKey: number[], signature: number[], createdAt: number, supersededAt: number|null }>>}
 */
export function listSignedPreKeys(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SIGNED_PREKEYS, 'readonly');
    const store = tx.objectStore(STORE_SIGNED_PREKEYS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete a signed pre-key by ID. Called after 48h grace period expires.
 * @param {IDBDatabase} db
 * @param {number} id
 */
export async function deleteSignedPreKey(db, id) {
  await del(db, STORE_SIGNED_PREKEYS, `spk-${id}`);
}

/**
 * Mark a signed pre-key as superseded (sets supersededAt timestamp).
 * The private key is retained until the 48h grace period expires.
 * @param {IDBDatabase} db
 * @param {number} spkId
 */
export async function markSPKSuperseded(db, spkId) {
  const existing = await getSignedPreKey(db, spkId);
  if (!existing) return;
  await setSignedPreKey(db, { ...existing, supersededAt: Date.now() });
}

// ---------------------------------------------------------------------------
// SPK ID counters (stored in STORE_IDENTITY alongside registrationId)
// ---------------------------------------------------------------------------

const CURRENT_SPK_ID_KEY = 'currentSPKId';
const NEXT_SPK_ID_KEY = 'nextSPKId';

/**
 * Get the ID of the currently active signed pre-key.
 * Defaults to 1 (the initial upload ID from uploadKeysAfterAuth).
 * @param {IDBDatabase} db
 * @returns {Promise<number>}
 */
export async function getCurrentSPKId(db) {
  const row = await get(db, STORE_IDENTITY, CURRENT_SPK_ID_KEY);
  return row?.value ?? 1;
}

/**
 * @param {IDBDatabase} db
 * @param {number} id
 */
export async function setCurrentSPKId(db, id) {
  await put(db, STORE_IDENTITY, CURRENT_SPK_ID_KEY, { value: id });
}

/**
 * Get the next SPK ID to use for rotation.
 * Defaults to 2 since the initial upload uses ID 1.
 * @param {IDBDatabase} db
 * @returns {Promise<number>}
 */
export async function getNextSPKId(db) {
  const row = await get(db, STORE_IDENTITY, NEXT_SPK_ID_KEY);
  return row?.value ?? 2;
}

/**
 * @param {IDBDatabase} db
 * @param {number} id
 */
export async function setNextSPKId(db, id) {
  await put(db, STORE_IDENTITY, NEXT_SPK_ID_KEY, { value: id });
}

// ---------------------------------------------------------------------------
// One-Time Pre-Keys (private key persistence for X3DH responder, deleted after use)
// ---------------------------------------------------------------------------

/**
 * @param {IDBDatabase} db
 * @param {{ keyId: number, publicKey: number[], privateKey: number[] }} otp
 */
export async function setOneTimePreKey(db, otp) {
  await put(db, STORE_OTP_PRIVATE, `otp-${otp.keyId}`, {
    keyId: otp.keyId,
    publicKey: otp.publicKey,
    privateKey: otp.privateKey,
  });
}

/**
 * @param {IDBDatabase} db
 * @param {number} keyId
 * @returns {Promise<{ keyId: number, publicKey: number[], privateKey: number[] }|null>}
 */
export async function getOneTimePreKey(db, keyId) {
  const row = await get(db, STORE_OTP_PRIVATE, `otp-${keyId}`);
  if (!row?.privateKey) return null;
  return { keyId: row.keyId, publicKey: row.publicKey, privateKey: row.privateKey };
}

/**
 * Delete a consumed one-time pre-key (forward secrecy).
 * @param {IDBDatabase} db
 * @param {number} keyId
 */
export async function deleteOneTimePreKey(db, keyId) {
  await del(db, STORE_OTP_PRIVATE, `otp-${keyId}`);
}

// ---------------------------------------------------------------------------
// Legacy pre-key blob (kept for backward compat, used by older tests)
// ---------------------------------------------------------------------------

/**
 * @param {IDBDatabase} db
 * @returns {Promise<object|null>}
 */
export async function getPreKeys(db) {
  const row = await get(db, STORE_PREKEYS, 'prekeys');
  return row ?? null;
}

/**
 * @param {IDBDatabase} db
 * @param {object} blob
 */
export async function setPreKeys(db, blob) {
  await put(db, STORE_PREKEYS, 'prekeys', blob);
}

// ---------------------------------------------------------------------------
// Message cache (B.5) — decrypted plaintext encrypted at rest with device key
// TODO(B.5, 2026-03-02): Cache eviction — delete entries older than N days
// TODO(B.5, 2026-03-02): Invalidate cache when identity key changes (re-registration)
// ---------------------------------------------------------------------------

/**
 * Returns decrypted cached message or null if missing/invalid.
 * @param {IDBDatabase} db
 * @param {string} msgId
 * @param {CryptoKey} deviceKey - AES-GCM key for message cache
 * @returns {Promise<{ content: string, senderId: string, timestamp: number }|null>}
 */
export async function getCachedMessage(db, msgId, deviceKey) {
  const row = await get(db, STORE_MESSAGES, msgId);
  if (!row?.blob) return null;
  const blob = row.blob instanceof Uint8Array ? row.blob : new Uint8Array(row.blob);
  if (blob.length <= MSG_CACHE_IV_BYTES) return null;
  const iv = blob.slice(0, MSG_CACHE_IV_BYTES);
  const ciphertext = blob.slice(MSG_CACHE_IV_BYTES);
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      deviceKey,
      ciphertext
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    return null;
  }
}

/**
 * Encrypts and stores a message in the cache.
 * @param {IDBDatabase} db
 * @param {string} msgId
 * @param {{ content: string, senderId: string, timestamp: number }} payload
 * @param {CryptoKey} deviceKey - AES-GCM key for message cache
 */
export async function setCachedMessage(db, msgId, payload, deviceKey) {
  const iv = crypto.getRandomValues(new Uint8Array(MSG_CACHE_IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    deviceKey,
    plaintext
  );
  const blob = new Uint8Array(iv.length + ciphertext.byteLength);
  blob.set(iv, 0);
  blob.set(new Uint8Array(ciphertext), iv.length);
  await put(db, STORE_MESSAGES, msgId, { blob });
}
