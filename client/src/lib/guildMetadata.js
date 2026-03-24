/**
 * Guild and channel metadata encryption/decryption.
 *
 * Uses AES-256-GCM (Web Crypto API) with a key derived from the guild's MLS
 * metadata group export_secret (via exportMetadataKey in hushCrypto.js).
 *
 * Blob format (all functions):
 *   [0x01]            — 1 byte version
 *   [nonce]           — 12 bytes (random, unique per encryption)
 *   [ciphertext+tag]  — variable (AES-GCM output includes 16-byte auth tag)
 *
 * Plaintext layout:
 *   guild:   JSON { n: string, d: string, i: string|null }
 *   channel: JSON { n: string, d: string }
 *
 * The server receives and stores only the opaque base64 blob — it never sees
 * plaintext guild or channel names.
 */

const METADATA_BLOB_VERSION = 0x01;
const NONCE_LENGTH = 12; // bytes — standard AES-GCM nonce

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Encrypt plaintext bytes with the given AES-GCM key.
 * Returns [version(1)][nonce(12)][ciphertext+tag(N)].
 *
 * @param {CryptoKey} key - AES-256-GCM key
 * @param {Uint8Array} plaintext - UTF-8 encoded JSON
 * @returns {Promise<Uint8Array>}
 */
async function encryptBlob(key, plaintext) {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext),
  );

  const blob = new Uint8Array(1 + NONCE_LENGTH + ciphertext.length);
  blob[0] = METADATA_BLOB_VERSION;
  blob.set(nonce, 1);
  blob.set(ciphertext, 1 + NONCE_LENGTH);
  return blob;
}

/**
 * Decrypt a blob produced by encryptBlob.
 *
 * @param {CryptoKey} key - AES-256-GCM key
 * @param {Uint8Array} blob
 * @returns {Promise<Uint8Array>} Decrypted plaintext bytes
 * @throws {Error} If version byte is unknown or decryption fails
 */
async function decryptBlob(key, blob) {
  if (blob[0] !== METADATA_BLOB_VERSION) {
    throw new Error(`[guildMetadata] Unknown blob version: 0x${blob[0].toString(16)}`);
  }
  const nonce = blob.slice(1, 1 + NONCE_LENGTH);
  const ciphertext = blob.slice(1 + NONCE_LENGTH);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    ciphertext,
  );
  return new Uint8Array(plaintext);
}

// ---------------------------------------------------------------------------
// Guild metadata
// ---------------------------------------------------------------------------

/**
 * Encrypt guild metadata using the guild's AES-256-GCM symmetric key.
 *
 * @param {CryptoKey} symmetricKey - AES-GCM key derived from exportMetadataKey
 * @param {{ name: string, description: string, icon: string|null }} metadata
 * @returns {Promise<Uint8Array>} Encrypted blob
 */
export async function encryptGuildMetadata(symmetricKey, metadata) {
  const payload = JSON.stringify({ n: metadata.name, d: metadata.description, i: metadata.icon ?? null });
  const plaintext = new TextEncoder().encode(payload);
  return encryptBlob(symmetricKey, plaintext);
}

/**
 * Decrypt a guild metadata blob.
 *
 * @param {CryptoKey} symmetricKey - AES-GCM key derived from exportMetadataKey
 * @param {Uint8Array} blob - Encrypted blob (from server, base64-decoded)
 * @returns {Promise<{ name: string, description: string, icon: string|null }>}
 */
export async function decryptGuildMetadata(symmetricKey, blob) {
  const plaintext = await decryptBlob(symmetricKey, blob);
  const parsed = JSON.parse(new TextDecoder().decode(plaintext));
  return { name: parsed.n ?? '', description: parsed.d ?? '', icon: parsed.i ?? null };
}

// ---------------------------------------------------------------------------
// Channel metadata
// ---------------------------------------------------------------------------

/**
 * Encrypt channel metadata using the guild's AES-256-GCM symmetric key.
 *
 * @param {CryptoKey} symmetricKey - AES-GCM key derived from exportMetadataKey
 * @param {{ name: string, description: string }} metadata
 * @returns {Promise<Uint8Array>} Encrypted blob
 */
export async function encryptChannelMetadata(symmetricKey, metadata) {
  const payload = JSON.stringify({ n: metadata.name, d: metadata.description ?? '' });
  const plaintext = new TextEncoder().encode(payload);
  return encryptBlob(symmetricKey, plaintext);
}

/**
 * Decrypt a channel metadata blob.
 *
 * @param {CryptoKey} symmetricKey - AES-GCM key derived from exportMetadataKey
 * @param {Uint8Array} blob - Encrypted blob (from server, base64-decoded)
 * @returns {Promise<{ name: string, description: string }>}
 */
export async function decryptChannelMetadata(symmetricKey, blob) {
  const plaintext = await decryptBlob(symmetricKey, blob);
  const parsed = JSON.parse(new TextDecoder().decode(plaintext));
  return { name: parsed.n ?? '', description: parsed.d ?? '' };
}

// ---------------------------------------------------------------------------
// Base64 transport helpers (for API calls)
// ---------------------------------------------------------------------------

/**
 * Encode a Uint8Array to a base64 string for API transport.
 * @param {Uint8Array} uint8Array
 * @returns {string}
 */
export function toBase64(uint8Array) {
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

/**
 * Decode a base64 string to a Uint8Array.
 * @param {string} base64String
 * @returns {Uint8Array}
 */
export function fromBase64(base64String) {
  const binary = atob(base64String);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Invite URL fragment helpers
// Guild name is embedded in the URL fragment (#name=...) and never sent to the server.
// ---------------------------------------------------------------------------

/**
 * Encode a guild name for embedding in an invite URL fragment.
 * @param {string} guildName
 * @returns {string} URI-encoded guild name
 */
export function encodeGuildNameForInvite(guildName) {
  return encodeURIComponent(guildName);
}

/**
 * Decode a guild name from an invite URL fragment.
 * @param {string} fragment - URI-encoded fragment value (the part after #name=)
 * @returns {string|null} Decoded guild name, or null if decoding fails
 */
export function decodeGuildNameFromInvite(fragment) {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Key import helper
// Converts raw 32-byte key material (from exportMetadataKey WASM) to a
// Web Crypto CryptoKey suitable for AES-GCM encrypt/decrypt.
// ---------------------------------------------------------------------------

/**
 * Import raw AES-256-GCM key bytes as a Web Crypto CryptoKey.
 *
 * @param {Uint8Array} keyBytes - 32 bytes from exportMetadataKey
 * @returns {Promise<CryptoKey>}
 */
export async function importMetadataKey(keyBytes) {
  return globalThis.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}
