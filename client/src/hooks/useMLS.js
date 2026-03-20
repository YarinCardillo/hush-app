/**
 * MLS session hook — Phase M.2 real encryption.
 *
 * Provides two crypto APIs:
 *
 * 1. Channel-centric (text chat, MLS group):
 *    encryptForChannel(plaintext) -> { ciphertext: Uint8Array }
 *    decryptFromChannel(messageBytes) -> string
 *    getCachedMessage(messageId) -> { content, senderId, timestamp } | null
 *    setCachedMessage(messageId, payload) -> void
 *
 * 2. User-centric (voice E2EE key exchange, legacy passthrough):
 *    encryptForUser(remoteUserId, plaintext) -> { ciphertext: Uint8Array, updatedState: Uint8Array }
 *    decryptFromUser(remoteUserId, remoteDeviceId, ciphertext) -> Uint8Array
 *    These remain as passthrough stubs — voice E2EE key exchange is handled separately
 *    via the LiveKit media layer, not MLS group encryption.
 */

import * as mlsGroupLib from '../lib/mlsGroup';
import * as mlsStoreLib from '../lib/mlsStore';
import * as hushCryptoLib from '../lib/hushCrypto';
import * as apiLib from '../lib/api';

/**
 * @param {object} opts
 * @param {() => Promise<IDBDatabase|null>} opts.getStore - Opens IndexedDB for the current user
 * @param {() => string|null} opts.getToken - Returns the JWT for API calls
 * @param {string} [opts.channelId] - Required for encryptForChannel/decryptFromChannel
 * @param {object} [opts._deps] - Optional dep injection for testing
 * @returns {{
 *   encryptForChannel: Function,
 *   decryptFromChannel: Function,
 *   getCachedMessage: Function,
 *   setCachedMessage: Function,
 *   encryptForUser: Function,
 *   decryptFromUser: Function,
 * }}
 */
export function useMLS({ getStore, getToken, channelId, _deps }) {
  const mlsGroup = _deps?.mlsGroup ?? mlsGroupLib;
  const mlsStore = _deps?.mlsStore ?? mlsStoreLib;
  const hushCrypto = _deps?.hushCrypto ?? hushCryptoLib;
  const api = _deps?.api ?? apiLib;

  // ---------------------------------------------------------------------------
  // Shared deps builder — opens DB and loads credential on each call.
  // Lazy: only called when an MLS operation is actually needed.
  // ---------------------------------------------------------------------------

  /**
   * Builds the deps object required by mlsGroup functions.
   * @returns {Promise<object>}
   */
  async function buildDeps() {
    const db = await getStore();
    const token = getToken();
    if (!db) throw new Error('[useMLS] No IDB store available');
    if (!token) throw new Error('[useMLS] No auth token available');
    const credential = await mlsStore.getCredential(db);
    return { db, token, credential, mlsStore, hushCrypto, api };
  }

  // ---------------------------------------------------------------------------
  // Channel-centric API (MLS group)
  // ---------------------------------------------------------------------------

  /**
   * Encrypt plaintext for the channel MLS group.
   * Returns a single ciphertext Uint8Array — no fan-out.
   *
   * @param {string} plaintext
   * @returns {Promise<{ ciphertext: Uint8Array, localId: string }>}
   */
  async function encryptForChannel(plaintext) {
    if (!channelId) throw new Error('[useMLS] channelId is required for encryptForChannel');
    const deps = await buildDeps();
    const { messageBytes, localId } = await mlsGroup.encryptMessage(deps, channelId, plaintext);
    return { ciphertext: messageBytes, localId };
  }

  /**
   * Decrypt a received MLS message from the channel group.
   * Returns the decrypted plaintext string.
   *
   * @param {Uint8Array} messageBytes
   * @returns {Promise<string>}
   */
  async function decryptFromChannel(messageBytes) {
    if (!channelId) throw new Error('[useMLS] channelId is required for decryptFromChannel');
    const deps = await buildDeps();
    const result = await mlsGroup.decryptMessage(deps, channelId, messageBytes);
    if (result.plaintext == null) {
      throw new Error(`[useMLS] decryptFromChannel: non-application message (type=${result.type})`);
    }
    return result.plaintext;
  }

  /**
   * Retrieve a cached plaintext entry for a self-sent message.
   * @param {string} messageId
   * @returns {Promise<{ content: string, senderId?: string, timestamp: number }|null>}
   */
  async function getCachedMessage(messageId) {
    try {
      const db = await getStore();
      if (!db) return null;
      const row = await mlsStore.getLocalPlaintext(db, messageId);
      if (!row) return null;
      return { content: row.plaintext, timestamp: row.timestamp };
    } catch {
      return null;
    }
  }

  /**
   * Persist a plaintext entry for a self-sent message.
   * @param {string} messageId
   * @param {{ content: string, senderId?: string, timestamp: number }} payload
   * @returns {Promise<void>}
   */
  async function setCachedMessage(messageId, payload) {
    try {
      const db = await getStore();
      if (!db) return;
      await mlsStore.setLocalPlaintext(db, messageId, {
        plaintext: payload.content ?? payload.plaintext ?? '',
        timestamp: payload.timestamp ?? Date.now(),
      });
    } catch {
      // Silent — cache errors must never surface to the user.
    }
  }

  // ---------------------------------------------------------------------------
  // User-centric API (voice E2EE key exchange — passthrough)
  // These remain as passthrough stubs. Voice E2EE key exchange uses the same
  // function signatures but operates on per-user ephemeral key material, not
  // MLS group messages. Migrating voice to MLS is a separate plan.
  // ---------------------------------------------------------------------------

  /**
   * Passthrough encrypt for voice E2EE key exchange.
   * @param {string} _remoteUserId
   * @param {Uint8Array} plaintext
   * @returns {Promise<{ ciphertext: Uint8Array, updatedState: Uint8Array }>}
   */
  async function encryptForUser(_remoteUserId, plaintext) {
    const content = new TextDecoder().decode(plaintext);
    const envelope = JSON.stringify({ plaintext: true, content });
    return {
      ciphertext: new TextEncoder().encode(envelope),
      updatedState: new Uint8Array(0),
    };
  }

  /**
   * Passthrough decrypt for voice E2EE key exchange.
   * @param {string} _remoteUserId
   * @param {string} _remoteDeviceId
   * @param {Uint8Array} ciphertext
   * @returns {Promise<Uint8Array>}
   */
  async function decryptFromUser(_remoteUserId, _remoteDeviceId, ciphertext) {
    const raw = new TextDecoder().decode(ciphertext);
    const parsed = JSON.parse(raw);
    return new TextEncoder().encode(parsed.content);
  }

  return {
    encryptForChannel,
    decryptFromChannel,
    getCachedMessage,
    setCachedMessage,
    encryptForUser,
    decryptFromUser,
  };
}
