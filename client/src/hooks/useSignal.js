/**
 * Signal Protocol session and encrypt/decrypt for the web client.
 * Uses signalStore (IndexedDB) and hushCrypto (WASM).
 *
 * Message envelope format (opaque to server):
 *   PreKey (initial):  [0x01][33: sender_ik][33: sender_ek][4: spk_id LE][4: opk_id LE | 0xFFFFFFFF][DR payload]
 *   Regular:           [0x02][DR payload]
 */

import * as hushCrypto from '../lib/hushCrypto';
import * as api from '../lib/api';
import * as signalStore from '../lib/signalStore';

const DEFAULT_DEVICE_ID = 'default';

const MSG_TYPE_PREKEY = 0x01;
const MSG_TYPE_REGULAR = 0x02;
const IDENTITY_KEY_BYTES = 33;
const KEY_ID_BYTES = 4;
const NO_OPK_SENTINEL = 0xFFFFFFFF;
const PREKEY_HEADER_BYTES = 1 + IDENTITY_KEY_BYTES + IDENTITY_KEY_BYTES + KEY_ID_BYTES + KEY_ID_BYTES; // 75

/**
 * @param {object} opts
 * @param {() => Promise<IDBDatabase|null>} opts.getStore
 * @param {() => string|null} opts.getToken
 * @returns {{ encryptForUser: Function, decryptFromUser: Function }}
 */
export function useSignal({ getStore, getToken }) {
  /**
   * Encrypts plaintext for a remote user. Establishes session via X3DH if needed.
   * @param {string} remoteUserId
   * @param {Uint8Array} plaintext
   * @param {string} [remoteDeviceId]
   * @returns {Promise<Uint8Array>} Envelope bytes (PreKey or Regular)
   */
  async function encryptForUser(remoteUserId, plaintext, remoteDeviceId = DEFAULT_DEVICE_ID) {
    const db = await getStore();
    if (!db) throw new Error('Signal store not open');
    const token = getToken();
    if (!token) throw new Error('Not authenticated');

    const session = await signalStore.getSession(db, remoteUserId, remoteDeviceId);

    if (!session) {
      return encryptInitial(db, token, remoteUserId, remoteDeviceId, plaintext);
    }

    return encryptRegular(db, remoteUserId, remoteDeviceId, session, plaintext);
  }

  /**
   * Decrypts an envelope from a remote user. Handles both PreKey and Regular messages.
   * @param {string} remoteUserId
   * @param {string} remoteDeviceId
   * @param {Uint8Array} envelope
   * @returns {Promise<Uint8Array>}
   */
  async function decryptFromUser(remoteUserId, remoteDeviceId, envelope) {
    const db = await getStore();
    if (!db) throw new Error('Signal store not open');

    if (envelope.length === 0) throw new Error('Empty envelope');
    const msgType = envelope[0];

    if (msgType === MSG_TYPE_PREKEY) {
      return decryptPreKey(db, remoteUserId, remoteDeviceId, envelope);
    }
    if (msgType === MSG_TYPE_REGULAR) {
      return decryptRegular(db, remoteUserId, remoteDeviceId, envelope);
    }

    throw new Error(`Unknown message type: 0x${msgType.toString(16)}`);
  }

  // ---------------------------------------------------------------------------
  // Encrypt helpers
  // ---------------------------------------------------------------------------

  async function encryptInitial(db, token, remoteUserId, remoteDeviceId, plaintext) {
    const bundleJson = await fetchBundle(token, remoteUserId, remoteDeviceId);
    if (!bundleJson) throw new Error(`No pre-key bundle for ${remoteUserId}`);

    const identity = await signalStore.getIdentity(db);
    if (!identity) throw new Error('No local identity');

    // Normalize Go API response (camelCase + base64) → WASM format (snake_case + arrays).
    const bundle = normalizeBundleForWasm(bundleJson);
    const bundleStr = JSON.stringify(bundle);
    const x3dhResult = await hushCrypto.performX3DH(bundleStr, identity.privateKey);

    // AD = Encode(IK_A) || Encode(IK_B) — initiator first, then responder.
    const remoteIk = coerceToUint8Array(bundle.identity_key);
    const ad = buildAssociatedData(identity.publicKey, remoteIk);

    const { ciphertext, updatedState } = await hushCrypto.encrypt(x3dhResult.stateBytes, plaintext, ad);
    await signalStore.setSession(db, remoteUserId, remoteDeviceId, updatedState, ad);

    const spkId = bundle.signed_pre_key_id ?? 1;
    const opkId = bundle.one_time_pre_key_id ?? NO_OPK_SENTINEL;

    return buildPreKeyEnvelope(identity.publicKey, x3dhResult.ephemeralPublic, spkId, opkId, ciphertext);
  }

  async function encryptRegular(db, remoteUserId, remoteDeviceId, session, plaintext) {
    const { ciphertext, updatedState } = await hushCrypto.encrypt(session.state, plaintext, session.ad);
    await signalStore.setSession(db, remoteUserId, remoteDeviceId, updatedState, session.ad);

    const envelope = new Uint8Array(1 + ciphertext.length);
    envelope[0] = MSG_TYPE_REGULAR;
    envelope.set(ciphertext, 1);
    return envelope;
  }

  // ---------------------------------------------------------------------------
  // Decrypt helpers
  // ---------------------------------------------------------------------------

  async function decryptPreKey(db, remoteUserId, remoteDeviceId, envelope) {
    const { senderIk, senderEk, spkId, opkId, drPayload } = parsePreKeyEnvelope(envelope);

    const identity = await signalStore.getIdentity(db);
    if (!identity) throw new Error('No local identity');

    const spk = await signalStore.getSignedPreKey(db, spkId);
    if (!spk) throw new Error(`No signed pre-key for id ${spkId}`);

    let opkPrivate = null;
    if (opkId !== NO_OPK_SENTINEL) {
      const opk = await signalStore.getOneTimePreKey(db, opkId);
      if (!opk) throw new Error(`No one-time pre-key for id ${opkId}`);
      opkPrivate = new Uint8Array(opk.privateKey);
    }

    const stateBytes = await hushCrypto.performX3DHResponder(
      identity.privateKey,
      new Uint8Array(spk.privateKey),
      new Uint8Array(spk.publicKey),
      opkPrivate,
      senderIk,
      senderEk,
    );

    // AD = Encode(IK_A) || Encode(IK_B) — sender (initiator) first, then us (responder).
    const ad = buildAssociatedData(senderIk, identity.publicKey);

    const { plaintext, updatedState } = await hushCrypto.decrypt(stateBytes, drPayload, ad);
    await signalStore.setSession(db, remoteUserId, remoteDeviceId, updatedState, ad);

    // Delete consumed OPK for forward secrecy.
    if (opkId !== NO_OPK_SENTINEL) {
      await signalStore.deleteOneTimePreKey(db, opkId);
    }

    return plaintext;
  }

  async function decryptRegular(db, remoteUserId, remoteDeviceId, envelope) {
    const session = await signalStore.getSession(db, remoteUserId, remoteDeviceId);
    if (!session) throw new Error(`No session for ${remoteUserId}/${remoteDeviceId}`);

    const drPayload = envelope.slice(1);
    const { plaintext, updatedState } = await hushCrypto.decrypt(session.state, drPayload, session.ad);
    await signalStore.setSession(db, remoteUserId, remoteDeviceId, updatedState, session.ad);
    return plaintext;
  }

  // ---------------------------------------------------------------------------
  // Bundle fetch
  // ---------------------------------------------------------------------------

  async function fetchBundle(token, remoteUserId, remoteDeviceId) {
    if (remoteDeviceId === DEFAULT_DEVICE_ID) {
      const bundles = await api.getPreKeyBundle(token, remoteUserId);
      return Array.isArray(bundles) ? bundles[0] : bundles;
    }
    return api.getPreKeyBundleByDevice(token, remoteUserId, remoteDeviceId);
  }

  return { encryptForUser, decryptFromUser };
}

// ---------------------------------------------------------------------------
// Envelope construction / parsing (pure functions)
// ---------------------------------------------------------------------------

/**
 * Builds AD = Encode(IK_A) || Encode(IK_B), where both are 33-byte 0x05-prefixed keys.
 * @param {Uint8Array} initiatorIk - Initiator's identity public key (33 bytes)
 * @param {Uint8Array} responderIk - Responder's identity public key (33 bytes)
 * @returns {Uint8Array} 66-byte associated data
 */
function buildAssociatedData(initiatorIk, responderIk) {
  const ad = new Uint8Array(IDENTITY_KEY_BYTES * 2);
  ad.set(initiatorIk, 0);
  ad.set(responderIk, IDENTITY_KEY_BYTES);
  return ad;
}

/**
 * @param {Uint8Array} senderIk
 * @param {Uint8Array} senderEk
 * @param {number} spkId
 * @param {number} opkId
 * @param {Uint8Array} drPayload - Double Ratchet header + ciphertext
 * @returns {Uint8Array}
 */
function buildPreKeyEnvelope(senderIk, senderEk, spkId, opkId, drPayload) {
  const buf = new Uint8Array(PREKEY_HEADER_BYTES + drPayload.length);
  let offset = 0;
  buf[offset++] = MSG_TYPE_PREKEY;
  buf.set(senderIk, offset); offset += IDENTITY_KEY_BYTES;
  buf.set(senderEk, offset); offset += IDENTITY_KEY_BYTES;
  new DataView(buf.buffer).setUint32(offset, spkId, true); offset += KEY_ID_BYTES;
  new DataView(buf.buffer).setUint32(offset, opkId, true); offset += KEY_ID_BYTES;
  buf.set(drPayload, offset);
  return buf;
}

/**
 * @param {Uint8Array} envelope
 * @returns {{ senderIk: Uint8Array, senderEk: Uint8Array, spkId: number, opkId: number, drPayload: Uint8Array }}
 */
function parsePreKeyEnvelope(envelope) {
  if (envelope.length < PREKEY_HEADER_BYTES) {
    throw new Error(`PreKey envelope too short: ${envelope.length} < ${PREKEY_HEADER_BYTES}`);
  }
  let offset = 1;
  const senderIk = envelope.slice(offset, offset + IDENTITY_KEY_BYTES); offset += IDENTITY_KEY_BYTES;
  const senderEk = envelope.slice(offset, offset + IDENTITY_KEY_BYTES); offset += IDENTITY_KEY_BYTES;
  const dv = new DataView(envelope.buffer, envelope.byteOffset);
  const spkId = dv.getUint32(offset, true); offset += KEY_ID_BYTES;
  const opkId = dv.getUint32(offset, true); offset += KEY_ID_BYTES;
  const drPayload = envelope.slice(offset);
  return { senderIk, senderEk, spkId, opkId, drPayload };
}

/**
 * Normalizes a Go API pre-key bundle for WASM consumption:
 * 1. Renames camelCase keys to snake_case (compiled WASM expects snake_case)
 * 2. Decodes base64 string values to numeric arrays (Go []byte → Rust Vec<u8>)
 * @param {object} bundle - Pre-key bundle from the Go API (camelCase, base64 bytes)
 * @returns {object} Bundle with snake_case keys and numeric array values
 */
function normalizeBundleForWasm(bundle) {
  const keyMap = {
    identityKey: 'identity_key',
    signedPreKey: 'signed_pre_key',
    signedPreKeySignature: 'signed_pre_key_signature',
    registrationId: 'registration_id',
    oneTimePreKeyId: 'one_time_pre_key_id',
    oneTimePreKey: 'one_time_pre_key',
  };
  const byteFields = new Set([
    'identity_key', 'signed_pre_key', 'signed_pre_key_signature', 'one_time_pre_key',
  ]);
  const result = {};
  for (const [key, value] of Object.entries(bundle)) {
    const snakeKey = keyMap[key] ?? key;
    if (byteFields.has(snakeKey) && typeof value === 'string') {
      const binary = atob(value);
      result[snakeKey] = Array.from(binary, (c) => c.charCodeAt(0));
    } else {
      result[snakeKey] = value;
    }
  }
  return result;
}

/**
 * Coerces a value (Array, Uint8Array, or ArrayLike) to Uint8Array.
 * @param {unknown} v
 * @returns {Uint8Array}
 */
function coerceToUint8Array(v) {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return new Uint8Array(v);
  return new Uint8Array(v);
}
