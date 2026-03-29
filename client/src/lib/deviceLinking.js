/**
 * Device linking primitives.
 *
 * Covers:
 *   - Ed25519 device certificate signing / verification
 *   - QR payload encoding for the approval route
 *   - ECDH-based blind relay encryption for transfer bundles
 *   - Transfer bundle serialisation helpers
 */
import * as ed from '@noble/ed25519';

const LINKING_CODE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const LINKING_CODE_LENGTH = 8;
const LINK_QR_ROUTE = '/link-device';
const LINK_BUNDLE_VERSION = 1;

/**
 * Encodes raw bytes as a base64 string.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a base64 string into raw bytes.
 *
 * @param {string} value
 * @returns {Uint8Array}
 */
export function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Creates a fresh Ed25519 device keypair for account association.
 *
 * The private key is currently only needed for future protocol extensions; the
 * linking flow stores the certified public key on the server.
 *
 * @returns {Promise<{ privateKey: Uint8Array, publicKey: Uint8Array, publicKeyBase64: string }>}
 */
export async function createDeviceIdentity() {
  const privateKey = ed.utils.randomSecretKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyBase64: bytesToBase64(publicKey),
  };
}

/**
 * Creates a fresh ECDH session keypair used for the blind relay payload.
 *
 * @returns {Promise<{ privateKey: CryptoKey, publicKey: CryptoKey, publicKeyBytes: Uint8Array, publicKeyBase64: string }>}
 */
export async function createSessionKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyBytes,
    publicKeyBase64: bytesToBase64(publicKeyBytes),
  };
}

/**
 * Imports a base64-encoded raw P-256 ECDH public key.
 *
 * @param {string} publicKeyBase64
 * @returns {Promise<CryptoKey>}
 */
export async function importSessionPublicKey(publicKeyBase64) {
  return crypto.subtle.importKey(
    'raw',
    base64ToBytes(publicKeyBase64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
}

/**
 * Derives an AES-256-GCM key from a local ECDH private key and remote public key.
 *
 * @param {CryptoKey} privateKey
 * @param {CryptoKey} publicKey
 * @returns {Promise<CryptoKey>}
 */
async function deriveRelayKey(privateKey, publicKey) {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  );
  return crypto.subtle.importKey(
    'raw',
    sharedBits,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts a transfer bundle for the new device's ECDH session public key.
 *
 * The sender generates a one-shot ECDH keypair, derives a shared AES key, and
 * returns the ephemeral relay public key alongside the AES-GCM envelope.
 *
 * @param {Uint8Array} plaintextBytes
 * @param {string} targetSessionPublicKeyBase64
 * @returns {Promise<{ relayPublicKey: string, relayIv: string, relayCiphertext: string }>}
 */
export async function encryptRelayPayload(plaintextBytes, targetSessionPublicKeyBase64) {
  const relaySession = await createSessionKeyPair();
  const targetPublicKey = await importSessionPublicKey(targetSessionPublicKeyBase64);
  const relayKey = await deriveRelayKey(relaySession.privateKey, targetPublicKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    relayKey,
    plaintextBytes,
  );

  return {
    relayPublicKey: relaySession.publicKeyBase64,
    relayIv: bytesToBase64(iv),
    relayCiphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypts a blind-relayed bundle using the new device's ECDH session private key.
 *
 * @param {{ relayCiphertext: string, relayIv: string, relayPublicKey: string }} envelope
 * @param {CryptoKey} sessionPrivateKey
 * @returns {Promise<Uint8Array>}
 */
export async function decryptRelayPayload(envelope, sessionPrivateKey) {
  const relayPublicKey = await importSessionPublicKey(envelope.relayPublicKey);
  const relayKey = await deriveRelayKey(sessionPrivateKey, relayPublicKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(envelope.relayIv) },
    relayKey,
    base64ToBytes(envelope.relayCiphertext),
  );
  return new Uint8Array(plaintext);
}

/**
 * Creates a device certificate by signing the new device's public key with
 * the existing device's private key.
 *
 * @param {Uint8Array} newDevicePublicKey
 * @param {Uint8Array} existingDevicePrivateKey
 * @returns {Promise<Uint8Array>}
 */
export async function certifyDevice(newDevicePublicKey, existingDevicePrivateKey) {
  return ed.signAsync(newDevicePublicKey, existingDevicePrivateKey);
}

/**
 * Verifies a device certificate.
 *
 * @param {Uint8Array} newDevicePublicKey
 * @param {Uint8Array} certificate
 * @param {Uint8Array} signingDevicePublicKey
 * @returns {Promise<boolean>}
 */
export async function verifyCertificate(
  newDevicePublicKey,
  certificate,
  signingDevicePublicKey,
) {
  return ed.verifyAsync(certificate, newDevicePublicKey, signingDevicePublicKey);
}

/**
 * Encodes a QR payload containing the request handle the existing device needs
 * to claim on the server.
 *
 * @param {{ requestId: string, secret: string, expiresAt: string }} payload
 * @returns {string}
 */
export function encodeQRPayload({ requestId, secret, expiresAt }) {
  return btoa(JSON.stringify({
    r: requestId,
    s: secret,
    e: expiresAt,
  }));
}

/**
 * Decodes a QR payload back into its request handle fields.
 *
 * @param {string} encoded
 * @returns {{ requestId: string, secret: string, expiresAt: string }}
 */
export function decodeQRPayload(encoded) {
  const json = atob(encoded);
  const { r, s, e } = JSON.parse(json);
  return {
    requestId: r,
    secret: s,
    expiresAt: e,
  };
}

/**
 * Builds the approval URL encoded into the QR code.
 *
 * @param {string} origin
 * @param {{ requestId: string, secret: string, expiresAt: string }} payload
 * @returns {string}
 */
export function buildLinkApprovalUrl(origin, payload) {
  const url = new URL(LINK_QR_ROUTE, origin);
  url.searchParams.set('payload', encodeQRPayload(payload));
  return url.toString();
}

/**
 * Generates a random 8-character alphanumeric fallback code.
 *
 * @returns {string}
 */
export function generateLinkingCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(LINKING_CODE_LENGTH));
  return Array.from(bytes)
    .map((value) => LINKING_CODE_CHARSET[value % LINKING_CODE_CHARSET.length])
    .join('');
}

/**
 * Serialises a transfer bundle into UTF-8 JSON bytes.
 *
 * @param {{
 *   userId: string,
 *   username?: string,
 *   displayName?: string,
 *   instanceUrl?: string,
 *   rootPrivateKey: Uint8Array,
 *   rootPublicKey: Uint8Array,
 *   historySnapshot?: object,
 *   exportedAt?: string,
 * }} bundle
 * @returns {Uint8Array}
 */
export function encodeTransferBundle(bundle) {
  const payload = {
    v: LINK_BUNDLE_VERSION,
    userId: bundle.userId,
    username: bundle.username ?? '',
    displayName: bundle.displayName ?? '',
    instanceUrl: bundle.instanceUrl ?? '',
    exportedAt: bundle.exportedAt ?? new Date().toISOString(),
    rootPrivateKey: bytesToBase64(bundle.rootPrivateKey),
    rootPublicKey: bytesToBase64(bundle.rootPublicKey),
    historySnapshot: bundle.historySnapshot ?? null,
  };
  return new TextEncoder().encode(JSON.stringify(payload));
}

/**
 * Parses a transfer bundle from UTF-8 JSON bytes.
 *
 * @param {Uint8Array} bytes
 * @returns {{
 *   version: number,
 *   userId: string,
 *   username: string,
 *   displayName: string,
 *   instanceUrl: string,
 *   exportedAt: string,
 *   rootPrivateKey: Uint8Array,
 *   rootPublicKey: Uint8Array,
 *   historySnapshot: object|null,
 * }}
 */
export function decodeTransferBundle(bytes) {
  const text = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(text);
  return {
    version: parsed.v ?? 1,
    userId: parsed.userId,
    username: parsed.username ?? '',
    displayName: parsed.displayName ?? '',
    instanceUrl: parsed.instanceUrl ?? '',
    exportedAt: parsed.exportedAt ?? '',
    rootPrivateKey: base64ToBytes(parsed.rootPrivateKey),
    rootPublicKey: base64ToBytes(parsed.rootPublicKey),
    historySnapshot: parsed.historySnapshot ?? null,
  };
}
