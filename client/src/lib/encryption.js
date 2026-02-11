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

const ENCRYPTION_ALGO = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

// Unencrypted header bytes so the SFU can still route packets
const UNENCRYPTED_BYTES = {
  video: 10, // VP8 header
  audio: 1, // Opus TOC header
};

// ─── Browser Support ─────────────────────────────────

export function isE2ESupported() {
  return (
    (typeof RTCRtpSender !== "undefined" &&
      typeof RTCRtpSender.prototype.createEncodedStreams === "function") ||
    typeof RTCRtpScriptTransform !== "undefined"
  );
}

export function hasScriptTransform() {
  return typeof RTCRtpScriptTransform !== "undefined";
}

// ─── Base64URL Encoding ──────────────────────────────

function toBase64Url(bytes) {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromBase64Url(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = base64.length % 4;
  const padded = remainder ? base64 + "=".repeat(4 - remainder) : base64;
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
    "raw",
    rawBytes,
    "HKDF",
    false,
    ["deriveKey"],
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(roomName),
      info: encoder.encode("hush-e2e-v1"),
    },
    keyMaterial,
    { name: ENCRYPTION_ALGO, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );

  const exported = await crypto.subtle.exportKey("raw", derivedKey);
  return new Uint8Array(exported);
}

// ─── Worker Management ───────────────────────────────

let e2eWorker = null;

function getE2EWorker() {
  if (!e2eWorker) {
    e2eWorker = new Worker(new URL("./e2eWorker.js", import.meta.url), {
      type: "module",
    });
  }
  return e2eWorker;
}

export function terminateE2EWorker() {
  if (e2eWorker) {
    e2eWorker.terminate();
    e2eWorker = null;
  }
}

// ─── Performance Monitoring ──────────────────────────

/**
 * Get frame drop statistics from an RTCRtpSender.
 * Returns { framesDropped, totalFrames, dropRate }.
 */
export async function getSenderStats(sender) {
  if (!sender) return { framesDropped: 0, totalFrames: 0, dropRate: 0 };

  try {
    const stats = await sender.getStats();
    let framesDropped = 0;
    let totalFrames = 0;

    for (const [, report] of stats) {
      if (report.type === "outbound-rtp" && report.kind === "video") {
        framesDropped = report.framesDropped || 0;
        totalFrames = (report.framesSent || 0) + framesDropped;
        break;
      }
    }

    const dropRate = totalFrames > 0 ? framesDropped / totalFrames : 0;
    return { framesDropped, totalFrames, dropRate };
  } catch (err) {
    console.error("[e2e] Failed to get sender stats:", err);
    return { framesDropped: 0, totalFrames: 0, dropRate: 0 };
  }
}

/**
 * Monitor frame drop rate and invoke callback when threshold is exceeded.
 * Returns cleanup function to stop monitoring.
 */
export function monitorFrameDrops(sender, options = {}) {
  const {
    threshold = 0.05, // 5% drop rate triggers callback
    intervalMs = 5000, // Check every 5 seconds
    onHighDropRate = () => {},
  } = options;

  let lastFramesDropped = 0;
  let consecutiveHighDrops = 0;

  const intervalId = setInterval(async () => {
    const { framesDropped, totalFrames, dropRate } =
      await getSenderStats(sender);

    // Calculate drop rate since last check
    const newDrops = framesDropped - lastFramesDropped;
    lastFramesDropped = framesDropped;

    if (dropRate > threshold && newDrops > 0) {
      consecutiveHighDrops++;
      if (consecutiveHighDrops >= 2) {
        // Two consecutive high drop periods = real issue
        console.warn(
          `[e2e] High frame drop rate detected: ${(dropRate * 100).toFixed(1)}% (${framesDropped}/${totalFrames})`,
        );
        onHighDropRate({ dropRate, framesDropped, totalFrames });
      }
    } else {
      consecutiveHighDrops = 0;
    }
  }, intervalMs);

  return () => clearInterval(intervalId);
}

// ─── Transform Helpers ───────────────────────────────

export async function importCryptoKey(keyBytes, usages) {
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: ENCRYPTION_ALGO, length: KEY_LENGTH },
    false,
    usages,
  );
}

// ─── Encryption Transform ────────────────────────────

/**
 * Apply E2E encryption to an RTCRtpSender.
 * Chooses RTCRtpScriptTransform (modern) or createEncodedStreams (legacy).
 *
 * @param {RTCRtpSender} sender - The sender to apply encryption to
 * @param {Uint8Array} keyBytes - The encryption key bytes
 * @param {string} kind - 'audio' or 'video'
 * @param {CryptoKey} preImportedKey - Optional pre-imported crypto key (for race condition fix)
 */
export async function applyEncryptionTransform(
  sender,
  keyBytes,
  kind,
  preImportedKey = null,
) {
  if (!sender || !keyBytes) return;

  if (typeof RTCRtpScriptTransform !== "undefined") {
    const worker = getE2EWorker();
    sender.transform = new RTCRtpScriptTransform(worker, {
      operation: "encrypt",
      kind,
      keyBytes: new Uint8Array(keyBytes),
    });
    console.log(`[e2e] Encryption active for ${kind}`);

    // Verify transform is still set after a delay
    setTimeout(() => {
      if (sender.transform) {
        console.log(`[e2e] Transform still active for ${kind}`);
      } else {
        console.error(`[e2e] Transform was cleared for ${kind}!`);
      }
    }, 1000);

    return;
  }

  if (typeof sender.createEncodedStreams === "function") {
    const key =
      preImportedKey || (await importCryptoKey(keyBytes, ["encrypt"]));
    const skipBytes = UNENCRYPTED_BYTES[kind] || 0;
    const { readable, writable } = sender.createEncodedStreams();

    readable
      .pipeThrough(
        new TransformStream({
          async transform(frame, controller) {
            try {
              const data = new Uint8Array(frame.data);
              const header = data.slice(0, skipBytes);
              const payload = data.slice(skipBytes);
              const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

              const encrypted = await crypto.subtle.encrypt(
                { name: ENCRYPTION_ALGO, iv },
                key,
                payload,
              );

              const result = new Uint8Array(
                header.length + IV_LENGTH + encrypted.byteLength,
              );
              result.set(header, 0);
              result.set(iv, header.length);
              result.set(new Uint8Array(encrypted), header.length + IV_LENGTH);

              frame.data = result.buffer;
              controller.enqueue(frame);
            } catch (err) {
              console.error("[e2e] Encryption error:", err);
              controller.enqueue(frame);
            }
          },
        }),
      )
      .pipeTo(writable);

    console.log(`[e2e] Encryption active for ${kind}`);
  }
}

// ─── Decryption Transform ────────────────────────────

/**
 * Apply E2E decryption to an RTCRtpReceiver.
 *
 * @param {RTCRtpReceiver} receiver - The receiver to apply decryption to
 * @param {Uint8Array} keyBytes - The decryption key bytes
 * @param {string} kind - 'audio' or 'video'
 * @param {CryptoKey} preImportedKey - Optional pre-imported crypto key (for race condition fix)
 */
export async function applyDecryptionTransform(
  receiver,
  keyBytes,
  kind,
  preImportedKey = null,
) {
  if (!receiver || !keyBytes) return;

  if (typeof RTCRtpScriptTransform !== "undefined") {
    const worker = getE2EWorker();
    receiver.transform = new RTCRtpScriptTransform(worker, {
      operation: "decrypt",
      kind,
      keyBytes: new Uint8Array(keyBytes),
    });
    console.log(`[e2e] Decryption active for ${kind}`);
    return;
  }

  if (typeof receiver.createEncodedStreams === "function") {
    const key =
      preImportedKey || (await importCryptoKey(keyBytes, ["decrypt"]));
    const skipBytes = UNENCRYPTED_BYTES[kind] || 0;
    const { readable, writable } = receiver.createEncodedStreams();

    readable
      .pipeThrough(
        new TransformStream({
          async transform(frame, controller) {
            try {
              const data = new Uint8Array(frame.data);
              const header = data.slice(0, skipBytes);
              const iv = data.slice(skipBytes, skipBytes + IV_LENGTH);
              const encrypted = data.slice(skipBytes + IV_LENGTH);

              const decrypted = await crypto.subtle.decrypt(
                { name: ENCRYPTION_ALGO, iv },
                key,
                encrypted,
              );

              const result = new Uint8Array(
                header.length + decrypted.byteLength,
              );
              result.set(header, 0);
              result.set(new Uint8Array(decrypted), header.length);

              frame.data = result.buffer;
              controller.enqueue(frame);
            } catch {
              // Decryption failed — possibly unencrypted frame, pass through
              controller.enqueue(frame);
            }
          },
        }),
      )
      .pipeTo(writable);

    console.log(`[e2e] Decryption active for ${kind}`);
  }
}
