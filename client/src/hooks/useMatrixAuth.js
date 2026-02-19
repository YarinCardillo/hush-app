import { useState, useCallback, useEffect } from 'react';
import { SSOAction } from 'matrix-js-sdk';
import {
  createMatrixClient,
  getMatrixClient,
  destroyMatrixClient,
} from '../lib/matrixClient';
import {
  getStoredCredentials,
  setStoredCredentials,
  clearStoredCredentials,
  GUEST_SESSION_KEY,
} from '../lib/authStorage';

/** IndexedDB-safe prefix for Rust crypto store. One store per account to avoid "account in the store doesn't match" errors. */
function cryptoStorePrefix(userId, deviceId) {
  const safeUserId = (userId || '').replace(/^@/, '').replace(/:/g, '-');
  return `hush-crypto-${safeUserId}-${deviceId || 'unknown'}`;
}

/**
 * Provides Matrix authentication operations and state management.
 * Primary use case: guest authentication for Hush rooms.
 *
 * @returns {Object} Auth state and operations
 * @returns {Function} loginAsGuest - Register as Matrix guest user
 * @returns {Function} login - Login with Matrix credentials (future use)
 * @returns {Function} register - Register new Matrix account (future use)
 * @returns {Function} logout - Logout and cleanup Matrix client
 * @returns {boolean} isAuthenticated - True when userId and accessToken present
 * @returns {boolean} isLoading - True during auth operations
 * @returns {Error|null} error - Last authentication error
 * @returns {string|null} userId - Matrix user ID
 * @returns {string|null} accessToken - Matrix access token
 * @returns {string|null} deviceId - Matrix device ID
 */
export function useMatrixAuth() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [userId, setUserId] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [rehydrationAttempted, setRehydrationAttempted] = useState(false);
  const [cryptoError, setCryptoError] = useState(null);
  const [ssoProviders, setSsoProviders] = useState([]);
  const [loginFlowsError, setLoginFlowsError] = useState(null);

  const isAuthenticated = userId !== null && accessToken !== null;

  /**
   * Register as anonymous user on Matrix homeserver.
   * Creates a real user account with random credentials (not a guest).
   * This allows room creation which guests cannot do.
   * Auto-generates display name from localStorage 'hush_displayName'.
   * Stores credentials and starts client sync after registration.
   */
  const loginAsGuest = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Create unauthenticated client for registration
      const client = createMatrixClient();

      // Get display name from localStorage (set by Home.jsx)
      const displayName = localStorage.getItem('hush_displayName') || 'Guest';

      // Generate random username and password for anonymous user
      // Using real user instead of guest because guests can't create rooms
      const randomId = Math.random().toString(36).substring(2, 10);
      const username = `hush_${randomId}`;
      const password = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);

      // Register as real user (not guest)
      const response = await client.register(
        username,
        password,
        null, // sessionId
        { type: 'm.login.dummy' }, // auth - dummy flow for servers without email verification
      );

      // Store credentials
      setUserId(response.user_id);
      setAccessToken(response.access_token);
      setDeviceId(response.device_id);

      // Recreate client with auth credentials
      createMatrixClient({
        userId: response.user_id,
        accessToken: response.access_token,
        deviceId: response.device_id,
      });

      // Set display name
      const authenticatedClient = getMatrixClient();
      if (authenticatedClient && displayName) {
        await authenticatedClient.setDisplayName(displayName);
      }

      // Initialize Rust crypto; block app if it fails (no unencrypted use)
      if (authenticatedClient) {
        try {
          const prefix = cryptoStorePrefix(
            authenticatedClient.getUserId(),
            authenticatedClient.getDeviceId(),
          );
          await authenticatedClient.initRustCrypto({ cryptoDatabasePrefix: prefix });
          console.log('[useMatrixAuth] Rust crypto initialized successfully');
          setCryptoError(null);
        } catch (cryptoErr) {
          console.error('[useMatrixAuth] Crypto initialization failed:', cryptoErr);
          setCryptoError(
            cryptoErr?.message || 'Encryption unavailable. Hush requires E2EE to function.',
          );
          setUserId(null);
          setAccessToken(null);
          setDeviceId(null);
          setIsLoading(false);
          return;
        }
      }

      // Start sync and wait for initial sync to complete
      if (authenticatedClient) {
        const syncPromise = new Promise((resolve, reject) => {
          const onSync = (state, prevState, data) => {
            if (state === 'PREPARED' || state === 'SYNCING') {
              authenticatedClient.off('sync', onSync);
              resolve();
            } else if (state === 'ERROR') {
              authenticatedClient.off('sync', onSync);
              reject(new Error('Sync error: ' + (data?.error?.message || 'Unknown')));
            }
          };
          authenticatedClient.on('sync', onSync);
        });

        const startPromise = authenticatedClient.startClient({ initialSyncLimit: 20 });
        await Promise.all([startPromise, syncPromise]);
      }

      if (authenticatedClient) {
        const baseUrl =
          authenticatedClient.getHomeserverUrl?.() ||
          import.meta.env.VITE_MATRIX_HOMESERVER_URL ||
          window.location.origin;
        setStoredCredentials({
          userId: response.user_id,
          deviceId: response.device_id,
          accessToken: response.access_token,
          baseUrl,
        });
      }
    } catch (err) {
      console.error('[useMatrixAuth] Anonymous registration failed:', err);
      setError(err);
      setUserId(null);
      setAccessToken(null);
      setDeviceId(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Fetches login flows from the homeserver and sets ssoProviders when SSO is available.
   * Call when showing Login or Register view so SSO buttons can be displayed.
   */
  const fetchLoginFlows = useCallback(async () => {
    setLoginFlowsError(null);
    try {
      const client = getMatrixClient() || createMatrixClient();
      const response = await client.loginFlows();
      const ssoFlow = response.flows?.find(
        (f) => f.type === 'm.login.sso' || f.type === 'm.login.cas'
      );
      if (ssoFlow?.identity_providers?.length > 0) {
        setSsoProviders(ssoFlow.identity_providers);
      } else if (ssoFlow) {
        setSsoProviders([{ id: '', name: 'SSO' }]);
      } else {
        setSsoProviders([]);
      }
    } catch (err) {
      console.error('[useMatrixAuth] fetchLoginFlows failed:', err);
      setLoginFlowsError(err);
      setSsoProviders([]);
    }
  }, []);

  /**
   * Redirects the browser to the homeserver SSO URL. After auth, the server
   * redirects back to /login/callback?loginToken=... which must be handled by
   * completeSsoLogin.
   *
   * @param {string|undefined} idpId - Identity provider id from ssoProviders, or undefined for generic SSO
   * @param {string} action - SSOAction.LOGIN or SSOAction.REGISTER
   */
  const startSsoLogin = useCallback((idpId, action) => {
    const callbackUrl = `${window.location.origin}/login/callback`;
    const client = getMatrixClient() || createMatrixClient();
    const url = client.getSsoLoginUrl(
      callbackUrl,
      'sso',
      idpId || undefined,
      action
    );
    window.location.href = url;
  }, []);

  /**
   * Exchanges a loginToken (from SSO redirect) for Matrix credentials and completes
   * login: init crypto, start client, store credentials.
   *
   * @param {string} loginToken - Token from redirect query param
   * @returns {Promise<boolean>} - True if login succeeded, false otherwise
   */
  const completeSsoLogin = useCallback(async (loginToken) => {
    setIsLoading(true);
    setError(null);

    try {
      const client = createMatrixClient();
      const response = await client.loginRequest({
        type: 'm.login.token',
        token: loginToken,
        refresh_token: true,
      });

      setUserId(response.user_id);
      setAccessToken(response.access_token);
      setDeviceId(response.device_id);

      createMatrixClient({
        userId: response.user_id,
        accessToken: response.access_token,
        deviceId: response.device_id,
      });

      const authenticatedClient = getMatrixClient();
      if (authenticatedClient) {
        try {
          const prefix = cryptoStorePrefix(
            authenticatedClient.getUserId(),
            authenticatedClient.getDeviceId(),
          );
          await authenticatedClient.initRustCrypto({ cryptoDatabasePrefix: prefix });
          setCryptoError(null);
        } catch (cryptoErr) {
          console.error('[useMatrixAuth] Crypto initialization failed:', cryptoErr);
          setCryptoError(
            cryptoErr?.message || 'Encryption unavailable. Hush requires E2EE to function.',
          );
          setUserId(null);
          setAccessToken(null);
          setDeviceId(null);
          setIsLoading(false);
          return false;
        }
      }

      if (authenticatedClient) {
        await authenticatedClient.startClient({ initialSyncLimit: 20 });
      }

      if (authenticatedClient) {
        const baseUrl =
          authenticatedClient.getHomeserverUrl?.() ||
          import.meta.env.VITE_MATRIX_HOMESERVER_URL ||
          window.location.origin;
        setStoredCredentials({
          userId: response.user_id,
          deviceId: response.device_id,
          accessToken: response.access_token,
          baseUrl,
        });
      }
      return true;
    } catch (err) {
      console.error('[useMatrixAuth] SSO token exchange failed:', err);
      setError(err);
      setUserId(null);
      setAccessToken(null);
      setDeviceId(null);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Login with Matrix credentials.
   * Accepts Matrix username (localpart) or email; Matrix spec allows identifier
   * types m.id.user or m.id.thirdparty (email) if the account has that 3PID linked.
   *
   * @param {string} identifier - Matrix username (localpart) or email address
   * @param {string} password - Matrix password
   */
  const login = useCallback(async (identifier, password) => {
    setIsLoading(true);
    setError(null);

    try {
      const client = createMatrixClient();

      const isEmail = typeof identifier === 'string' && identifier.includes('@');
      const loginBody = {
        type: 'm.login.password',
        password,
        identifier: isEmail
          ? { type: 'm.id.thirdparty', medium: 'email', address: identifier.trim() }
          : { type: 'm.id.user', user: identifier.trim() },
      };
      const response = await client.loginRequest(loginBody);

      setUserId(response.user_id);
      setAccessToken(response.access_token);
      setDeviceId(response.device_id);

      // Recreate client with auth credentials
      createMatrixClient({
        userId: response.user_id,
        accessToken: response.access_token,
        deviceId: response.device_id,
      });

      const authenticatedClient = getMatrixClient();
      if (authenticatedClient) {
        try {
          const prefix = cryptoStorePrefix(
            authenticatedClient.getUserId(),
            authenticatedClient.getDeviceId(),
          );
          await authenticatedClient.initRustCrypto({ cryptoDatabasePrefix: prefix });
          setCryptoError(null);
        } catch (cryptoErr) {
          console.error('[useMatrixAuth] Crypto initialization failed:', cryptoErr);
          setCryptoError(
            cryptoErr?.message || 'Encryption unavailable. Hush requires E2EE to function.',
          );
          setUserId(null);
          setAccessToken(null);
          setDeviceId(null);
          setIsLoading(false);
          return;
        }
      }

      if (authenticatedClient) {
        await authenticatedClient.startClient({ initialSyncLimit: 20 });
      }

      if (authenticatedClient) {
        const baseUrl =
          authenticatedClient.getHomeserverUrl?.() ||
          import.meta.env.VITE_MATRIX_HOMESERVER_URL ||
          window.location.origin;
        setStoredCredentials({
          userId: response.user_id,
          deviceId: response.device_id,
          accessToken: response.access_token,
          baseUrl,
        });
      }
    } catch (err) {
      console.error('[useMatrixAuth] Login failed:', err);
      setError(err);
      setUserId(null);
      setAccessToken(null);
      setDeviceId(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Register new Matrix account.
   * Uses m.login.dummy (no email verification). Display name is not required by
   * Matrix for registration; we set it via setDisplayName after register (profile).
   *
   * @param {string} username - Desired Matrix username (localpart)
   * @param {string} password - Account password
   * @param {string} displayName - Display name set on Matrix profile after register
   */
  const register = useCallback(async (username, password, displayName) => {
    setIsLoading(true);
    setError(null);

    try {
      const client = createMatrixClient();

      const response = await client.register(
        username,
        password,
        null, // sessionId
        { type: 'm.login.dummy' }, // auth
      );

      setUserId(response.user_id);
      setAccessToken(response.access_token);
      setDeviceId(response.device_id);

      // Recreate client with auth credentials
      createMatrixClient({
        userId: response.user_id,
        accessToken: response.access_token,
        deviceId: response.device_id,
      });

      // Set display name if provided
      const authenticatedClient = getMatrixClient();
      if (authenticatedClient && displayName) {
        await authenticatedClient.setDisplayName(displayName);
      }

      if (authenticatedClient) {
        try {
          const prefix = cryptoStorePrefix(
            authenticatedClient.getUserId(),
            authenticatedClient.getDeviceId(),
          );
          await authenticatedClient.initRustCrypto({ cryptoDatabasePrefix: prefix });
          setCryptoError(null);
        } catch (cryptoErr) {
          console.error('[useMatrixAuth] Crypto initialization failed:', cryptoErr);
          setCryptoError(
            cryptoErr?.message || 'Encryption unavailable. Hush requires E2EE to function.',
          );
          setUserId(null);
          setAccessToken(null);
          setDeviceId(null);
          setIsLoading(false);
          return;
        }
      }

      if (authenticatedClient) {
        await authenticatedClient.startClient({ initialSyncLimit: 20 });
      }

      if (authenticatedClient) {
        const baseUrl =
          authenticatedClient.getHomeserverUrl?.() ||
          import.meta.env.VITE_MATRIX_HOMESERVER_URL ||
          window.location.origin;
        setStoredCredentials({
          userId: response.user_id,
          deviceId: response.device_id,
          accessToken: response.access_token,
          baseUrl,
        });
      }
    } catch (err) {
      console.error('[useMatrixAuth] Registration failed:', err);
      setError(err);
      setUserId(null);
      setAccessToken(null);
      setDeviceId(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Logout current user and cleanup Matrix client.
   * Calls destroyMatrixClient() which stops sync and clears session.
   */
  const clearCryptoError = useCallback(() => setCryptoError(null), []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setCryptoError(null);

    try {
      sessionStorage.removeItem(GUEST_SESSION_KEY);
      clearStoredCredentials();
      await destroyMatrixClient();
      setUserId(null);
      setAccessToken(null);
      setDeviceId(null);
    } catch (err) {
      console.error('[useMatrixAuth] Logout failed:', err);
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Rehydrate from localStorage on mount (e.g. after refresh or new tab)
  useEffect(() => {
    if (userId !== null) {
      setRehydrationAttempted(true);
      return;
    }

    const stored = getStoredCredentials();
    if (!stored) {
      setRehydrationAttempted(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        createMatrixClient({
          baseUrl: stored.baseUrl,
          userId: stored.userId,
          accessToken: stored.accessToken,
          deviceId: stored.deviceId,
        });
        const client = getMatrixClient();
        if (!client || cancelled) {
          setRehydrationAttempted(true);
          return;
        }

        const prefix = cryptoStorePrefix(stored.userId, stored.deviceId);
        await client.initRustCrypto({ cryptoDatabasePrefix: prefix });
        if (cancelled) {
          setRehydrationAttempted(true);
          return;
        }

        await client.startClient({ initialSyncLimit: 20 });
        if (cancelled) {
          setRehydrationAttempted(true);
          return;
        }

        setUserId(stored.userId);
        setAccessToken(stored.accessToken);
        setDeviceId(stored.deviceId);
      } catch (err) {
        console.error('[useMatrixAuth] Rehydration failed:', err);
        clearStoredCredentials();
        if (getMatrixClient()) {
          destroyMatrixClient().catch(() => {});
        }
      } finally {
        if (!cancelled) setRehydrationAttempted(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return {
    loginAsGuest,
    login,
    register,
    logout,
    fetchLoginFlows,
    startSsoLogin,
    completeSsoLogin,
    ssoProviders,
    loginFlowsError,
    isAuthenticated,
    isLoading,
    error,
    userId,
    accessToken,
    deviceId,
    rehydrationAttempted,
    cryptoError,
    clearCryptoError,
  };
}
