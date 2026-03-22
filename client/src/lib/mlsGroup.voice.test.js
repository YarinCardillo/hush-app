import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createVoiceGroup,
  joinVoiceGroup,
  exportVoiceFrameKey,
  destroyVoiceGroup,
  performVoiceSelfUpdate,
  processVoiceCommit,
  voiceChannelIdToBytes,
} from './mlsGroup';

// ---------------------------------------------------------------------------
// Shared mock factory
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
    mergePendingCommit: vi.fn().mockResolvedValue({
      groupInfoBytes: new Uint8Array([7, 8, 9]),
      epoch: 1,
    }),
    selfUpdate: vi.fn().mockResolvedValue({
      commitBytes: new Uint8Array([10, 11, 12]),
      groupInfoBytes: new Uint8Array([13, 14, 15]),
      epoch: 2,
    }),
    processMessage: vi.fn().mockResolvedValue({
      type: 'commit',
      epoch: 3,
    }),
    exportVoiceFrameKey: vi.fn().mockResolvedValue({
      frameKeyBytes: new Uint8Array(32).fill(0xab),
      epoch: 1,
    }),
  };
}

function makeApi() {
  return {
    getMLSVoiceGroupInfo: vi.fn().mockResolvedValue({
      groupInfo: btoa(String.fromCharCode(1, 2, 3)),
      epoch: 0,
    }),
    putMLSVoiceGroupInfo: vi.fn().mockResolvedValue(undefined),
    postMLSVoiceCommit: vi.fn().mockResolvedValue(undefined),
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
// voiceChannelIdToBytes
// ---------------------------------------------------------------------------

describe('voiceChannelIdToBytes', () => {
  it('prefixes channelId with "voice:"', () => {
    const bytes = voiceChannelIdToBytes('ch-1');
    expect(new TextDecoder().decode(bytes)).toBe('voice:ch-1');
  });

  it('is distinct from plain channelIdToBytes', () => {
    const voice = voiceChannelIdToBytes('ch-1');
    const plain = new TextEncoder().encode('ch-1');
    expect(voice).not.toEqual(plain);
  });
});

// ---------------------------------------------------------------------------
// createVoiceGroup
// ---------------------------------------------------------------------------

describe('mlsGroup voice lifecycle', () => {
  let deps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it('createVoiceGroup creates a voice MLS group and returns epoch', async () => {
    const result = await createVoiceGroup(deps, 'ch-1');

    expect(result).toEqual({ epoch: 0 });
    expect(deps.mlsStore.preloadGroupState).toHaveBeenCalledWith(deps.db);
    expect(deps.hushCrypto.createGroup).toHaveBeenCalledWith(
      voiceChannelIdToBytes('ch-1'),
      deps.credential.signingPrivateKey,
      deps.credential.signingPublicKey,
      deps.credential.credentialBytes,
    );
    expect(deps.mlsStore.flushStorageCache).toHaveBeenCalledWith(deps.db);
    expect(deps.api.putMLSVoiceGroupInfo).toHaveBeenCalledWith(
      'test-token',
      'ch-1',
      expect.any(String), // base64 groupInfoBytes
      0,
    );
    expect(deps.mlsStore.setGroupEpoch).toHaveBeenCalledWith(deps.db, 'voice:ch-1', 0);
  });

  // ---------------------------------------------------------------------------
  // joinVoiceGroup
  // ---------------------------------------------------------------------------

  it('joinVoiceGroup joins existing voice group via External Commit', async () => {
    const result = await joinVoiceGroup(deps, 'ch-1');

    // External Commit path (groupInfo exists on server)
    expect(deps.hushCrypto.joinGroupExternal).toHaveBeenCalled();
    expect(deps.api.postMLSVoiceCommit).toHaveBeenCalledWith(
      'test-token',
      'ch-1',
      expect.any(String), // base64 commitBytes
      1, // joinResult.epoch
    );
    expect(deps.hushCrypto.mergePendingCommit).toHaveBeenCalled();
    expect(deps.api.putMLSVoiceGroupInfo).toHaveBeenCalled();
    expect(deps.mlsStore.setGroupEpoch).toHaveBeenCalledWith(deps.db, 'voice:ch-1', 1);
    expect(result).toEqual({ epoch: 1 });
  });

  it('joinVoiceGroup falls back to createVoiceGroup when server returns null', async () => {
    deps.api.getMLSVoiceGroupInfo = vi.fn().mockResolvedValue(null);

    const result = await joinVoiceGroup(deps, 'ch-1');

    expect(deps.hushCrypto.createGroup).toHaveBeenCalled();
    expect(deps.hushCrypto.joinGroupExternal).not.toHaveBeenCalled();
    expect(result).toEqual({ epoch: 0 });
  });

  it('joinVoiceGroup falls back to createVoiceGroup when groupInfo field is absent', async () => {
    deps.api.getMLSVoiceGroupInfo = vi.fn().mockResolvedValue({ epoch: 0 });

    const result = await joinVoiceGroup(deps, 'ch-1');

    expect(deps.hushCrypto.createGroup).toHaveBeenCalled();
    expect(result).toEqual({ epoch: 0 });
  });

  // ---------------------------------------------------------------------------
  // exportVoiceFrameKey
  // ---------------------------------------------------------------------------

  it('exportVoiceFrameKey returns 32-byte key and epoch number', async () => {
    const result = await exportVoiceFrameKey(deps, 'ch-1');

    expect(deps.mlsStore.preloadGroupState).toHaveBeenCalledWith(deps.db);
    expect(deps.hushCrypto.exportVoiceFrameKey).toHaveBeenCalledWith(
      voiceChannelIdToBytes('ch-1'),
      deps.credential.signingPrivateKey,
      deps.credential.signingPublicKey,
      deps.credential.credentialBytes,
    );
    // Export is read-only — flush must NOT be called.
    expect(deps.mlsStore.flushStorageCache).not.toHaveBeenCalled();
    expect(result.frameKeyBytes).toBeInstanceOf(Uint8Array);
    expect(result.frameKeyBytes.length).toBe(32);
    expect(result.epoch).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // destroyVoiceGroup
  // ---------------------------------------------------------------------------

  it('destroyVoiceGroup clears local voice group state', async () => {
    await destroyVoiceGroup(deps, 'ch-1');

    expect(deps.mlsStore.deleteGroupEpoch).toHaveBeenCalledWith(deps.db, 'voice:ch-1');
    // No server call — server handles cleanup via LiveKit webhook.
    expect(deps.api.putMLSVoiceGroupInfo).not.toHaveBeenCalled();
    expect(deps.api.postMLSVoiceCommit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // performVoiceSelfUpdate
  // ---------------------------------------------------------------------------

  it('performVoiceSelfUpdate advances epoch via self_update', async () => {
    const result = await performVoiceSelfUpdate(deps, 'ch-1');

    expect(deps.hushCrypto.selfUpdate).toHaveBeenCalledWith(
      voiceChannelIdToBytes('ch-1'),
      deps.credential.signingPrivateKey,
      deps.credential.signingPublicKey,
      deps.credential.credentialBytes,
    );
    expect(deps.api.postMLSVoiceCommit).toHaveBeenCalled();
    expect(deps.hushCrypto.mergePendingCommit).toHaveBeenCalled();
    expect(deps.api.putMLSVoiceGroupInfo).toHaveBeenCalled();
    expect(deps.mlsStore.setGroupEpoch).toHaveBeenCalledWith(deps.db, 'voice:ch-1', 1);
    expect(result).toEqual({ epoch: 1 });
  });

  // ---------------------------------------------------------------------------
  // processVoiceCommit
  // ---------------------------------------------------------------------------

  it('processVoiceCommit processes incoming voice commit and updates epoch', async () => {
    const commitBytes = new Uint8Array([20, 21, 22]);
    const result = await processVoiceCommit(deps, 'ch-1', commitBytes);

    expect(deps.mlsStore.preloadGroupState).toHaveBeenCalledWith(deps.db);
    expect(deps.hushCrypto.processMessage).toHaveBeenCalledWith(
      voiceChannelIdToBytes('ch-1'),
      deps.credential.signingPrivateKey,
      deps.credential.signingPublicKey,
      deps.credential.credentialBytes,
      commitBytes,
    );
    expect(deps.mlsStore.flushStorageCache).toHaveBeenCalledWith(deps.db);
    expect(deps.mlsStore.setGroupEpoch).toHaveBeenCalledWith(deps.db, 'voice:ch-1', 3);
    expect(result).toEqual({ type: 'commit', epoch: 3 });
  });
});
