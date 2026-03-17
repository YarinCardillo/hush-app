/**
 * MLS Protocol state in IndexedDB.
 * Store prefix: hush-mls-${userId}-${deviceId} (one DB per local user+device).
 * Stores: credential (MLS signing keys + credential bytes),
 *         keyPackages (KeyPackage private key blobs keyed by hashRefHex),
 *         lastResort (last-resort KeyPackage, read-only fallback).
 */

const DB_NAME_PREFIX = 'hush-mls-';
const STORE_CREDENTIAL = 'credential';
const STORE_KEY_PACKAGES = 'keyPackages';
const STORE_LAST_RESORT = 'lastResort';
const DB_VERSION = 1;

const CREDENTIAL_KEY = 'credential';
const LAST_RESORT_KEY = 'lastResort';

/**
 * Opens the MLS store for the given user and device.
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
      if (!db.objectStoreNames.contains(STORE_CREDENTIAL)) {
        db.createObjectStore(STORE_CREDENTIAL, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_KEY_PACKAGES)) {
        db.createObjectStore(STORE_KEY_PACKAGES, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_LAST_RESORT)) {
        db.createObjectStore(STORE_LAST_RESORT, { keyPath: 'key' });
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
// Credential
// ---------------------------------------------------------------------------

/**
 * Retrieve the stored MLS credential. Returns null if not yet generated.
 * @param {IDBDatabase} db
 * @returns {Promise<{ signingPublicKey: Uint8Array, signingPrivateKey: Uint8Array, credentialBytes: Uint8Array }|null>}
 */
export async function getCredential(db) {
  const row = await get(db, STORE_CREDENTIAL, CREDENTIAL_KEY);
  if (!row?.signingPublicKey) return null;
  return {
    signingPublicKey: new Uint8Array(row.signingPublicKey),
    signingPrivateKey: new Uint8Array(row.signingPrivateKey),
    credentialBytes: new Uint8Array(row.credentialBytes),
  };
}

/**
 * Store the MLS credential. Bytes are serialised as number arrays for IndexedDB compat.
 * @param {IDBDatabase} db
 * @param {{ signingPublicKey: Uint8Array, signingPrivateKey: Uint8Array, credentialBytes: Uint8Array }} credential
 * @returns {Promise<void>}
 */
export async function setCredential(db, credential) {
  await put(db, STORE_CREDENTIAL, CREDENTIAL_KEY, {
    signingPublicKey: Array.from(credential.signingPublicKey),
    signingPrivateKey: Array.from(credential.signingPrivateKey),
    credentialBytes: Array.from(credential.credentialBytes),
  });
}

// ---------------------------------------------------------------------------
// KeyPackage private key blobs
// ---------------------------------------------------------------------------

/**
 * Retrieve a KeyPackage private key blob by its hashRefHex.
 * @param {IDBDatabase} db
 * @param {string} hashRefHex - Hex-encoded KeyPackage hash reference
 * @returns {Promise<{ keyPackageBytes: Uint8Array, privateKeyBytes: Uint8Array, createdAt: number }|null>}
 */
export async function getKeyPackage(db, hashRefHex) {
  const row = await get(db, STORE_KEY_PACKAGES, hashRefHex);
  if (!row?.keyPackageBytes) return null;
  return {
    keyPackageBytes: new Uint8Array(row.keyPackageBytes),
    privateKeyBytes: new Uint8Array(row.privateKeyBytes),
    createdAt: row.createdAt ?? 0,
  };
}

/**
 * Store a KeyPackage private key blob.
 * @param {IDBDatabase} db
 * @param {string} hashRefHex - Hex-encoded KeyPackage hash reference (IndexedDB key)
 * @param {{ keyPackageBytes: Uint8Array, privateKeyBytes: Uint8Array, createdAt: number }} payload
 * @returns {Promise<void>}
 */
export async function setKeyPackage(db, hashRefHex, payload) {
  await put(db, STORE_KEY_PACKAGES, hashRefHex, {
    keyPackageBytes: Array.from(payload.keyPackageBytes),
    privateKeyBytes: Array.from(payload.privateKeyBytes),
    createdAt: payload.createdAt ?? Date.now(),
  });
}

/**
 * Delete a consumed KeyPackage private key blob (forward secrecy).
 * @param {IDBDatabase} db
 * @param {string} hashRefHex
 * @returns {Promise<void>}
 */
export async function deleteKeyPackage(db, hashRefHex) {
  await del(db, STORE_KEY_PACKAGES, hashRefHex);
}

/**
 * List all stored KeyPackage blobs. Used for debugging and maintenance.
 * @param {IDBDatabase} db
 * @returns {Promise<Array<object>>}
 */
export function listAllKeyPackages(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_KEY_PACKAGES, 'readonly');
    const store = tx.objectStore(STORE_KEY_PACKAGES);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Last-resort KeyPackage
// ---------------------------------------------------------------------------

/**
 * Retrieve the last-resort KeyPackage. Returns null if not yet stored.
 * The last-resort KeyPackage is never consumed — it serves as a read-only fallback
 * when all regular KeyPackages have been exhausted.
 * @param {IDBDatabase} db
 * @returns {Promise<{ keyPackageBytes: Uint8Array, privateKeyBytes: Uint8Array, hashRefHex: string }|null>}
 */
export async function getLastResort(db) {
  const row = await get(db, STORE_LAST_RESORT, LAST_RESORT_KEY);
  if (!row?.keyPackageBytes) return null;
  return {
    keyPackageBytes: new Uint8Array(row.keyPackageBytes),
    privateKeyBytes: new Uint8Array(row.privateKeyBytes),
    hashRefHex: row.hashRefHex,
  };
}

/**
 * Store the last-resort KeyPackage (replacing any previous entry).
 * @param {IDBDatabase} db
 * @param {{ keyPackageBytes: Uint8Array, privateKeyBytes: Uint8Array, hashRefHex: string }} payload
 * @returns {Promise<void>}
 */
export async function setLastResort(db, payload) {
  await put(db, STORE_LAST_RESORT, LAST_RESORT_KEY, {
    keyPackageBytes: Array.from(payload.keyPackageBytes),
    privateKeyBytes: Array.from(payload.privateKeyBytes),
    hashRefHex: payload.hashRefHex,
  });
}
