/**
 * Tests for uploadKeysAfterAuth (pure logic; no WASM/signalStore imports here).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadKeysAfterAuth } from './uploadKeysAfterAuth';

describe('uploadKeysAfterAuth', () => {
  const token = 'jwt-token';
  const userId = '11111111-1111-1111-1111-111111111111';
  const deviceId = 'device-1';

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calls uploadKeys with pre-key-upload-shaped payload when identity is missing', async () => {
    const mockUploadKeys = vi.fn().mockResolvedValue(undefined);
    const mockStore = {
      openStore: vi.fn().mockResolvedValue({}),
      getIdentity: vi.fn().mockResolvedValue(null),
      setIdentity: vi.fn().mockResolvedValue(undefined),
      setRegistrationId: vi.fn().mockResolvedValue(undefined),
    };
    const mockCrypto = {
      init: vi.fn().mockResolvedValue(undefined),
      generateIdentity: vi.fn().mockResolvedValue({
        publicKey: new Uint8Array(32),
        privateKey: new Uint8Array(32),
        registrationId: 12345,
      }),
      generatePreKeyBundle: vi.fn().mockResolvedValue({
        identity_key: new Uint8Array(32),
        signed_pre_key: new Uint8Array(32),
        signed_pre_key_signature: new Uint8Array(64),
        registration_id: 12345,
        one_time_pre_keys: [
          { key_id: 1, public_key: new Uint8Array(32) },
          { key_id: 2, public_key: new Uint8Array(32) },
        ],
      }),
    };

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
        { keyId: 1, publicKey: expect.any(Array) },
        { keyId: 2, publicKey: expect.any(Array) },
      ],
    });
  });

  it('does not call uploadKeys when identity already exists', async () => {
    const mockUploadKeys = vi.fn();
    const mockStore = {
      openStore: vi.fn().mockResolvedValue({}),
      getIdentity: vi.fn().mockResolvedValue({
        publicKey: new Uint8Array(32),
        privateKey: new Uint8Array(32),
      }),
    };
    const mockCrypto = {
      init: vi.fn(),
      generateIdentity: vi.fn(),
      generatePreKeyBundle: vi.fn(),
    };

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
