/**
 * Identity vault module.
 *
 * Provides AES-256-GCM encryption of the identity private key (IK_priv),
 * keyed by a PIN-derived PBKDF2-SHA256 key. The encrypted blob is persisted
 * in IndexedDB per user. Salt is stored in localStorage and must be preserved
 * across sessions for deterministic key derivation.
 *
 * Blob format: [12-byte nonce][ciphertext][16-byte GCM tag]
 *
 * Key derivation: PBKDF2-SHA256, 200,000 iterations, 256-bit output.
 * Salt: 16 bytes, generated once and stored in localStorage under SALT_KEY.
 */

/** PBKDF2 iteration count — OWASP minimum for PBKDF2-SHA256 (2023). */
const PBKDF2_ITERATIONS = 200_000;

/** localStorage key for the PBKDF2 salt. */
const SALT_KEY = 'hush_vault_salt';

/** AES-GCM nonce length in bytes. */
const NONCE_LENGTH = 12;

/** IndexedDB object store name. */
const OBJECT_STORE_NAME = 'vault';

/** IDB record key under which the encrypted private key is stored. */
const ENCRYPTED_KEY_RECORD = 'ik_priv_encrypted';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the persisted PBKDF2 salt from localStorage, generating and storing
 * a new 16-byte random salt if none exists yet.
 *
 * @returns {Uint8Array} 16-byte salt.
 */
function generateAndStoreSalt() {
  const existing = localStorage.getItem(SALT_KEY);
  if (existing) {
    return hexToBytes(existing);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(SALT_KEY, bytesToHex(salt));
  return salt;
}

/**
 * Converts a hex string to a Uint8Array.
 *
 * @param {string} hex - Hexadecimal string (even length, lowercase or uppercase).
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
  const result = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    result[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return result;
}

/**
 * Converts a Uint8Array to a lowercase hex string.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Derives an AES-256-GCM key from a PIN using PBKDF2-SHA256.
 *
 * The salt is read from localStorage (generating one if absent), ensuring
 * that the same PIN on the same device always produces the same derived key.
 *
 * @param {string} pin - User-supplied PIN or passphrase.
 * @returns {Promise<CryptoKey>} AES-256-GCM CryptoKey for encrypt/decrypt.
 */
async function deriveKeyFromPin(pin) {
  const salt = generateAndStoreSalt();
  const pinBytes = new TextEncoder().encode(pin);

  const rawKey = await crypto.subtle.importKey('raw', pinBytes, 'PBKDF2', false, [
    'deriveKey',
  ]);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---------------------------------------------------------------------------
// Public API — Encryption / Decryption
// ---------------------------------------------------------------------------

/**
 * Encrypts a 32-byte private key with a user PIN.
 *
 * A 12-byte random nonce is generated per call, so two encryptions of the
 * same key with the same PIN produce different blobs (nonce differs).
 *
 * Blob format: [12-byte nonce][ciphertext + 16-byte GCM tag]
 *
 * @param {Uint8Array} privateKey - 32-byte Ed25519 private key seed.
 * @param {string} pin - User PIN or passphrase.
 * @returns {Promise<Uint8Array>} Encrypted blob.
 */
export async function encryptVault(privateKey, pin) {
  const key = await deriveKeyFromPin(pin);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    privateKey,
  );

  const blob = new Uint8Array(NONCE_LENGTH + ciphertext.byteLength);
  blob.set(nonce, 0);
  blob.set(new Uint8Array(ciphertext), NONCE_LENGTH);
  return blob;
}

/**
 * Decrypts an encrypted vault blob with a user PIN.
 *
 * Throws a DOMException (OperationError) if the PIN is wrong (GCM tag
 * mismatch), preventing silent key recovery with an incorrect PIN.
 *
 * @param {Uint8Array} blob - Encrypted blob produced by encryptVault.
 * @param {string} pin - User PIN or passphrase.
 * @returns {Promise<Uint8Array>} Decrypted 32-byte private key.
 * @throws {DOMException} If PIN is incorrect (GCM authentication failure).
 */
export async function decryptVault(blob, pin) {
  const key = await deriveKeyFromPin(pin);
  const nonce = blob.slice(0, NONCE_LENGTH);
  const ciphertext = blob.slice(NONCE_LENGTH);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    ciphertext,
  );

  return new Uint8Array(plaintext);
}

// ---------------------------------------------------------------------------
// Public API — IndexedDB persistence
// ---------------------------------------------------------------------------

/**
 * Opens (or creates) the vault IndexedDB database for a specific user.
 *
 * Database name: `hush-vault-{userId}`
 * Object store: `vault` (key-value)
 *
 * @param {string} userId - User identifier string.
 * @returns {Promise<IDBDatabase>} Open IDB database handle.
 */
export function openVaultStore(userId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`hush-vault-${userId}`, 1);

    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        db.createObjectStore(OBJECT_STORE_NAME);
      }
    };

    request.onsuccess = event => resolve(event.target.result);
    request.onerror = event => reject(event.target.error);
  });
}

/**
 * Persists an encrypted vault blob in IndexedDB under the canonical record key.
 *
 * @param {IDBDatabase} db - Open vault IDB handle (from openVaultStore).
 * @param {Uint8Array} blob - Encrypted blob to persist.
 * @returns {Promise<void>}
 */
export function saveEncryptedKey(db, blob) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OBJECT_STORE_NAME, 'readwrite');
    const store = tx.objectStore(OBJECT_STORE_NAME);
    const request = store.put(blob, ENCRYPTED_KEY_RECORD);
    request.onsuccess = () => resolve();
    request.onerror = event => reject(event.target.error);
  });
}

/**
 * Loads the encrypted vault blob from IndexedDB.
 *
 * @param {IDBDatabase} db - Open vault IDB handle (from openVaultStore).
 * @returns {Promise<Uint8Array|null>} Encrypted blob or null if none stored.
 */
export function loadEncryptedKey(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OBJECT_STORE_NAME, 'readonly');
    const store = tx.objectStore(OBJECT_STORE_NAME);
    const request = store.get(ENCRYPTED_KEY_RECORD);
    request.onsuccess = event => {
      const value = event.target.result ?? null;
      if (value === null) {
        resolve(null);
      } else if (value instanceof Uint8Array) {
        resolve(value);
      } else {
        // fake-indexeddb and some environments return ArrayBuffer or similar;
        // coerce to Uint8Array for a consistent return type.
        resolve(new Uint8Array(value));
      }
    };
    request.onerror = event => reject(event.target.error);
  });
}

/**
 * Deletes the vault IndexedDB database for a specific user.
 *
 * Used on account removal or factory reset. Resolves (does not throw) when
 * the database does not exist.
 *
 * @param {string} userId - User identifier string.
 * @returns {Promise<void>}
 */
export function deleteVaultDatabase(userId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(`hush-vault-${userId}`);
    request.onsuccess = () => resolve();
    request.onerror = event => reject(event.target.error);
    // onblocked fires when the DB is open in another tab; still resolves
    request.onblocked = () => resolve();
  });
}

// ---------------------------------------------------------------------------
// Public API — Vault configuration
// ---------------------------------------------------------------------------

/**
 * Retrieves vault configuration from localStorage.
 *
 * Config shape: { timeout: 'browser_close' | 'refresh' | number | 'never', pinType: 'pin' | 'passphrase' }
 *
 * @param {string} userId - User identifier string.
 * @returns {{ timeout: string|number, pinType: string }|null} Config or null if not set.
 */
export function getVaultConfig(userId) {
  const raw = localStorage.getItem(`hush_vault_config_${userId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Persists vault configuration in localStorage.
 *
 * @param {string} userId - User identifier string.
 * @param {{ timeout: string|number, pinType: string }} config - Vault config object.
 */
export function setVaultConfig(userId, config) {
  localStorage.setItem(`hush_vault_config_${userId}`, JSON.stringify(config));
}
