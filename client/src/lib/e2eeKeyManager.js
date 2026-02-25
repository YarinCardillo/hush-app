/**
 * E2EE key generation, distribution, and rotation for LiveKit media.
 * Used by useRoom; creator/leader sends key via Signal-encrypted WebSocket messages,
 * joiners receive and setKey.
 */

const DEFAULT_DEVICE_ID = 'default';

export const KEY_EXCHANGE_RETRY_MESSAGE = 'Could not establish secure media channel. Retrying…';
export const KEY_EXCHANGE_FAIL_MESSAGE = 'Secure channel failed. Please rejoin.';

/**
 * Runs an async send with retries and exponential backoff.
 * @param {() => Promise<void>} fn - Async function that performs the send
 * @param {{ maxAttempts?: number, baseDelayMs?: number, onRetry?: (attempt: number) => void }} options
 * @returns {Promise<void>}
 */
export async function retrySend(fn, { maxAttempts = 3, baseDelayMs = 1000, onRetry } = {}) {
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
 * Subscribes to WebSocket media.key events for E2EE key delivery.
 * @param {{ on: (type: string, cb: (data: any) => void) => void, off: (type: string, cb: (data: any) => void) => void }} wsClient
 * @param {Function} decryptFromUser
 * @param {{ channelIdRef: import('react').MutableRefObject<string|null>, e2eeKeyProviderRef: import('react').MutableRefObject<import('livekit-client').ExternalE2EEKeyProvider|null>, keyBytesRef: import('react').MutableRefObject<Uint8Array|null>, currentKeyIndexRef: import('react').MutableRefObject<number> }} refs
 * @param {(key: Uint8Array|null) => void} setE2eeKey
 * @param {(fn: () => void) => void} setMediaKeyUnsubscribe
 */
export function setupMediaKeyListener(wsClient, decryptFromUser, refs, setE2eeKey, setMediaKeyUnsubscribe) {
  const handleMediaKey = async (data) => {
    const senderUserId = data?.sender_user_id;
    const envelopeB64 = data?.payload;
    if (!senderUserId || !envelopeB64 || !refs.e2eeKeyProviderRef.current || !refs.channelIdRef.current) return;
    try {
      const envelopeBytes = fromBase64(envelopeB64);
      const plaintext = await decryptFromUser(senderUserId, DEFAULT_DEVICE_ID, envelopeBytes);
      const decoded = new TextDecoder().decode(plaintext);
      const parsed = JSON.parse(decoded);
      const channelId = parsed?.channelId;
      const keyB64 = parsed?.key;
      const keyIndex = parsed?.keyIndex ?? 0;
      if (!channelId || channelId !== refs.channelIdRef.current || !keyB64) return;
      const keyBytes = fromBase64(keyB64);
      await refs.e2eeKeyProviderRef.current.setKey(keyBytes, keyIndex);
      refs.currentKeyIndexRef.current = keyIndex;
      refs.keyBytesRef.current = keyBytes;
      setE2eeKey(keyBytes);
      console.log('[livekit] E2EE key applied from media.key, keyIndex:', keyIndex);
    } catch (e) {
      console.error('[livekit] Failed to apply E2EE key from media.key:', e);
    }
  };

  wsClient.on('media.key', handleMediaKey);
  setMediaKeyUnsubscribe?.(() => {
    wsClient.off('media.key', handleMediaKey);
  });
}

/**
 * Sends current E2EE key to a newly connected participant via WebSocket media.key.
 * @param {import('livekit-client').RemoteParticipant} participant
 * @param {{ send: (type: string, payload: object) => void }} wsClient
 * @param {Function} encryptForUser
 * @param {string} currentUserId
 * @param {{ channelIdRef: import('react').MutableRefObject<string|null>, e2eeKeyProviderRef: import('react').MutableRefObject<import('livekit-client').ExternalE2EEKeyProvider|null>, keyBytesRef: import('react').MutableRefObject<Uint8Array|null>, currentKeyIndexRef: import('react').MutableRefObject<number> }} refs
 * @param {(msg: string|null) => void} setKeyExchangeMessage
 */
export async function handleParticipantConnected(participant, wsClient, encryptForUser, currentUserId, refs, setKeyExchangeMessage) {
  if (
    !refs.e2eeKeyProviderRef.current ||
    !refs.keyBytesRef.current ||
    !refs.channelIdRef.current ||
    !currentUserId
  ) {
    return;
  }
  const channelId = refs.channelIdRef.current;
  const keyBytes = refs.keyBytesRef.current;
  const keyIndex = refs.currentKeyIndexRef.current;
  const keyB64 = toBase64(keyBytes);
  try {
    await retrySend(
      async () => {
        const payload = {
          channelId,
          key: keyB64,
          keyIndex,
        };
        const plaintext = new TextEncoder().encode(JSON.stringify(payload));
        const envelope = await encryptForUser(participant.identity, plaintext);
        const envelopeB64 = toBase64(envelope);
        wsClient.send('media.key', {
          target_user_id: participant.identity,
          payload: envelopeB64,
        });
        console.log('[livekit] E2EE key sent to', participant.identity);
      },
      {},
    );
    setKeyExchangeMessage(null);
  } catch (err) {
    console.warn('[livekit] Failed to send E2EE key to participant:', err);
    setKeyExchangeMessage(KEY_EXCHANGE_FAIL_MESSAGE);
  }
}

/**
 * If this client is the leader (lexicographically smallest Matrix user ID among remaining),
 * generates a new key and distributes it via media.key. Otherwise no-op.
 * @param {import('livekit-client').RemoteParticipant} participant
 * @param {import('livekit-client').Room} room
 * @param {{ send: (type: string, payload: object) => void }} wsClient
 * @param {Function} encryptForUser
 * @param {string} currentUserId
 * @param {{ channelIdRef: import('react').MutableRefObject<string|null>, e2eeKeyProviderRef: import('react').MutableRefObject<import('livekit-client').ExternalE2EEKeyProvider|null>, keyBytesRef: import('react').MutableRefObject<Uint8Array|null>, currentKeyIndexRef: import('react').MutableRefObject<number> }} refs
 * @param {(key: Uint8Array|null) => void} setE2eeKey
 * @param {(msg: string|null) => void} setKeyExchangeMessage
 */
export async function handleParticipantDisconnected(participant, room, wsClient, encryptForUser, currentUserId, refs, setE2eeKey, setKeyExchangeMessage) {
  if (
    !refs.e2eeKeyProviderRef.current ||
    !refs.channelIdRef.current ||
    !currentUserId
  ) {
    return;
  }
  const remaining = [
    room.localParticipant.identity,
    ...Array.from(room.remoteParticipants.values()).map((p) => p.identity),
  ].filter(Boolean);
  remaining.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const leader = remaining[0];
  if (currentUserId !== leader) return;

  const newKey = new Uint8Array(32);
  crypto.getRandomValues(newKey);
  const newKeyIndex = refs.currentKeyIndexRef.current + 1;
  refs.currentKeyIndexRef.current = newKeyIndex;
  refs.keyBytesRef.current = newKey;
  await refs.e2eeKeyProviderRef.current.setKey(newKey, newKeyIndex);
  setE2eeKey(newKey);

  const channelId = refs.channelIdRef.current;
  const keyB64 = toBase64(newKey);
  const targets = remaining.slice(1);
  let rekeyFailed = false;
  for (const userId of targets) {
    try {
      await retrySend(
        async () => {
          const payload = {
            channelId,
            key: keyB64,
            keyIndex: newKeyIndex,
          };
          const plaintext = new TextEncoder().encode(JSON.stringify(payload));
          const envelope = await encryptForUser(userId, plaintext);
          const envelopeB64 = toBase64(envelope);
          wsClient.send('media.key', {
            target_user_id: userId,
            payload: envelopeB64,
          });
        },
        {},
      );
      setKeyExchangeMessage(null);
    } catch (err) {
      console.warn('[livekit] Rekey: failed to send to', userId, err);
      rekeyFailed = true;
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

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return btoa(s);
}

function fromBase64(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
