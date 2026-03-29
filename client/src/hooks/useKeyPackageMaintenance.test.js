/**
 * Unit tests for useKeyPackageMaintenance hook.
 *
 * Focus: baseUrl threading — verifies that uploadMLSKeyPackages and
 * getKeyPackageCount receive baseUrl from the hook's bound deps, not as a
 * separate argument passed by the caller.
 *
 * The replenishment logic itself (key generation, last-resort rotation) is
 * integration-level behaviour tested elsewhere; here we only verify wiring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useKeyPackageMaintenance } from './useKeyPackageMaintenance';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock api.js so we can intercept upload and count calls.
vi.mock('../lib/api', () => ({
  uploadMLSKeyPackages: vi.fn(),
  getKeyPackageCount: vi.fn(),
}));
import * as apiModule from '../lib/api';

// Mock mlsStore so replenishKeyPackages can't open a real IndexedDB.
vi.mock('../lib/mlsStore', () => ({
  openStore: vi.fn(),
  getCredential: vi.fn(),
  setKeyPackage: vi.fn(),
  setLastResort: vi.fn(),
}));
import * as mlsStore from '../lib/mlsStore';

// Mock hushCrypto so generateKeyPackage returns deterministic results.
vi.mock('../lib/hushCrypto', () => ({
  generateKeyPackage: vi.fn(),
}));
import * as hushCrypto from '../lib/hushCrypto';

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE_URL = 'https://remote.instance.example.com';
const TOKEN = 'test-jwt-token';
const USER_ID = 'user-uuid-123';
const DEVICE_ID = 'device-uuid-456';

function makeDefaultProps(overrides = {}) {
  return {
    token: TOKEN,
    userId: USER_ID,
    deviceId: DEVICE_ID,
    threshold: 10,
    wsClient: null,
    baseUrl: BASE_URL,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useKeyPackageMaintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: count is above threshold, so no upload happens.
    apiModule.getKeyPackageCount.mockResolvedValue(50);
    apiModule.uploadMLSKeyPackages.mockResolvedValue(undefined);
  });

  // ── Test 1: getKeyPackageCount receives baseUrl via bound deps ───────────────

  it('calls getKeyPackageCount with bound baseUrl when count is above threshold', async () => {
    apiModule.getKeyPackageCount.mockResolvedValue(50); // above threshold

    renderHook(() => useKeyPackageMaintenance(makeDefaultProps()));

    await waitFor(() => {
      expect(apiModule.getKeyPackageCount).toHaveBeenCalled();
    });

    // The hook's useMemo binds baseUrl, so apiModule receives it as last arg.
    expect(apiModule.getKeyPackageCount).toHaveBeenCalledWith(TOKEN, DEVICE_ID, BASE_URL);
  });

  // ── Test 2: uploadMLSKeyPackages receives baseUrl via bound deps ─────────────

  it('calls uploadMLSKeyPackages with bound baseUrl when replenishing', async () => {
    // Count below threshold triggers replenishment.
    apiModule.getKeyPackageCount.mockResolvedValue(5);

    const mockDb = {};
    mlsStore.openStore.mockResolvedValue(mockDb);
    mlsStore.getCredential.mockResolvedValue({
      signingPrivateKey: new Uint8Array(32),
      signingPublicKey: new Uint8Array(32),
      credentialBytes: new Uint8Array(64),
    });
    mlsStore.setKeyPackage.mockResolvedValue(undefined);
    mlsStore.setLastResort.mockResolvedValue(undefined);

    const fakeKP = {
      keyPackageBytes: new Uint8Array([1, 2, 3]),
      privateKeyBytes: new Uint8Array([4, 5, 6]),
      hashRefBytes: new Uint8Array([7, 8, 9]),
    };
    hushCrypto.generateKeyPackage.mockResolvedValue(fakeKP);

    renderHook(() => useKeyPackageMaintenance(makeDefaultProps()));

    await waitFor(() => {
      expect(apiModule.uploadMLSKeyPackages).toHaveBeenCalled();
    }, { timeout: 10000 });

    // All upload calls should carry the baseUrl bound in deps.
    const calls = apiModule.uploadMLSKeyPackages.mock.calls;
    for (const call of calls) {
      expect(call[2], 'uploadMLSKeyPackages should receive baseUrl as 3rd arg').toBe(BASE_URL);
    }
  });

  // ── Test 3: useMemo rebuilds deps when baseUrl changes ───────────────────────

  it('re-creates bound api functions when baseUrl changes', async () => {
    apiModule.getKeyPackageCount.mockResolvedValue(50);

    const { rerender } = renderHook(
      (props) => useKeyPackageMaintenance(props),
      { initialProps: makeDefaultProps({ baseUrl: 'https://first.instance.com' }) },
    );

    await waitFor(() => expect(apiModule.getKeyPackageCount).toHaveBeenCalled());
    expect(apiModule.getKeyPackageCount).toHaveBeenLastCalledWith(
      TOKEN, DEVICE_ID, 'https://first.instance.com',
    );

    apiModule.getKeyPackageCount.mockClear();

    // Change baseUrl — the hook must re-run the on-mount effect with new bound URL.
    rerender(makeDefaultProps({ baseUrl: 'https://second.instance.com' }));

    await waitFor(() => expect(apiModule.getKeyPackageCount).toHaveBeenCalled());
    expect(apiModule.getKeyPackageCount).toHaveBeenLastCalledWith(
      TOKEN, DEVICE_ID, 'https://second.instance.com',
    );
  });

  // ── Test 4: hook does not run when baseUrl is null or undefined ──────────────

  it('does not call getKeyPackageCount when baseUrl is null', async () => {
    renderHook(() => useKeyPackageMaintenance(makeDefaultProps({ baseUrl: null })));

    // Flush microtasks — nothing should fire.
    await act(async () => {});

    expect(apiModule.getKeyPackageCount).not.toHaveBeenCalled();
  });

  it('does not call getKeyPackageCount when baseUrl is undefined', async () => {
    renderHook(() => useKeyPackageMaintenance(makeDefaultProps({ baseUrl: undefined })));

    await act(async () => {});

    expect(apiModule.getKeyPackageCount).not.toHaveBeenCalled();
  });

  it('calls getKeyPackageCount when baseUrl is empty string (same-origin)', async () => {
    apiModule.getKeyPackageCount.mockResolvedValue(50);

    renderHook(() => useKeyPackageMaintenance(makeDefaultProps({ baseUrl: '' })));

    await waitFor(() => expect(apiModule.getKeyPackageCount).toHaveBeenCalled());
    expect(apiModule.getKeyPackageCount).toHaveBeenCalledWith(TOKEN, DEVICE_ID, '');
  });
});
