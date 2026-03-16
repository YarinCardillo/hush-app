/**
 * Tests for api.js client functions and uploadKeysAfterAuth.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadKeysAfterAuth } from './uploadKeysAfterAuth';
import { leaveGuild, getHandshake } from './api';

// ── leaveGuild ────────────────────────────────────────────────────────────────

describe('leaveGuild', () => {
  const TOKEN = 'test-jwt';
  const SERVER_ID = 'server-uuid-123';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls POST /api/servers/:id/leave with auth header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', mockFetch);

    await leaveGuild(TOKEN, SERVER_ID);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`/api/servers/${SERVER_ID}/leave`);
    expect(opts.method).toBe('POST');
    expect(opts.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('throws on non-ok response with server error message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'guild owner cannot leave' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(leaveGuild(TOKEN, SERVER_ID)).rejects.toThrow('guild owner cannot leave');
  });

  it('throws fallback message when error response has no error field', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(leaveGuild(TOKEN, SERVER_ID)).rejects.toThrow('leave guild failed: 500');
  });
});

// ── getHandshake ──────────────────────────────────────────────────────────────

describe('getHandshake', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls GET /api/handshake without Authorization header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ opk_low_threshold: 10 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await getHandshake();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/handshake');
    // getHandshake uses raw fetch with no opts — no Authorization header
    expect(opts).toBeUndefined();
  });

  it('returns parsed JSON from the handshake endpoint', async () => {
    const payload = {
      server_version: '1.0.0',
      api_version: 'v1',
      min_client_version: '0.9.0',
      opk_low_threshold: 5,
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await getHandshake();

    expect(result).toEqual(payload);
    expect(result.opk_low_threshold).toBe(5);
  });

  it('throws when handshake endpoint returns non-ok status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', mockFetch);

    await expect(getHandshake()).rejects.toThrow('handshake failed: 503');
  });
});

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
