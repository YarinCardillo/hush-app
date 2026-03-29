/**
 * useAuth BIP39 auth hook tests.
 *
 * Covers:
 *   - performLogout wipes all storage
 *   - unlockVault correct/incorrect PIN
 *   - PIN attempt counter increments and progressive delays
 *   - performRegister and performChallengeResponse happy path
 *   - Session rehydration: vault 'locked' when session flag absent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { JWT_KEY } from './useAuth';

// ── authInstanceStore mock (must be declared before module imports) ─────────────
let _mockActiveInstanceUrl = '';
vi.mock('../lib/authInstanceStore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getActiveAuthInstanceUrlSync: () => _mockActiveInstanceUrl,
  };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../lib/api', () => ({
  fetchWithAuth: vi.fn(),
  uploadKeyPackagesAfterAuth: vi.fn().mockResolvedValue(undefined),
  requestChallenge: vi.fn(),
  verifyChallenge: vi.fn(),
  registerWithPublicKey: vi.fn(),
  requestGuestSession: vi.fn(),
  listDeviceKeys: vi.fn().mockResolvedValue([]),
  revokeDeviceKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/bip39Identity', () => ({
  mnemonicToIdentityKey: vi.fn().mockResolvedValue({
    privateKey: new Uint8Array(32).fill(1),
    publicKey: new Uint8Array(32).fill(2),
  }),
  signChallenge: vi.fn().mockResolvedValue(new Uint8Array(64).fill(3)),
  signTransparencyEntry: vi.fn().mockResolvedValue({
    signature: new Uint8Array(64).fill(4),
  }),
}));

// Shared blob store (reset between tests via beforeEach).
const _vaultBlobs = new Map();

vi.mock('../lib/identityVault', () => ({
  encryptVault: vi.fn().mockImplementation(async (privateKey) => {
    const blob = new Uint8Array(privateKey.length + 12);
    blob.set(privateKey, 12);
    return blob;
  }),
  decryptVault: vi.fn().mockImplementation(async (blob, pin) => {
    if (pin === 'wrong') throw new DOMException('decryption failed', 'OperationError');
    return new Uint8Array(blob.slice(12));
  }),
  decryptVaultAndExportKey: vi.fn().mockImplementation(async (blob, pin) => {
    if (pin === 'wrong') throw new DOMException('decryption failed', 'OperationError');
    return { privateKey: new Uint8Array(blob.slice(12)), rawKeyHex: 'aabbccdd' };
  }),
  decryptVaultWithRawKey: vi.fn().mockImplementation(async (blob, rawKeyHex) => {
    if (rawKeyHex === 'bad-key') throw new DOMException('decryption failed', 'OperationError');
    return new Uint8Array(blob.slice(12));
  }),
  openVaultStore: vi.fn().mockImplementation(async (userId) => ({
    userId,
    close: vi.fn(),
  })),
  saveEncryptedKey: vi.fn().mockImplementation(async (db, blob) => {
    _vaultBlobs.set(db.userId, blob);
  }),
  loadEncryptedKey: vi.fn().mockImplementation(async (db) => {
    return _vaultBlobs.get(db.userId) ?? null;
  }),
  deleteVaultDatabase: vi.fn().mockResolvedValue(undefined),
  getVaultConfig: vi.fn().mockReturnValue(null),
  setVaultConfig: vi.fn(),
  bytesToHex: vi.fn().mockImplementation((bytes) =>
    Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join(''),
  ),
  hexToBytes: vi.fn().mockImplementation((hex) => {
    const result = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      result[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return result;
  }),
  saveSaltToIDB: vi.fn().mockResolvedValue(undefined),
  saveVaultMarkerToIDB: vi.fn().mockResolvedValue(undefined),
  checkVaultExistsInIDB: vi.fn().mockResolvedValue({ exists: false, publicKeyHex: null }),
  loadVaultMarkerFromIDB: vi.fn().mockResolvedValue(null),
}));

// ── Imports after mocks ────────────────────────────────────────────────────────

import * as apiMod from '../lib/api';
import * as vaultMod from '../lib/identityVault';
import {
  setInstanceToken,
  getInstanceToken,
  getLocalToken,
  clearSession,
} from './useAuth';

// ── Helpers ───────────────────────────────────────────────────────────────────

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

function mockFetchOk(body) {
  return { ok: true, json: () => Promise.resolve(body) };
}

/**
 * Builds a fake (unsigned) JWT with the given payload.
 * The client only reads the payload; it does not verify the signature.
 */
function buildFakeJwt(payload) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  _vaultBlobs.clear();
  _mockActiveInstanceUrl = '';

  vi.mocked(apiMod.fetchWithAuth).mockReset();
  vi.mocked(apiMod.fetchWithAuth).mockResolvedValue({ ok: false, status: 401 });
  vi.mocked(apiMod.uploadKeyPackagesAfterAuth).mockResolvedValue(undefined);
  vi.mocked(apiMod.requestChallenge).mockResolvedValue({ nonce: 'deadbeef' });
  vi.mocked(apiMod.verifyChallenge).mockResolvedValue({
    token: 'jwt-test',
    user: { id: 'user-1', username: 'alice', displayName: 'Alice' },
  });
  vi.mocked(apiMod.registerWithPublicKey).mockResolvedValue({
    token: 'jwt-register',
    user: { id: 'user-reg', username: 'newuser', displayName: 'New User' },
  });
  vi.mocked(apiMod.requestGuestSession).mockResolvedValue({
    token: 'jwt-guest',
    guestId: 'guest_abc123',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  vi.mocked(vaultMod.deleteVaultDatabase).mockClear();
  vi.mocked(vaultMod.saveEncryptedKey).mockClear();
  vi.mocked(vaultMod.encryptVault).mockClear();
  vi.mocked(vaultMod.openVaultStore).mockClear();
  vi.mocked(vaultMod.getVaultConfig).mockReturnValue(null);
  vi.mocked(vaultMod.setVaultConfig).mockClear();
});

afterEach(() => {
  cleanup();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useAuth — performChallengeResponse', () => {
  it('sets token and user on successful challenge-response', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performChallengeResponse(
        new Uint8Array(32).fill(1),
        new Uint8Array(32).fill(2),
      );
    });

    expect(result.current.token).toBe('jwt-test');
    expect(result.current.user?.id).toBe('user-1');
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.vaultState).toBe('unlocked');
    expect(sessionStorage.getItem(JWT_KEY)).toBe('jwt-test');
  });

  it('uses the provided auth instance for challenge verification and key upload', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performChallengeResponse(
        new Uint8Array(32).fill(1),
        new Uint8Array(32).fill(2),
        'https://chat.example.com',
      );
    });

    expect(apiMod.requestChallenge).toHaveBeenCalledWith(expect.any(String), 'https://chat.example.com');
    expect(apiMod.verifyChallenge).toHaveBeenCalledWith(
      expect.any(String),
      'deadbeef',
      expect.any(String),
      expect.any(String),
      'https://chat.example.com',
    );
    expect(apiMod.uploadKeyPackagesAfterAuth).toHaveBeenCalledWith(
      'jwt-test',
      'user-1',
      expect.any(String),
      {},
      'https://chat.example.com',
    );
  });

  it('persists public key hex in localStorage for vault detection', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performChallengeResponse(
        new Uint8Array(32).fill(1),
        new Uint8Array(32).fill(2),
      );
    });

    await waitFor(() => expect(result.current.user?.id).toBe('user-1'));

    const storedHex = localStorage.getItem('hush_vault_user_user-1');
    expect(storedHex).toBeTruthy();
    expect(typeof storedHex).toBe('string');
    expect(storedHex.length).toBe(64);
  });
});

describe('useAuth — performRegister', () => {
  it('registers, authenticates, and sets vaultState=unlocked', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performRegister('newuser', 'New User', 'word '.repeat(12).trim());
    });

    expect(result.current.token).toBe('jwt-register');
    expect(result.current.user?.id).toBe('user-reg');
    expect(result.current.vaultState).toBe('unlocked');
    expect(result.current.needsPinSetup).toBe(true);
    expect(sessionStorage.getItem(JWT_KEY)).toBe('jwt-register');
    expect(apiMod.registerWithPublicKey).toHaveBeenCalledOnce();
  });

  it('registers and uploads MLS state against the provided auth instance', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performRegister(
        'newuser',
        'New User',
        'word '.repeat(12).trim(),
        undefined,
        'https://chat.example.com',
      );
    });

    expect(apiMod.registerWithPublicKey).toHaveBeenCalledWith(
      'newuser',
      'New User',
      expect.any(String),
      expect.any(String),
      undefined,
      'https://chat.example.com',
      expect.any(String),
      expect.any(Number),
    );
    expect(apiMod.uploadKeyPackagesAfterAuth).toHaveBeenCalledWith(
      'jwt-register',
      'user-reg',
      expect.any(String),
      {},
      'https://chat.example.com',
    );
  });

  it('resets state on registration failure', async () => {
    vi.mocked(apiMod.registerWithPublicKey).mockRejectedValueOnce(new Error('username taken'));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      try {
        await result.current.performRegister('existing', 'User', 'some mnemonic');
      } catch { /* expected */ }
    });

    expect(result.current.vaultState).toBe('none');
    expect(result.current.token).toBeNull();
    expect(result.current.user).toBeNull();
    expect(result.current.needsPinSetup).toBe(false);
  });
});

describe('useAuth — unlockVault', () => {
  async function setupLockedVault(result) {
    // Complete auth to create user state.
    await act(async () => {
      await result.current.performChallengeResponse(
        new Uint8Array(32).fill(1),
        new Uint8Array(32).fill(2),
      );
    });
    await waitFor(() => expect(result.current.vaultState).toBe('unlocked'));

    // Save encrypted key.
    await act(async () => {
      await result.current.setPIN('correct');
    });

    // Lock the vault.
    act(() => result.current.lockVault());
    await waitFor(() => expect(result.current.vaultState).toBe('locked'));
  }

  it('unlockVault with correct PIN sets vaultState=unlocked', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await setupLockedVault(result);

    await act(async () => {
      await result.current.unlockVault('correct');
    });

    expect(result.current.vaultState).toBe('unlocked');
  });

  it('unlockVault with wrong PIN increments attempt counter', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await setupLockedVault(result);

    await act(async () => {
      try { await result.current.unlockVault('wrong'); } catch { /* expected */ }
    });

    const raw = localStorage.getItem('hush_pin_attempts_user-1');
    expect(raw).toBeTruthy();
    const record = JSON.parse(raw);
    expect(record.count).toBe(1);
  });

  it('unlockVault clears attempt counter on success after failures', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await setupLockedVault(result);

    // One failure.
    await act(async () => {
      try { await result.current.unlockVault('wrong'); } catch { /* expected */ }
    });

    // Correct PIN.
    await act(async () => {
      await result.current.unlockVault('correct');
    });

    const raw = localStorage.getItem('hush_pin_attempts_user-1');
    expect(raw).toBeNull();
  });

  it('unlockVault with wrong PIN throws WRONG_PIN error code', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await setupLockedVault(result);

    let caught;
    await act(async () => {
      try { await result.current.unlockVault('wrong'); } catch (err) { caught = err; }
    });

    expect(caught?.code).toBe('WRONG_PIN');
    expect(result.current.vaultState).toBe('locked');
  });
});

describe('useAuth — PIN attempt counter wipe after MAX_PIN_FAILURES', () => {
  it('wipes vault after 10 failures and throws VAULT_WIPED', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performChallengeResponse(
        new Uint8Array(32).fill(1),
        new Uint8Array(32).fill(2),
      );
    });
    await waitFor(() => expect(result.current.vaultState).toBe('unlocked'));

    await act(async () => { await result.current.setPIN('pin'); });
    act(() => result.current.lockVault());
    await waitFor(() => expect(result.current.vaultState).toBe('locked'));

    // Pre-seed to 9 failures (no delay imposed for count=9: threshold 9 → 60s).
    // Override with count=9 BUT disable the delay for the test by setting count to 5
    // so the 5-second delay kicks in… actually we need to avoid all delays.
    // Use count=0 pre-seed and just make decryptVault always throw.
    // The wipe fires at count REACHING 10, so seed at 9.
    // We need the 60s delay check to not block: mock pinDelayMs to return 0.
    // Since pinDelayMs is internal, let's just seed at count=9 and accept
    // that the 60s delay will apply. Instead, seed at count=2 so no delay.

    // Reset to count=9 — the wipe will happen but with 60s delay first.
    // Better: set count=9 but bypass delay by seeding to a count that has no delay
    // Delay table: threshold 9 → 60s, 7 → 30s, 5 → 5s, 3 → 1s, <3 → 0.
    // Use count=9 but only advances to 10 (wipe). The delay for count=9 is 60s → too slow.
    // Solution: Seed at count=9 but mock Date so it appears no time has passed.
    // Simpler: just pre-seed at count=8 (threshold≤8 → next entry is 9, delay=30s).
    // Actually, let's just make the initial failures cheap by pre-seeding to count=9
    // and mocking setTimeout to be immediate.

    // Use fake timers only for the delay portion.
    vi.useFakeTimers();

    localStorage.setItem(
      'hush_pin_attempts_user-1',
      JSON.stringify({ count: 9, lastAttemptAt: new Date().toISOString() }),
    );

    let caught;
    const unlockPromise = act(async () => {
      try { await result.current.unlockVault('wrong'); } catch (err) { caught = err; }
    });

    // Advance timers to skip the 60s delay.
    vi.advanceTimersByTime(61_000);

    await unlockPromise;
    vi.useRealTimers();

    expect(caught?.code).toBe('VAULT_WIPED');
    expect(result.current.vaultState).toBe('none');
    expect(vaultMod.deleteVaultDatabase).toHaveBeenCalledWith('user-1');
    expect(sessionStorage.getItem(JWT_KEY)).toBeNull();
  }, 15_000);
});

describe('useAuth — performLogout', () => {
  it('clears all storage and resets state', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performChallengeResponse(
        new Uint8Array(32).fill(1),
        new Uint8Array(32).fill(2),
      );
    });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    // Seed some storage to verify wipe.
    localStorage.setItem('test_key', 'test_value');
    sessionStorage.setItem('test_key', 'test_value');

    vi.mocked(apiMod.fetchWithAuth).mockResolvedValue({ ok: true, status: 204 });

    await act(async () => {
      await result.current.performLogout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.vaultState).toBe('none');
    expect(result.current.token).toBeNull();
    expect(result.current.user).toBeNull();
    expect(sessionStorage.getItem(JWT_KEY)).toBeNull();
    expect(localStorage.getItem('test_key')).toBeNull();
    expect(sessionStorage.getItem('test_key')).toBeNull();
  });

  it('calls deleteVaultDatabase for the logged-in user', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performChallengeResponse(
        new Uint8Array(32).fill(1),
        new Uint8Array(32).fill(2),
      );
    });
    await waitFor(() => expect(result.current.user?.id).toBe('user-1'));

    vi.mocked(apiMod.fetchWithAuth).mockResolvedValue({ ok: true, status: 204 });

    await act(async () => {
      await result.current.performLogout();
    });

    expect(vaultMod.deleteVaultDatabase).toHaveBeenCalledWith('user-1');
  });

  it('proceeds with full local wipe even if server call fails', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performChallengeResponse(
        new Uint8Array(32).fill(1),
        new Uint8Array(32).fill(2),
      );
    });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    vi.mocked(apiMod.fetchWithAuth).mockRejectedValue(new Error('network error'));

    let threw = false;
    await act(async () => {
      try { await result.current.performLogout(); } catch { threw = true; }
    });

    expect(threw).toBe(false);
    expect(result.current.vaultState).toBe('none');
  });
});

describe('useAuth — session rehydration', () => {
  it('sets vaultState=locked when JWT exists but session flag is absent (vault blob exists)', async () => {
    sessionStorage.setItem(JWT_KEY, 'valid-jwt');
    localStorage.setItem('hush_vault_user_user-42', 'aabb');
    // No VAULT_SESSION_FLAG.

    // Vault blob must exist in IDB — otherwise it's a stale marker (PIN never set).
    const fakeBlob = new Uint8Array(44);
    fakeBlob.set(new Uint8Array(32).fill(1), 12);
    _vaultBlobs.set('user-42', fakeBlob);

    vi.mocked(apiMod.fetchWithAuth).mockResolvedValue(
      mockFetchOk({ id: 'user-42', username: 'eve', displayName: 'Eve' }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.vaultState).toBe('locked');
  });

  it('sets vaultState=unlocked when vault marker exists but no blob (PIN never set)', async () => {
    sessionStorage.setItem(JWT_KEY, 'valid-jwt');
    localStorage.setItem('hush_vault_user_user-42', 'aabb');
    // No blob in _vaultBlobs — simulates registration without PIN setup.

    vi.mocked(apiMod.fetchWithAuth).mockResolvedValue(
      mockFetchOk({ id: 'user-42', username: 'eve', displayName: 'Eve' }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.vaultState).toBe('unlocked');
    // Stale marker should be cleared.
    expect(localStorage.getItem('hush_vault_user_user-42')).toBeNull();
  });

  it('preserves pending pin setup across refresh when JWT is still valid', async () => {
    sessionStorage.setItem(JWT_KEY, 'valid-jwt');
    sessionStorage.setItem('hush_pin_setup_pending', '1');

    vi.mocked(apiMod.fetchWithAuth).mockResolvedValue(
      mockFetchOk({ id: 'user-42', username: 'eve', displayName: 'Eve' }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.vaultState).toBe('unlocked');
    expect(result.current.needsPinSetup).toBe(true);
  });

  it('auto-unlocks vault when JWT, session flag, AND derived key all exist (refresh)', async () => {
    // Soft refresh: JWT valid, session alive, and the derived AES key from a
    // prior PIN entry is in sessionStorage. The vault should auto-decrypt
    // without showing the PIN screen.
    sessionStorage.setItem(JWT_KEY, 'valid-jwt');
    sessionStorage.setItem('hush_vault_session_alive', '1');
    sessionStorage.setItem('hush_vault_derived_key', 'aabbccdd');
    localStorage.setItem('hush_vault_user_user-43', 'aabb');

    // Populate the vault blob so loadEncryptedKey returns something.
    const fakeBlob = new Uint8Array(44); // 12-byte nonce + 32-byte key
    fakeBlob.set(new Uint8Array(32).fill(1), 12);
    _vaultBlobs.set('user-43', fakeBlob);

    vi.mocked(apiMod.fetchWithAuth).mockResolvedValue(
      mockFetchOk({ id: 'user-43', username: 'frank', displayName: 'Frank' }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.vaultState).toBe('unlocked');
    expect(vaultMod.decryptVaultWithRawKey).toHaveBeenCalledWith(fakeBlob, 'aabbccdd');
  });

  it('migrates the legacy global vault timeout key into the per-user config on startup', async () => {
    sessionStorage.setItem(JWT_KEY, 'valid-jwt');
    sessionStorage.setItem('hush_vault_session_alive', '1');
    sessionStorage.setItem('hush_vault_derived_key', 'aabbccdd');
    localStorage.setItem('hush_vault_timeout', '15m');
    localStorage.setItem('hush_vault_user_user-43', 'aabb');

    const fakeBlob = new Uint8Array(44);
    fakeBlob.set(new Uint8Array(32).fill(1), 12);
    _vaultBlobs.set('user-43', fakeBlob);

    vi.mocked(apiMod.fetchWithAuth).mockResolvedValue(
      mockFetchOk({ id: 'user-43', username: 'frank', displayName: 'Frank' }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(vaultMod.setVaultConfig).toHaveBeenCalledWith(
      'user-43',
      { timeout: 15, pinType: 'pin' },
    );
    expect(localStorage.getItem('hush_vault_timeout')).toBeNull();
    expect(result.current.vaultState).toBe('unlocked');
  });

  it('sets vaultState=locked when JWT and session flag exist but derived key is absent (vault blob exists)', async () => {
    // Session alive but no derived key — vault timeout='refresh' cleared it,
    // or this is the first load after browser restart. Must prompt for PIN.
    sessionStorage.setItem(JWT_KEY, 'valid-jwt');
    sessionStorage.setItem('hush_vault_session_alive', '1');
    // No hush_vault_derived_key set.
    localStorage.setItem('hush_vault_user_user-43', 'aabb');

    // Vault blob must exist — otherwise it's a stale marker.
    const fakeBlob = new Uint8Array(44);
    fakeBlob.set(new Uint8Array(32).fill(1), 12);
    _vaultBlobs.set('user-43', fakeBlob);

    vi.mocked(apiMod.fetchWithAuth).mockResolvedValue(
      mockFetchOk({ id: 'user-43', username: 'frank', displayName: 'Frank' }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.vaultState).toBe('locked');
  });

  it('falls back to locked if stored derived key fails to decrypt', async () => {
    // Derived key in sessionStorage is corrupt or stale — auto-unlock fails,
    // should fall back to PIN screen.
    sessionStorage.setItem(JWT_KEY, 'valid-jwt');
    sessionStorage.setItem('hush_vault_session_alive', '1');
    sessionStorage.setItem('hush_vault_derived_key', 'bad-key');
    localStorage.setItem('hush_vault_user_user-43', 'aabb');

    const fakeBlob = new Uint8Array(44);
    _vaultBlobs.set('user-43', fakeBlob);

    vi.mocked(apiMod.fetchWithAuth).mockResolvedValue(
      mockFetchOk({ id: 'user-43', username: 'frank', displayName: 'Frank' }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.vaultState).toBe('locked');
    // Bad key should be cleared from sessionStorage.
    expect(sessionStorage.getItem('hush_vault_derived_key')).toBeNull();
  });

  it('sets vaultState=none when JWT is invalid (401)', async () => {
    sessionStorage.setItem(JWT_KEY, 'bad-jwt');
    vi.mocked(apiMod.fetchWithAuth).mockResolvedValue({ ok: false, status: 401 });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.vaultState).toBe('none');
    expect(sessionStorage.getItem(JWT_KEY)).toBeNull();
  });

  it('sets vaultState=none when no JWT present', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.vaultState).toBe('none');
    expect(result.current.isAuthenticated).toBe(false);
  });
});

describe('useAuth — setPIN', () => {
  it('encrypts and saves key after unlock', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performRegister('newuser', 'New User', 'word '.repeat(12).trim());
    });
    await waitFor(() => expect(result.current.vaultState).toBe('unlocked'));
    expect(result.current.needsPinSetup).toBe(true);

    await act(async () => {
      await result.current.setPIN('my-secret-pin');
    });

    expect(vaultMod.encryptVault).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'my-secret-pin',
    );
    expect(vaultMod.saveEncryptedKey).toHaveBeenCalled();
    expect(result.current.needsPinSetup).toBe(false);
  });

  it('throws if called without identity key in memory', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let caught;
    await act(async () => {
      try { await result.current.setPIN('pin'); } catch (err) { caught = err; }
    });

    expect(caught?.message).toMatch(/no identity key/i);
  });
});

describe('useAuth — skipPinSetup', () => {
  it('clears the pending pin-setup state without logging out', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performRegister('newuser', 'New User', 'word '.repeat(12).trim());
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.needsPinSetup).toBe(true);

    act(() => {
      result.current.skipPinSetup();
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.needsPinSetup).toBe(false);
  });
});

describe('useAuth — lockVault', () => {
  it('sets vaultState=locked without deleting vault data', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performChallengeResponse(
        new Uint8Array(32).fill(1),
        new Uint8Array(32).fill(2),
      );
    });
    await waitFor(() => expect(result.current.vaultState).toBe('unlocked'));

    act(() => result.current.lockVault());
    await waitFor(() => expect(result.current.vaultState).toBe('locked'));

    expect(vaultMod.deleteVaultDatabase).not.toHaveBeenCalled();
  });

  it('removes a stale refresh handler when vault timeout changes while unlocked', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performChallengeResponse(
        new Uint8Array(32).fill(1),
        new Uint8Array(32).fill(2),
      );
    });
    await waitFor(() => expect(result.current.vaultState).toBe('unlocked'));

    sessionStorage.setItem('hush_vault_derived_key', 'secret');

    act(() => {
      result.current.updateVaultTimeout('refresh');
    });

    act(() => {
      result.current.updateVaultTimeout('browser_close');
    });

    window.dispatchEvent(new Event('beforeunload'));

    expect(vaultMod.setVaultConfig).toHaveBeenNthCalledWith(
      1,
      'user-1',
      { timeout: 'refresh', pinType: 'pin' },
    );
    expect(vaultMod.setVaultConfig).toHaveBeenNthCalledWith(
      2,
      'user-1',
      { timeout: 'browser_close', pinType: 'pin' },
    );
    expect(sessionStorage.getItem('hush_vault_derived_key')).toBe('secret');
  });
});

// ── Guest session ──────────────────────────────────────────────────────────────

describe('useAuth — guest session', () => {
  /**
   * Builds a fake JWT with is_guest=true and the given expiry.
   * The client reads claims from the payload only (no sig verification).
   */
  function makeGuestJwt(expiresAtMs) {
    const payload = {
      sub: 'guest_abc123',
      sid: 'sess-guest-1',
      is_guest: true,
      exp: Math.floor(expiresAtMs / 1000),
      iat: Math.floor(Date.now() / 1000),
    };
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = btoa(JSON.stringify(payload));
    return `${header}.${body}.fake-sig`;
  }

  it('performGuestAuth sets isGuest=true and guestExpiresAt', async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const guestToken = makeGuestJwt(new Date(expiresAt).getTime());
    vi.mocked(apiMod.requestGuestSession).mockResolvedValue({
      token: guestToken,
      guestId: 'guest_abc123',
      expiresAt,
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performGuestAuth();
    });

    expect(result.current.isGuest).toBe(true);
    expect(result.current.guestExpiresAt).toBe(expiresAt);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.vaultState).toBe('unlocked');
  });

  it('guest JWT with T-5min remaining triggers hush_guest_expiry_warning event', async () => {
    // Expires in exactly 5 minutes — warning fires immediately (warningMs <= 0).
    const expiresAtMs = Date.now() + 5 * 60 * 1000;
    const guestToken = makeGuestJwt(expiresAtMs);
    vi.mocked(apiMod.requestGuestSession).mockResolvedValue({
      token: guestToken,
      guestId: 'guest_abc123',
      expiresAt: new Date(expiresAtMs).toISOString(),
    });

    const warningHandler = vi.fn();
    window.addEventListener('hush_guest_expiry_warning', warningHandler);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performGuestAuth();
    });

    // The warning fires synchronously when <= 5 min remaining.
    expect(warningHandler).toHaveBeenCalledOnce();
    window.removeEventListener('hush_guest_expiry_warning', warningHandler);
  });

  it('guest session expiry fires hush_guest_session_expired event and resets state', async () => {
    // Very short expiry so we can use real timers with a short wait.
    const expiresAtMs = Date.now() + 300;
    const guestToken = makeGuestJwt(expiresAtMs);
    vi.mocked(apiMod.requestGuestSession).mockResolvedValue({
      token: guestToken,
      guestId: 'guest_abc123',
      expiresAt: new Date(expiresAtMs).toISOString(),
    });

    const expiredHandler = vi.fn();
    window.addEventListener('hush_guest_session_expired', expiredHandler);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performGuestAuth();
    });

    expect(result.current.isGuest).toBe(true);

    // Wait for the expiry timer to fire (300ms).
    await waitFor(() => expect(expiredHandler).toHaveBeenCalledOnce(), { timeout: 3000 });
    await waitFor(() => expect(result.current.isGuest).toBe(false), { timeout: 3000 });
    expect(result.current.isAuthenticated).toBe(false);

    window.removeEventListener('hush_guest_session_expired', expiredHandler);
  }, 10_000);

  it('performGuestAuth failure resets state', async () => {
    vi.mocked(apiMod.requestGuestSession).mockRejectedValueOnce(new Error('server error'));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      try { await result.current.performGuestAuth(); } catch { /* expected */ }
    });

    expect(result.current.isGuest).toBe(false);
    expect(result.current.token).toBeNull();
    expect(result.current.vaultState).toBe('none');
  });
});

// ── Per-instance JWT storage ───────────────────────────────────────────────────

describe('useAuth — per-instance JWT storage', () => {
  it('setInstanceToken stores at the host-namespaced key', () => {
    setInstanceToken('https://chat.example.com', 'token-a');
    expect(sessionStorage.getItem('hush_jwt_chat.example.com')).toBe('token-a');
    expect(sessionStorage.getItem(JWT_KEY)).toBeNull();
  });

  it('getInstanceToken reads from the host-namespaced key', () => {
    sessionStorage.setItem('hush_jwt_chat.example.com', 'token-b');
    expect(getInstanceToken('https://chat.example.com')).toBe('token-b');
  });

  it('getLocalToken reads from the active instance namespaced key', () => {
    _mockActiveInstanceUrl = 'https://chat.example.com';
    sessionStorage.setItem('hush_jwt_chat.example.com', 'token-active');
    expect(getLocalToken()).toBe('token-active');
  });

  it('clearSession removes all hush_jwt_* keys', () => {
    sessionStorage.setItem('hush_jwt_chat.example.com', 'token-a');
    sessionStorage.setItem('hush_jwt_other.host.net', 'token-b');
    sessionStorage.setItem(JWT_KEY, 'token-legacy');
    sessionStorage.setItem('hush_vault_session_alive', '1');
    clearSession();
    expect(sessionStorage.getItem('hush_jwt_chat.example.com')).toBeNull();
    expect(sessionStorage.getItem('hush_jwt_other.host.net')).toBeNull();
    expect(sessionStorage.getItem(JWT_KEY)).toBeNull();
    // Non-JWT keys should not be touched by clearSession (vault session flag cleared separately).
  });

  it('legacy migration: hush_jwt migrated to namespaced key on first getLocalToken read', () => {
    _mockActiveInstanceUrl = 'https://chat.example.com';
    sessionStorage.setItem(JWT_KEY, 'legacy-token');
    const token = getLocalToken();
    expect(token).toBe('legacy-token');
    expect(sessionStorage.getItem('hush_jwt_chat.example.com')).toBe('legacy-token');
    expect(sessionStorage.getItem(JWT_KEY)).toBeNull();
  });

  it('two instances can store and retrieve different tokens simultaneously', () => {
    setInstanceToken('https://instance-a.com', 'jwt-a');
    setInstanceToken('https://instance-b.com', 'jwt-b');
    expect(getInstanceToken('https://instance-a.com')).toBe('jwt-a');
    expect(getInstanceToken('https://instance-b.com')).toBe('jwt-b');
    expect(getInstanceToken('https://instance-a.com')).not.toBe(getInstanceToken('https://instance-b.com'));
  });
});
