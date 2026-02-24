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
 * Generates a pre-key bundle including private keys for local storage.
 * Only PUBLIC keys should be uploaded to the server.
 * @param {Uint8Array} identityPublic
 * @param {Uint8Array} identityPrivate
 * @param {number} registrationId
 * @param {number} numOneTime
 * @returns {Promise<object>}
 */
export async function generatePreKeyBundle(identityPublic, identityPrivate, registrationId, numOneTime) {
  await init();
  return module.generatePreKeyBundle(identityPublic, identityPrivate, registrationId, numOneTime);
}

/**
 * X3DH initiator (Alice). Returns session state + ephemeral public key for the initial message.
 * @param {string} remoteBundleJson - JSON from GET /api/keys/:userId/:deviceId
 * @param {Uint8Array} identityPrivate
 * @returns {Promise<{ stateBytes: Uint8Array, ephemeralPublic: Uint8Array }>}
 */
export async function performX3DH(remoteBundleJson, identityPrivate) {
  await init();
  const result = module.performX3DH(remoteBundleJson, identityPrivate);
  return {
    stateBytes: new Uint8Array(result.state_bytes),
    ephemeralPublic: new Uint8Array(result.ephemeral_public),
  };
}

/**
 * X3DH responder (Bob). Takes Alice's initial message keys and Bob's private keys.
 * @param {Uint8Array} identityPrivate - Bob's identity private key (32 bytes)
 * @param {Uint8Array} spkPrivate - Bob's signed pre-key private (32 bytes)
 * @param {Uint8Array} spkPublic - Bob's signed pre-key public (33 bytes)
 * @param {Uint8Array|null} opkPrivate - Bob's one-time pre-key private (32 bytes, or null)
 * @param {Uint8Array} aliceIdentityPublic - Alice's identity public (33 bytes)
 * @param {Uint8Array} aliceEphemeralPublic - Alice's ephemeral public (33 bytes)
 * @returns {Promise<Uint8Array>} Session state bytes
 */
export async function performX3DHResponder(
  identityPrivate, spkPrivate, spkPublic, opkPrivate,
  aliceIdentityPublic, aliceEphemeralPublic,
) {
  await init();
  const result = module.performX3DHResponder(
    identityPrivate,
    spkPrivate,
    spkPublic,
    opkPrivate ?? new Uint8Array(0),
    aliceIdentityPublic,
    aliceEphemeralPublic,
  );
  return new Uint8Array(result.state_bytes);
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
