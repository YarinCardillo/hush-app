/**
 * Lazy-loaded hush-crypto WASM module.
 * Call init() before any other method (e.g. on first encrypt or after login).
 *
 * All WASM functions return structured JS objects via serde_wasm_bindgen.
 * Vec<u8> fields arrive as Uint8Array; u32 fields as JS numbers.
 *
 * Exports MLS credential and KeyPackage generation.
 * Signal Protocol functions (generateIdentity, generatePreKeyBundle,
 * performX3DH, encrypt, decrypt) have been removed — superseded by MLS (Phase M.2+).
 */

let module = null;
let initPromise = null;

/**
 * Loads the WASM module. Idempotent and safe against concurrent calls.
 * @returns {Promise<void>}
 */
export async function init() {
  if (module) return;
  if (!initPromise) {
    initPromise = (async () => {
      const m = await import('../wasm/hush_crypto.js');
      await m.default();
      m.init();
      module = m;
    })();
  }
  return initPromise;
}

/**
 * Generates an MLS credential (BasicCredential + signing keypair).
 * The credential must be uploaded to /api/mls/credentials (public material only).
 * The signing private key must be stored locally in mlsStore for KeyPackage generation.
 *
 * @param {string} identity - Opaque identity string (format: "${userId}:${deviceId}")
 * @returns {Promise<{ signingPublicKey: Uint8Array, signingPrivateKey: Uint8Array, credentialBytes: Uint8Array }>}
 */
export async function generateCredential(identity) {
  await init();
  const out = module.generateCredential(identity);
  return {
    signingPublicKey: new Uint8Array(out.signingPublicKey),
    signingPrivateKey: new Uint8Array(out.signingPrivateKey),
    credentialBytes: new Uint8Array(out.credentialBytes),
  };
}

/**
 * Generates a single MLS KeyPackage for the given credential.
 * Only keyPackageBytes should be uploaded to the server.
 * privateKeyBytes must be stored locally in mlsStore keyed by hex(hashRefBytes).
 *
 * @param {Uint8Array} signingPrivateKey - From generateCredential (64 bytes: seed||public)
 * @param {Uint8Array} signingPublicKey - From generateCredential
 * @param {Uint8Array} credentialBytes - From generateCredential
 * @returns {Promise<{ keyPackageBytes: Uint8Array, privateKeyBytes: Uint8Array, hashRefBytes: Uint8Array }>}
 */
export async function generateKeyPackage(signingPrivateKey, signingPublicKey, credentialBytes) {
  await init();
  const out = module.generateKeyPackage(signingPrivateKey, signingPublicKey, credentialBytes);
  return {
    keyPackageBytes: new Uint8Array(out.keyPackageBytes),
    privateKeyBytes: new Uint8Array(out.privateKeyBytes),
    hashRefBytes: new Uint8Array(out.hashRefBytes),
  };
}
