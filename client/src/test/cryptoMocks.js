/**
 * Mock for hush-crypto WASM API. Used in Vitest to avoid loading real WASM.
 * Replace with real module in tests that need full E2EE (e2e or integration).
 *
 * API surface matches the planned hush-crypto WASM bindings (B.2/B.3).
 */

export const mockHushCrypto = {
  async init() {},
  async generateIdentity() {
    return {
      publicKey: new Uint8Array(32),
      privateKey: new Uint8Array(32),
      registrationId: 12345,
    };
  },
  async generatePreKeyBundle(_identityPublic, _identityPrivate, _registrationId, _numOneTime) {
    return {
      identity_key: new Uint8Array(32),
      signed_pre_key: new Uint8Array(32),
      signed_pre_key_signature: new Uint8Array(64),
      registration_id: 12345,
      one_time_pre_keys: [],
    };
  },
  async performX3DH(_remoteBundle, _myIdentity) {
    return new Uint8Array(0);
  },
  async encrypt(_stateBytes, _plaintext, _associatedData) {
    return { ciphertext: new Uint8Array(0), updatedState: new Uint8Array(0) };
  },
  async decrypt(_stateBytes, _ciphertextWithHeader, _associatedData) {
    return { plaintext: new Uint8Array(0), updatedState: new Uint8Array(0) };
  },
};
