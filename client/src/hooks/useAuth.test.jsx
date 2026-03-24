/**
 * useAuth BIP39 auth hook tests.
 *
 * Covers:
 *   - performLogout wipes all storage
 *   - unlockVault correct/incorrect PIN
 *   - PIN attempt counter increments and progressive delays
 *   - Guest session uses sessionStorage only, not IDB
 *   - performRegister and performChallengeResponse happy path
 *   - Session rehydration: vault 'locked' when session flag absent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { JWT_KEY, GUEST_SESSION_KEY } from './useAuth';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../lib/api', () => ({
  fetchWithAuth: vi.fn(),
  uploadKeyPackagesAfterAuth: vi.fn().mockResolvedValue(undefined),
  requestChallenge: vi.fn(),
  verifyChallenge: vi.fn(),
  registerWithPublicKey: vi.fn(),
  loginGuest: vi.fn(),
  listDeviceKeys: vi.fn().mockResolvedValue([]),
  revokeDeviceKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/bip39Identity', () => ({
  mnemonicToIdentityKey: vi.fn().mockResolvedValue({
    privateKey: new Uint8Array(32).fill(1),
    publicKey: new Uint8Array(32).fill(2),
  }),
  signChallenge: vi.fn().mockResolvedValue(new Uint8Array(64).fill(3)),
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
}));

// ── Imports after mocks ────────────────────────────────────────────────────────

import * as apiMod from '../lib/api';
import * as vaultMod from '../lib/identityVault';

// ── Helpers ───────────────────────────────────────────────────────────────────

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

function mockFetchOk(body) {
  return { ok: true, json: () => Promise.resolve(body) };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  _vaultBlobs.clear();

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
  vi.mocked(apiMod.loginGuest).mockResolvedValue({
    token: 'jwt-guest',
    user: { id: 'user-guest', username: 'guest', displayName: 'Guest' },
  });
  vi.mocked(vaultMod.deleteVaultDatabase).mockClear();
  vi.mocked(vaultMod.saveEncryptedKey).mockClear();
  vi.mocked(vaultMod.encryptVault).mockClear();
  vi.mocked(vaultMod.openVaultStore).mockClear();
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
    expect(sessionStorage.getItem(JWT_KEY)).toBe('jwt-register');
    expect(apiMod.registerWithPublicKey).toHaveBeenCalledOnce();
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
  });
});

describe('useAuth — performGuestLogin', () => {
  it('stores token in sessionStorage and sets vaultState=guest', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performGuestLogin();
    });

    expect(result.current.vaultState).toBe('guest');
    expect(result.current.token).toBe('jwt-guest');
    expect(result.current.user?.id).toBe('user-guest');
    expect(sessionStorage.getItem(JWT_KEY)).toBe('jwt-guest');
    expect(sessionStorage.getItem(GUEST_SESSION_KEY)).toBe('1');
  });

  it('does not persist identity key to IDB for guest session', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performGuestLogin('join-code-abc');
    });

    expect(vaultMod.saveEncryptedKey).not.toHaveBeenCalled();
    expect(vaultMod.openVaultStore).not.toHaveBeenCalled();
  });

  it('does not set vault user key in localStorage for guest', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performGuestLogin();
    });

    expect(result.current.vaultState).toBe('guest');

    const vaultKeys = Object.keys(localStorage).filter(k => k.startsWith('hush_vault_user_'));
    expect(vaultKeys).toHaveLength(0);
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
  it('sets vaultState=locked when JWT exists but session flag is absent', async () => {
    sessionStorage.setItem(JWT_KEY, 'valid-jwt');
    localStorage.setItem('hush_vault_user_user-42', 'aabb');
    // No VAULT_SESSION_FLAG.

    vi.mocked(apiMod.fetchWithAuth).mockResolvedValue(
      mockFetchOk({ id: 'user-42', username: 'eve', displayName: 'Eve' }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.vaultState).toBe('locked');
  });

  it('sets vaultState=unlocked when JWT and session flag both exist', async () => {
    sessionStorage.setItem(JWT_KEY, 'valid-jwt');
    sessionStorage.setItem('hush_vault_session_alive', '1');
    localStorage.setItem('hush_vault_user_user-43', 'aabb');

    vi.mocked(apiMod.fetchWithAuth).mockResolvedValue(
      mockFetchOk({ id: 'user-43', username: 'frank', displayName: 'Frank' }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.vaultState).toBe('unlocked');
  });

  it('sets vaultState=none when JWT is invalid (401)', async () => {
    sessionStorage.setItem(JWT_KEY, 'bad-jwt');
    vi.mocked(apiMod.fetchWithAuth).mockResolvedValue({ ok: false, status: 401 });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.vaultState).toBe('none');
    expect(sessionStorage.getItem(JWT_KEY)).toBeNull();
  });

  it('sets vaultState=guest when GUEST_SESSION_KEY is present', async () => {
    sessionStorage.setItem(JWT_KEY, 'guest-jwt');
    sessionStorage.setItem(GUEST_SESSION_KEY, '1');

    vi.mocked(apiMod.fetchWithAuth).mockResolvedValue(
      mockFetchOk({ id: 'user-guest', username: 'guest', displayName: 'Guest' }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.vaultState).toBe('guest');
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
      await result.current.performChallengeResponse(
        new Uint8Array(32).fill(1),
        new Uint8Array(32).fill(2),
      );
    });
    await waitFor(() => expect(result.current.vaultState).toBe('unlocked'));

    await act(async () => {
      await result.current.setPIN('my-secret-pin');
    });

    expect(vaultMod.encryptVault).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'my-secret-pin',
    );
    expect(vaultMod.saveEncryptedKey).toHaveBeenCalled();
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
});
