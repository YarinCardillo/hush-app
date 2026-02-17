/**
 * Persists Matrix credentials in sessionStorage for rehydration after page refresh.
 * Single key to avoid multiple storage entries.
 */

const STORAGE_KEY = 'hush_matrix_credentials';

/**
 * @typedef {Object} StoredCredentials
 * @property {string} userId
 * @property {string} deviceId
 * @property {string} accessToken
 * @property {string} baseUrl
 */

/**
 * Reads stored Matrix credentials from sessionStorage.
 * @returns {StoredCredentials|null} Parsed credentials or null if missing/invalid
 */
export function getStoredCredentials() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (
      typeof data?.userId === 'string' &&
      typeof data?.deviceId === 'string' &&
      typeof data?.accessToken === 'string' &&
      typeof data?.baseUrl === 'string'
    ) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Writes Matrix credentials to sessionStorage.
 * @param {StoredCredentials} credentials
 */
export function setStoredCredentials(credentials) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
}

/**
 * Removes stored Matrix credentials from sessionStorage.
 */
export function clearStoredCredentials() {
  sessionStorage.removeItem(STORAGE_KEY);
}
