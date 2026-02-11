/**
 * E2E Encryption Worker for Hush
 *
 * Handles RTCRtpScriptTransform events for AES-256-GCM
 * frame encryption/decryption in a dedicated Worker thread.
 *
 * Frame format: [unencrypted header][12-byte IV][AES-GCM ciphertext]
 * - Video: 10-byte VP8 header kept in clear for SFU routing
 * - Audio: 1-byte Opus TOC header kept in clear for SFU routing
 */

const ENCRYPTION_ALGO = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

const UNENCRYPTED_BYTES = {
  video: 10,
  audio: 1,
};

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
      } catch {
        controller.enqueue(frame);
      }
    },
  });
}

function createDecryptPipeline(key, skipBytes) {
  return new TransformStream({
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
  });
}

// Each RTCRtpScriptTransform triggers a separate rtctransform event
// with its own readable/writable pair and options (operation, kind, keyBytes).
self.onrtctransform = async (event) => {
  const { readable, writable } = event.transformer;
  const { operation, kind, keyBytes } = event.transformer.options;

  const skipBytes = UNENCRYPTED_BYTES[kind] || 0;
  const isEncrypt = operation === 'encrypt';
  const key = await importKey(keyBytes, [isEncrypt ? 'encrypt' : 'decrypt']);

  const pipeline = isEncrypt
    ? createEncryptPipeline(key, skipBytes)
    : createDecryptPipeline(key, skipBytes);

  readable.pipeThrough(pipeline).pipeTo(writable);
};
