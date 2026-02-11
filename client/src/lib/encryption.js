/**
 * E2E Encryption for Hush
 *
 * Uses WebRTC Encoded Transform API to encrypt/decrypt media frames
 * before they reach the SFU. The server only sees encrypted blobs.
 *
 * Key derivation: A random key fragment is embedded in the room URL
 * hash (#fragment). This fragment never reaches the server. The actual
 * AES-256-GCM key is derived via HKDF using the fragment + room name.
 *
 * Browser support:
 * - Chrome 118+: RTCRtpScriptTransform (Worker-based)
 * - Chrome 86-117, Edge 86+, Brave: createEncodedStreams (legacy)
 * - Firefox: Partial (behind flag)
 * - Safari: No support
 *
 * Fallback: DTLS/SRTP transport encryption (server can read media).
 */

const ENCRYPTION_ALGO = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

// Unencrypted header bytes so the SFU can still route packets
const UNENCRYPTED_BYTES = {
  video: 10, // VP8 header
  audio: 1,  // Opus TOC header
};

// ─── Browser Support ─────────────────────────────────

export function isE2ESupported() {
  return (
    typeof RTCRtpSender !== 'undefined' &&
    typeof RTCRtpSender.prototype.createEncodedStreams === 'function'
  ) || (
    typeof RTCRtpScriptTransform !== 'undefined'
  );
}

export function hasScriptTransform() {
  return typeof RTCRtpScriptTransform !== 'undefined';
}

// ─── Base64URL Encoding ──────────────────────────────

function toBase64Url(bytes) {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function fromBase64Url(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = base64.length % 4;
  const padded = remainder ? base64 + '='.repeat(4 - remainder) : base64;
  const binary = atob(padded);
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

// ─── Key Generation & Derivation ─────────────────────

/**
 * Generate a random key fragment for the URL hash.
 * Returns a 43-character base64url string (32 bytes of entropy).
 */
export function generateKeyFragment() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64Url(bytes);
}

/**
 * Derive an AES-256-GCM key from a URL hash fragment and room name.
 * Uses HKDF for domain separation — same fragment in different rooms
 * produces different keys. Returns raw key bytes (Uint8Array, 32 bytes).
 */
export async function deriveKeyFromFragment(fragment, roomName) {
  const rawBytes = fromBase64Url(fragment);
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw', rawBytes, 'HKDF', false, ['deriveKey']
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(roomName),
      info: encoder.encode('hush-e2e-v1'),
    },
    keyMaterial,
    { name: ENCRYPTION_ALGO, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );

  const exported = await crypto.subtle.exportKey('raw', derivedKey);
  return new Uint8Array(exported);
}

// ─── Worker Management ───────────────────────────────

let e2eWorker = null;

function getE2EWorker() {
  if (!e2eWorker) {
    e2eWorker = new Worker(
      new URL('./e2eWorker.js', import.meta.url),
      { type: 'module' }
    );
  }
  return e2eWorker;
}

export function terminateE2EWorker() {
  if (e2eWorker) {
    e2eWorker.terminate();
    e2eWorker = null;
  }
}

// ─── Transform Helpers ───────────────────────────────

async function importCryptoKey(keyBytes, usages) {
  return crypto.subtle.importKey(
    'raw', keyBytes,
    { name: ENCRYPTION_ALGO, length: KEY_LENGTH },
    false, usages
  );
}

// ─── Encryption Transform ────────────────────────────

/**
 * Apply E2E encryption to an RTCRtpSender.
 * Chooses RTCRtpScriptTransform (modern) or createEncodedStreams (legacy).
 */
export async function applyEncryptionTransform(sender, keyBytes, kind) {
  if (!sender || !keyBytes) return;

  if (typeof RTCRtpScriptTransform !== 'undefined') {
    const worker = getE2EWorker();
    sender.transform = new RTCRtpScriptTransform(worker, {
      operation: 'encrypt',
      kind,
      keyBytes: new Uint8Array(keyBytes),
    });
    console.log(`[e2e] Encryption active for ${kind}`);
    return;
  }

  if (typeof sender.createEncodedStreams === 'function') {
    const key = await importCryptoKey(keyBytes, ['encrypt']);
    const skipBytes = UNENCRYPTED_BYTES[kind] || 0;
    const { readable, writable } = sender.createEncodedStreams();

    readable.pipeThrough(new TransformStream({
      async transform(frame, controller) {
        try {
          const data = new Uint8Array(frame.data);
          const header = data.slice(0, skipBytes);
          const payload = data.slice(skipBytes);
          const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

          const encrypted = await crypto.subtle.encrypt(
            { name: ENCRYPTION_ALGO, iv }, key, payload
          );

          const result = new Uint8Array(
            header.length + IV_LENGTH + encrypted.byteLength
          );
          result.set(header, 0);
          result.set(iv, header.length);
          result.set(new Uint8Array(encrypted), header.length + IV_LENGTH);

          frame.data = result.buffer;
          controller.enqueue(frame);
        } catch (err) {
          console.error('[e2e] Encryption error:', err);
          controller.enqueue(frame);
        }
      },
    })).pipeTo(writable);

    console.log(`[e2e] Encryption active for ${kind}`);
  }
}

// ─── Decryption Transform ────────────────────────────

/**
 * Apply E2E decryption to an RTCRtpReceiver.
 */
export async function applyDecryptionTransform(receiver, keyBytes, kind) {
  if (!receiver || !keyBytes) return;

  if (typeof RTCRtpScriptTransform !== 'undefined') {
    const worker = getE2EWorker();
    receiver.transform = new RTCRtpScriptTransform(worker, {
      operation: 'decrypt',
      kind,
      keyBytes: new Uint8Array(keyBytes),
    });
    console.log(`[e2e] Decryption active for ${kind}`);
    return;
  }

  if (typeof receiver.createEncodedStreams === 'function') {
    const key = await importCryptoKey(keyBytes, ['decrypt']);
    const skipBytes = UNENCRYPTED_BYTES[kind] || 0;
    const { readable, writable } = receiver.createEncodedStreams();

    readable.pipeThrough(new TransformStream({
      async transform(frame, controller) {
        try {
          const data = new Uint8Array(frame.data);
          const header = data.slice(0, skipBytes);
          const iv = data.slice(skipBytes, skipBytes + IV_LENGTH);
          const encrypted = data.slice(skipBytes + IV_LENGTH);

          const decrypted = await crypto.subtle.decrypt(
            { name: ENCRYPTION_ALGO, iv }, key, encrypted
          );

          const result = new Uint8Array(header.length + decrypted.byteLength);
          result.set(header, 0);
          result.set(new Uint8Array(decrypted), header.length);

          frame.data = result.buffer;
          controller.enqueue(frame);
        } catch {
          // Decryption failed — possibly unencrypted frame, pass through
          controller.enqueue(frame);
        }
      },
    })).pipeTo(writable);

    console.log(`[e2e] Decryption active for ${kind}`);
  }
}
