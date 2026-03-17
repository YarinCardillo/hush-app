/**
 * Tests for uploadKeyPackages.js (MLS initial credential + KeyPackage upload).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadKeyPackagesAfterAuth } from './uploadKeyPackages';

const TOKEN = 'test-jwt';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const DEVICE_ID = 'device-1';

/** Minimal credential returned by mock WASM generateCredential. */
function makeMockCredential() {
  return {
    signingPublicKey: new Uint8Array(32).fill(0x01),
    signingPrivateKey: new Uint8Array(64).fill(0x02),
    credentialBytes: new Uint8Array(64).fill(0x03),
  };
}

/** Minimal KeyPackage returned by mock WASM generateKeyPackage. */
let kpCounter = 0;
function makeMockKeyPackage() {
  kpCounter++;
  return {
    keyPackageBytes: new Uint8Array([kpCounter]),
    privateKeyBytes: new Uint8Array(64).fill(kpCounter),
    hashRefBytes: new Uint8Array(32).fill(kpCounter),
  };
}

function createMockMlsStore(credentialExists = false) {
  const db = {};
  return {
    openStore: vi.fn().mockResolvedValue(db),
    getCredential: vi.fn().mockResolvedValue(credentialExists ? makeMockCredential() : null),
    setCredential: vi.fn().mockResolvedValue(undefined),
    getKeyPackage: vi.fn().mockResolvedValue(null),
    setKeyPackage: vi.fn().mockResolvedValue(undefined),
    setLastResort: vi.fn().mockResolvedValue(undefined),
    _db: db,
  };
}

function createMockCrypto() {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    generateCredential: vi.fn().mockResolvedValue(makeMockCredential()),
    generateKeyPackage: vi.fn().mockImplementation(makeMockKeyPackage),
  };
}

describe('uploadKeyPackagesAfterAuth', () => {
  beforeEach(() => {
    kpCounter = 0;
    vi.clearAllMocks();
  });

  describe('first call (no credential in store)', () => {
    it('generates credential via WASM and stores it locally', async () => {
      const mockMlsStore = createMockMlsStore(false);
      const mockCrypto = createMockCrypto();
      const mockUploadCredential = vi.fn().mockResolvedValue(undefined);
      const mockUploadKeyPackages = vi.fn().mockResolvedValue(undefined);

      await uploadKeyPackagesAfterAuth(TOKEN, USER_ID, DEVICE_ID, {
        mlsStore: mockMlsStore,
        crypto: mockCrypto,
        uploadCredential: mockUploadCredential,
        uploadKeyPackages: mockUploadKeyPackages,
      });

      expect(mockCrypto.init).toHaveBeenCalled();
      expect(mockCrypto.generateCredential).toHaveBeenCalledWith(`${USER_ID}:${DEVICE_ID}`);
      expect(mockMlsStore.setCredential).toHaveBeenCalledOnce();
      const storedCred = mockMlsStore.setCredential.mock.calls[0][1];
      expect(storedCred).toHaveProperty('signingPublicKey');
      expect(storedCred).toHaveProperty('signingPrivateKey');
      expect(storedCred).toHaveProperty('credentialBytes');
    });

    it('uploads credential to server with correct body shape', async () => {
      const mockMlsStore = createMockMlsStore(false);
      const mockCrypto = createMockCrypto();
      const mockUploadCredential = vi.fn().mockResolvedValue(undefined);
      const mockUploadKeyPackages = vi.fn().mockResolvedValue(undefined);

      await uploadKeyPackagesAfterAuth(TOKEN, USER_ID, DEVICE_ID, {
        mlsStore: mockMlsStore,
        crypto: mockCrypto,
        uploadCredential: mockUploadCredential,
        uploadKeyPackages: mockUploadKeyPackages,
      });

      expect(mockUploadCredential).toHaveBeenCalledOnce();
      const [callToken, body] = mockUploadCredential.mock.calls[0];
      expect(callToken).toBe(TOKEN);
      expect(body).toMatchObject({
        deviceId: DEVICE_ID,
        credentialBytes: expect.any(Array),
        signingPublicKey: expect.any(Array),
      });
      // Must be plain number arrays, not Uint8Arrays (JSON-safe)
      expect(Array.isArray(body.credentialBytes)).toBe(true);
      expect(Array.isArray(body.signingPublicKey)).toBe(true);
    });

    it('generates 50 KeyPackages + 1 last-resort when starting fresh', async () => {
      const mockMlsStore = createMockMlsStore(false);
      const mockCrypto = createMockCrypto();
      const mockUploadCredential = vi.fn().mockResolvedValue(undefined);
      const mockUploadKeyPackages = vi.fn().mockResolvedValue(undefined);

      await uploadKeyPackagesAfterAuth(TOKEN, USER_ID, DEVICE_ID, {
        mlsStore: mockMlsStore,
        crypto: mockCrypto,
        uploadCredential: mockUploadCredential,
        uploadKeyPackages: mockUploadKeyPackages,
      });

      // 50 regular + 1 last-resort = 51 total WASM calls
      expect(mockCrypto.generateKeyPackage).toHaveBeenCalledTimes(51);

      // 50 regular KeyPackages stored in IndexedDB
      expect(mockMlsStore.setKeyPackage).toHaveBeenCalledTimes(50);

      // 1 last-resort stored separately
      expect(mockMlsStore.setLastResort).toHaveBeenCalledOnce();
    });

    it('stores private keys in IndexedDB keyed by hex(hashRefBytes)', async () => {
      const mockMlsStore = createMockMlsStore(false);
      const mockCrypto = createMockCrypto();
      const mockUploadCredential = vi.fn().mockResolvedValue(undefined);
      const mockUploadKeyPackages = vi.fn().mockResolvedValue(undefined);

      await uploadKeyPackagesAfterAuth(TOKEN, USER_ID, DEVICE_ID, {
        mlsStore: mockMlsStore,
        crypto: mockCrypto,
        uploadCredential: mockUploadCredential,
        uploadKeyPackages: mockUploadKeyPackages,
      });

      // Each setKeyPackage call receives (db, hashRefHex, { keyPackageBytes, privateKeyBytes, createdAt })
      for (const call of mockMlsStore.setKeyPackage.mock.calls) {
        const [_db, hashRefHex, payload] = call;
        expect(typeof hashRefHex).toBe('string');
        expect(hashRefHex).toMatch(/^[0-9a-f]+$/);
        expect(payload).toHaveProperty('keyPackageBytes');
        expect(payload).toHaveProperty('privateKeyBytes');
        expect(payload).toHaveProperty('createdAt');
      }
    });

    it('uploads batch of 50 KeyPackages with expiresAt', async () => {
      const mockMlsStore = createMockMlsStore(false);
      const mockCrypto = createMockCrypto();
      const mockUploadCredential = vi.fn().mockResolvedValue(undefined);
      const mockUploadKeyPackages = vi.fn().mockResolvedValue(undefined);

      await uploadKeyPackagesAfterAuth(TOKEN, USER_ID, DEVICE_ID, {
        mlsStore: mockMlsStore,
        crypto: mockCrypto,
        uploadCredential: mockUploadCredential,
        uploadKeyPackages: mockUploadKeyPackages,
      });

      // Two upload calls: batch (50 KPs) + last-resort (1 KP)
      expect(mockUploadKeyPackages).toHaveBeenCalledTimes(2);

      // Find the batch upload (50 packages)
      const batchCall = mockUploadKeyPackages.mock.calls.find(
        ([_token, body]) => !body.lastResort,
      );
      expect(batchCall).toBeDefined();
      const [batchToken, batchBody] = batchCall;
      expect(batchToken).toBe(TOKEN);
      expect(batchBody.deviceId).toBe(DEVICE_ID);
      expect(batchBody.keyPackages).toHaveLength(50);
      expect(batchBody.expiresAt).toBeDefined();
      // Each entry is a plain number array
      for (const kp of batchBody.keyPackages) {
        expect(Array.isArray(kp)).toBe(true);
      }
    });

    it('uploads last-resort KeyPackage separately with lastResort: true', async () => {
      const mockMlsStore = createMockMlsStore(false);
      const mockCrypto = createMockCrypto();
      const mockUploadCredential = vi.fn().mockResolvedValue(undefined);
      const mockUploadKeyPackages = vi.fn().mockResolvedValue(undefined);

      await uploadKeyPackagesAfterAuth(TOKEN, USER_ID, DEVICE_ID, {
        mlsStore: mockMlsStore,
        crypto: mockCrypto,
        uploadCredential: mockUploadCredential,
        uploadKeyPackages: mockUploadKeyPackages,
      });

      const lastResortCall = mockUploadKeyPackages.mock.calls.find(
        ([_token, body]) => body.lastResort === true,
      );
      expect(lastResortCall).toBeDefined();
      const [lrToken, lrBody] = lastResortCall;
      expect(lrToken).toBe(TOKEN);
      expect(lrBody.deviceId).toBe(DEVICE_ID);
      expect(lrBody.keyPackages).toHaveLength(1);
    });
  });

  describe('second call (credential already exists)', () => {
    it('skips credential generation when credential already exists in store', async () => {
      const mockMlsStore = createMockMlsStore(true);
      const mockCrypto = createMockCrypto();
      const mockUploadCredential = vi.fn().mockResolvedValue(undefined);
      const mockUploadKeyPackages = vi.fn().mockResolvedValue(undefined);

      await uploadKeyPackagesAfterAuth(TOKEN, USER_ID, DEVICE_ID, {
        mlsStore: mockMlsStore,
        crypto: mockCrypto,
        uploadCredential: mockUploadCredential,
        uploadKeyPackages: mockUploadKeyPackages,
      });

      expect(mockCrypto.generateCredential).not.toHaveBeenCalled();
      expect(mockMlsStore.setCredential).not.toHaveBeenCalled();
      expect(mockUploadCredential).not.toHaveBeenCalled();
    });

    it('still generates and uploads KeyPackages on second call', async () => {
      const mockMlsStore = createMockMlsStore(true);
      const mockCrypto = createMockCrypto();
      const mockUploadCredential = vi.fn().mockResolvedValue(undefined);
      const mockUploadKeyPackages = vi.fn().mockResolvedValue(undefined);

      await uploadKeyPackagesAfterAuth(TOKEN, USER_ID, DEVICE_ID, {
        mlsStore: mockMlsStore,
        crypto: mockCrypto,
        uploadCredential: mockUploadCredential,
        uploadKeyPackages: mockUploadKeyPackages,
      });

      // Still generates 50 + 1 last-resort
      expect(mockCrypto.generateKeyPackage).toHaveBeenCalledTimes(51);
      expect(mockUploadKeyPackages).toHaveBeenCalledTimes(2);
    });
  });
});
