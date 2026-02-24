/**
 * Signal Protocol session and encrypt/decrypt for the web client.
 * Uses signalStore (IndexedDB) and hushCrypto (WASM).
 * Requires getStore() (openStore(userId, deviceId)) and getToken() from auth.
 */

import * as hushCrypto from '../lib/hushCrypto';
import * as api from '../lib/api';
import * as signalStore from '../lib/signalStore';

const DEFAULT_DEVICE_ID = 'default';

/**
 * @param {object} opts
 * @param {() => Promise<IDBDatabase|null>} opts.getStore - Returns open Signal store (openStore(userId, deviceId))
 * @param {() => string|null} opts.getToken - Returns current JWT or null
 * @returns {{ encryptForUser: (remoteUserId: string, plaintext: Uint8Array) => Promise<Uint8Array>, decryptFromUser: (remoteUserId: string, remoteDeviceId: string, ciphertext: Uint8Array) => Promise<Uint8Array> }}
 */
export function useSignal({ getStore, getToken }) {
  /**
   * Encrypts plaintext for a remote user. Establishes session via X3DH if needed.
   * @param {string} remoteUserId - Target user UUID
   * @param {Uint8Array} plaintext
   * @param {string} [remoteDeviceId] - Optional; defaults to DEFAULT_DEVICE_ID
   * @returns {Promise<Uint8Array>} Ciphertext (header + body)
   */
  async function encryptForUser(remoteUserId, plaintext, remoteDeviceId = DEFAULT_DEVICE_ID) {
    const db = await getStore();
    if (!db) throw new Error('Signal store not open');
    const token = getToken();
    if (!token) throw new Error('Not authenticated');

    let stateBytes = await signalStore.getSession(db, remoteUserId, remoteDeviceId);
    if (!stateBytes || stateBytes.length === 0) {
      let bundleJson;
      if (remoteDeviceId === DEFAULT_DEVICE_ID) {
        const bundles = await api.getPreKeyBundle(token, remoteUserId);
        bundleJson = Array.isArray(bundles) ? bundles[0] : bundles;
      } else {
        bundleJson = await api.getPreKeyBundleByDevice(token, remoteUserId, remoteDeviceId);
      }
      if (!bundleJson) throw new Error(`No pre-key bundle for ${remoteUserId}`);
      const identity = await signalStore.getIdentity(db);
      if (!identity) throw new Error('No local identity');
      const state = await hushCrypto.performX3DH(JSON.stringify(bundleJson), identity.privateKey);
      stateBytes = state;
      await signalStore.setSession(db, remoteUserId, remoteDeviceId, stateBytes);
    }

    const ad = new Uint8Array(0);
    const { ciphertext, updatedState } = await hushCrypto.encrypt(stateBytes, plaintext, ad);
    await signalStore.setSession(db, remoteUserId, remoteDeviceId, updatedState);
    return ciphertext;
  }

  /**
   * Decrypts ciphertext from a remote user+device.
   * @param {string} remoteUserId
   * @param {string} remoteDeviceId
   * @param {Uint8Array} ciphertextWithHeader
   * @returns {Promise<Uint8Array>}
   */
  async function decryptFromUser(remoteUserId, remoteDeviceId, ciphertextWithHeader) {
    const db = await getStore();
    if (!db) throw new Error('Signal store not open');
    let stateBytes = await signalStore.getSession(db, remoteUserId, remoteDeviceId);
    if (!stateBytes || stateBytes.length === 0) throw new Error(`No session for ${remoteUserId}/${remoteDeviceId}`);
    const ad = new Uint8Array(0);
    const { plaintext, updatedState } = await hushCrypto.decrypt(stateBytes, ciphertextWithHeader, ad);
    await signalStore.setSession(db, remoteUserId, remoteDeviceId, updatedState);
    return plaintext;
  }

  return { encryptForUser, decryptFromUser };
}
