/**
 * Tests for useMLS hook contract.
 *
 * Verifies:
 * - encryptForChannel delegates to mlsGroup.encryptMessage
 * - encryptForChannel throws when channelId is missing (no silent fallback)
 * - encryptForChannel does NOT wrap errors in plaintext envelope
 * - decryptFromChannel delegates to mlsGroup.decryptMessage
 * - decryptFromChannel throws on non-application messages
 * - getCachedMessage returns cached plaintext from mlsStore
 * - setCachedMessage persists plaintext to mlsStore
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMLS } from './useMLS';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockDb() {
  return { transaction: vi.fn(), objectStoreNames: { contains: vi.fn() } };
}

function makeMockDeps() {
  return {
    mlsGroup: {
      encryptMessage: vi.fn().mockResolvedValue({
        messageBytes: new Uint8Array([1, 2, 3]),
        localId: 'mock-local-id',
      }),
      decryptMessage: vi.fn().mockResolvedValue({
        plaintext: 'decrypted-hello',
        type: 'application',
        epoch: 1,
        senderIdentity: 'sender-123',
      }),
      exportGuildMetadataKey: vi.fn().mockResolvedValue(new Uint8Array(32)),
    },
    mlsStore: {
      getCredential: vi.fn().mockResolvedValue({
        signingPublicKey: new Uint8Array([10]),
        signingPrivateKey: new Uint8Array([20]),
        credentialBytes: new Uint8Array([30]),
      }),
      getLocalPlaintext: vi.fn().mockResolvedValue(null),
      setLocalPlaintext: vi.fn().mockResolvedValue(undefined),
    },
    hushCrypto: {},
    api: {},
  };
}

function makeGetStore(db) {
  return vi.fn().mockResolvedValue(db);
}

function makeGetToken() {
  return vi.fn().mockReturnValue('mock-jwt-token');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useMLS', () => {
  let mockDb;
  let mockDeps;
  let getStore;
  let getToken;

  beforeEach(() => {
    mockDb = makeMockDb();
    mockDeps = makeMockDeps();
    getStore = makeGetStore(mockDb);
    getToken = makeGetToken();
  });

  describe('encryptForChannel', () => {
    it('delegates to mlsGroup.encryptMessage with correct channelId and returns ciphertext', async () => {
      const channelId = 'channel-abc';
      const { encryptForChannel } = useMLS({
        getStore,
        getToken,
        channelId,
        _deps: mockDeps,
      });

      const result = await encryptForChannel('hello world');

      expect(mockDeps.mlsGroup.encryptMessage).toHaveBeenCalledTimes(1);
      const [deps, passedChannelId, plaintext] = mockDeps.mlsGroup.encryptMessage.mock.calls[0];
      expect(passedChannelId).toBe('channel-abc');
      expect(plaintext).toBe('hello world');
      expect(result.ciphertext).toBeInstanceOf(Uint8Array);
      expect(Array.from(result.ciphertext)).toEqual([1, 2, 3]);
      expect(result.localId).toBe('mock-local-id');
    });

    it('throws when channelId is not set', async () => {
      const { encryptForChannel } = useMLS({
        getStore,
        getToken,
        channelId: undefined,
        _deps: mockDeps,
      });

      await expect(encryptForChannel('hello')).rejects.toThrow(
        'channelId is required for encryptForChannel'
      );
    });

    it('does NOT wrap errors in a plaintext envelope (_hush_plaintext)', async () => {
      mockDeps.mlsGroup.encryptMessage.mockRejectedValue(new Error('MLS encrypt failed'));

      const { encryptForChannel } = useMLS({
        getStore,
        getToken,
        channelId: 'channel-xyz',
        _deps: mockDeps,
      });

      // The error must propagate — not be caught and wrapped in a plaintext fallback
      await expect(encryptForChannel('test')).rejects.toThrow('MLS encrypt failed');
    });

    it('result never contains _hush_plaintext field', async () => {
      const { encryptForChannel } = useMLS({
        getStore,
        getToken,
        channelId: 'channel-test',
        _deps: mockDeps,
      });

      const result = await encryptForChannel('some text');

      // Verify no plaintext fallback envelope exists in the result
      expect(result).not.toHaveProperty('_hush_plaintext');
      expect(result).not.toHaveProperty('plaintext');
      expect(JSON.stringify(result)).not.toContain('_hush_plaintext');
    });
  });

  describe('decryptFromChannel', () => {
    it('delegates to mlsGroup.decryptMessage and returns plaintext string', async () => {
      const channelId = 'channel-decrypt';
      const { decryptFromChannel } = useMLS({
        getStore,
        getToken,
        channelId,
        _deps: mockDeps,
      });

      const messageBytes = new Uint8Array([10, 20, 30]);
      const result = await decryptFromChannel(messageBytes);

      expect(mockDeps.mlsGroup.decryptMessage).toHaveBeenCalledTimes(1);
      const [deps, passedChannelId, passedBytes] = mockDeps.mlsGroup.decryptMessage.mock.calls[0];
      expect(passedChannelId).toBe('channel-decrypt');
      expect(passedBytes).toBe(messageBytes);
      expect(result).toBe('decrypted-hello');
    });

    it('throws on non-application messages (plaintext is null)', async () => {
      mockDeps.mlsGroup.decryptMessage.mockResolvedValue({
        plaintext: null,
        type: 'commit',
        epoch: 2,
      });

      const { decryptFromChannel } = useMLS({
        getStore,
        getToken,
        channelId: 'channel-commit',
        _deps: mockDeps,
      });

      await expect(decryptFromChannel(new Uint8Array([1]))).rejects.toThrow(
        'non-application message'
      );
    });

    it('throws when channelId is not set', async () => {
      const { decryptFromChannel } = useMLS({
        getStore,
        getToken,
        channelId: undefined,
        _deps: mockDeps,
      });

      await expect(decryptFromChannel(new Uint8Array([1]))).rejects.toThrow(
        'channelId is required for decryptFromChannel'
      );
    });
  });

  describe('getCachedMessage', () => {
    it('returns cached plaintext from mlsStore', async () => {
      mockDeps.mlsStore.getLocalPlaintext.mockResolvedValue({
        plaintext: 'cached hello',
        timestamp: 1700000000,
      });

      const { getCachedMessage } = useMLS({
        getStore,
        getToken,
        channelId: 'ch-1',
        _deps: mockDeps,
      });

      const result = await getCachedMessage('msg-123');

      expect(mockDeps.mlsStore.getLocalPlaintext).toHaveBeenCalledWith(mockDb, 'msg-123');
      expect(result).toEqual({ content: 'cached hello', timestamp: 1700000000 });
    });

    it('returns null when no cached message exists', async () => {
      mockDeps.mlsStore.getLocalPlaintext.mockResolvedValue(null);

      const { getCachedMessage } = useMLS({
        getStore,
        getToken,
        channelId: 'ch-1',
        _deps: mockDeps,
      });

      const result = await getCachedMessage('msg-nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when store is unavailable', async () => {
      getStore = vi.fn().mockResolvedValue(null);

      const { getCachedMessage } = useMLS({
        getStore,
        getToken,
        channelId: 'ch-1',
        _deps: mockDeps,
      });

      const result = await getCachedMessage('msg-123');
      expect(result).toBeNull();
    });
  });

  describe('setCachedMessage', () => {
    it('persists plaintext to mlsStore', async () => {
      const { setCachedMessage } = useMLS({
        getStore,
        getToken,
        channelId: 'ch-1',
        _deps: mockDeps,
      });

      await setCachedMessage('msg-456', {
        content: 'hello world',
        timestamp: 1700000001,
      });

      expect(mockDeps.mlsStore.setLocalPlaintext).toHaveBeenCalledWith(mockDb, 'msg-456', {
        plaintext: 'hello world',
        timestamp: 1700000001,
      });
    });

    it('does not throw when store is unavailable', async () => {
      getStore = vi.fn().mockResolvedValue(null);

      const { setCachedMessage } = useMLS({
        getStore,
        getToken,
        channelId: 'ch-1',
        _deps: mockDeps,
      });

      // Should not throw — silent failure for cache operations
      await expect(
        setCachedMessage('msg-789', { content: 'test', timestamp: 0 })
      ).resolves.toBeUndefined();
    });
  });
});
