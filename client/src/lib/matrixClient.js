import * as sdk from 'matrix-js-sdk';

let matrixClient = null;

/**
 * Creates and initializes a Matrix client instance.
 *
 * @param {Object} options - Matrix client configuration options
 * @param {string} options.baseUrl - Homeserver URL (optional, defaults to env var or origin/_matrix)
 * @param {string} options.userId - Matrix user ID (optional)
 * @param {string} options.accessToken - Access token for authenticated client (optional)
 * @param {string} options.deviceId - Device ID for E2EE (optional)
 * @returns {MatrixClient} The initialized Matrix client instance
 */
export function createMatrixClient(options = {}) {
  // Clean up existing client if present
  if (matrixClient) {
    destroyMatrixClient();
  }

  const homeserverUrl =
    options.baseUrl ||
    import.meta.env.VITE_MATRIX_HOMESERVER_URL ||
    window.location.origin;

  const clientConfig = {
    baseUrl: homeserverUrl,
    ...options,
  };

  matrixClient = sdk.createClient(clientConfig);

  return matrixClient;
}

/**
 * Retrieves the current Matrix client instance.
 *
 * @returns {MatrixClient|null} The Matrix client or null if not initialized
 */
export function getMatrixClient() {
  return matrixClient;
}

/**
 * Destroys the current Matrix client, stopping sync and clearing instance.
 * Performs cleanup and logout if the client is authenticated.
 */
export async function destroyMatrixClient() {
  if (!matrixClient) {
    return;
  }

  try {
    // Stop sync if running
    if (matrixClient.isInitialSyncComplete()) {
      matrixClient.stopClient();
    }

    // Logout if authenticated (clears server-side session)
    const accessToken = matrixClient.getAccessToken();
    if (accessToken) {
      await matrixClient.logout(true); // stopClient = true
    }
  } catch (error) {
    console.error('Error during Matrix client cleanup:', error);
  } finally {
    matrixClient = null;
  }
}
