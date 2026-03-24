/**
 * Device linking module.
 *
 * Provides device certificate generation and verification for multi-device
 * account linking, QR payload encoding/decoding, and linking code generation.
 *
 * Protocol overview (from ARCHITECTURE.md §Key Design Decisions #6):
 *   - Each device has its own independent Ed25519 keypair.
 *   - Private keys never leave the originating device.
 *   - To link a new device, an authenticated existing device signs the new
 *     device's public key: certificate = Sign(IK_existing_priv, IK_new_pub)
 *   - The new device displays a QR code containing its public key, an
 *     ephemeral DH public key, expiry time, and a nonce.
 *   - The existing device scans the QR, verifies freshness, and produces
 *     the certificate, which the new device submits to the server.
 *
 * Uses @noble/ed25519 (audited, Paul Miller, MIT).
 */
import * as ed from '@noble/ed25519';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Encodes a Uint8Array to a base64 string using the standard btoa alphabet.
 *
 * @param {Uint8Array} bytes
 * @returns {string} Base64 string.
 */
function base64Encode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a base64 string to a Uint8Array.
 *
 * @param {string} str - Base64 string.
 * @returns {Uint8Array}
 */
function base64Decode(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Public API — Device certificates
// ---------------------------------------------------------------------------

/**
 * Creates a device certificate by signing the new device's public key with
 * the existing device's private key.
 *
 * The certificate proves that the holder of `existingDevicePrivateKey`
 * authorised `newDevicePublicKey` as a trusted device on the same account.
 *
 * @param {Uint8Array} newDevicePublicKey - 32-byte Ed25519 public key of the device being certified.
 * @param {Uint8Array} existingDevicePrivateKey - 32-byte Ed25519 private key of the authorising device.
 * @returns {Promise<Uint8Array>} 64-byte Ed25519 signature (the certificate).
 */
export async function certifyDevice(newDevicePublicKey, existingDevicePrivateKey) {
  return ed.signAsync(newDevicePublicKey, existingDevicePrivateKey);
}

/**
 * Verifies a device certificate.
 *
 * Returns true only when the certificate is a valid Ed25519 signature of
 * `newDevicePublicKey` produced by the owner of `signingDevicePublicKey`.
 *
 * @param {Uint8Array} newDevicePublicKey - 32-byte public key of the device being certified.
 * @param {Uint8Array} certificate - 64-byte certificate returned by certifyDevice.
 * @param {Uint8Array} signingDevicePublicKey - 32-byte public key of the authorising device.
 * @returns {Promise<boolean>} True if the certificate is valid.
 */
export async function verifyCertificate(
  newDevicePublicKey,
  certificate,
  signingDevicePublicKey,
) {
  return ed.verifyAsync(certificate, newDevicePublicKey, signingDevicePublicKey);
}

// ---------------------------------------------------------------------------
// Public API — QR payload encode/decode
// ---------------------------------------------------------------------------

/**
 * Encodes a device linking QR payload to a base64 string.
 *
 * The payload is compact (short JSON keys) to keep the QR code density low
 * and scannable at small physical sizes.
 *
 * JSON fields:
 *   dpk  — base64(devicePublicKey)
 *   epk  — base64(ephemeralPublicKey)
 *   exp  — ISO 8601 expiry timestamp
 *   n    — base64(nonce)
 *
 * @param {{ devicePublicKey: Uint8Array, ephemeralPublicKey: Uint8Array, expiry: string, nonce: Uint8Array }} payload
 * @returns {string} Base64-encoded JSON payload.
 */
export function encodeQRPayload({ devicePublicKey, ephemeralPublicKey, expiry, nonce }) {
  const json = JSON.stringify({
    dpk: base64Encode(devicePublicKey),
    epk: base64Encode(ephemeralPublicKey),
    exp: expiry,
    n: base64Encode(nonce),
  });
  return btoa(json);
}

/**
 * Decodes a base64 device linking QR payload back to typed fields.
 *
 * @param {string} encoded - Base64 string produced by encodeQRPayload.
 * @returns {{ devicePublicKey: Uint8Array, ephemeralPublicKey: Uint8Array, expiry: string, nonce: Uint8Array }}
 */
export function decodeQRPayload(encoded) {
  const json = atob(encoded);
  const { dpk, epk, exp, n } = JSON.parse(json);
  return {
    devicePublicKey: base64Decode(dpk),
    ephemeralPublicKey: base64Decode(epk),
    expiry: exp,
    nonce: base64Decode(n),
  };
}

// ---------------------------------------------------------------------------
// Public API — Linking code
// ---------------------------------------------------------------------------

/** Charset for linking codes: uppercase A-Z and digits 0-9. Excludes lowercase
 *  to avoid ambiguous glyphs (0/O, 1/I/l) on small mobile displays. */
const LINKING_CODE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const LINKING_CODE_LENGTH = 8;

/**
 * Generates a random 8-character alphanumeric linking code (uppercase only).
 *
 * The code is displayed to the user on the new device during manual linking
 * (fallback when QR scanning is unavailable).
 *
 * @returns {string} 8-character string from the set [A-Z0-9].
 */
export function generateLinkingCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(LINKING_CODE_LENGTH));
  return Array.from(bytes)
    .map(b => LINKING_CODE_CHARSET[b % LINKING_CODE_CHARSET.length])
    .join('');
}
