/**
 * useRoom MLS voice E2EE tests
 *
 * Exercises the MLS voice group lifecycle wired into useRoom.js (M.3-03).
 * Uses dependency-injected mocks for mlsGroup, mlsStore, hushCrypto, api,
 * and the LiveKit ExternalE2EEKeyProvider so no WASM or network is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Stable hoisted mocks — must be created with vi.hoisted() so they exist
// when vi.mock() factory functions run (factories execute before imports).
// ---------------------------------------------------------------------------
const {
  mockCreateVoiceGroup,
  mockJoinVoiceGroup,
  mockExportVoiceFrameKey,
  mockProcessVoiceCommit,
  mockPerformVoiceSelfUpdate,
  mockDestroyVoiceGroup,
  mockGetCredential,
  mockGetMLSVoiceGroupInfo,
  mockSetKey,
  mockE2EEKeyProvider,
} = vi.hoisted(() => {
  const mockSetKey = vi.fn().mockResolvedValue(undefined);
  // Must use a regular function (not arrow) so `new ExternalE2EEKeyProvider()` works
  function MockExternalE2EEKeyProvider() {
    this.setKey = mockSetKey;
  }
  const mockE2EEKeyProvider = vi.fn(MockExternalE2EEKeyProvider);

  return {
    mockCreateVoiceGroup: vi.fn().mockResolvedValue({ epoch: 0 }),
    mockJoinVoiceGroup: vi.fn().mockResolvedValue({ epoch: 1 }),
    mockExportVoiceFrameKey: vi.fn().mockResolvedValue({
      frameKeyBytes: new Uint8Array(32).fill(0xab),
      epoch: 1,
    }),
    mockProcessVoiceCommit: vi.fn().mockResolvedValue({ type: 'commit', epoch: 2 }),
    mockPerformVoiceSelfUpdate: vi.fn().mockResolvedValue({ epoch: 3 }),
    mockDestroyVoiceGroup: vi.fn().mockResolvedValue(undefined),
    mockGetCredential: vi.fn().mockResolvedValue({
      signingPrivateKey: new Uint8Array([1]),
      signingPublicKey: new Uint8Array([2]),
      credentialBytes: new Uint8Array([3]),
    }),
    mockGetMLSVoiceGroupInfo: vi.fn().mockRejectedValue(new Error('404')),
    mockSetKey,
    mockE2EEKeyProvider,
  };
});

vi.mock('../lib/mlsGroup', () => ({
  createVoiceGroup: mockCreateVoiceGroup,
  joinVoiceGroup: mockJoinVoiceGroup,
  exportVoiceFrameKey: mockExportVoiceFrameKey,
  processVoiceCommit: mockProcessVoiceCommit,
  performVoiceSelfUpdate: mockPerformVoiceSelfUpdate,
  destroyVoiceGroup: mockDestroyVoiceGroup,
  voiceChannelIdToBytes: (id) => new TextEncoder().encode(`voice:${id}`),
}));

vi.mock('../lib/mlsStore', () => ({
  openStore: vi.fn().mockResolvedValue({}),
  getCredential: mockGetCredential,
}));

vi.mock('../lib/hushCrypto', () => ({}));

vi.mock('../lib/api', () => ({
  getMLSVoiceGroupInfo: mockGetMLSVoiceGroupInfo,
}));

// Mock livekit-client ExternalE2EEKeyProvider and Room
vi.mock('livekit-client', () => {
  const RoomEvent = {
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    Connected: 'connected',
    Disconnected: 'disconnected',
    TrackPublished: 'trackPublished',
    TrackUnpublished: 'trackUnpublished',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
  };

  class MockRoom {
    constructor() {
      this._handlers = {};
      this.remoteParticipants = new Map();
    }
    on(event, handler) {
      this._handlers[event] = handler;
    }
    off(event) {
      delete this._handlers[event];
    }
    emit(event, ...args) {
      this._handlers[event]?.(...args);
    }
    async connect() {}
    async disconnect() {}
  }

  return {
    ExternalE2EEKeyProvider: mockE2EEKeyProvider,
    Room: MockRoom,
    RoomEvent,
    Track: { Source: { ScreenShare: 'screen_share', ScreenShareAudio: 'screen_share_audio' }, Kind: { Video: 'video' } },
  };
});

// Mock E2EE worker
vi.mock('livekit-client/e2ee-worker?worker', () => ({
  default: class MockWorker {},
}));

// Mock trackManager — no real audio/video in unit tests
vi.mock('../lib/trackManager', () => ({
  attachRemoteTrackListeners: vi.fn(),
  preloadNoiseGateWorklet: vi.fn(),
  publishScreen: vi.fn(),
  unpublishScreen: vi.fn(),
  switchScreenSource: vi.fn(),
  changeQuality: vi.fn(),
  publishWebcam: vi.fn(),
  unpublishWebcam: vi.fn(),
  publishMic: vi.fn(),
  unpublishMic: vi.fn(),
  watchScreen: vi.fn(),
  unwatchScreen: vi.fn(),
}));

import { useRoom } from './useRoom';

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

const CHANNEL_ID = 'ch-test-1';
const ROOM_NAME = `channel-${CHANNEL_ID}`;

function makeWsClient() {
  const handlers = {};
  return {
    on: vi.fn((event, handler) => { handlers[event] = handler; }),
    off: vi.fn((event) => { delete handlers[event]; }),
    _emit: (event, data) => handlers[event]?.(data),
  };
}

function makeGetStore() {
  return vi.fn().mockResolvedValue({});
}

function makeGetToken() {
  return vi.fn().mockReturnValue('test-token');
}

// Stub fetch for LiveKit token endpoint
function stubLivekitFetch() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ token: 'lk-token' }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useRoom MLS voice E2EE', () => {
  let wsClient;
  let getStore;
  let getToken;

  beforeEach(() => {
    // Clear all mocks FIRST so reassignments below take effect cleanly
    vi.clearAllMocks();

    // Recreate per-test objects after clearing (so their impls are fresh)
    wsClient = makeWsClient();
    getStore = makeGetStore();
    getToken = makeGetToken();
    stubLivekitFetch();

    // Restore default implementations for hoisted mocks after clearAllMocks
    mockCreateVoiceGroup.mockResolvedValue({ epoch: 0 });
    mockJoinVoiceGroup.mockResolvedValue({ epoch: 1 });
    mockExportVoiceFrameKey.mockResolvedValue({
      frameKeyBytes: new Uint8Array(32).fill(0xab),
      epoch: 1,
    });
    mockProcessVoiceCommit.mockResolvedValue({ type: 'commit', epoch: 2 });
    mockPerformVoiceSelfUpdate.mockResolvedValue({ epoch: 3 });
    mockDestroyVoiceGroup.mockResolvedValue(undefined);
    mockGetMLSVoiceGroupInfo.mockRejectedValue(new Error('404'));
    mockGetCredential.mockResolvedValue({
      signingPrivateKey: new Uint8Array([1]),
      signingPublicKey: new Uint8Array([2]),
      credentialBytes: new Uint8Array([3]),
    });
    mockSetKey.mockResolvedValue(undefined);
  });

  it('connectRoom creates voice MLS group when no existing group on server (first participant)', async () => {
    // getMLSVoiceGroupInfo throws (404 = no group) → createVoiceGroup path
    mockGetMLSVoiceGroupInfo.mockRejectedValue(new Error('404'));

    const { result } = renderHook(() =>
      useRoom({ wsClient, getToken, currentUserId: 'u1', getStore, voiceKeyRotationHours: 2 }),
    );

    await act(async () => {
      await result.current.connectRoom(ROOM_NAME, 'TestUser', CHANNEL_ID);
    });

    expect(mockCreateVoiceGroup).toHaveBeenCalledTimes(1);
    expect(mockJoinVoiceGroup).not.toHaveBeenCalled();
  });

  it('connectRoom calls exportVoiceFrameKey and applies key via setKey(frameKeyBytes, epoch % 256)', async () => {
    mockGetMLSVoiceGroupInfo.mockRejectedValue(new Error('404'));
    mockExportVoiceFrameKey.mockResolvedValue({
      frameKeyBytes: new Uint8Array(32).fill(0xff),
      epoch: 5,
    });

    const { result } = renderHook(() =>
      useRoom({ wsClient, getToken, currentUserId: 'u1', getStore, voiceKeyRotationHours: 2 }),
    );

    await act(async () => {
      await result.current.connectRoom(ROOM_NAME, 'TestUser', CHANNEL_ID);
    });

    expect(mockExportVoiceFrameKey).toHaveBeenCalledTimes(1);
    // setKey is called on the ExternalE2EEKeyProvider instance
    expect(mockSetKey).toHaveBeenCalledWith(expect.any(Uint8Array), 5 % 256);
    // voiceEpoch state should reflect the derived epoch
    expect(result.current.voiceEpoch).toBe(5);
    expect(result.current.isE2EEEnabled).toBe(true);
  });

  it('isVoiceReconnecting is false after successful MLS setup, true only during the async gap', async () => {
    // When connectRoom completes successfully, isVoiceReconnecting must be false.
    // The true→false transition happens within connectRoom after the key is applied.
    // We verify the final state here; the Reconnecting indicator is shown in VoiceChannel.jsx.
    mockGetMLSVoiceGroupInfo.mockRejectedValue(new Error('404'));

    const { result } = renderHook(() =>
      useRoom({ wsClient, getToken, currentUserId: 'u1', getStore, voiceKeyRotationHours: 2 }),
    );

    await act(async () => {
      await result.current.connectRoom(ROOM_NAME, 'TestUser', CHANNEL_ID);
    });

    // After successful connect: reconnecting must be false, E2EE must be enabled
    expect(result.current.isVoiceReconnecting).toBe(false);
    expect(result.current.isE2EEEnabled).toBe(true);
  });

  it('mls.commit WS event triggers key re-derivation with new epoch (skips own commits)', async () => {
    mockGetMLSVoiceGroupInfo.mockRejectedValue(new Error('404'));
    const { result } = renderHook(() =>
      useRoom({ wsClient, getToken, currentUserId: 'u1', getStore, voiceKeyRotationHours: 2 }),
    );

    await act(async () => {
      await result.current.connectRoom(ROOM_NAME, 'TestUser', CHANNEL_ID);
    });

    // Simulate an mls.commit from a different user
    const commitBytes = new Uint8Array([1, 2, 3]);
    const b64 = btoa(String.fromCharCode(...commitBytes));
    mockExportVoiceFrameKey.mockResolvedValue({
      frameKeyBytes: new Uint8Array(32).fill(0xcc),
      epoch: 7,
    });
    mockProcessVoiceCommit.mockResolvedValue({ type: 'commit', epoch: 7 });

    await act(async () => {
      wsClient._emit('mls.commit', {
        group_type: 'voice',
        channel_id: CHANNEL_ID,
        sender_id: 'other-user',
        commit_bytes: b64,
        epoch: 7,
      });
    });

    expect(mockProcessVoiceCommit).toHaveBeenCalledTimes(1);
    expect(mockExportVoiceFrameKey).toHaveBeenCalledTimes(2); // once on connect, once on commit
    expect(result.current.voiceEpoch).toBe(7);
  });

  it('mls.commit WS event skips own commits (sender_id === currentUserId)', async () => {
    mockGetMLSVoiceGroupInfo.mockRejectedValue(new Error('404'));
    const { result } = renderHook(() =>
      useRoom({ wsClient, getToken, currentUserId: 'u1', getStore, voiceKeyRotationHours: 2 }),
    );

    await act(async () => {
      await result.current.connectRoom(ROOM_NAME, 'TestUser', CHANNEL_ID);
    });

    const initialCallCount = mockProcessVoiceCommit.mock.calls.length;

    await act(async () => {
      wsClient._emit('mls.commit', {
        group_type: 'voice',
        channel_id: CHANNEL_ID,
        sender_id: 'u1', // own commit
        commit_bytes: btoa('abc'),
        epoch: 2,
      });
    });

    // Own commits must not trigger processVoiceCommit
    expect(mockProcessVoiceCommit).toHaveBeenCalledTimes(initialCallCount);
  });

  it('disconnectRoom destroys local voice group state', async () => {
    mockGetMLSVoiceGroupInfo.mockRejectedValue(new Error('404'));
    const { result } = renderHook(() =>
      useRoom({ wsClient, getToken, currentUserId: 'u1', getStore, voiceKeyRotationHours: 2 }),
    );

    await act(async () => {
      await result.current.connectRoom(ROOM_NAME, 'TestUser', CHANNEL_ID);
    });

    await act(async () => {
      await result.current.disconnectRoom();
    });

    expect(mockDestroyVoiceGroup).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'test-token' }),
      CHANNEL_ID,
    );
    expect(result.current.voiceEpoch).toBeNull();
    expect(result.current.isE2EEEnabled).toBe(false);
    expect(result.current.isVoiceReconnecting).toBe(false);
  });

  it('MLS failure blocks voice entirely — no unencrypted fallback', async () => {
    // Both getMLSVoiceGroupInfo and createVoiceGroup fail
    mockGetMLSVoiceGroupInfo.mockRejectedValue(new Error('Network error'));
    mockCreateVoiceGroup.mockRejectedValue(new Error('WASM failure'));

    const { result } = renderHook(() =>
      useRoom({ wsClient, getToken, currentUserId: 'u1', getStore, voiceKeyRotationHours: 2 }),
    );

    await act(async () => {
      await result.current.connectRoom(ROOM_NAME, 'TestUser', CHANNEL_ID);
    });

    // Voice must be blocked — error set with clear message
    expect(result.current.error).toMatch(/encrypted voice|please try again/i);
    // E2EE must NOT be enabled — no unencrypted fallback
    expect(result.current.isE2EEEnabled).toBe(false);
    expect(result.current.isVoiceReconnecting).toBe(false);
  });
});
