/**
 * Lazy-loaded hush-crypto WASM module.
 * Call init() before any other method (e.g. on first encrypt or after login).
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
      const m = await import(/* @vite-ignore */ '/wasm/hush_crypto.js');
      await m.default();
      m.init();
      module = m;
    })();
  }
  return initPromise;
}

/**
 * @returns {Promise<{ publicKey: Uint8Array, privateKey: Uint8Array, registrationId: number }>}
 */
export async function generateIdentity() {
  await init();
  const out = module.generateIdentity();
  return {
    publicKey: new Uint8Array(out.public_key),
    privateKey: new Uint8Array(out.private_key),
    registrationId: out.registration_id,
  };
}

/**
 * @param {Uint8Array} identityPublic
 * @param {Uint8Array} identityPrivate
 * @param {number} registrationId
 * @param {number} numOneTime
 * @returns {Promise<object>} Bundle for upload (identityKey, signedPreKey, signedPreKeySignature, registrationId, oneTimePreKeys)
 */
export async function generatePreKeyBundle(identityPublic, identityPrivate, registrationId, numOneTime) {
  await init();
  return module.generatePreKeyBundle(identityPublic, identityPrivate, registrationId, numOneTime);
}

/**
 * @param {string} remoteBundleJson - JSON from GET /api/keys/:userId/:deviceId
 * @param {Uint8Array} identityPrivate
 * @returns {Promise<Uint8Array>} Session state bytes for persistence
 */
export async function performX3DH(remoteBundleJson, identityPrivate) {
  await init();
  return module.performX3DH(remoteBundleJson, identityPrivate);
}

/**
 * @param {Uint8Array} stateBytes
 * @param {Uint8Array} plaintext
 * @param {Uint8Array} associatedData
 * @returns {Promise<{ ciphertext: Uint8Array, updatedState: Uint8Array }>}
 */
export async function encrypt(stateBytes, plaintext, associatedData) {
  await init();
  const out = module.encrypt(stateBytes, plaintext, associatedData ?? new Uint8Array(0));
  return {
    ciphertext: new Uint8Array(out.ciphertext),
    updatedState: new Uint8Array(out.updated_state),
  };
}

/**
 * @param {Uint8Array} stateBytes
 * @param {Uint8Array} ciphertextWithHeader
 * @param {Uint8Array} associatedData
 * @returns {Promise<{ plaintext: Uint8Array, updatedState: Uint8Array }>}
 */
export async function decrypt(stateBytes, ciphertextWithHeader, associatedData) {
  await init();
  const out = module.decrypt(stateBytes, ciphertextWithHeader, associatedData ?? new Uint8Array(0));
  return {
    plaintext: new Uint8Array(out.plaintext),
    updatedState: new Uint8Array(out.updated_state),
  };
}
