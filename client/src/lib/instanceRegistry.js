/**
 * Instance registry — IndexedDB-backed store for multi-instance connections.
 *
 * Database: 'hush-instances' (version 1)
 * Object stores:
 *   - 'instances'   keyPath: 'instanceUrl' — per-instance JWT, userId, connectionState
 *   - 'guild-order' — single record key 'order' storing ordered guildId array
 *
 * Follows the raw IndexedDB API pattern from mlsStore.js and identityVault.js.
 * Callers receive the IDBDatabase handle from openInstanceRegistry() and pass it
 * to all subsequent operations, enabling dependency injection for tests.
 *
 * @module instanceRegistry
 */

/** IndexedDB database name. */
const DB_NAME = 'hush-instances';

/** Database version — increment on schema changes. */
const DB_VERSION = 1;

/** Store names. */
const STORE_INSTANCES = 'instances';
const STORE_GUILD_ORDER = 'guild-order';

/** Key used for the single guild-order record. */
const GUILD_ORDER_KEY = 'order';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Wraps an IDB put request in a Promise.
 *
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {object} value - Record to store; key comes from the store's keyPath or explicit key.
 * @param {string} [key] - Explicit key (only needed when store has no keyPath).
 * @returns {Promise<void>}
 */
function idbPut(db, storeName, value, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = key !== undefined ? store.put(value, key) : store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Wraps an IDB get request in a Promise.
 *
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {string} key
 * @returns {Promise<unknown|null>}
 */
function idbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Wraps an IDB getAll request in a Promise.
 *
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @returns {Promise<Array<unknown>>}
 */
function idbGetAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Wraps an IDB delete request in a Promise.
 *
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {string} key
 * @returns {Promise<void>}
 */
function idbDelete(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// DB open / upgrade
// ---------------------------------------------------------------------------

/**
 * Opens the 'hush-instances' IndexedDB database.
 * Creates object stores on first open (version 1).
 *
 * @param {string} [dbName] - Override database name (for test isolation). Defaults to 'hush-instances'.
 * @returns {Promise<IDBDatabase>}
 */
export function openInstanceRegistry(dbName = DB_NAME) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_INSTANCES)) {
        db.createObjectStore(STORE_INSTANCES, { keyPath: 'instanceUrl' });
      }
      if (!db.objectStoreNames.contains(STORE_GUILD_ORDER)) {
        // No keyPath — records stored with explicit key 'order'.
        db.createObjectStore(STORE_GUILD_ORDER);
      }
    };
  });
}

// ---------------------------------------------------------------------------
// Instance CRUD
// ---------------------------------------------------------------------------

/**
 * @typedef {object} InstanceRecord
 * @property {string} instanceUrl   - Canonical base URL, used as the primary key.
 * @property {string} jwt           - Current session JWT for this instance.
 * @property {string} userId        - UUID of the authenticated user on this instance.
 * @property {string} username      - Username on this instance.
 * @property {string} displayName   - Display name on this instance.
 * @property {string} connectionState - 'connected' | 'disconnected' | 'error'
 * @property {number} lastSeen      - Unix epoch ms of last successful connection.
 */

/**
 * Upsert an instance record by instanceUrl.
 *
 * @param {IDBDatabase} db
 * @param {InstanceRecord} record
 * @returns {Promise<void>}
 */
export function saveInstance(db, record) {
  return idbPut(db, STORE_INSTANCES, record);
}

/**
 * Retrieve all stored instance records.
 *
 * @param {IDBDatabase} db
 * @returns {Promise<InstanceRecord[]>}
 */
export function getAllInstances(db) {
  return idbGetAll(db, STORE_INSTANCES);
}

/**
 * Retrieve a single instance record by URL.
 * Returns null if not found.
 *
 * @param {IDBDatabase} db
 * @param {string} instanceUrl
 * @returns {Promise<InstanceRecord|null>}
 */
export function getInstanceByUrl(db, instanceUrl) {
  return idbGet(db, STORE_INSTANCES, instanceUrl);
}

/**
 * Delete an instance record. No-op if the record does not exist.
 *
 * @param {IDBDatabase} db
 * @param {string} instanceUrl
 * @returns {Promise<void>}
 */
export function removeInstance(db, instanceUrl) {
  return idbDelete(db, STORE_INSTANCES, instanceUrl);
}

/**
 * Return the JWT for an instance, or null if not found.
 *
 * @param {IDBDatabase} db
 * @param {string} instanceUrl
 * @returns {Promise<string|null>}
 */
export async function getInstanceJwt(db, instanceUrl) {
  const record = await getInstanceByUrl(db, instanceUrl);
  return record?.jwt ?? null;
}

// ---------------------------------------------------------------------------
// Guild order persistence
// ---------------------------------------------------------------------------

/**
 * Persist the ordered list of guild IDs for the multi-instance sidebar.
 * Replaces any previously stored order.
 *
 * @param {IDBDatabase} db
 * @param {string[]} guildIds - Ordered array of guild UUIDs.
 * @returns {Promise<void>}
 */
export function saveGuildOrder(db, guildIds) {
  return idbPut(db, STORE_GUILD_ORDER, { guildIds }, GUILD_ORDER_KEY);
}

/**
 * Retrieve the persisted guild order.
 * Returns an empty array if no order has been saved yet.
 *
 * @param {IDBDatabase} db
 * @returns {Promise<string[]>}
 */
export async function getGuildOrder(db) {
  const record = await idbGet(db, STORE_GUILD_ORDER, GUILD_ORDER_KEY);
  return record?.guildIds ?? [];
}
