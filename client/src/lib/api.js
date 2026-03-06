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
 * @param {string} serverId - Guild UUID the channel belongs to
 * @param {string} channelId - Channel UUID
 * @param {{ before?: string, limit?: number }} [opts] - before: RFC3339 cursor; limit: default 50, max 50
 * @returns {Promise<Array<{ id: string, channelId: string, senderId: string, ciphertext: string, timestamp: string }>>}
 */
export async function getChannelMessages(token, serverId, channelId, opts = {}) {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  if (opts.limit != null) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const path = `/api/servers/${encodeURIComponent(serverId)}/channels/${encodeURIComponent(channelId)}/messages${qs ? `?${qs}` : ''}`;
  const res = await fetchWithAuth(token, path);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `get messages ${res.status}`);
  }
  return res.json();
}

/**
 * Get current instance metadata.
 * @param {string} token - JWT
 * @returns {Promise<{ id: string, name: string, iconUrl?: string, ownerId: string, registrationMode: string, serverCreationPolicy: string, createdAt: string, bootstrapped: boolean }>}
 */
export async function getInstance(token) {
  const res = await fetchWithAuth(token, '/api/instance');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `get instance ${res.status}`);
  }
  return res.json();
}

/**
 * Update instance metadata (owner-only).
 * @param {string} token - JWT
 * @param {{ name?: string, iconUrl?: string, registrationMode?: string }} body
 * @returns {Promise<void>}
 */
export async function updateInstance(token, body) {
  const res = await fetchWithAuth(token, '/api/instance', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `update instance ${res.status}`);
  }
}

// ── Guild API ─────────────────────────────────────────────────────────────────

/**
 * List all guilds the authenticated user belongs to.
 * @param {string} token - JWT
 * @returns {Promise<Array<{ id: string, name: string, ownerId: string, createdAt: string }>>}
 */
export async function getMyGuilds(token) {
  const res = await fetchWithAuth(token, '/api/servers');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `get guilds ${res.status}`);
  }
  return res.json();
}

/**
 * Create a new guild.
 * @param {string} token - JWT
 * @param {string} name - Guild name
 * @returns {Promise<{ id: string, name: string, ownerId: string, createdAt: string }>}
 */
export async function createGuild(token, name) {
  const res = await fetchWithAuth(token, '/api/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `create guild ${res.status}`);
  }
  return res.json();
}

/**
 * Delete a guild (owner only).
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @returns {Promise<void>}
 */
export async function deleteGuild(token, serverId) {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `delete guild ${res.status}`);
  }
}

/**
 * List all channels in a guild.
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @returns {Promise<Array<{ id: string, name: string, type: string, voiceMode?: string, parentId?: string, position: number, createdAt: string }>>}
 */
export async function getGuildChannels(token, serverId) {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}/channels`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.error || `get channels ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

/**
 * Create a channel in a guild (admin+).
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {{ name: string, type: 'text'|'voice', voiceMode?: string, parentId?: string, position?: number }} body
 * @returns {Promise<object>} Created channel
 */
export async function createGuildChannel(token, serverId, body) {
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
 * Delete a channel in a guild (admin only).
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {string} channelId - Channel UUID
 * @returns {Promise<void>}
 */
export async function deleteGuildChannel(token, serverId, channelId) {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/channels/${encodeURIComponent(channelId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `delete channel ${res.status}`);
  }
}

/**
 * Move a channel to a new parent and/or position within a guild (admin only).
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {string} channelId - Channel UUID
 * @param {{ parentId?: string|null, position: number }} body
 * @returns {Promise<void>}
 */
export async function moveChannel(token, serverId, channelId, body) {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/channels/${encodeURIComponent(channelId)}/move`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `move channel ${res.status}`);
  }
}

/**
 * List all members of a guild.
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @returns {Promise<Array<{ id: string, username: string, displayName: string, role: string, createdAt: string }>>}
 */
export async function getGuildMembers(token, serverId) {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}/members`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.error || `get members ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

/**
 * Create an invite code for a guild.
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {{ maxUses?: number, expiresInHours?: number }} [opts]
 * @returns {Promise<{ code: string, createdBy: string, maxUses: number, expiresAt: string }>}
 */
export async function createGuildInvite(token, serverId, opts = {}) {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `create invite ${res.status}`);
  }
  return res.json();
}

/**
 * Resolve an invite code to guild info (public — no auth required).
 * @param {string} code - Invite code
 * @returns {Promise<{ code: string, guildName: string, expiresAt: string, serverId: string }>}
 */
export async function getInviteInfo(code) {
  const res = await fetch(`${defaultBase}/api/invites/${encodeURIComponent(code)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `invite lookup ${res.status}`);
  }
  return res.json();
}

/**
 * Claim an invite code (adds the authenticated user to the guild).
 * @param {string} token - JWT
 * @param {string} code - Invite code
 * @returns {Promise<{ serverId: string, guildName: string }>}
 */
export async function claimInvite(token, code) {
  const res = await fetchWithAuth(token, '/api/invites/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `claim invite ${res.status}`);
  }
  return res.json();
}

// ── Moderation API ───────────────────────────────────────────────────────────

/**
 * Kick a user from a guild.
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {string} userId - Target user UUID
 * @param {string} reason - Required reason string
 * @returns {Promise<void>}
 */
export async function kickUser(token, serverId, userId, reason) {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/kick`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, reason }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `kick ${res.status}`);
  }
}

/**
 * Ban a user from a guild.
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {string} userId - Target user UUID
 * @param {string} reason - Required reason string
 * @param {number|null} [expiresIn] - Duration in seconds; null = permanent
 * @returns {Promise<void>}
 */
export async function banUser(token, serverId, userId, reason, expiresIn) {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/ban`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, reason, expiresIn: expiresIn ?? null }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `ban ${res.status}`);
  }
}

/**
 * Mute a user in a guild.
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {string} userId - Target user UUID
 * @param {string} reason - Required reason string
 * @param {number|null} [expiresIn] - Duration in seconds; null = permanent
 * @returns {Promise<void>}
 */
export async function muteUser(token, serverId, userId, reason, expiresIn) {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/mute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, reason, expiresIn: expiresIn ?? null }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `mute ${res.status}`);
  }
}

/**
 * Unban a user from a guild. Requires admin role.
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {string} userId - Target user UUID
 * @param {string} reason - Required reason string
 * @returns {Promise<void>}
 */
export async function unbanUser(token, serverId, userId, reason) {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/unban`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, reason }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `unban failed ${res.status}`);
  }
}

/**
 * Unmute a user in a guild. Requires mod+ role.
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {string} userId - Target user UUID
 * @param {string} reason - Required reason string
 * @returns {Promise<void>}
 */
export async function unmuteUser(token, serverId, userId, reason) {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/unmute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, reason }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `unmute failed ${res.status}`);
  }
}

/**
 * List active bans for a guild. Requires admin role.
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @returns {Promise<Array<{ id: string, userId: string, actorId: string, reason: string, createdAt: string, expiresAt?: string }>>}
 */
export async function listBans(token, serverId) {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/bans`,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `list bans failed ${res.status}`);
  }
  return res.json();
}

/**
 * List active mutes for a guild. Requires admin role.
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @returns {Promise<Array<{ id: string, userId: string, actorId: string, reason: string, createdAt: string, expiresAt?: string }>>}
 */
export async function listMutes(token, serverId) {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/mutes`,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `list mutes failed ${res.status}`);
  }
  return res.json();
}

/**
 * Change a user's role in a guild.
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {string} userId - Target user UUID
 * @param {string} newRole - 'member' | 'mod' | 'admin'
 * @param {string} reason - Required reason string
 * @returns {Promise<void>}
 */
export async function changeUserRole(token, serverId, userId, newRole, reason) {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/role`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newRole, reason }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `change role ${res.status}`);
  }
}

/**
 * Delete a message within a guild (mod action or self-delete).
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {string} messageId - Message UUID
 * @returns {Promise<void>}
 */
export async function deleteMessage(token, serverId, messageId) {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/messages/${encodeURIComponent(messageId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `delete message ${res.status}`);
  }
}

/**
 * Fetch guild audit log entries with optional filters.
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {{ limit?: number, offset?: number, action?: string, actorId?: string, targetId?: string }} [opts]
 * @returns {Promise<Array<{ id: string, actorId: string, targetId?: string, action: string, reason: string, metadata?: object, createdAt: string }>>}
 */
export async function getAuditLog(token, serverId, opts = {}) {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set('limit', String(opts.limit));
  if (opts.offset != null) params.set('offset', String(opts.offset));
  if (opts.action) params.set('action', opts.action);
  if (opts.actorId) params.set('actor_id', opts.actorId);
  if (opts.targetId) params.set('target_id', opts.targetId);
  const qs = params.toString();
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/audit-log${qs ? '?' + qs : ''}`,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load audit log');
  }
  return res.json();
}

// ── System Messages ───────────────────────────────────────────────────────────

/**
 * Fetch paginated system messages for a guild.
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {{ before?: string, limit?: number }} [opts] - before: RFC3339 cursor; limit: default 50
 * @returns {Promise<Array<{ id: string, serverId: string, eventType: string, actorId: string, targetId?: string, reason?: string, metadata?: object, createdAt: string }>>}
 */
export async function getSystemMessages(token, serverId, opts = {}) {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  if (opts.limit != null) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const path = `/api/servers/${encodeURIComponent(serverId)}/system-messages${qs ? '?' + qs : ''}`;
  const res = await fetchWithAuth(token, path);
  if (!res.ok) throw new Error(`getSystemMessages: ${res.status}`);
  return res.json();
}

// ── Instance Admin ────────────────────────────────────────

/**
 * Search instance users by username prefix (admin+).
 * @param {string} token - JWT
 * @param {string} query - Username prefix to search
 * @returns {Promise<Array<{ id: string, username: string, displayName: string, role: string, createdAt: string, isBanned: boolean, banReason?: string, banExpiresAt?: string }>>}
 */
export async function searchInstanceUsers(token, query) {
  const res = await fetchWithAuth(token, `/api/instance/users?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Search failed');
  return res.json();
}

/**
 * Ban a user at the instance level (admin+).
 * @param {string} token - JWT
 * @param {string} userId - Target user UUID
 * @param {string} reason - Ban reason (required)
 * @param {number|null} [expiresIn] - Duration in seconds; null = permanent
 * @returns {Promise<void>}
 */
export async function instanceBanUser(token, userId, reason, expiresIn) {
  const res = await fetchWithAuth(token, '/api/instance/bans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, reason, expiresIn: expiresIn ?? null }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Ban failed');
}

/**
 * Unban a user at the instance level (admin+).
 * @param {string} token - JWT
 * @param {string} userId - Target user UUID
 * @param {string} reason - Unban reason (required)
 * @returns {Promise<void>}
 */
export async function instanceUnbanUser(token, userId, reason) {
  const res = await fetchWithAuth(token, '/api/instance/unban', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, reason }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Unban failed');
}

/**
 * Fetch instance-level audit log entries (owner only).
 * @param {string} token - JWT
 * @param {{ limit?: number, offset?: number, action?: string, targetId?: string }} [opts]
 * @returns {Promise<Array<{ id: string, actorId: string, targetId?: string, action: string, reason: string, metadata?: object, createdAt: string }>>}
 */
export async function getInstanceAuditLog(token, opts = {}) {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set('limit', String(opts.limit));
  if (opts.offset != null) params.set('offset', String(opts.offset));
  if (opts.action) params.set('action', opts.action);
  if (opts.targetId) params.set('target_id', opts.targetId);
  const qs = params.toString();
  const res = await fetchWithAuth(token, `/api/instance/audit-log${qs ? '?' + qs : ''}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load audit log');
  return res.json();
}

/**
 * Update instance configuration (owner only).
 * @param {string} token - JWT
 * @param {{ registrationMode?: string, serverCreationPolicy?: string }} updates
 * @returns {Promise<void>}
 */
export async function updateInstanceConfig(token, updates) {
  const res = await fetchWithAuth(token, '/api/instance', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Config update failed');
}

// ── Call after Go backend register/login ──────────────────────────────────────

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
