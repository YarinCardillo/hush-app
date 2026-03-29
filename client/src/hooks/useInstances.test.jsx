/**
 * Tests for useInstances hook.
 *
 * Uses fake-indexeddb (auto-installed via setup.js) for IDB operations,
 * and vi.mock for ws.js, api.js, instanceRegistry.js, and AuthContext
 * to avoid real network/WS connections or auth state.
 *
 * Test coverage:
 *   - bootInstance: handshake -> auth -> WS connect -> guild fetch -> merge
 *   - Parallel boot of multiple instances on mount
 *   - Guild merge ordering (IDB-persisted order, new guilds append to bottom)
 *   - disconnectInstance: WS teardown + IDB remove + state cleanup
 *   - Reconnect state transitions (unexpected WS close -> 'reconnecting')
 *   - getWsClient / getTokenForInstance accessors
 *   - refreshGuilds re-fetches guild list for an instance
 *   - InstanceContext: useInstanceContext throws outside provider, provides value inside
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

// ── Stable mock references (vi.hoisted required for module-mock factory) ──────

const mockConnect = vi.hoisted(() => vi.fn());
const mockDisconnect = vi.hoisted(() => vi.fn());
const mockSend = vi.hoisted(() => vi.fn());
const mockOn = vi.hoisted(() => vi.fn());
const mockOff = vi.hoisted(() => vi.fn());
const mockIsConnected = vi.hoisted(() => vi.fn(() => true));

const createMockWsClient = vi.hoisted(() => vi.fn(() => ({
  connect: mockConnect,
  disconnect: mockDisconnect,
  send: mockSend,
  on: mockOn,
  off: mockOff,
  isConnected: mockIsConnected,
})));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../lib/ws.js', () => ({
  createWsClient: createMockWsClient,
}));

vi.mock('../lib/api.js', () => ({
  getHandshake: vi.fn(),
  requestChallenge: vi.fn(),
  verifyChallenge: vi.fn(),
  registerWithPublicKey: vi.fn(),
  getMyGuilds: vi.fn(),
  fetchWithAuth: vi.fn(),
}));

vi.mock('../lib/instanceRegistry.js', () => ({
  openInstanceRegistry: vi.fn(),
  saveInstance: vi.fn(),
  getAllInstances: vi.fn(),
  getInstanceByUrl: vi.fn(),
  removeInstance: vi.fn(),
  getInstanceJwt: vi.fn(),
  saveGuildOrder: vi.fn(),
  getGuildOrder: vi.fn(),
}));

// Mock AuthContext so useInstances can read identityKeyRef without real auth.
vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

// ── Import mocks after declaration ────────────────────────────────────────────

import * as wsModule from '../lib/ws.js';
import * as apiModule from '../lib/api.js';
import * as registryModule from '../lib/instanceRegistry.js';
import { useAuth as useAuthMock } from '../contexts/AuthContext.jsx';

// ── Shared test fixtures ──────────────────────────────────────────────────────

const INSTANCE_A = 'https://a.example.com';
const INSTANCE_B = 'https://b.example.com';
const JWT_A = 'jwt-a';
const JWT_B = 'jwt-b';
const USER_A = { id: 'user-a', username: 'alice' };
const USER_B = { id: 'user-b', username: 'bob' };

const GUILDS_A = [
  { id: 'guild-1', encryptedMetadata: 'meta-1' },
  { id: 'guild-2', encryptedMetadata: 'meta-2' },
];
const GUILDS_B = [
  { id: 'guild-3', encryptedMetadata: 'meta-3' },
];

const FAKE_IDENTITY_KEY = {
  privateKey: new Uint8Array(32).fill(1),
  publicKey: new Uint8Array(32).fill(2),
};

function makeFakeDb() {
  return { name: 'hush-instances', close: vi.fn() };
}

/** Set up api mocks for a successful auth flow on one instance. */
function setupAuthMocks(jwt, user, guilds) {
  apiModule.getHandshake.mockResolvedValueOnce({ server_version: '1.0', api_version: '1' });
  apiModule.requestChallenge.mockResolvedValueOnce({ nonce: 'deadbeef' });
  apiModule.verifyChallenge.mockResolvedValueOnce({ token: jwt, user });
  apiModule.getMyGuilds.mockResolvedValueOnce(guilds);
}

// ── Test setup ────────────────────────────────────────────────────────────────

describe('useInstances', () => {
  let fakeDb;
  const { useRef } = React;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();

    fakeDb = makeFakeDb();
    registryModule.openInstanceRegistry.mockResolvedValue(fakeDb);
    registryModule.getAllInstances.mockResolvedValue([]);
    registryModule.getGuildOrder.mockResolvedValue([]);
    registryModule.saveInstance.mockResolvedValue(undefined);
    registryModule.removeInstance.mockResolvedValue(undefined);
    registryModule.saveGuildOrder.mockResolvedValue(undefined);

    // Provide a fake identity key via mocked useAuth.
    // vaultState='unlocked' and loading=false so the boot effect proceeds
    // (it gates on auth readiness before opening IDB/booting instances).
    useAuthMock.mockReturnValue({
      identityKeyRef: { current: FAKE_IDENTITY_KEY },
      user: { id: 'local-user', username: 'testuser' },
      token: 'local-jwt',
      vaultState: 'unlocked',
      loading: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  it('initialises with empty state when no instances in IDB', async () => {
    const { useInstances } = await import('./useInstances.js');
    const { result } = renderHook(() => useInstances());

    await waitFor(() => {
      expect(result.current.instanceStates.size).toBe(0);
    });

    expect(result.current.mergedGuilds).toEqual([]);
  });

  it('registers the active auth instance when a local JWT exists but no instances are stored', async () => {
    const primaryInstanceUrl = 'https://chat.example.com';
    localStorage.setItem('hush_auth_instance_selected', primaryInstanceUrl);
    sessionStorage.setItem('hush_auth_instance_active', primaryInstanceUrl);
    sessionStorage.setItem('hush_jwt', 'local-jwt');
    apiModule.getMyGuilds.mockResolvedValueOnce([]);

    const { useInstances } = await import('./useInstances.js');
    const { result } = renderHook(() => useInstances());

    await waitFor(() => {
      expect(result.current.instanceStates.has(primaryInstanceUrl)).toBe(true);
    });

    expect(registryModule.saveInstance).toHaveBeenCalledWith(
      fakeDb,
      expect.objectContaining({ instanceUrl: primaryInstanceUrl, jwt: 'local-jwt' }),
    );
  });

  // ── bootInstance ──────────────────────────────────────────────────────────

  it('bootInstance sets connectionState to connected after successful auth', async () => {
    const { useInstances } = await import('./useInstances.js');
    setupAuthMocks(JWT_A, USER_A, GUILDS_A);

    const { result } = renderHook(() => useInstances());

    await waitFor(() => expect(registryModule.openInstanceRegistry).toHaveBeenCalled());

    await act(async () => {
      await result.current.bootInstance(INSTANCE_A);
    });

    await waitFor(() => {
      const state = result.current.instanceStates.get(INSTANCE_A);
      expect(state?.connectionState).toBe('connected');
    });
  });

  it('bootInstance calls handshake, challenge, verify in sequence', async () => {
    const { useInstances } = await import('./useInstances.js');
    setupAuthMocks(JWT_A, USER_A, GUILDS_A);

    const { result } = renderHook(() => useInstances());
    await waitFor(() => expect(registryModule.openInstanceRegistry).toHaveBeenCalled());

    await act(async () => {
      await result.current.bootInstance(INSTANCE_A);
    });

    await waitFor(() => {
      expect(apiModule.getHandshake).toHaveBeenCalledWith(INSTANCE_A);
      expect(apiModule.requestChallenge).toHaveBeenCalled();
      expect(apiModule.verifyChallenge).toHaveBeenCalled();
    });
  });

  it('bootInstance saves JWT to IDB after successful auth', async () => {
    const { useInstances } = await import('./useInstances.js');
    setupAuthMocks(JWT_A, USER_A, GUILDS_A);

    const { result } = renderHook(() => useInstances());
    await waitFor(() => expect(registryModule.openInstanceRegistry).toHaveBeenCalled());

    await act(async () => {
      await result.current.bootInstance(INSTANCE_A);
    });

    await waitFor(() => {
      expect(registryModule.saveInstance).toHaveBeenCalledWith(
        fakeDb,
        expect.objectContaining({ instanceUrl: INSTANCE_A, jwt: JWT_A }),
      );
    });
  });

  it('bootInstance creates WS client and calls connect', async () => {
    const { useInstances } = await import('./useInstances.js');
    setupAuthMocks(JWT_A, USER_A, GUILDS_A);

    const { result } = renderHook(() => useInstances());
    await waitFor(() => expect(registryModule.openInstanceRegistry).toHaveBeenCalled());

    await act(async () => {
      await result.current.bootInstance(INSTANCE_A);
    });

    await waitFor(() => {
      expect(wsModule.createWsClient).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining('ws') }),
      );
      expect(mockConnect).toHaveBeenCalled();
    });
  });

  it('bootInstance stamps instanceUrl on each fetched guild', async () => {
    const { useInstances } = await import('./useInstances.js');
    setupAuthMocks(JWT_A, USER_A, GUILDS_A);

    const { result } = renderHook(() => useInstances());
    await waitFor(() => expect(registryModule.openInstanceRegistry).toHaveBeenCalled());

    await act(async () => {
      await result.current.bootInstance(INSTANCE_A);
    });

    await waitFor(() => {
      const stamped = result.current.mergedGuilds.filter(g => g.instanceUrl === INSTANCE_A);
      expect(stamped.length).toBe(GUILDS_A.length);
    });
  });

  it('bootInstance auto-registers when verifyChallenge returns 404', async () => {
    const { useInstances } = await import('./useInstances.js');

    apiModule.getHandshake.mockResolvedValueOnce({ server_version: '1.0', api_version: '1' });
    apiModule.requestChallenge.mockResolvedValueOnce({ nonce: 'deadbeef' });
    // Simulate unknown-key 404 response.
    const notFoundErr = Object.assign(new Error('verifyChallenge 404'), { status: 404 });
    apiModule.verifyChallenge.mockRejectedValueOnce(notFoundErr);
    // Auto-register succeeds.
    apiModule.registerWithPublicKey.mockResolvedValueOnce({ token: JWT_A, user: USER_A });
    apiModule.getMyGuilds.mockResolvedValueOnce(GUILDS_A);

    const { result } = renderHook(() => useInstances());
    await waitFor(() => expect(registryModule.openInstanceRegistry).toHaveBeenCalled());

    await act(async () => {
      await result.current.bootInstance(INSTANCE_A);
    });

    await waitFor(() => {
      expect(apiModule.registerWithPublicKey).toHaveBeenCalled();
      expect(result.current.instanceStates.get(INSTANCE_A)?.connectionState).toBe('connected');
    });
  });

  // ── Parallel boot on mount ────────────────────────────────────────────────

  it('boots multiple instances in parallel when found in IDB on mount', async () => {
    const { useInstances } = await import('./useInstances.js');

    registryModule.getAllInstances.mockResolvedValue([
      { instanceUrl: INSTANCE_A },
      { instanceUrl: INSTANCE_B },
    ]);

    apiModule.getHandshake.mockResolvedValue({ server_version: '1.0' });
    apiModule.requestChallenge
      .mockResolvedValueOnce({ nonce: 'aa' })
      .mockResolvedValueOnce({ nonce: 'bb' });
    apiModule.verifyChallenge
      .mockResolvedValueOnce({ token: JWT_A, user: USER_A })
      .mockResolvedValueOnce({ token: JWT_B, user: USER_B });
    apiModule.getMyGuilds
      .mockResolvedValueOnce(GUILDS_A)
      .mockResolvedValueOnce(GUILDS_B);

    const { result } = renderHook(() => useInstances());

    await waitFor(() => {
      const a = result.current.instanceStates.get(INSTANCE_A);
      const b = result.current.instanceStates.get(INSTANCE_B);
      expect(a?.connectionState).toBe('connected');
      expect(b?.connectionState).toBe('connected');
    }, { timeout: 3000 });

    expect(result.current.mergedGuilds.length).toBe(GUILDS_A.length + GUILDS_B.length);
  });

  // ── Guild merge ordering ──────────────────────────────────────────────────

  it('mergedGuilds respects IDB-persisted guild order', async () => {
    const { useInstances } = await import('./useInstances.js');

    registryModule.getGuildOrder.mockResolvedValue(['guild-3', 'guild-1', 'guild-2']);
    registryModule.getAllInstances.mockResolvedValue([
      { instanceUrl: INSTANCE_A },
      { instanceUrl: INSTANCE_B },
    ]);

    apiModule.getHandshake.mockResolvedValue({ server_version: '1.0' });
    apiModule.requestChallenge.mockResolvedValue({ nonce: 'nonce' });
    apiModule.verifyChallenge
      .mockResolvedValueOnce({ token: JWT_A, user: USER_A })
      .mockResolvedValueOnce({ token: JWT_B, user: USER_B });
    apiModule.getMyGuilds
      .mockResolvedValueOnce(GUILDS_A)
      .mockResolvedValueOnce(GUILDS_B);

    const { result } = renderHook(() => useInstances());

    await waitFor(() => {
      expect(result.current.mergedGuilds.length).toBe(3);
    }, { timeout: 3000 });

    const ids = result.current.mergedGuilds.map(g => g.id);
    expect(ids).toEqual(['guild-3', 'guild-1', 'guild-2']);
  });

  it('mergedGuilds appends unordered guilds to the bottom', async () => {
    const { useInstances } = await import('./useInstances.js');

    // Only guild-1 is in the persisted order.
    registryModule.getGuildOrder.mockResolvedValue(['guild-1']);
    registryModule.getAllInstances.mockResolvedValue([{ instanceUrl: INSTANCE_A }]);

    apiModule.getHandshake.mockResolvedValue({ server_version: '1.0' });
    apiModule.requestChallenge.mockResolvedValue({ nonce: 'nonce' });
    apiModule.verifyChallenge.mockResolvedValueOnce({ token: JWT_A, user: USER_A });
    apiModule.getMyGuilds.mockResolvedValueOnce(GUILDS_A); // guild-1, guild-2

    const { result } = renderHook(() => useInstances());

    await waitFor(() => {
      expect(result.current.mergedGuilds.length).toBe(2);
    }, { timeout: 3000 });

    const ids = result.current.mergedGuilds.map(g => g.id);
    expect(ids[0]).toBe('guild-1');  // ordered
    expect(ids[1]).toBe('guild-2');  // appended
  });

  // ── disconnectInstance ────────────────────────────────────────────────────

  it('disconnectInstance closes WS and removes instance from state', async () => {
    const { useInstances } = await import('./useInstances.js');
    setupAuthMocks(JWT_A, USER_A, GUILDS_A);

    const { result } = renderHook(() => useInstances());
    await waitFor(() => expect(registryModule.openInstanceRegistry).toHaveBeenCalled());

    await act(async () => {
      await result.current.bootInstance(INSTANCE_A);
    });

    await waitFor(() => {
      expect(result.current.instanceStates.get(INSTANCE_A)?.connectionState).toBe('connected');
    });

    await act(async () => {
      await result.current.disconnectInstance(INSTANCE_A);
    });

    await waitFor(() => {
      expect(result.current.instanceStates.has(INSTANCE_A)).toBe(false);
    });

    expect(mockDisconnect).toHaveBeenCalled();
    expect(registryModule.removeInstance).toHaveBeenCalledWith(fakeDb, INSTANCE_A);
  });

  it('disconnectInstance removes guilds from mergedGuilds', async () => {
    const { useInstances } = await import('./useInstances.js');
    setupAuthMocks(JWT_A, USER_A, GUILDS_A);

    const { result } = renderHook(() => useInstances());
    await waitFor(() => expect(registryModule.openInstanceRegistry).toHaveBeenCalled());

    await act(async () => {
      await result.current.bootInstance(INSTANCE_A);
    });

    await waitFor(() => {
      expect(result.current.mergedGuilds.some(g => g.instanceUrl === INSTANCE_A)).toBe(true);
    });

    await act(async () => {
      await result.current.disconnectInstance(INSTANCE_A);
    });

    await waitFor(() => {
      expect(result.current.mergedGuilds.some(g => g.instanceUrl === INSTANCE_A)).toBe(false);
    });
  });

  // ── Reconnect state ───────────────────────────────────────────────────────

  it('connectionState becomes reconnecting when WS closes unexpectedly', async () => {
    const { useInstances } = await import('./useInstances.js');
    setupAuthMocks(JWT_A, USER_A, GUILDS_A);

    let closeHandler = null;
    mockOn.mockImplementation((event, handler) => {
      if (event === 'close') closeHandler = handler;
    });

    const { result } = renderHook(() => useInstances());
    await waitFor(() => expect(registryModule.openInstanceRegistry).toHaveBeenCalled());

    await act(async () => {
      await result.current.bootInstance(INSTANCE_A);
    });

    await waitFor(() => {
      expect(result.current.instanceStates.get(INSTANCE_A)?.connectionState).toBe('connected');
    });

    // Simulate unexpected WS close.
    await act(async () => {
      if (closeHandler) closeHandler({});
    });

    await waitFor(() => {
      const state = result.current.instanceStates.get(INSTANCE_A);
      expect(state?.connectionState).toBe('reconnecting');
    });
  });

  // ── Accessor functions ────────────────────────────────────────────────────

  it('getWsClient returns the WS client for a connected instance', async () => {
    const { useInstances } = await import('./useInstances.js');
    setupAuthMocks(JWT_A, USER_A, GUILDS_A);

    const { result } = renderHook(() => useInstances());
    await waitFor(() => expect(registryModule.openInstanceRegistry).toHaveBeenCalled());

    await act(async () => {
      await result.current.bootInstance(INSTANCE_A);
    });

    await waitFor(() => {
      expect(result.current.instanceStates.get(INSTANCE_A)?.connectionState).toBe('connected');
    });

    const client = result.current.getWsClient(INSTANCE_A);
    expect(client).toBeDefined();
    expect(typeof client?.send).toBe('function');
  });

  it('getWsClient returns null for unknown instance', async () => {
    const { useInstances } = await import('./useInstances.js');
    const { result } = renderHook(() => useInstances());
    await waitFor(() => expect(registryModule.openInstanceRegistry).toHaveBeenCalled());

    expect(result.current.getWsClient('https://unknown.example.com')).toBeNull();
  });

  it('getTokenForInstance returns the JWT for a connected instance', async () => {
    const { useInstances } = await import('./useInstances.js');
    setupAuthMocks(JWT_A, USER_A, GUILDS_A);

    const { result } = renderHook(() => useInstances());
    await waitFor(() => expect(registryModule.openInstanceRegistry).toHaveBeenCalled());

    await act(async () => {
      await result.current.bootInstance(INSTANCE_A);
    });

    await waitFor(() => {
      expect(result.current.instanceStates.get(INSTANCE_A)?.connectionState).toBe('connected');
    });

    expect(result.current.getTokenForInstance(INSTANCE_A)).toBe(JWT_A);
  });

  it('getTokenForInstance returns null for unknown instance', async () => {
    const { useInstances } = await import('./useInstances.js');
    const { result } = renderHook(() => useInstances());
    await waitFor(() => expect(registryModule.openInstanceRegistry).toHaveBeenCalled());

    expect(result.current.getTokenForInstance('https://unknown.example.com')).toBeNull();
  });

  // ── refreshGuilds ─────────────────────────────────────────────────────────

  it('refreshGuilds re-fetches guilds for a connected instance', async () => {
    const { useInstances } = await import('./useInstances.js');
    setupAuthMocks(JWT_A, USER_A, GUILDS_A);

    const { result } = renderHook(() => useInstances());
    await waitFor(() => expect(registryModule.openInstanceRegistry).toHaveBeenCalled());

    await act(async () => {
      await result.current.bootInstance(INSTANCE_A);
    });

    await waitFor(() => {
      expect(result.current.instanceStates.get(INSTANCE_A)?.connectionState).toBe('connected');
    });

    const updatedGuilds = [{ id: 'guild-99', encryptedMetadata: 'meta-99' }];
    apiModule.getMyGuilds.mockResolvedValueOnce(updatedGuilds);

    await act(async () => {
      await result.current.refreshGuilds(INSTANCE_A);
    });

    await waitFor(() => {
      const guild = result.current.mergedGuilds.find(g => g.id === 'guild-99');
      expect(guild?.instanceUrl).toBe(INSTANCE_A);
    });
  });
});

// ── InstanceContext tests ─────────────────────────────────────────────────────

describe('InstanceContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registryModule.openInstanceRegistry.mockResolvedValue(makeFakeDb());
    registryModule.getAllInstances.mockResolvedValue([]);
    registryModule.getGuildOrder.mockResolvedValue([]);
    useAuthMock.mockReturnValue({
      identityKeyRef: { current: FAKE_IDENTITY_KEY },
      user: { id: 'local-user', username: 'testuser' },
      token: 'local-jwt',
      vaultState: 'unlocked',
      loading: false,
    });
  });

  it('useInstanceContext throws when used outside InstanceProvider', async () => {
    const { useInstanceContext } = await import('../contexts/InstanceContext.jsx');

    expect(() => renderHook(() => useInstanceContext())).toThrow(
      /InstanceProvider/,
    );
  });

  it('useInstanceContext provides useInstances state inside InstanceProvider', async () => {
    const { InstanceProvider, useInstanceContext } = await import('../contexts/InstanceContext.jsx');

    const { result } = renderHook(() => useInstanceContext(), {
      wrapper: ({ children }) => (
        <InstanceProvider>{children}</InstanceProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current).toBeDefined();
      expect(typeof result.current.bootInstance).toBe('function');
      expect(Array.isArray(result.current.mergedGuilds)).toBe(true);
    });
  });
});
