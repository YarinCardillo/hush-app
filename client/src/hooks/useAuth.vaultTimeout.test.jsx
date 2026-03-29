import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';

vi.mock('../lib/api', () => ({
  fetchWithAuth: vi.fn(),
  uploadKeyPackagesAfterAuth: vi.fn().mockResolvedValue(undefined),
  requestChallenge: vi.fn().mockResolvedValue({ nonce: 'deadbeef' }),
  verifyChallenge: vi.fn().mockResolvedValue({
    token: 'jwt-test',
    user: { id: 'user-1', username: 'alice', displayName: 'Alice' },
  }),
  registerWithPublicKey: vi.fn(),
  requestGuestSession: vi.fn(),
}));

vi.mock('../lib/bip39Identity', () => ({
  mnemonicToIdentityKey: vi.fn(),
  signChallenge: vi.fn().mockResolvedValue(new Uint8Array(64).fill(3)),
  signTransparencyEntry: vi.fn().mockResolvedValue({
    signature: new Uint8Array(64).fill(4),
  }),
}));

const vaultBlobs = new Map();
const vaultConfigs = new Map();

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
    vaultBlobs.set(db.userId, blob);
  }),
  loadEncryptedKey: vi.fn().mockImplementation(async (db) => vaultBlobs.get(db.userId) ?? null),
  deleteVaultDatabase: vi.fn().mockResolvedValue(undefined),
  getVaultConfig: vi.fn().mockImplementation((userId) => vaultConfigs.get(userId) ?? null),
  setVaultConfig: vi.fn().mockImplementation((userId, config) => {
    vaultConfigs.set(userId, config);
  }),
  bytesToHex: vi.fn().mockImplementation((bytes) => (
    Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  )),
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

function wrapper({ children }) {
  return <AuthProvider>{children}</AuthProvider>;
}

async function unlockPersistedVault(result) {
  await act(async () => {
    await result.current.performChallengeResponse(
      new Uint8Array(32).fill(1),
      new Uint8Array(32).fill(2),
    );
  });
  await waitFor(() => expect(result.current.vaultState).toBe('unlocked'));

  await act(async () => {
    await result.current.setPIN('correct');
  });

  act(() => {
    result.current.lockVault();
  });
  await waitFor(() => expect(result.current.vaultState).toBe('locked'));

  await act(async () => {
    await result.current.unlockVault('correct');
  });
  await waitFor(() => expect(result.current.vaultState).toBe('unlocked'));
}

describe('useAuth — vault timeout', () => {
  beforeEach(() => {
    cleanup();
    sessionStorage.clear();
    localStorage.clear();
    vaultBlobs.clear();
    vaultConfigs.clear();
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('locks after the active-tab timeout and requires PIN re-entry to restore state', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await unlockPersistedVault(result);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T00:00:00.000Z'));

    const initialUserId = result.current.user?.id;
    const initialToken = result.current.token;

    act(() => {
      result.current.updateVaultTimeout(5);
    });

    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    });

    expect(result.current.vaultState).toBe('locked');
    expect(result.current.user?.id).toBe(initialUserId);
    expect(result.current.token).toBe(initialToken);

    await act(async () => {
      await result.current.unlockVault('correct');
    });

    expect(result.current.vaultState).toBe('unlocked');
    expect(result.current.user?.id).toBe(initialUserId);
    expect(result.current.token).toBe(initialToken);
  });

  it('locks immediately when the tab resumes after the inactivity deadline passed', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await unlockPersistedVault(result);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T00:00:00.000Z'));

    act(() => {
      result.current.updateVaultTimeout(5);
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });

    act(() => {
      vi.setSystemTime(new Date('2026-03-29T00:05:30.000Z'));
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.vaultState).toBe('locked');
  });
});
