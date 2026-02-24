/**
 * Mock for hush-crypto WASM API. Used in Vitest to avoid loading real WASM.
 * Replace with real module in tests that need full E2EE (e2e or integration).
 *
 * API surface matches the hush-crypto WASM bindings (B.2/B.3).
 */

const MOCK_PUBLIC_KEY_33 = new Uint8Array(33);
MOCK_PUBLIC_KEY_33[0] = 0x05;

const MOCK_PRIVATE_KEY_32 = new Uint8Array(32);
const MOCK_SIGNATURE_96 = new Uint8Array(96);
const MOCK_STATE_BYTES = new Uint8Array(64);

export const mockHushCrypto = {
  async init() {},

  async generateIdentity() {
    return {
      publicKey: new Uint8Array(MOCK_PUBLIC_KEY_33),
      privateKey: new Uint8Array(MOCK_PRIVATE_KEY_32),
      registrationId: 12345,
    };
  },

  async generatePreKeyBundle(_identityPublic, _identityPrivate, _registrationId, numOneTime) {
    const otpks = [];
    for (let i = 0; i < (numOneTime ?? 0); i++) {
      otpks.push({
        key_id: i,
        public_key: new Uint8Array(MOCK_PUBLIC_KEY_33),
        private_key: new Uint8Array(MOCK_PRIVATE_KEY_32),
      });
    }
    return {
      identity_key: new Uint8Array(MOCK_PUBLIC_KEY_33),
      signed_pre_key: new Uint8Array(MOCK_PUBLIC_KEY_33),
      signed_pre_key_signature: new Uint8Array(MOCK_SIGNATURE_96),
      signed_pre_key_private: new Uint8Array(MOCK_PRIVATE_KEY_32),
      registration_id: 12345,
      one_time_pre_keys: otpks,
    };
  },

  async performX3DH(_remoteBundle, _myIdentity) {
    return {
      stateBytes: new Uint8Array(MOCK_STATE_BYTES),
      ephemeralPublic: new Uint8Array(MOCK_PUBLIC_KEY_33),
    };
  },

  async performX3DHResponder(_idPriv, _spkPriv, _spkPub, _opkPriv, _aliceIk, _aliceEk) {
    return new Uint8Array(MOCK_STATE_BYTES);
  },

  async encrypt(_stateBytes, plaintext, _ad) {
    return {
      ciphertext: new Uint8Array(plaintext),
      updatedState: new Uint8Array(MOCK_STATE_BYTES),
    };
  },

  async decrypt(_stateBytes, ciphertext, _ad) {
    return {
      plaintext: new Uint8Array(ciphertext),
      updatedState: new Uint8Array(MOCK_STATE_BYTES),
    };
  },
};
