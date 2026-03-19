/**
 * Unit tests for hushCrypto.js WASM bridge.
 *
 * The WASM module is mocked so tests run without native binaries.
 * These tests assert that hushCrypto.js correctly maps camelCase WASM output
 * fields (emitted by serde_wasm_bindgen with #[serde(rename_all = "camelCase")])
 * to the returned JS objects. A regression here means all downstream callers
 * (uploadKeyPackages, useKeyPackageMaintenance, useMLS) receive empty Uint8Arrays.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the WASM module before importing hushCrypto so the module-level
// `module` variable is never populated with the real WASM binary.
vi.mock('../wasm/hush_crypto.js', () => {
  return {
    default: vi.fn().mockResolvedValue(undefined),
    init: vi.fn(),
    generateCredential: vi.fn((identity) => ({
      signingPublicKey: new Uint8Array([1, 2, 3]),
      signingPrivateKey: new Uint8Array([4, 5, 6]),
      credentialBytes: new Uint8Array([7, 8, 9]),
    })),
    generateKeyPackage: vi.fn((privKey, pubKey, cred) => ({
      keyPackageBytes: new Uint8Array([4, 5, 6]),
      privateKeyBytes: new Uint8Array([7, 8, 9]),
      hashRefBytes: new Uint8Array([10, 11, 12]),
    })),
  };
});

// Import AFTER mock registration so vitest replaces the module at load time.
import { generateCredential, generateKeyPackage, init } from './hushCrypto.js';

describe('hushCrypto WASM bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateCredential()', () => {
    it('returns non-undefined signingPublicKey, signingPrivateKey, and credentialBytes', async () => {
      const result = await generateCredential('user123:device1');

      expect(result.signingPublicKey).toBeDefined();
      expect(result.signingPrivateKey).toBeDefined();
      expect(result.credentialBytes).toBeDefined();
    });

    it('returns Uint8Arrays with length matching WASM mock output (not zero-length)', async () => {
      const result = await generateCredential('user123:device1');

      expect(result.signingPublicKey).toBeInstanceOf(Uint8Array);
      expect(result.signingPublicKey.length).toBe(3);

      expect(result.signingPrivateKey).toBeInstanceOf(Uint8Array);
      expect(result.signingPrivateKey.length).toBe(3);

      expect(result.credentialBytes).toBeInstanceOf(Uint8Array);
      expect(result.credentialBytes.length).toBe(3);
    });

    it('does not expose snake_case fields (camelCase contract enforced)', async () => {
      const result = await generateCredential('user123:device1');

      // These would be the result if snake_case keys were accessed — must remain undefined.
      expect((result).signing_public_key).toBeUndefined();
      expect((result).signing_private_key).toBeUndefined();
      expect((result).credential_bytes).toBeUndefined();
    });
  });

  describe('generateKeyPackage()', () => {
    it('returns non-undefined keyPackageBytes, privateKeyBytes, and hashRefBytes', async () => {
      const privKey = new Uint8Array([1, 2]);
      const pubKey = new Uint8Array([3, 4]);
      const cred = new Uint8Array([5, 6]);

      const result = await generateKeyPackage(privKey, pubKey, cred);

      expect(result.keyPackageBytes).toBeDefined();
      expect(result.privateKeyBytes).toBeDefined();
      expect(result.hashRefBytes).toBeDefined();
    });

    it('returns Uint8Arrays with length matching WASM mock output (not zero-length)', async () => {
      const privKey = new Uint8Array([1, 2]);
      const pubKey = new Uint8Array([3, 4]);
      const cred = new Uint8Array([5, 6]);

      const result = await generateKeyPackage(privKey, pubKey, cred);

      expect(result.keyPackageBytes).toBeInstanceOf(Uint8Array);
      expect(result.keyPackageBytes.length).toBe(3);

      expect(result.privateKeyBytes).toBeInstanceOf(Uint8Array);
      expect(result.privateKeyBytes.length).toBe(3);

      expect(result.hashRefBytes).toBeInstanceOf(Uint8Array);
      expect(result.hashRefBytes.length).toBe(3);
    });

    it('does not expose snake_case fields (camelCase contract enforced)', async () => {
      const privKey = new Uint8Array([1, 2]);
      const pubKey = new Uint8Array([3, 4]);
      const cred = new Uint8Array([5, 6]);

      const result = await generateKeyPackage(privKey, pubKey, cred);

      expect((result).key_package_bytes).toBeUndefined();
      expect((result).private_key_bytes).toBeUndefined();
      expect((result).hash_ref_bytes).toBeUndefined();
    });
  });

  describe('init() idempotency', () => {
    it('calling init() when module is already initialized does not re-invoke the WASM loader', async () => {
      // The module singleton is already populated by earlier tests in this file.
      // vi.clearAllMocks() in beforeEach reset all call counts to 0.
      // Calling init() on an already-initialized module must NOT call default() again.
      const wasmMod = await import('../wasm/hush_crypto.js');

      await init();
      await init();

      // Both calls should be pure no-ops: default() count stays at 0 after clearAllMocks.
      expect(wasmMod.default).toHaveBeenCalledTimes(0);
    });
  });
});
