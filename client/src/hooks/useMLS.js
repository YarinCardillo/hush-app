/**
 * MLS session hook — Phase M.3 channel-centric API only.
 *
 * Provides the channel-centric crypto API (MLS group):
 *    encryptForChannel(plaintext) -> { ciphertext: Uint8Array, localId: string }
 *    decryptFromChannel(messageBytes) -> string
 *    getCachedMessage(messageId) -> { content, senderId, timestamp } | null
 *    setCachedMessage(messageId, payload) -> void
 *
 * User-centric passthrough stubs (encryptForUser, decryptFromUser) have been removed.
 * Voice E2EE uses MLS voice groups — see mlsGroup.js (createVoiceGroup, joinVoiceGroup,
 * exportVoiceFrameKey, performVoiceSelfUpdate, destroyVoiceGroup).
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
  // Guild metadata key export
  // ---------------------------------------------------------------------------

  /**
   * Export the AES-256 metadata key for a guild from its MLS metadata group.
   * Returns null if the credential or group state is not yet available.
   *
   * @param {string} guildId
   * @returns {Promise<Uint8Array|null>}
   */
  async function getGuildMetadataKey(guildId) {
    try {
      const deps = await buildDeps();
      return await mlsGroup.exportGuildMetadataKey(deps, guildId);
    } catch {
      // Group state not yet available — caller falls back to showing UUID
      return null;
    }
  }

  return {
    encryptForChannel,
    decryptFromChannel,
    getCachedMessage,
    setCachedMessage,
    getGuildMetadataKey,
  };
}
