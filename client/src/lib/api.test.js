/**
 * Tests for uploadKeysAfterAuth (pure logic; no WASM/signalStore imports here).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadKeysAfterAuth } from './uploadKeysAfterAuth';

describe('uploadKeysAfterAuth', () => {
  const token = 'jwt-token';
  const userId = '11111111-1111-1111-1111-111111111111';
  const deviceId = 'device-1';

  /** Creates a mock store with all required methods. */
  function createMockStore(identityExists = false) {
    return {
      openStore: vi.fn().mockResolvedValue({}),
      getIdentity: vi.fn().mockResolvedValue(
        identityExists
          ? { publicKey: new Uint8Array(33), privateKey: new Uint8Array(32) }
          : null,
      ),
      setIdentity: vi.fn().mockResolvedValue(undefined),
      setRegistrationId: vi.fn().mockResolvedValue(undefined),
      setSignedPreKey: vi.fn().mockResolvedValue(undefined),
      setOneTimePreKey: vi.fn().mockResolvedValue(undefined),
    };
  }

  /** Creates a mock crypto with the new API surface (including private keys). */
  function createMockCrypto() {
    return {
      init: vi.fn().mockResolvedValue(undefined),
      generateIdentity: vi.fn().mockResolvedValue({
        publicKey: new Uint8Array(33),
        privateKey: new Uint8Array(32),
        registrationId: 12345,
      }),
      generatePreKeyBundle: vi.fn().mockResolvedValue({
        identity_key: new Uint8Array(33),
        signed_pre_key: new Uint8Array(33),
        signed_pre_key_signature: new Uint8Array(96),
        signed_pre_key_private: new Uint8Array(32),
        registration_id: 12345,
        one_time_pre_keys: [
          { key_id: 0, public_key: new Uint8Array(33), private_key: new Uint8Array(32) },
          { key_id: 1, public_key: new Uint8Array(33), private_key: new Uint8Array(32) },
        ],
      }),
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('generates keys and uploads public payload when identity is missing', async () => {
    const mockStore = createMockStore(false);
    const mockCrypto = createMockCrypto();
    const mockUploadKeys = vi.fn().mockResolvedValue(undefined);

    await uploadKeysAfterAuth(token, userId, deviceId, {
      store: mockStore,
      crypto: mockCrypto,
      uploadKeys: mockUploadKeys,
    });

    expect(mockStore.openStore).toHaveBeenCalledWith(userId, deviceId);
    expect(mockStore.getIdentity).toHaveBeenCalled();
    expect(mockCrypto.init).toHaveBeenCalled();
    expect(mockCrypto.generateIdentity).toHaveBeenCalled();
    expect(mockCrypto.generatePreKeyBundle).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.any(Uint8Array),
      12345,
      100,
    );
    expect(mockUploadKeys).toHaveBeenCalledTimes(1);
    const [callToken, body] = mockUploadKeys.mock.calls[0];
    expect(callToken).toBe(token);
    expect(body).toMatchObject({
      deviceId,
      registrationId: 12345,
      identityKey: expect.any(Array),
      signedPreKey: expect.any(Array),
      signedPreKeySignature: expect.any(Array),
      oneTimePreKeys: [
        { keyId: 0, publicKey: expect.any(Array) },
        { keyId: 1, publicKey: expect.any(Array) },
      ],
    });
  });

  it('persists SPK private key locally', async () => {
    const mockStore = createMockStore(false);
    const mockCrypto = createMockCrypto();
    const mockUploadKeys = vi.fn().mockResolvedValue(undefined);

    await uploadKeysAfterAuth(token, userId, deviceId, {
      store: mockStore,
      crypto: mockCrypto,
      uploadKeys: mockUploadKeys,
    });

    expect(mockStore.setSignedPreKey).toHaveBeenCalledTimes(1);
    const spk = mockStore.setSignedPreKey.mock.calls[0][1];
    expect(spk).toMatchObject({
      id: 1,
      publicKey: expect.any(Array),
      privateKey: expect.any(Array),
      signature: expect.any(Array),
    });
    expect(spk.privateKey.length).toBe(32);
  });

  it('persists OPK private keys locally', async () => {
    const mockStore = createMockStore(false);
    const mockCrypto = createMockCrypto();
    const mockUploadKeys = vi.fn().mockResolvedValue(undefined);

    await uploadKeysAfterAuth(token, userId, deviceId, {
      store: mockStore,
      crypto: mockCrypto,
      uploadKeys: mockUploadKeys,
    });

    expect(mockStore.setOneTimePreKey).toHaveBeenCalledTimes(2);
    const otp0 = mockStore.setOneTimePreKey.mock.calls[0][1];
    expect(otp0).toMatchObject({ keyId: 0, publicKey: expect.any(Array), privateKey: expect.any(Array) });
    expect(otp0.privateKey.length).toBe(32);
  });

  it('does NOT send private keys to the server', async () => {
    const mockStore = createMockStore(false);
    const mockCrypto = createMockCrypto();
    const mockUploadKeys = vi.fn().mockResolvedValue(undefined);

    await uploadKeysAfterAuth(token, userId, deviceId, {
      store: mockStore,
      crypto: mockCrypto,
      uploadKeys: mockUploadKeys,
    });

    const body = mockUploadKeys.mock.calls[0][1];
    expect(body).not.toHaveProperty('signedPreKeyPrivate');
    expect(body).not.toHaveProperty('signed_pre_key_private');
    for (const otp of body.oneTimePreKeys) {
      expect(otp).not.toHaveProperty('privateKey');
      expect(otp).not.toHaveProperty('private_key');
    }
  });

  it('does not call uploadKeys when identity already exists', async () => {
    const mockStore = createMockStore(true);
    const mockCrypto = createMockCrypto();
    const mockUploadKeys = vi.fn();

    await uploadKeysAfterAuth(token, userId, deviceId, {
      store: mockStore,
      crypto: mockCrypto,
      uploadKeys: mockUploadKeys,
    });

    expect(mockStore.getIdentity).toHaveBeenCalled();
    expect(mockCrypto.init).not.toHaveBeenCalled();
    expect(mockCrypto.generateIdentity).not.toHaveBeenCalled();
    expect(mockUploadKeys).not.toHaveBeenCalled();
  });
});
