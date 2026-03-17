/**
 * MLS session stub hook replacing useSignal.
 *
 * This is a Phase M.1 passthrough: messages are sent as plaintext-wrapped JSON
 * until Phase M.2 implements real MLS group encrypt/decrypt.
 *
 * The function signatures are identical to useSignal so Chat.jsx and other
 * callers require no structural changes.
 *
 * TODO(M.2): Replace passthrough with MLS group encrypt/decrypt.
 */

/**
 * @param {object} opts
 * @param {() => Promise<IDBDatabase|null>} opts.getStore - Unused in M.1; required by M.2
 * @param {() => string|null} opts.getToken - Unused in M.1; required by M.2
 * @returns {{ encryptForUser: Function, decryptFromUser: Function, getCachedMessage: Function, setCachedMessage: Function }}
 */
export function useMLS({ getStore, getToken }) { // eslint-disable-line no-unused-vars
  /**
   * Passthrough "encrypt": wraps plaintext in a JSON envelope so the message
   * wire format is backward-compatible with Phase M.2 real encryption.
   * Returns the same shape as useSignal.encryptForUser.
   *
   * @param {string} _remoteUserId
   * @param {Uint8Array} plaintext
   * @param {string} [_remoteDeviceId]
   * @returns {Promise<{ ciphertext: Uint8Array, updatedState: Uint8Array }>}
   */
  async function encryptForUser(_remoteUserId, plaintext, _remoteDeviceId) {
    // TODO(M.2): Replace passthrough with MLS group encrypt/decrypt
    const content = new TextDecoder().decode(plaintext);
    const envelope = JSON.stringify({ plaintext: true, content });
    return {
      ciphertext: new TextEncoder().encode(envelope),
      updatedState: new Uint8Array(0),
    };
  }

  /**
   * Passthrough "decrypt": parses the JSON envelope and returns the plaintext.
   * Returns the same shape as useSignal.decryptFromUser.
   *
   * @param {string} _remoteUserId
   * @param {string} _remoteDeviceId
   * @param {Uint8Array} ciphertext
   * @returns {Promise<{ plaintext: Uint8Array, updatedState: Uint8Array }>}
   */
  async function decryptFromUser(_remoteUserId, _remoteDeviceId, ciphertext) {
    // TODO(M.2): Replace passthrough with MLS group encrypt/decrypt
    const raw = new TextDecoder().decode(ciphertext);
    const parsed = JSON.parse(raw);
    return {
      plaintext: new TextEncoder().encode(parsed.content),
      updatedState: new Uint8Array(0),
    };
  }

  /**
   * Returns null — no message cache in M.1.
   * M.2 adds MLS group state persistence.
   * @returns {Promise<null>}
   */
  async function getCachedMessage(_msgId) { // eslint-disable-line no-unused-vars
    // TODO(M.2): Replace passthrough with MLS group encrypt/decrypt
    return null;
  }

  /**
   * No-op — no message cache in M.1.
   * @returns {Promise<void>}
   */
  async function setCachedMessage(_msgId, _payload) { // eslint-disable-line no-unused-vars
    // TODO(M.2): Replace passthrough with MLS group encrypt/decrypt
  }

  return { encryptForUser, decryptFromUser, getCachedMessage, setCachedMessage };
}
