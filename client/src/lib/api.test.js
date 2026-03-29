/**
 * Tests for api.js client functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkUsernameAvailable,
  createDeviceLinkRequest,
  fetchWithAuth,
  leaveGuild,
  getHandshake,
  registerWithPublicKey,
  requestChallenge,
  uploadMLSCredential,
  uploadMLSKeyPackages,
  getKeyPackageCount,
  uploadKeyPackagesAfterAuth,
} from './api';

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
      json: () => Promise.resolve({ key_package_low_threshold: 10 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await getHandshake();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/handshake');
    // getHandshake passes a timeout signal but no Authorization header
    expect(opts).toEqual({ signal: expect.any(AbortSignal) });
  });

  it('returns parsed JSON from the handshake endpoint', async () => {
    const payload = {
      server_version: '1.0.0',
      api_version: 'v1',
      min_client_version: '0.9.0',
      key_package_low_threshold: 10,
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await getHandshake();

    expect(result).toEqual(payload);
    expect(result.key_package_low_threshold).toBe(10);
  });

  it('normalizes camelCase registrationMode for existing consumers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        registrationMode: 'closed',
        capabilities: {
          'e2ee.chat': true,
          'e2ee.media': true,
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await getHandshake('https://chat.example.com');

    expect(result.registrationMode).toBe('closed');
    expect(result.registration_mode).toBe('closed');
    expect(result.capabilities).toEqual({
      'e2ee.chat': true,
      'e2ee.media': true,
    });
  });

  it('throws when handshake endpoint returns non-ok status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', mockFetch);

    await expect(getHandshake()).rejects.toThrow('handshake failed: 503');
  });

  it('logs and enriches network failures for handshake requests', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')));

    await expect(getHandshake('https://chat.example.com')).rejects.toThrow(
      'handshake failed. Could not reach https://chat.example.com/api/handshake.',
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[api] handshake failed',
      expect.objectContaining({
        url: 'https://chat.example.com/api/handshake',
      }),
    );
  });
});

// ── checkUsernameAvailable ───────────────────────────────────────────────────

describe('checkUsernameAvailable', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when the username is available', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ available: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      checkUsernameAvailable('alice', 'https://chat.example.com'),
    ).resolves.toBe(true);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://chat.example.com/api/auth/check-username/alice',
      { signal: expect.any(AbortSignal) },
    );
  });

  it('aborts when the caller signal is cancelled', async () => {
    const controller = new AbortController();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockFetch = vi.fn().mockImplementation((_url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', mockFetch);

    const pending = checkUsernameAvailable('alice', 'https://chat.example.com', controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow(
      'check username availability failed for https://chat.example.com/api/auth/check-username/alice',
    );
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });
});

// ── MLS API functions ─────────────────────────────────────────────────────────

describe('uploadMLSCredential', () => {
  const TOKEN = 'jwt-token';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls POST /api/mls/credentials with correct body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', mockFetch);

    const body = {
      deviceId: 'dev-1',
      credentialBytes: [1, 2, 3],
      signingPublicKey: [4, 5, 6],
    };
    await uploadMLSCredential(TOKEN, body);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/mls/credentials');
    expect(opts.method).toBe('POST');
    expect(opts.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(opts.body)).toEqual(body);
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'bad request' }),
    }));

    await expect(uploadMLSCredential(TOKEN, {})).rejects.toThrow('bad request');
  });
});

describe('uploadMLSKeyPackages', () => {
  const TOKEN = 'jwt-token';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls POST /api/mls/key-packages with correct body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', mockFetch);

    const body = {
      deviceId: 'dev-1',
      keyPackages: [[1, 2, 3], [4, 5, 6]],
      expiresAt: '2026-04-17T00:00:00Z',
    };
    await uploadMLSKeyPackages(TOKEN, body);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/mls/key-packages');
    expect(opts.method).toBe('POST');
    expect(opts.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(opts.body)).toEqual(body);
  });

  it('sends lastResort: true when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', mockFetch);

    const body = { deviceId: 'dev-1', keyPackages: [[1]], lastResort: true };
    await uploadMLSKeyPackages(TOKEN, body);

    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body).lastResort).toBe(true);
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    }));

    await expect(uploadMLSKeyPackages(TOKEN, {})).rejects.toThrow();
  });
});

describe('getKeyPackageCount', () => {
  const TOKEN = 'jwt-token';
  const DEVICE_ID = 'dev-1';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls GET /api/mls/key-packages/count with deviceId query param', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: 42 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const count = await getKeyPackageCount(TOKEN, DEVICE_ID);

    expect(count).toBe(42);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/mls/key-packages/count');
    expect(url).toContain(`deviceId=${encodeURIComponent(DEVICE_ID)}`);
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'unauthorized' }),
    }));

    await expect(getKeyPackageCount(TOKEN, DEVICE_ID)).rejects.toThrow();
  });
});

describe('uploadKeyPackagesAfterAuth (api.js wrapper)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('delegates to uploadKeyPackagesAfterAuthImpl with injected deps', async () => {
    // Inject all deps so no real WASM or IndexedDB is touched.
    const TOKEN = 'tok';
    const userId = 'u1';
    const deviceId = 'd1';

    const mockCred = {
      signingPublicKey: new Uint8Array(32).fill(1),
      signingPrivateKey: new Uint8Array(64).fill(2),
      credentialBytes: new Uint8Array(64).fill(3),
    };
    const mockKP = {
      keyPackageBytes: new Uint8Array([1]),
      privateKeyBytes: new Uint8Array(64).fill(4),
      hashRefBytes: new Uint8Array(32).fill(5),
    };

    const mockMlsStore = {
      openStore: vi.fn().mockResolvedValue({}),
      getCredential: vi.fn().mockResolvedValue(null),
      setCredential: vi.fn().mockResolvedValue(undefined),
      setKeyPackage: vi.fn().mockResolvedValue(undefined),
      setLastResort: vi.fn().mockResolvedValue(undefined),
    };
    const mockCrypto = {
      init: vi.fn().mockResolvedValue(undefined),
      generateCredential: vi.fn().mockResolvedValue(mockCred),
      generateKeyPackage: vi.fn().mockResolvedValue(mockKP),
    };

    await uploadKeyPackagesAfterAuth(TOKEN, userId, deviceId, {
      mlsStore: mockMlsStore,
      crypto: mockCrypto,
      uploadCredential: vi.fn().mockResolvedValue(undefined),
      uploadKeyPackages: vi.fn().mockResolvedValue(undefined),
    });

    expect(mockMlsStore.openStore).toHaveBeenCalledWith(userId, deviceId);
    expect(mockCrypto.generateCredential).toHaveBeenCalled();
  });

  it('uploads MLS bootstrap material to the selected auth instance by default', async () => {
    localStorage.setItem('hush_auth_instance_selected', 'https://chat.example.com');

    const TOKEN = 'tok';
    const userId = 'u1';
    const deviceId = 'd1';

    const mockCred = {
      signingPublicKey: new Uint8Array(32).fill(1),
      signingPrivateKey: new Uint8Array(64).fill(2),
      credentialBytes: new Uint8Array(64).fill(3),
    };
    const mockKP = {
      keyPackageBytes: new Uint8Array([1]),
      privateKeyBytes: new Uint8Array(64).fill(4),
      hashRefBytes: new Uint8Array(32).fill(5),
    };

    const mockMlsStore = {
      openStore: vi.fn().mockResolvedValue({}),
      getCredential: vi.fn().mockResolvedValue(null),
      setCredential: vi.fn().mockResolvedValue(undefined),
      setKeyPackage: vi.fn().mockResolvedValue(undefined),
      setLastResort: vi.fn().mockResolvedValue(undefined),
    };
    const mockCrypto = {
      init: vi.fn().mockResolvedValue(undefined),
      generateCredential: vi.fn().mockResolvedValue(mockCred),
      generateKeyPackage: vi.fn().mockResolvedValue(mockKP),
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    await uploadKeyPackagesAfterAuth(TOKEN, userId, deviceId, {
      mlsStore: mockMlsStore,
      crypto: mockCrypto,
    });

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://chat.example.com/api/mls/credentials',
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://chat.example.com/api/mls/key-packages',
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      'https://chat.example.com/api/mls/key-packages',
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
  });
});

describe('registerWithPublicKey', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds a human-readable device label to the registration body', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'jwt', user: { id: 'u1' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await registerWithPublicKey('alice', 'Alice', 'pub-key', 'device-1');

    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toMatchObject({
      deviceId: 'device-1',
      label: 'Chrome on macOS',
    });
  });
});

describe('createDeviceLinkRequest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds a human-readable device label when the caller does not provide one', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ requestId: 'req-1', secret: 'sec-1', code: 'ABCD1234', expiresAt: '2026-03-29T00:05:00Z' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await createDeviceLinkRequest({
      devicePublicKey: 'pub',
      sessionPublicKey: 'session',
      deviceId: 'device-1',
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toMatchObject({
      deviceId: 'device-1',
      label: 'Safari on iPhone',
    });
  });
});

describe('auth instance routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('uses the selected auth instance for challenge requests when no baseUrl is passed', async () => {
    localStorage.setItem('hush_auth_instance_selected', 'https://chat.example.com');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ nonce: 'abc123' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await requestChallenge('public-key');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://chat.example.com/api/auth/challenge',
      expect.any(Object),
    );
  });

  it('routes auth-only fetches to the active auth instance', async () => {
    sessionStorage.setItem('hush_auth_instance_active', 'https://alpha.example.com');

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal('fetch', mockFetch);

    await fetchWithAuth('jwt-token', '/api/auth/devices');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://alpha.example.com/api/auth/devices',
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
  });

  it('routes pre-auth requests to the selected auth instance even when another instance is active', async () => {
    localStorage.setItem('hush_auth_instance_selected', 'https://chat.example.com');
    sessionStorage.setItem('hush_auth_instance_active', 'https://alpha.example.com');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ nonce: 'abc123' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await requestChallenge('public-key');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://chat.example.com/api/auth/challenge',
      expect.any(Object),
    );
  });
});
