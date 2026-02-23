/**
 * E2EE key generation, distribution, and rotation for LiveKit media.
 * Used by useRoom; creator/leader sends key via Matrix to-device, joiners receive and setKey.
 */

import { ClientEvent } from 'matrix-js-sdk';

export const KEY_EXCHANGE_RETRY_MESSAGE = 'Could not establish secure media channel. Retrying…';
export const KEY_EXCHANGE_FAIL_MESSAGE = 'Secure channel failed. Please rejoin.';

/**
 * Runs an async to-device send with retries and exponential backoff.
 * @param {() => Promise<void>} fn - Async function that performs the send
 * @param {{ maxAttempts?: number, baseDelayMs?: number, onRetry?: (attempt: number) => void }} options
 * @returns {Promise<void>}
 */
export async function retryToDeviceSend(fn, { maxAttempts = 3, baseDelayMs = 1000, onRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        onRetry?.(attempt);
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

/**
 * Returns a 256-bit placeholder key for joiners until real key arrives via to-device.
 * @returns {Uint8Array}
 */
export function getPlaceholderKey() {
  return new Uint8Array(32);
}

/**
 * Subscribes to Matrix to-device events for E2EE key delivery. Returns unsubscribe function.
 * @param {import('matrix-js-sdk').MatrixClient} matrixClient
 * @param {{ matrixRoomIdRef: import('react').MutableRefObject<string|null>, e2eeKeyProviderRef: import('react').MutableRefObject<import('livekit-client').ExternalE2EEKeyProvider|null>, keyBytesRef: import('react').MutableRefObject<Uint8Array|null>, currentKeyIndexRef: import('react').MutableRefObject<number> }} refs
 * @param {(key: Uint8Array|null) => void} setE2eeKey
 * @param {(fn: () => void) => void} setToDeviceUnsubscribe
 */
export function setupToDeviceListener(matrixClient, refs, setE2eeKey, setToDeviceUnsubscribe) {
  const handleToDeviceE2EEKey = async (event) => {
    if (event.getType() !== 'io.hush.e2ee_key') return;
    const content = event.getContent();
    const roomId = content?.roomId;
    const keyB64 = content?.key;
    const keyIndex = content?.keyIndex ?? 0;
    if (!roomId || !keyB64 || refs.matrixRoomIdRef.current !== roomId || !refs.e2eeKeyProviderRef.current) return;
    try {
      const binary = atob(keyB64);
      const keyBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) keyBytes[i] = binary.charCodeAt(i);
      await refs.e2eeKeyProviderRef.current.setKey(keyBytes, keyIndex);
      refs.currentKeyIndexRef.current = keyIndex;
      refs.keyBytesRef.current = keyBytes;
      setE2eeKey(keyBytes);
      console.log('[livekit] E2EE key applied from to-device, keyIndex:', keyIndex);
    } catch (e) {
      console.error('[livekit] Failed to apply E2EE key from to-device:', e);
    }
  };

  matrixClient.on(ClientEvent.ToDeviceEvent, handleToDeviceE2EEKey);
  setToDeviceUnsubscribe(() => {
    matrixClient.off(ClientEvent.ToDeviceEvent, handleToDeviceE2EEKey);
  });
}

/**
 * Sends current E2EE key to a newly connected participant via Matrix to-device.
 * @param {import('livekit-client').RemoteParticipant} participant
 * @param {import('matrix-js-sdk').MatrixClient} matrixClient
 * @param {{ matrixRoomIdRef: import('react').MutableRefObject<string|null>, e2eeKeyProviderRef: import('react').MutableRefObject<import('livekit-client').ExternalE2EEKeyProvider|null>, keyBytesRef: import('react').MutableRefObject<Uint8Array|null>, currentKeyIndexRef: import('react').MutableRefObject<number> }} refs
 * @param {(msg: string|null) => void} setKeyExchangeMessage
 */
export async function handleParticipantConnected(participant, matrixClient, refs, setKeyExchangeMessage) {
  if (
    !refs.e2eeKeyProviderRef.current ||
    !refs.keyBytesRef.current ||
    !refs.matrixRoomIdRef.current ||
    !matrixClient.getCrypto()
  ) {
    return;
  }
  const roomId = refs.matrixRoomIdRef.current;
  const keyBytes = refs.keyBytesRef.current;
  const keyIndex = refs.currentKeyIndexRef.current;
  const keyB64 = btoa(String.fromCharCode(...keyBytes));
  try {
    await retryToDeviceSend(
      async () => {
        const deviceMap = await matrixClient.getCrypto().getUserDeviceInfo([participant.identity], true);
        const devicesForUser = deviceMap?.get(participant.identity);
        const devices = devicesForUser
          ? Array.from(devicesForUser.keys()).map((deviceId) => ({
              userId: participant.identity,
              deviceId,
            }))
          : [];
        if (devices.length > 0) {
          await matrixClient.encryptAndSendToDevice('io.hush.e2ee_key', devices, {
            roomId,
            key: keyB64,
            keyIndex,
          });
          console.log('[livekit] E2EE key sent to', participant.identity);
        }
      },
      {},
    );
    setKeyExchangeMessage(null);
  } catch (err) {
    console.warn('[livekit] Failed to send E2EE key to participant:', err);
    // If the Matrix token expired (401) but E2EE key was already set, the stream
    // keeps working — the new participant will receive the key from another peer
    // whose token is still valid.  Don't show a scary toast for this.
    const isTokenExpired = /M_UNKNOWN_TOKEN|401|expired/i.test(err?.message || '');
    if (!isTokenExpired) {
      setKeyExchangeMessage(KEY_EXCHANGE_FAIL_MESSAGE);
    }
  }
}

/**
 * If this client is the leader (lexicographically smallest Matrix user ID among remaining),
 * generates a new key and distributes it via to-device. Otherwise no-op.
 * @param {import('livekit-client').RemoteParticipant} participant
 * @param {import('livekit-client').Room} room
 * @param {import('matrix-js-sdk').MatrixClient} matrixClient
 * @param {{ matrixRoomIdRef: import('react').MutableRefObject<string|null>, e2eeKeyProviderRef: import('react').MutableRefObject<import('livekit-client').ExternalE2EEKeyProvider|null>, keyBytesRef: import('react').MutableRefObject<Uint8Array|null>, currentKeyIndexRef: import('react').MutableRefObject<number> }} refs
 * @param {(key: Uint8Array|null) => void} setE2eeKey
 * @param {(msg: string|null) => void} setKeyExchangeMessage
 */
export async function handleParticipantDisconnected(participant, room, matrixClient, refs, setE2eeKey, setKeyExchangeMessage) {
  if (
    !refs.e2eeKeyProviderRef.current ||
    !refs.matrixRoomIdRef.current ||
    !matrixClient.getCrypto()
  ) {
    return;
  }
  const remaining = [
    room.localParticipant.identity,
    ...Array.from(room.remoteParticipants.values()).map((p) => p.identity),
  ].filter(Boolean);
  remaining.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const leader = remaining[0];
  const myIdentity = matrixClient.getUserId();
  if (myIdentity !== leader) return;

  const newKey = new Uint8Array(32);
  crypto.getRandomValues(newKey);
  const newKeyIndex = refs.currentKeyIndexRef.current + 1;
  refs.currentKeyIndexRef.current = newKeyIndex;
  refs.keyBytesRef.current = newKey;
  await refs.e2eeKeyProviderRef.current.setKey(newKey, newKeyIndex);
  setE2eeKey(newKey);

  const roomId = refs.matrixRoomIdRef.current;
  const keyB64 = btoa(String.fromCharCode(...newKey));
  const targets = remaining.slice(1);
  let rekeyFailed = false;
  for (const userId of targets) {
    try {
      await retryToDeviceSend(
        async () => {
          const deviceMap = await matrixClient.getCrypto().getUserDeviceInfo([userId], true);
          const devicesForUser = deviceMap?.get(userId);
          const devices = devicesForUser
            ? Array.from(devicesForUser.keys()).map((deviceId) => ({ userId, deviceId }))
            : [];
          if (devices.length > 0) {
            await matrixClient.encryptAndSendToDevice('io.hush.e2ee_key', devices, {
              roomId,
              key: keyB64,
              keyIndex: newKeyIndex,
            });
          }
        },
        {},
      );
      setKeyExchangeMessage(null);
    } catch (err) {
      console.warn('[livekit] Rekey: failed to send to', userId, err);
      const isTokenExpired = /M_UNKNOWN_TOKEN|401|expired/i.test(err?.message || '');
      if (!isTokenExpired) {
        rekeyFailed = true;
      }
    }
  }
  if (rekeyFailed) {
    setKeyExchangeMessage(KEY_EXCHANGE_FAIL_MESSAGE);
  } else {
    console.log('[livekit] E2EE rekey: new key distributed by leader');
  }
}

/**
 * Sets the creator's random key on the keyProvider after connect (first in room).
 * @param {import('livekit-client').ExternalE2EEKeyProvider} keyProvider
 * @param {{ keyBytesRef: import('react').MutableRefObject<Uint8Array|null>, currentKeyIndexRef: import('react').MutableRefObject<number> }} refs
 * @param {(key: Uint8Array|null) => void} setE2eeKey
 */
export async function setCreatorKey(keyProvider, refs, setE2eeKey) {
  const randomKey = new Uint8Array(32);
  crypto.getRandomValues(randomKey);
  await keyProvider.setKey(randomKey, 0);
  refs.keyBytesRef.current = randomKey;
  refs.currentKeyIndexRef.current = 0;
  setE2eeKey(randomKey);
  console.log('[livekit] E2EE creator: random key set');
}
