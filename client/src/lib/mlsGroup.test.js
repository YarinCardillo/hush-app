/**
 * Tests for mlsGroup.js — chat channel MLS group lifecycle operations.
 *
 * Covers:
 *   - createChannelGroup: creates group, flushes state, stores epoch
 *   - joinChannelGroup: joins via External Commit, posts commit to server
 *   - addMemberToChannel: adds member, posts commit, returns welcomeBytes
 *   - removeMemberFromChannel: removes member, posts commit
 *   - encryptMessage: encrypts plaintext, returns ciphertext + localId
 *   - decryptMessage: decrypts ciphertext, returns plaintext for application messages
 *   - decryptMessage: returns null plaintext for commit messages
 *   - Error propagation: no silent failures in crypto operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createChannelGroup,
  joinChannelGroup,
  addMemberToChannel,
  removeMemberFromChannel,
  encryptMessage,
  decryptMessage,
} from './mlsGroup.js';

// ---------------------------------------------------------------------------
// Mock factories — mirrors mlsGroup.voice.test.js pattern
// ---------------------------------------------------------------------------

function makeDb() {
  return {};
}

function makeMlsStore() {
  return {
    preloadGroupState: vi.fn().mockResolvedValue(undefined),
    flushStorageCache: vi.fn().mockResolvedValue(undefined),
    setGroupEpoch: vi.fn().mockResolvedValue(undefined),
    getGroupEpoch: vi.fn().mockResolvedValue(0),
    deleteGroupEpoch: vi.fn().mockResolvedValue(undefined),
    setLocalPlaintext: vi.fn().mockResolvedValue(undefined),
    getLocalPlaintext: vi.fn().mockResolvedValue(null),
  };
}

function makeHushCrypto() {
  return {
    createGroup: vi.fn().mockResolvedValue({
      groupInfoBytes: new Uint8Array([1, 2, 3]),
      epoch: 0,
    }),
    joinGroupExternal: vi.fn().mockResolvedValue({
      commitBytes: new Uint8Array([4, 5, 6]),
      epoch: 1,
    }),
    exportGroupInfoBytes: vi.fn().mockResolvedValue({
      groupInfoBytes: new Uint8Array([7, 8, 9]),
    }),
    addMembers: vi.fn().mockResolvedValue({
      commitBytes: new Uint8Array([10, 11, 12]),
      groupInfoBytes: new Uint8Array([13, 14, 15]),
      welcomeBytes: new Uint8Array([16, 17, 18]),
      epoch: 2,
    }),
    removeMembers: vi.fn().mockResolvedValue({
      commitBytes: new Uint8Array([19, 20, 21]),
      groupInfoBytes: new Uint8Array([22, 23, 24]),
      epoch: 3,
    }),
    createMessage: vi.fn().mockResolvedValue({
      messageBytes: new Uint8Array([25, 26, 27]),
    }),
    processMessage: vi.fn().mockResolvedValue({
      type: 'application',
      plaintext: new TextEncoder().encode('hello world'),
      senderIdentity: 'sender-pub-key',
      epoch: 4,
    }),
  };
}

function makeApi() {
  return {
    putMLSGroupInfo: vi.fn().mockResolvedValue(undefined),
    getMLSGroupInfo: vi.fn().mockResolvedValue({
      groupInfo: btoa(String.fromCharCode(1, 2, 3)),
      epoch: 0,
    }),
    postMLSCommit: vi.fn().mockResolvedValue(undefined),
    getMLSCommitsSinceEpoch: vi.fn().mockResolvedValue({ commits: [] }),
  };
}

function makeCredential() {
  return {
    signingPrivateKey: new Uint8Array([1]),
    signingPublicKey: new Uint8Array([2]),
    credentialBytes: new Uint8Array([3]),
  };
}

function makeDeps(overrides = {}) {
  return {
    db: makeDb(),
    token: 'test-token',
    credential: makeCredential(),
    mlsStore: makeMlsStore(),
    hushCrypto: makeHushCrypto(),
    api: makeApi(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createChannelGroup
// ---------------------------------------------------------------------------

describe('createChannelGroup', () => {
  let deps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it('calls createGroup with channelId bytes and credential fields', async () => {
    await createChannelGroup(deps, 'ch-1');

    expect(deps.mlsStore.preloadGroupState).toHaveBeenCalledWith(deps.db);
    expect(deps.hushCrypto.createGroup).toHaveBeenCalledWith(
      new TextEncoder().encode('ch-1'),
      deps.credential.signingPrivateKey,
      deps.credential.signingPublicKey,
      deps.credential.credentialBytes,
    );
  });

  it('flushes storage cache after createGroup', async () => {
    await createChannelGroup(deps, 'ch-1');
    expect(deps.mlsStore.flushStorageCache).toHaveBeenCalledWith(deps.db);
  });

  it('stores GroupInfo on the server with the returned epoch', async () => {
    await createChannelGroup(deps, 'ch-1');
    expect(deps.api.putMLSGroupInfo).toHaveBeenCalledWith(
      'test-token',
      'ch-1',
      expect.any(String), // base64 groupInfoBytes
      0,                  // epoch from mock
    );
  });

  it('sets local group epoch after creation', async () => {
    await createChannelGroup(deps, 'ch-1');
    expect(deps.mlsStore.setGroupEpoch).toHaveBeenCalledWith(deps.db, 'ch-1', 0);
  });

  it('returns groupInfoBytes and epoch', async () => {
    const result = await createChannelGroup(deps, 'ch-1');
    expect(result.epoch).toBe(0);
    expect(result.groupInfoBytes).toBeInstanceOf(Uint8Array);
  });

  it('throws when createGroup returns empty groupInfoBytes', async () => {
    deps.hushCrypto.createGroup.mockResolvedValueOnce({
      groupInfoBytes: new Uint8Array(0),
      epoch: 0,
    });

    await expect(createChannelGroup(deps, 'ch-1')).rejects.toThrow(
      'createGroup returned empty groupInfoBytes',
    );
  });

  it('throws when no credential is available', async () => {
    deps.credential = null;
    await expect(createChannelGroup(deps, 'ch-1')).rejects.toThrow(
      'No credential available',
    );
  });
});

// ---------------------------------------------------------------------------
// joinChannelGroup
// ---------------------------------------------------------------------------

describe('joinChannelGroup', () => {
  let deps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it('joins via External Commit and posts commit to server', async () => {
    await joinChannelGroup(deps, 'ch-2');

    expect(deps.hushCrypto.joinGroupExternal).toHaveBeenCalled();
    expect(deps.api.postMLSCommit).toHaveBeenCalledWith(
      'test-token',
      'ch-2',
      expect.any(String), // base64 commit
      expect.any(String), // base64 groupInfo
      1,                  // epoch from joinGroupExternal mock
    );
  });

  it('sets local group epoch after joining', async () => {
    await joinChannelGroup(deps, 'ch-2');
    expect(deps.mlsStore.setGroupEpoch).toHaveBeenCalledWith(deps.db, 'ch-2', 1);
  });

  it('returns without joining when server has no GroupInfo', async () => {
    deps.api.getMLSGroupInfo.mockResolvedValueOnce(null);
    await joinChannelGroup(deps, 'ch-2');

    // No External Commit should be attempted when no group exists
    expect(deps.hushCrypto.joinGroupExternal).not.toHaveBeenCalled();
  });

  it('returns without joining when groupInfo field is absent', async () => {
    deps.api.getMLSGroupInfo.mockResolvedValueOnce({ groupInfo: null });
    await joinChannelGroup(deps, 'ch-2');

    expect(deps.hushCrypto.joinGroupExternal).not.toHaveBeenCalled();
  });

  it('preloads and flushes storage cache around WASM calls', async () => {
    await joinChannelGroup(deps, 'ch-2');

    expect(deps.mlsStore.preloadGroupState).toHaveBeenCalledWith(deps.db);
    expect(deps.mlsStore.flushStorageCache).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// addMemberToChannel
// ---------------------------------------------------------------------------

describe('addMemberToChannel', () => {
  let deps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it('calls addMembers with key package and posts commit', async () => {
    const keyPackageBytes = new Uint8Array([99, 100, 101]);
    await addMemberToChannel(deps, 'ch-3', keyPackageBytes);

    expect(deps.hushCrypto.addMembers).toHaveBeenCalledWith(
      new TextEncoder().encode('ch-3'),
      deps.credential.signingPrivateKey,
      deps.credential.signingPublicKey,
      deps.credential.credentialBytes,
      expect.stringContaining('['), // JSON array of base64 key packages
    );
    expect(deps.api.postMLSCommit).toHaveBeenCalledWith(
      'test-token',
      'ch-3',
      expect.any(String),
      expect.any(String),
      2, // epoch from addMembers mock
    );
  });

  it('returns welcomeBytes for the new member', async () => {
    const keyPackageBytes = new Uint8Array([1, 2, 3]);
    const result = await addMemberToChannel(deps, 'ch-3', keyPackageBytes);

    expect(result.welcomeBytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.welcomeBytes)).toEqual([16, 17, 18]);
  });

  it('updates local group epoch after adding member', async () => {
    const keyPackageBytes = new Uint8Array([1, 2, 3]);
    await addMemberToChannel(deps, 'ch-3', keyPackageBytes);

    expect(deps.mlsStore.setGroupEpoch).toHaveBeenCalledWith(deps.db, 'ch-3', 2);
  });

  it('propagates addMembers error without wrapping in plaintext', async () => {
    deps.hushCrypto.addMembers.mockRejectedValueOnce(new Error('MLS addMembers failed'));
    const keyPackageBytes = new Uint8Array([1]);

    await expect(addMemberToChannel(deps, 'ch-3', keyPackageBytes)).rejects.toThrow(
      'MLS addMembers failed',
    );
  });
});

// ---------------------------------------------------------------------------
// removeMemberFromChannel
// ---------------------------------------------------------------------------

describe('removeMemberFromChannel', () => {
  let deps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it('calls removeMembers with member identity and posts commit', async () => {
    await removeMemberFromChannel(deps, 'ch-4', 'member-identity-hex');

    expect(deps.hushCrypto.removeMembers).toHaveBeenCalledWith(
      new TextEncoder().encode('ch-4'),
      deps.credential.signingPrivateKey,
      deps.credential.signingPublicKey,
      deps.credential.credentialBytes,
      expect.stringContaining('member-identity-hex'),
    );
    expect(deps.api.postMLSCommit).toHaveBeenCalledWith(
      'test-token',
      'ch-4',
      expect.any(String),
      expect.any(String),
      3, // epoch from removeMembers mock
    );
  });

  it('updates local group epoch after removing member', async () => {
    await removeMemberFromChannel(deps, 'ch-4', 'member-to-remove');
    expect(deps.mlsStore.setGroupEpoch).toHaveBeenCalledWith(deps.db, 'ch-4', 3);
  });

  it('propagates removeMembers error', async () => {
    deps.hushCrypto.removeMembers.mockRejectedValueOnce(new Error('member not found'));

    await expect(
      removeMemberFromChannel(deps, 'ch-4', 'unknown-member'),
    ).rejects.toThrow('member not found');
  });
});

// ---------------------------------------------------------------------------
// encryptMessage
// ---------------------------------------------------------------------------

describe('encryptMessage', () => {
  let deps;

  beforeEach(() => {
    deps = makeDeps();
    // Group epoch already set (non-null) so lazy join is skipped
    deps.mlsStore.getGroupEpoch.mockResolvedValue(0);
  });

  it('stores plaintext in local cache before encrypting', async () => {
    await encryptMessage(deps, 'ch-5', 'hello world');

    // setLocalPlaintext must be called before createMessage
    const setOrder = deps.mlsStore.setLocalPlaintext.mock.invocationCallOrder[0];
    const createOrder = deps.hushCrypto.createMessage.mock.invocationCallOrder[0];
    expect(setOrder).toBeLessThan(createOrder);
  });

  it('returns ciphertext bytes and a localId', async () => {
    const result = await encryptMessage(deps, 'ch-5', 'test');

    expect(result.messageBytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.messageBytes)).toEqual([25, 26, 27]);
    expect(typeof result.localId).toBe('string');
    expect(result.localId.length).toBeGreaterThan(0);
  });

  it('calls createMessage with UTF-8 encoded plaintext', async () => {
    await encryptMessage(deps, 'ch-5', 'hello');

    const args = deps.hushCrypto.createMessage.mock.calls[0];
    const plaintextArg = args[4]; // 5th argument is the plaintext bytes
    expect(new TextDecoder().decode(plaintextArg)).toBe('hello');
  });

  it('does not wrap encryption errors in a plaintext envelope', async () => {
    deps.hushCrypto.createMessage.mockRejectedValueOnce(new Error('WASM encrypt error'));

    await expect(encryptMessage(deps, 'ch-5', 'test')).rejects.toThrow('WASM encrypt error');
  });

  it('result never contains _hush_plaintext field (no plaintext fallback)', async () => {
    const result = await encryptMessage(deps, 'ch-5', 'secret');

    expect(result).not.toHaveProperty('_hush_plaintext');
    expect(result).not.toHaveProperty('plaintext');
    expect(JSON.stringify(result)).not.toContain('_hush_plaintext');
  });

  it('different calls produce different localIds (UUID uniqueness)', async () => {
    const r1 = await encryptMessage(deps, 'ch-5', 'msg-1');
    const r2 = await encryptMessage(deps, 'ch-5', 'msg-2');
    expect(r1.localId).not.toBe(r2.localId);
  });
});

// ---------------------------------------------------------------------------
// decryptMessage
// ---------------------------------------------------------------------------

describe('decryptMessage', () => {
  let deps;

  beforeEach(() => {
    deps = makeDeps();
    deps.mlsStore.getGroupEpoch.mockResolvedValue(0);
  });

  it('returns decoded plaintext string for application messages', async () => {
    const messageBytes = new Uint8Array([1, 2, 3]);
    const result = await decryptMessage(deps, 'ch-6', messageBytes);

    expect(result.plaintext).toBe('hello world');
    expect(result.type).toBe('application');
    expect(result.senderIdentity).toBe('sender-pub-key');
    expect(typeof result.epoch).toBe('number');
  });

  it('calls processMessage with correct channelId bytes', async () => {
    const messageBytes = new Uint8Array([4, 5, 6]);
    await decryptMessage(deps, 'ch-6', messageBytes);

    expect(deps.hushCrypto.processMessage).toHaveBeenCalledWith(
      new TextEncoder().encode('ch-6'),
      deps.credential.signingPrivateKey,
      deps.credential.signingPublicKey,
      deps.credential.credentialBytes,
      messageBytes,
    );
  });

  it('returns null plaintext for commit messages', async () => {
    deps.hushCrypto.processMessage.mockResolvedValueOnce({
      type: 'commit',
      plaintext: null,
      epoch: 5,
    });

    const result = await decryptMessage(deps, 'ch-6', new Uint8Array([1]));

    expect(result.plaintext).toBeNull();
    expect(result.type).toBe('commit');
  });

  it('updates epoch in store after processing a commit message', async () => {
    deps.hushCrypto.processMessage.mockResolvedValueOnce({
      type: 'commit',
      plaintext: null,
      epoch: 7,
    });

    await decryptMessage(deps, 'ch-6', new Uint8Array([1]));

    expect(deps.mlsStore.setGroupEpoch).toHaveBeenCalledWith(deps.db, 'ch-6', 7);
  });

  it('does not update epoch store for application messages', async () => {
    await decryptMessage(deps, 'ch-6', new Uint8Array([1]));

    // setGroupEpoch must NOT be called for application messages
    expect(deps.mlsStore.setGroupEpoch).not.toHaveBeenCalled();
  });

  it('preloads and flushes storage cache around WASM call', async () => {
    await decryptMessage(deps, 'ch-6', new Uint8Array([1]));

    expect(deps.mlsStore.preloadGroupState).toHaveBeenCalledWith(deps.db);
    expect(deps.mlsStore.flushStorageCache).toHaveBeenCalled();
  });

  it('propagates decryption errors without swallowing them', async () => {
    deps.hushCrypto.processMessage.mockRejectedValueOnce(new Error('decryption failed'));

    await expect(
      decryptMessage(deps, 'ch-6', new Uint8Array([1, 2])),
    ).rejects.toThrow('decryption failed');
  });
});
