import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const createWsClient = vi.hoisted(() => vi.fn(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
})));

const openInstanceRegistry = vi.hoisted(() => vi.fn());
const saveInstance = vi.hoisted(() => vi.fn());
const getAllInstances = vi.hoisted(() => vi.fn());
const getGuildOrder = vi.hoisted(() => vi.fn());

const getMyGuilds = vi.hoisted(() => vi.fn());
const useAuth = vi.hoisted(() => vi.fn());
const getDeviceId = vi.hoisted(() => vi.fn(() => 'device-1'));

vi.mock('../lib/ws.js', () => ({
  createWsClient,
}));

vi.mock('../lib/instanceRegistry.js', () => ({
  openInstanceRegistry,
  saveInstance,
  getAllInstances,
  removeInstance: vi.fn(),
  saveGuildOrder: vi.fn(),
  getGuildOrder,
}));

vi.mock('../lib/api.js', () => ({
  getHandshake: vi.fn(),
  requestChallenge: vi.fn(),
  verifyChallenge: vi.fn(),
  registerWithPublicKey: vi.fn(),
  getMyGuilds,
  fetchWithAuth: vi.fn(),
}));

vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth,
}));

vi.mock('./useAuth.js', () => ({
  getDeviceId,
}));

describe('useInstances active auth instance boot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();

    openInstanceRegistry.mockResolvedValue({ close: vi.fn() });
    getAllInstances.mockResolvedValue([]);
    getGuildOrder.mockResolvedValue([]);
    saveInstance.mockResolvedValue(undefined);
    getMyGuilds.mockResolvedValue([]);
    useAuth.mockReturnValue({
      identityKeyRef: {
        current: {
          privateKey: new Uint8Array(32).fill(1),
          publicKey: new Uint8Array(32).fill(2),
        },
      },
      user: { id: 'user-1', username: 'alice' },
      vaultState: 'unlocked',
      loading: false,
    });
  });

  it('registers the active auth instance instead of defaulting to the current origin', async () => {
    const primaryInstanceUrl = 'https://chat.example.com';
    localStorage.setItem('hush_auth_instance_selected', primaryInstanceUrl);
    sessionStorage.setItem('hush_auth_instance_active', primaryInstanceUrl);
    sessionStorage.setItem('hush_jwt', 'local-jwt');

    const { useInstances } = await import('./useInstances.js');
    const { result } = renderHook(() => useInstances());

    await waitFor(() => {
      expect(result.current.instanceStates.has(primaryInstanceUrl)).toBe(true);
    });

    expect(saveInstance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        instanceUrl: primaryInstanceUrl,
        jwt: 'local-jwt',
      }),
    );
  });
});
