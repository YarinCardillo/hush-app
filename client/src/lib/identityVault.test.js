/**
 * Tests for identityVault.js — AES-256-GCM vault encryption with PBKDF2-SHA256 PIN derivation
 * and IndexedDB persistence. Uses fake-indexeddb (auto-imported in setup.js).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptVault,
  decryptVault,
  openVaultStore,
  saveEncryptedKey,
  loadEncryptedKey,
  deleteVaultDatabase,
  getVaultConfig,
  setVaultConfig,
} from './identityVault.js';

// Helpers
function makePrivateKey() {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
}

describe('encryptVault / decryptVault round-trip', () => {
  beforeEach(() => {
    // Clear the PBKDF2 salt from localStorage before each test so each
    // test gets a fresh, consistent salt state.
    localStorage.clear();
  });

  it('decryptVault returns the original 32-byte private key', async () => {
    const pk = makePrivateKey();
    const pin = '1234';
    const blob = await encryptVault(pk, pin);
    const recovered = await decryptVault(blob, pin);
    expect(recovered).toBeInstanceOf(Uint8Array);
    expect(recovered).toHaveLength(32);
    expect(recovered).toEqual(pk);
  });

  it('encryptVault returns a Uint8Array longer than 32 bytes (nonce + ciphertext + GCM tag)', async () => {
    const pk = makePrivateKey();
    const blob = await encryptVault(pk, '5678');
    expect(blob).toBeInstanceOf(Uint8Array);
    // 12-byte nonce + 32-byte plaintext + 16-byte GCM tag = 60 minimum
    expect(blob.length).toBeGreaterThanOrEqual(60);
  });

  it('wrong PIN causes decryptVault to throw (AES-GCM tag mismatch)', async () => {
    const pk = makePrivateKey();
    const blob = await encryptVault(pk, 'correct-pin');
    await expect(decryptVault(blob, 'wrong-pin')).rejects.toThrow();
  });

  it('decrypt with same pin and same salt succeeds (deterministic key derivation)', async () => {
    const pk = makePrivateKey();
    const pin = 'stable-pin';
    // Both calls use the salt already stored by the first encryptVault call
    const blob = await encryptVault(pk, pin);
    const recovered1 = await decryptVault(blob, pin);
    const recovered2 = await decryptVault(blob, pin);
    expect(recovered1).toEqual(pk);
    expect(recovered2).toEqual(pk);
  });

  it('different nonces mean two encryptions of the same key produce different blobs', async () => {
    const pk = makePrivateKey();
    const pin = 'nonce-test';
    const blob1 = await encryptVault(pk, pin);
    const blob2 = await encryptVault(pk, pin);
    // Nonce differs so blobs should differ
    expect(blob1).not.toEqual(blob2);
    // But both decrypt correctly
    expect(await decryptVault(blob1, pin)).toEqual(pk);
    expect(await decryptVault(blob2, pin)).toEqual(pk);
  });

  it('nonce uniqueness: first 12 bytes of two blobs differ (crypto.getRandomValues not reused)', async () => {
    const pk = makePrivateKey();
    const pin = 'nonce-uniqueness-check';
    const blob1 = await encryptVault(pk, pin);
    const blob2 = await encryptVault(pk, pin);
    // Extract the 12-byte nonce prefix from each blob
    const nonce1 = blob1.slice(0, 12);
    const nonce2 = blob2.slice(0, 12);
    // Nonces MUST differ: AES-GCM security relies on nonce uniqueness per key.
    // If they match, two ciphertexts share a (nonce, key) pair — catastrophic.
    expect(nonce1).not.toEqual(nonce2);
  });
});

describe('openVaultStore / saveEncryptedKey / loadEncryptedKey', () => {
  const TEST_USER = 'user-abc-123';

  afterEach(async () => {
    await deleteVaultDatabase(TEST_USER);
  });

  it('openVaultStore returns a database object', async () => {
    const db = await openVaultStore(TEST_USER);
    expect(db).toBeTruthy();
    db.close();
  });

  it('saveEncryptedKey then loadEncryptedKey returns the same blob', async () => {
    const pk = makePrivateKey();
    localStorage.clear();
    const blob = await encryptVault(pk, '9999');

    const db = await openVaultStore(TEST_USER);
    await saveEncryptedKey(db, blob);
    const loaded = await loadEncryptedKey(db);
    db.close();

    expect(loaded).toBeInstanceOf(Uint8Array);
    expect(loaded).toEqual(blob);
  });

  it('loadEncryptedKey returns null when no key has been saved', async () => {
    const db = await openVaultStore(TEST_USER);
    const result = await loadEncryptedKey(db);
    db.close();
    expect(result).toBeNull();
  });
});

describe('deleteVaultDatabase', () => {
  it('does not throw when database does not exist', async () => {
    await expect(deleteVaultDatabase('nonexistent-user-xyz')).resolves.not.toThrow();
  });

  it('deletes the database so a subsequent open creates fresh store', async () => {
    const userId = 'delete-test-user';
    const pk = makePrivateKey();
    localStorage.clear();
    const blob = await encryptVault(pk, '0000');

    const db = await openVaultStore(userId);
    await saveEncryptedKey(db, blob);
    db.close();

    await deleteVaultDatabase(userId);

    // Re-open: should be fresh, no key stored
    const db2 = await openVaultStore(userId);
    const result = await loadEncryptedKey(db2);
    db2.close();
    expect(result).toBeNull();

    await deleteVaultDatabase(userId);
  });
});

describe('getVaultConfig / setVaultConfig', () => {
  const CONFIG_USER = 'config-test-user';

  beforeEach(() => {
    localStorage.removeItem(`hush_vault_config_${CONFIG_USER}`);
  });

  it('getVaultConfig returns null when no config is set', () => {
    const cfg = getVaultConfig(CONFIG_USER);
    expect(cfg).toBeNull();
  });

  it('setVaultConfig persists and getVaultConfig retrieves it', () => {
    const config = { timeout: 30, pinType: 'pin' };
    setVaultConfig(CONFIG_USER, config);
    const cfg = getVaultConfig(CONFIG_USER);
    expect(cfg).toEqual(config);
  });

  it('supports all valid timeout variants', () => {
    const timeouts = ['browser_close', 'refresh', 60, 'never'];
    for (const timeout of timeouts) {
      const config = { timeout, pinType: 'passphrase' };
      setVaultConfig(CONFIG_USER, config);
      expect(getVaultConfig(CONFIG_USER)).toEqual(config);
    }
  });

  it('overwrites previous config on second setVaultConfig call', () => {
    setVaultConfig(CONFIG_USER, { timeout: 'never', pinType: 'pin' });
    setVaultConfig(CONFIG_USER, { timeout: 15, pinType: 'passphrase' });
    expect(getVaultConfig(CONFIG_USER)).toEqual({ timeout: 15, pinType: 'passphrase' });
  });
});
