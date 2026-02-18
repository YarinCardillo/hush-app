/**
 * Persists Matrix credentials in localStorage for rehydration across sessions.
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
 * Reads stored Matrix credentials from localStorage.
 * @returns {StoredCredentials|null} Parsed credentials or null if missing/invalid
 */
export function getStoredCredentials() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
 * Writes Matrix credentials to localStorage.
 * @param {StoredCredentials} credentials
 */
export function setStoredCredentials(credentials) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
}

/**
 * Removes stored Matrix credentials from localStorage.
 */
export function clearStoredCredentials() {
  localStorage.removeItem(STORAGE_KEY);
}
