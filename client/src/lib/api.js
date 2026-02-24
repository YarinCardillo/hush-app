/**
 * HTTP client for the Go backend API.
 * Assumes auth token is passed per-request or set elsewhere.
 */

import * as signalStore from './signalStore';
import * as hushCrypto from './hushCrypto';
import { uploadKeysAfterAuth as uploadKeysAfterAuthImpl } from './uploadKeysAfterAuth';

const defaultBase = '';

/**
 * @param {string} token - JWT
 * @param {string} path - e.g. /api/keys/upload
 * @param {RequestInit} [opts]
 * @returns {Promise<Response>}
 */
export async function fetchWithAuth(token, path, opts = {}) {
  const url = path.startsWith('http') ? path : `${defaultBase}${path}`;
  const headers = new Headers(opts.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { ...opts, headers });
}

/**
 * Upload pre-keys to the server.
 * @param {string} token - JWT
 * @param {object} body - PreKeyUploadRequest (deviceId, identityKey, signedPreKey, signedPreKeySignature, registrationId, oneTimePreKeys)
 * @returns {Promise<void>}
 */
export async function uploadKeys(token, body) {
  const res = await fetchWithAuth(token, '/api/keys/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `upload keys ${res.status}`);
  }
}

/**
 * Fetch pre-key bundle(s) for a user (all devices).
 * @param {string} token - JWT
 * @param {string} userId - Target user UUID
 * @returns {Promise<Array<object>>}
 */
export async function getPreKeyBundle(token, userId) {
  const res = await fetchWithAuth(token, `/api/keys/${userId}`);
  if (!res.ok) {
    if (res.status === 404) return [];
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `get prekey bundle ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch pre-key bundle for a user and device.
 * @param {string} token - JWT
 * @param {string} userId - Target user UUID
 * @param {string} deviceId - Target device ID
 * @returns {Promise<object>}
 */
export async function getPreKeyBundleByDevice(token, userId, deviceId) {
  const res = await fetchWithAuth(token, `/api/keys/${userId}/${encodeURIComponent(deviceId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `get prekey bundle ${res.status}`);
  }
  return res.json();
}

/**
 * Call after Go backend register/login. Ensures identity exists in IndexedDB and uploads keys.
 * When using Go auth (Phase E), call this after successful login/register with token, userId, and a stable deviceId (e.g. from localStorage).
 * @param {string} token - JWT from auth response
 * @param {string} userId - Current user UUID
 * @param {string} deviceId - Stable device ID (e.g. from localStorage or generated once)
 * @param {object} [deps] - Optional: { store, crypto, uploadKeys } for testing
 */
export async function uploadKeysAfterAuth(token, userId, deviceId, deps = {}) {
  await uploadKeysAfterAuthImpl(token, userId, deviceId, {
    store: deps.store ?? signalStore,
    crypto: deps.crypto ?? hushCrypto,
    uploadKeys: deps.uploadKeys ?? uploadKeys,
  });
}
