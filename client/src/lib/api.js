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
 * Fetch paginated message history for a channel. Ciphertext is base64; client decrypts locally.
 * @param {string} token - JWT
 * @param {string} channelId - Channel UUID
 * @param {{ before?: string, limit?: number }} [opts] - before: RFC3339 cursor; limit: default 50, max 50
 * @returns {Promise<Array<{ id: string, channelId: string, senderId: string, ciphertext: string, timestamp: string }>>}
 */
export async function getChannelMessages(token, channelId, opts = {}) {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  if (opts.limit != null) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const path = `/api/channels/${encodeURIComponent(channelId)}/messages${qs ? `?${qs}` : ''}`;
  const res = await fetchWithAuth(token, path);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `get messages ${res.status}`);
  }
  return res.json();
}

/**
 * List servers the current user is a member of.
 * @param {string} token - JWT
 * @returns {Promise<Array<{ id: string, name: string, iconUrl?: string, ownerId: string, createdAt: string, role: string }>>}
 */
export async function listServers(token) {
  const res = await fetchWithAuth(token, '/api/servers');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `list servers ${res.status}`);
  }
  return res.json();
}

/**
 * Get server details with channels and current user's role.
 * @param {string} token - JWT
 * @param {string} serverId - Server UUID
 * @returns {Promise<{ server: object, channels: Array<object>, myRole: string }>}
 */
export async function getServer(token, serverId) {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `get server ${res.status}`);
  }
  return res.json();
}

/**
 * Create a new server.
 * @param {string} token - JWT
 * @param {{ name: string, iconUrl?: string }} body
 * @returns {Promise<object>} Created server
 */
export async function createServer(token, body) {
  const res = await fetchWithAuth(token, '/api/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `create server ${res.status}`);
  }
  return res.json();
}

/**
 * Resolve an invite code to server info (for join flow). No auth required.
 * @param {string} code - Invite code (from link or user input)
 * @returns {Promise<{ serverId: string, serverName: string }>}
 */
export async function getInviteByCode(code) {
  const res = await fetch(`${defaultBase}/api/invites/${encodeURIComponent(code)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `invite lookup ${res.status}`);
  }
  return res.json();
}

/**
 * Join a server with an invite code.
 * @param {string} token - JWT
 * @param {string} serverId - Server UUID
 * @param {{ inviteCode: string }} body
 * @returns {Promise<object>} Server
 */
export async function joinServer(token, serverId, body) {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `join server ${res.status}`);
  }
  return res.json();
}

/**
 * Create a channel in a server.
 * @param {string} token - JWT
 * @param {string} serverId - Server UUID
 * @param {{ name: string, type: 'text'|'voice', voiceMode?: 'performance'|'quality', parentId?: string, position?: number }} body
 * @returns {Promise<object>} Created channel
 */
export async function createChannel(token, serverId, body) {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `create channel ${res.status}`);
  }
  return res.json();
}

/**
 * Delete a channel (admin only).
 * @param {string} token - JWT
 * @param {string} channelId - Channel UUID
 * @returns {Promise<void>}
 */
export async function deleteChannel(token, channelId) {
  const res = await fetchWithAuth(token, `/api/channels/${encodeURIComponent(channelId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `delete channel ${res.status}`);
  }
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
