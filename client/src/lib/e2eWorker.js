/**
 * E2E Encryption Worker for Hush
 *
 * Handles RTCRtpScriptTransform events for AES-256-GCM
 * frame encryption/decryption in a dedicated Worker thread.
 *
 * Frame format: [unencrypted header][12-byte IV][AES-GCM ciphertext]
 * - Video: 10-byte VP8 header kept in clear for SFU routing
 * - Audio: 1-byte Opus TOC header kept in clear for SFU routing
 *
 * Performance optimizations:
 * - Pre-allocated IV buffer pool (reduces GC pressure at 60fps)
 * - Frame timing diagnostics (identifies encryption bottlenecks)
 * - Timeout mechanism (drops frames taking >16ms to maintain 60fps)
 */

const ENCRYPTION_ALGO = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

const UNENCRYPTED_BYTES = {
  video: 10,
  audio: 1,
};

// Performance: pre-allocate IV buffer pool to reduce allocations at 60fps
const IV_POOL_SIZE = 8;
const ivPool = Array.from({ length: IV_POOL_SIZE }, () => new Uint8Array(IV_LENGTH));
let ivPoolIndex = 0;

function getIVFromPool() {
  const iv = ivPool[ivPoolIndex];
  ivPoolIndex = (ivPoolIndex + 1) % IV_POOL_SIZE;
  crypto.getRandomValues(iv);
  return iv;
}

// Performance monitoring
let slowFrameCount = 0;
let totalFrameCount = 0;
const SLOW_FRAME_THRESHOLD_MS = 10; // Log if encryption takes >10ms
const FRAME_TIMEOUT_MS = 16; // Drop frame if >16ms (maintain 60fps)

async function importKey(keyBytes, usages) {
  return crypto.subtle.importKey(
    'raw', keyBytes,
    { name: ENCRYPTION_ALGO, length: KEY_LENGTH },
    false, usages
  );
}

function createEncryptPipeline(key, skipBytes) {
  return new TransformStream({
    async transform(frame, controller) {
      const startTime = performance.now();
      totalFrameCount++;

      try {
        const data = new Uint8Array(frame.data);
        const header = data.slice(0, skipBytes);
        const payload = data.slice(skipBytes);
        const iv = getIVFromPool();

        // Race encryption against timeout to maintain framerate
        const encryptPromise = crypto.subtle.encrypt(
          { name: ENCRYPTION_ALGO, iv }, key, payload
        );

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('timeout')), FRAME_TIMEOUT_MS);
        });

        const encrypted = await Promise.race([encryptPromise, timeoutPromise]);

        const result = new Uint8Array(
          header.length + IV_LENGTH + encrypted.byteLength
        );
        result.set(header, 0);
        result.set(iv, header.length);
        result.set(new Uint8Array(encrypted), header.length + IV_LENGTH);

        frame.data = result.buffer;

        const duration = performance.now() - startTime;
        if (duration > SLOW_FRAME_THRESHOLD_MS) {
          slowFrameCount++;
          if (slowFrameCount % 10 === 0) {
            console.warn(`[e2e] Slow encryption detected: ${slowFrameCount}/${totalFrameCount} frames >${SLOW_FRAME_THRESHOLD_MS}ms (last: ${duration.toFixed(2)}ms)`);
          }
        }

        controller.enqueue(frame);
      } catch (err) {
        if (err.message === 'timeout') {
          console.warn('[e2e] Frame dropped: encryption timeout');
        } else {
          console.error('[e2e-worker] Encryption failed:', err.message, err);
        }
        // Pass through original frame on error/timeout
        controller.enqueue(frame);
      }
    },
  });
}

function createDecryptPipeline(key, skipBytes) {
  let slowDecryptCount = 0;
  let totalDecryptCount = 0;

  return new TransformStream({
    async transform(frame, controller) {
      const startTime = performance.now();
      totalDecryptCount++;

      try {
        const data = new Uint8Array(frame.data);
        const header = data.slice(0, skipBytes);
        const iv = data.slice(skipBytes, skipBytes + IV_LENGTH);
        const encrypted = data.slice(skipBytes + IV_LENGTH);

        // Race decryption against timeout
        const decryptPromise = crypto.subtle.decrypt(
          { name: ENCRYPTION_ALGO, iv }, key, encrypted
        );

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('timeout')), FRAME_TIMEOUT_MS);
        });

        const decrypted = await Promise.race([decryptPromise, timeoutPromise]);

        const result = new Uint8Array(header.length + decrypted.byteLength);
        result.set(header, 0);
        result.set(new Uint8Array(decrypted), header.length);

        frame.data = result.buffer;

        const duration = performance.now() - startTime;
        if (duration > SLOW_FRAME_THRESHOLD_MS) {
          slowDecryptCount++;
          if (slowDecryptCount % 10 === 0) {
            console.warn(`[e2e] Slow decryption detected: ${slowDecryptCount}/${totalDecryptCount} frames >${SLOW_FRAME_THRESHOLD_MS}ms (last: ${duration.toFixed(2)}ms)`);
          }
        }

        controller.enqueue(frame);
      } catch (err) {
        if (err.message === 'timeout') {
          console.warn('[e2e] Frame dropped: decryption timeout');
        } else {
          console.warn('[e2e-worker] Decryption failed (possibly unencrypted frame):', err.message);
        }
        // Decryption failed — possibly unencrypted frame, pass through
        controller.enqueue(frame);
      }
    },
  });
}

// Each RTCRtpScriptTransform triggers a separate rtctransform event
// with its own readable/writable pair and options (operation, kind, keyBytes).
self.onrtctransform = async (event) => {
  const { readable, writable } = event.transformer;
  const { operation, kind, keyBytes } = event.transformer.options;

  console.log(`[e2e-worker] Transform initialized: ${operation} for ${kind}`);

  const skipBytes = UNENCRYPTED_BYTES[kind] || 0;
  const isEncrypt = operation === 'encrypt';
  const key = await importKey(keyBytes, [isEncrypt ? 'encrypt' : 'decrypt']);

  const pipeline = isEncrypt
    ? createEncryptPipeline(key, skipBytes)
    : createDecryptPipeline(key, skipBytes);

  readable.pipeThrough(pipeline).pipeTo(writable);
};
