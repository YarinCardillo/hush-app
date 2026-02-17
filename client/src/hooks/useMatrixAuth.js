import { useState, useCallback } from 'react';
import {
  createMatrixClient,
  getMatrixClient,
  destroyMatrixClient,
} from '../lib/matrixClient';

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

      // Initialize Rust crypto for E2EE support (matrix-js-sdk v40+). Use per-account store so
      // multiple users/tabs do not share one IndexedDB and hit "account in the store doesn't match".
      if (authenticatedClient) {
        try {
          const prefix = cryptoStorePrefix(
            authenticatedClient.getUserId(),
            authenticatedClient.getDeviceId(),
          );
          await authenticatedClient.initRustCrypto({ cryptoDatabasePrefix: prefix });
          console.log('[useMatrixAuth] Rust crypto initialized successfully');
        } catch (cryptoErr) {
          console.error('[useMatrixAuth] Crypto initialization failed:', cryptoErr);
          // Non-fatal: continue without E2EE if crypto init fails
        }
      }

      // Start sync and wait for initial sync to complete
      if (authenticatedClient) {
        // Create a promise that resolves when sync reaches PREPARED or SYNCING state
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

        // Start client and wait for initial sync to complete
        const startPromise = authenticatedClient.startClient({ initialSyncLimit: 20 });
        await Promise.all([startPromise, syncPromise]);
      }
    } catch (err) {
      console.error('[useMatrixAuth] Anonymous registration failed:', err);
      setError(err);
      // Clear partial state on failure
      setUserId(null);
      setAccessToken(null);
      setDeviceId(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Login with Matrix credentials.
   * For future use - not currently used in Hush flow.
   *
   * @param {string} username - Matrix username
   * @param {string} password - Matrix password
   */
  const login = useCallback(async (username, password) => {
    setIsLoading(true);
    setError(null);

    try {
      const client = createMatrixClient();

      const response = await client.login('m.login.password', {
        user: username,
        password: password,
      });

      setUserId(response.user_id);
      setAccessToken(response.access_token);
      setDeviceId(response.device_id);

      // Recreate client with auth credentials
      createMatrixClient({
        userId: response.user_id,
        accessToken: response.access_token,
        deviceId: response.device_id,
      });

      // Initialize Rust crypto with per-account store (see loginAsGuest).
      const authenticatedClient = getMatrixClient();
      if (authenticatedClient) {
        try {
          const prefix = cryptoStorePrefix(
            authenticatedClient.getUserId(),
            authenticatedClient.getDeviceId(),
          );
          await authenticatedClient.initRustCrypto({ cryptoDatabasePrefix: prefix });
          console.log('[useMatrixAuth] Rust crypto initialized successfully');
        } catch (cryptoErr) {
          console.error('[useMatrixAuth] Crypto initialization failed:', cryptoErr);
          // Non-fatal: continue without E2EE if crypto init fails
        }
      }

      // Start sync
      if (authenticatedClient) {
        await authenticatedClient.startClient({ initialSyncLimit: 20 });
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
   * For future use - not currently used in Hush flow.
   *
   * @param {string} username - Desired username
   * @param {string} password - Account password
   * @param {string} displayName - User display name
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

      // Initialize Rust crypto with per-account store (see loginAsGuest).
      if (authenticatedClient) {
        try {
          const prefix = cryptoStorePrefix(
            authenticatedClient.getUserId(),
            authenticatedClient.getDeviceId(),
          );
          await authenticatedClient.initRustCrypto({ cryptoDatabasePrefix: prefix });
          console.log('[useMatrixAuth] Rust crypto initialized successfully');
        } catch (cryptoErr) {
          console.error('[useMatrixAuth] Crypto initialization failed:', cryptoErr);
          // Non-fatal: continue without E2EE if crypto init fails
        }
      }

      // Start sync
      if (authenticatedClient) {
        await authenticatedClient.startClient({ initialSyncLimit: 20 });
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
  const logout = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      await destroyMatrixClient();
      // Clear auth state
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

  return {
    loginAsGuest,
    login,
    register,
    logout,
    isAuthenticated,
    isLoading,
    error,
    userId,
    accessToken,
    deviceId,
  };
}
