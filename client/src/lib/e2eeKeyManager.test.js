import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  retrySend,
  toBase64,
  fromBase64,
  getPlaceholderKey,
  setupMediaKeyListener,
  handleParticipantConnected,
  handleParticipantDisconnected,
  setCreatorKey,
  KEY_EXCHANGE_FAIL_MESSAGE,
} from './e2eeKeyManager';

describe('toBase64 / fromBase64', () => {
  it('round-trips arbitrary bytes', () => {
    const original = new Uint8Array([0, 1, 127, 128, 255]);
    const b64 = toBase64(original);
    const decoded = fromBase64(b64);
    expect(decoded).toEqual(original);
  });

  it('handles empty array', () => {
    const empty = new Uint8Array(0);
    expect(fromBase64(toBase64(empty))).toEqual(empty);
  });
});

describe('getPlaceholderKey', () => {
  it('returns 32-byte zero array', () => {
    const key = getPlaceholderKey();
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
    expect(key.every((b) => b === 0)).toBe(true);
  });
});

describe('retrySend', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('succeeds on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    await retrySend(fn, { maxAttempts: 3, baseDelayMs: 10 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);

    const promise = retrySend(fn, { maxAttempts: 3, baseDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    await promise;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max attempts exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent'));

    const promise = retrySend(fn, { maxAttempts: 2, baseDelayMs: 10 });
    const assertion = expect(promise).rejects.toThrow('persistent');
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('calls onRetry callback between attempts', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);
    const onRetry = vi.fn();

    const promise = retrySend(fn, { maxAttempts: 3, baseDelayMs: 10, onRetry });
    await vi.advanceTimersByTimeAsync(10);
    await promise;
    expect(onRetry).toHaveBeenCalledWith(0);
  });
});

describe('setupMediaKeyListener', () => {
  it('decrypts and applies key on media.key event', async () => {
    const keyBytes = new Uint8Array([1, 2, 3, 4]);
    const keyB64 = toBase64(keyBytes);
    const channelId = 'ch-1';
    const payload = JSON.stringify({ channelId, key: keyB64, keyIndex: 5 });
    const plaintext = new TextEncoder().encode(payload);
    const envelopeB64 = toBase64(plaintext);

    const setKey = vi.fn().mockResolvedValue(undefined);
    const refs = {
      channelIdRef: { current: channelId },
      e2eeKeyProviderRef: { current: { setKey } },
      keyBytesRef: { current: null },
      currentKeyIndexRef: { current: 0 },
    };
    const setE2eeKey = vi.fn();
    const decryptFromUser = vi.fn().mockResolvedValue(plaintext);

    let handler;
    const wsClient = {
      on: vi.fn((type, cb) => { handler = cb; }),
      off: vi.fn(),
    };

    setupMediaKeyListener(wsClient, decryptFromUser, refs, setE2eeKey, vi.fn());

    await handler({ sender_user_id: 'user-a', payload: envelopeB64 });

    expect(decryptFromUser).toHaveBeenCalledWith('user-a', 'default', expect.any(Uint8Array));
    expect(setKey).toHaveBeenCalledWith(keyBytes, 5);
    expect(refs.currentKeyIndexRef.current).toBe(5);
    expect(setE2eeKey).toHaveBeenCalledWith(keyBytes);
  });

  it('ignores events with mismatched channelId', async () => {
    const payload = JSON.stringify({ channelId: 'other', key: toBase64(new Uint8Array(4)), keyIndex: 0 });
    const plaintext = new TextEncoder().encode(payload);

    const refs = {
      channelIdRef: { current: 'ch-1' },
      e2eeKeyProviderRef: { current: { setKey: vi.fn() } },
      keyBytesRef: { current: null },
      currentKeyIndexRef: { current: 0 },
    };
    const decryptFromUser = vi.fn().mockResolvedValue(plaintext);

    let handler;
    const wsClient = {
      on: vi.fn((type, cb) => { handler = cb; }),
      off: vi.fn(),
    };

    setupMediaKeyListener(wsClient, decryptFromUser, refs, vi.fn(), vi.fn());

    await handler({ sender_user_id: 'user-a', payload: toBase64(plaintext) });
    expect(refs.e2eeKeyProviderRef.current.setKey).not.toHaveBeenCalled();
  });
});

describe('handleParticipantConnected', () => {
  function makeRoom(localIdentity, remoteIdentities) {
    return {
      localParticipant: { identity: localIdentity },
      remoteParticipants: new Map(
        remoteIdentities.map((id) => [id, { identity: id }]),
      ),
    };
  }

  it('only leader sends the key', async () => {
    const wsSend = vi.fn();
    const wsClient = { send: wsSend };
    const encryptForUser = vi.fn().mockResolvedValue(new Uint8Array([9, 9]));
    const refs = {
      channelIdRef: { current: 'ch-1' },
      e2eeKeyProviderRef: { current: {} },
      keyBytesRef: { current: new Uint8Array([1, 2]) },
      currentKeyIndexRef: { current: 0 },
    };
    const setMsg = vi.fn();
    const participant = { identity: 'charlie' };
    const room = makeRoom('alice', ['charlie']);

    // alice < charlie → alice is leader → should send
    await handleParticipantConnected(participant, room, wsClient, encryptForUser, 'alice', refs, setMsg);
    expect(encryptForUser).toHaveBeenCalledTimes(1);
    expect(wsSend).toHaveBeenCalled();
    expect(setMsg).toHaveBeenCalledWith(null);
  });

  it('non-leader does not send', async () => {
    const wsSend = vi.fn();
    const wsClient = { send: wsSend };
    const encryptForUser = vi.fn();
    const refs = {
      channelIdRef: { current: 'ch-1' },
      e2eeKeyProviderRef: { current: {} },
      keyBytesRef: { current: new Uint8Array([1]) },
      currentKeyIndexRef: { current: 0 },
    };
    const participant = { identity: 'alice' };
    const room = makeRoom('charlie', ['alice']);

    // alice < charlie → alice is leader, but currentUserId is charlie → skip
    await handleParticipantConnected(participant, room, wsClient, encryptForUser, 'charlie', refs, vi.fn());
    expect(encryptForUser).not.toHaveBeenCalled();
    expect(wsSend).not.toHaveBeenCalled();
  });

  it('encrypts once, not per retry', async () => {
    let sendCount = 0;
    const wsClient = {
      send: vi.fn(() => {
        sendCount++;
        if (sendCount === 1) throw new Error('transient');
      }),
    };
    const encryptForUser = vi.fn().mockResolvedValue(new Uint8Array([5]));
    const refs = {
      channelIdRef: { current: 'ch-1' },
      e2eeKeyProviderRef: { current: {} },
      keyBytesRef: { current: new Uint8Array([1]) },
      currentKeyIndexRef: { current: 0 },
    };
    const participant = { identity: 'bob' };
    const room = makeRoom('alice', ['bob']);

    vi.useFakeTimers();
    const promise = handleParticipantConnected(participant, room, wsClient, encryptForUser, 'alice', refs, vi.fn());
    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    // Encrypt called exactly once; send retried.
    expect(encryptForUser).toHaveBeenCalledTimes(1);
    expect(wsClient.send).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('handleParticipantDisconnected', () => {
  function makeRoom(localIdentity, remoteIdentities) {
    return {
      localParticipant: { identity: localIdentity },
      remoteParticipants: new Map(
        remoteIdentities.map((id) => [id, { identity: id }]),
      ),
    };
  }

  it('leader generates new key and distributes to remaining participants', async () => {
    const wsSend = vi.fn();
    const wsClient = { send: wsSend };
    const encryptForUser = vi.fn().mockResolvedValue(new Uint8Array([7]));
    const setKey = vi.fn().mockResolvedValue(undefined);
    const refs = {
      channelIdRef: { current: 'ch-1' },
      e2eeKeyProviderRef: { current: { setKey } },
      keyBytesRef: { current: new Uint8Array([1]) },
      currentKeyIndexRef: { current: 2 },
    };
    const setE2eeKey = vi.fn();
    const setMsg = vi.fn();
    const departed = { identity: 'charlie' };
    // After charlie leaves: alice (local) + bob (remote)
    const room = makeRoom('alice', ['bob']);

    await handleParticipantDisconnected(departed, room, wsClient, encryptForUser, 'alice', refs, setE2eeKey, setMsg);

    expect(setKey).toHaveBeenCalledWith(expect.any(Uint8Array), 3);
    expect(refs.currentKeyIndexRef.current).toBe(3);
    expect(setE2eeKey).toHaveBeenCalled();
    expect(encryptForUser).toHaveBeenCalledTimes(1);
    expect(encryptForUser.mock.calls[0][0]).toBe('bob');
    expect(encryptForUser.mock.calls[0][1].constructor.name).toBe('Uint8Array');
    expect(wsSend).toHaveBeenCalledWith('media.key', expect.objectContaining({ target_user_id: 'bob' }));
    expect(setMsg).toHaveBeenCalledWith(null);
  });

  it('non-leader does not rekey', async () => {
    const encryptForUser = vi.fn();
    const setKey = vi.fn();
    const refs = {
      channelIdRef: { current: 'ch-1' },
      e2eeKeyProviderRef: { current: { setKey } },
      keyBytesRef: { current: new Uint8Array([1]) },
      currentKeyIndexRef: { current: 0 },
    };
    const departed = { identity: 'alice' };
    // After alice leaves: bob (local) + charlie (remote). bob < charlie → bob is leader.
    const room = makeRoom('bob', ['charlie']);

    await handleParticipantDisconnected(departed, room, { send: vi.fn() }, encryptForUser, 'charlie', refs, vi.fn(), vi.fn());
    expect(encryptForUser).not.toHaveBeenCalled();
    expect(setKey).not.toHaveBeenCalled();
  });

  it('sets fail message when a send fails', async () => {
    const encryptForUser = vi.fn().mockResolvedValue(new Uint8Array([7]));
    const wsClient = { send: vi.fn(() => { throw new Error('send fail'); }) };
    const setKey = vi.fn().mockResolvedValue(undefined);
    const refs = {
      channelIdRef: { current: 'ch-1' },
      e2eeKeyProviderRef: { current: { setKey } },
      keyBytesRef: { current: new Uint8Array([1]) },
      currentKeyIndexRef: { current: 0 },
    };
    const setMsg = vi.fn();
    const departed = { identity: 'charlie' };
    const room = makeRoom('alice', ['bob']);

    vi.useFakeTimers();
    const promise = handleParticipantDisconnected(departed, room, wsClient, encryptForUser, 'alice', refs, vi.fn(), setMsg);
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    expect(setMsg).toHaveBeenCalledWith(KEY_EXCHANGE_FAIL_MESSAGE);
    vi.useRealTimers();
  });
});

describe('setCreatorKey', () => {
  it('generates random key and sets index 0', async () => {
    const setKey = vi.fn().mockResolvedValue(undefined);
    const refs = {
      keyBytesRef: { current: null },
      currentKeyIndexRef: { current: 5 },
    };
    const setE2eeKey = vi.fn();

    await setCreatorKey({ setKey }, refs, setE2eeKey);

    expect(setKey).toHaveBeenCalledWith(expect.any(Uint8Array), 0);
    const keyArg = setKey.mock.calls[0][0];
    expect(keyArg.length).toBe(32);
    expect(refs.keyBytesRef.current).toBe(keyArg);
    expect(refs.currentKeyIndexRef.current).toBe(0);
    expect(setE2eeKey).toHaveBeenCalledWith(keyArg);
  });
});
