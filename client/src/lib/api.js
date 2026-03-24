/**
 * HTTP client for the Go backend API.
 * Assumes auth token is passed per-request or set elsewhere.
 */

import * as mlsStore from './mlsStore';
import * as hushCrypto from './hushCrypto';
import { uploadKeyPackagesAfterAuth as uploadKeyPackagesAfterAuthImpl } from './uploadKeyPackages';

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
 * Upload MLS credential (public material only) to the server.
 * @param {string} token - JWT
 * @param {{ deviceId: string, credentialBytes: number[], signingPublicKey: number[] }} body
 * @returns {Promise<void>}
 */
export async function uploadMLSCredential(token, body) {
  const res = await fetchWithAuth(token, '/api/mls/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `upload MLS credential ${res.status}`);
  }
}

/**
 * Upload a batch of MLS KeyPackages to the server.
 * @param {string} token - JWT
 * @param {{ deviceId: string, keyPackages: number[][], expiresAt?: string, lastResort?: boolean }} body
 * @returns {Promise<void>}
 */
export async function uploadMLSKeyPackages(token, body) {
  const res = await fetchWithAuth(token, '/api/mls/key-packages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `upload MLS key packages ${res.status}`);
  }
}

/**
 * Get the current KeyPackage count for this device from the server.
 * Used by key maintenance to decide whether to replenish KeyPackages.
 * @param {string} token - JWT
 * @param {string} deviceId - Device ID
 * @returns {Promise<number>}
 */
export async function getKeyPackageCount(token, deviceId) {
  const res = await fetchWithAuth(token, `/api/mls/key-packages/count?deviceId=${encodeURIComponent(deviceId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `getKeyPackageCount ${res.status}`);
  }
  const data = await res.json();
  return data.count;
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

// ── BIP39 Auth API ────────────────────────────────────────────────────────────

/**
 * Request a challenge nonce for a given public key.
 * The server issues a nonce that must be signed with the matching private key.
 *
 * @param {string} publicKeyBase64 - Base64-encoded 32-byte Ed25519 public key.
 * @returns {Promise<{ nonce: string }>} Hex-encoded nonce.
 */
export async function requestChallenge(publicKeyBase64) {
  const res = await fetch(`${defaultBase}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: publicKeyBase64 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `requestChallenge ${res.status}`);
  return data;
}

/**
 * Verify a signed challenge nonce and receive a JWT session token.
 *
 * @param {string} publicKeyBase64 - Base64-encoded Ed25519 public key.
 * @param {string} nonce - Hex nonce from requestChallenge.
 * @param {string} signatureBase64 - Base64-encoded 64-byte Ed25519 signature.
 * @param {string} deviceId - Stable per-device identifier (UUID).
 * @returns {Promise<{ token: string, user: object }>}
 */
export async function verifyChallenge(publicKeyBase64, nonce, signatureBase64, deviceId) {
  const res = await fetch(`${defaultBase}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: publicKeyBase64, nonce, signature: signatureBase64, deviceId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `verifyChallenge ${res.status}`);
  return data;
}

/**
 * Register a new account with a BIP39-derived public key.
 *
 * @param {string} username - Unique username.
 * @param {string} displayName - Display name.
 * @param {string} publicKeyBase64 - Base64-encoded Ed25519 public key.
 * @param {string} deviceId - Stable per-device identifier (UUID).
 * @param {string} [inviteCode] - Optional invite code for invite_only registration mode.
 * @returns {Promise<{ token: string, user: object }>}
 */
export async function registerWithPublicKey(username, displayName, publicKeyBase64, deviceId, inviteCode) {
  const body = { username, displayName, publicKey: publicKeyBase64, deviceId };
  if (inviteCode) body.inviteCode = inviteCode;
  const res = await fetch(`${defaultBase}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `registerWithPublicKey ${res.status}`);
  return data;
}

/**
 * Authenticate as a guest (ephemeral, no mnemonic required).
 * Optionally accepts a joinCode to join a specific guild as a guest.
 *
 * @param {string} [joinCode] - Optional join/invite code.
 * @returns {Promise<{ token: string, user: object }>}
 */
export async function loginGuest(joinCode) {
  const body = joinCode ? { joinCode } : {};
  const res = await fetch(`${defaultBase}/api/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `loginGuest ${res.status}`);
  return data;
}

/**
 * List all registered device keys for the authenticated user.
 *
 * @param {string} token - JWT
 * @returns {Promise<Array<{ deviceId: string, publicKey: string, createdAt: string, lastSeenAt: string }>>}
 */
export async function listDeviceKeys(token) {
  const res = await fetchWithAuth(token, '/api/auth/devices');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `listDeviceKeys ${res.status}`);
  return data;
}

/**
 * Revoke a registered device key. The device can no longer authenticate.
 *
 * @param {string} token - JWT
 * @param {string} deviceId - Device ID to revoke.
 * @returns {Promise<void>}
 */
export async function revokeDeviceKey(token, deviceId) {
  const res = await fetchWithAuth(token, `/api/auth/devices/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `revokeDeviceKey ${res.status}`);
  }
}

/**
 * Register a new device key certified by an existing authenticated device.
 * Used in the multi-device linking flow (Plan 05).
 *
 * @param {string} token - JWT of the certifying device.
 * @param {string} newDevicePublicKeyBase64 - Base64-encoded Ed25519 public key of the new device.
 * @param {string} certificate - Base64-encoded signature: Sign(IK_existing_priv, IK_new_pub).
 * @param {string} deviceId - Device ID for the new device.
 * @returns {Promise<void>}
 */
/**
 * Register a new device key certified by an existing authenticated device.
 * Used in the multi-device linking flow (Plan 06).
 *
 * @param {string} token - JWT of the certifying device.
 * @param {string} newDevicePublicKeyBase64 - Base64-encoded Ed25519 public key of the new device.
 * @param {string} certificate - Base64-encoded signature: Sign(IK_existing_priv, IK_new_pub).
 * @param {string} deviceId - Device ID for the new device.
 * @param {string} signingDeviceId - Device ID of the certifying (existing) device.
 * @param {string} [label] - Optional human-readable label for the new device.
 * @returns {Promise<void>}
 */
export async function certifyNewDevice(token, newDevicePublicKeyBase64, certificate, deviceId, signingDeviceId, label) {
  const res = await fetchWithAuth(token, '/api/auth/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      devicePublicKey: newDevicePublicKeyBase64,
      certificate,
      deviceId,
      signingDeviceId,
      label,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `certifyNewDevice ${res.status}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch server handshake data (no auth required).
 * Returns server version, API version, KeyPackage low threshold, and other instance metadata.
 * @returns {Promise<{ server_version: string, api_version: string, min_client_version: string, key_package_low_threshold: number }>}
 */
export async function getHandshake() {
  const res = await fetch('/api/handshake');
  if (!res.ok) throw new Error(`handshake failed: ${res.status}`);
  return res.json();
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
 * Create a new guild (two-step: POST returns UUID, then PUT uploads encrypted metadata).
 * @param {string} token - JWT
 * @param {string} [encryptedMetadata] - Base64-encoded AES-GCM blob; null on initial creation
 * @param {string} [templateId] - Optional template UUID to use for channel creation
 * @returns {Promise<{ id: string, encryptedMetadata: string|null, permissionLevel: number, createdAt: string }>}
 */
export async function createGuild(token, encryptedMetadata, templateId) {
  const body = {};
  if (encryptedMetadata != null) body.encryptedMetadata = encryptedMetadata;
  if (templateId) body.templateId = templateId;
  const res = await fetchWithAuth(token, '/api/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `create guild ${res.status}`);
  }
  return res.json();
}

/**
 * Update guild encrypted metadata (e.g. after MLS group is set up).
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {string} encryptedMetadata - Base64-encoded AES-GCM blob
 * @returns {Promise<void>}
 */
export async function updateGuildMetadata(token, serverId, encryptedMetadata) {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encryptedMetadata }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `update guild metadata ${res.status}`);
  }
}

/**
 * Voluntarily leave a guild (non-owner members only).
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @returns {Promise<void>}
 */
export async function leaveGuild(token, serverId) {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}/leave`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `leave guild failed: ${res.status}`);
  }
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
 * NOTE: Response does NOT include guildName — the guild name is read from the URL fragment.
 * @param {string} code - Invite code
 * @returns {Promise<{ code: string, serverId: string, memberCount: number, expiresAt: string }>}
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
 * NOTE: Response does NOT include guildName — navigation uses serverId only.
 * @param {string} token - JWT
 * @param {string} code - Invite code
 * @returns {Promise<{ serverId: string }>}
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
 * Change a user's permission level in a guild.
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {string} userId - Target user UUID
 * @param {number} permissionLevel - Integer: 0=member, 1=mod, 2=admin, 3=owner
 * @returns {Promise<void>}
 */
export async function changePermissionLevel(token, serverId, userId, permissionLevel) {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/level`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionLevel }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `change permission level ${res.status}`);
  }
}

/**
 * @deprecated Use changePermissionLevel instead.
 * Kept for backward compatibility during transition.
 */
export async function changeUserRole(token, serverId, userId, newRole) {
  // Map legacy role strings to integer levels
  const levelMap = { member: 0, mod: 1, admin: 2, owner: 3 };
  const level = levelMap[newRole] ?? 0;
  return changePermissionLevel(token, serverId, userId, level);
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

// ── Server Templates ─────────────────────────────────────────────────────────

/**
 * List all server templates (owner only).
 * @param {string} token - JWT
 * @returns {Promise<Array<{ id: string, name: string, channels: Array, isDefault: boolean, position: number }>>}
 */
export async function listServerTemplates(token) {
  const res = await fetchWithAuth(token, '/api/instance/server-templates');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load templates');
  return res.json();
}

/**
 * Create a new server template (owner only).
 * @param {string} token - JWT
 * @param {{ name: string, channels: Array, isDefault: boolean }} body
 * @returns {Promise<object>} Created template
 */
export async function createServerTemplate(token, body) {
  const res = await fetchWithAuth(token, '/api/instance/server-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to create template');
  return res.json();
}

/**
 * Update a server template (owner only).
 * @param {string} token - JWT
 * @param {string} id - Template UUID
 * @param {{ name: string, channels: Array, isDefault: boolean }} body
 * @returns {Promise<void>}
 */
export async function updateServerTemplate(token, id, body) {
  const res = await fetchWithAuth(token, `/api/instance/server-templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to update template');
}

/**
 * Delete a server template (owner only, cannot delete default).
 * @param {string} token - JWT
 * @param {string} id - Template UUID
 * @returns {Promise<void>}
 */
export async function deleteServerTemplate(token, id) {
  const res = await fetchWithAuth(token, `/api/instance/server-templates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to delete template');
}

// ── Call after Go backend register/login ──────────────────────────────────────

/**
 * Call after Go backend register/login. Generates MLS credential + KeyPackages,
 * persists private keys locally, and uploads public material to the server.
 * @param {string} token - JWT from auth response
 * @param {string} userId - Current user UUID
 * @param {string} deviceId - Stable device ID (e.g. from localStorage or generated once)
 * @param {object} [deps] - Optional deps for testing: { mlsStore, crypto, uploadCredential, uploadKeyPackages }
 */
export async function uploadKeyPackagesAfterAuth(token, userId, deviceId, deps = {}) {
  await uploadKeyPackagesAfterAuthImpl(token, userId, deviceId, {
    mlsStore: deps.mlsStore ?? mlsStore,
    crypto: deps.crypto ?? hushCrypto,
    uploadCredential: deps.uploadCredential ?? uploadMLSCredential.bind(null),
    uploadKeyPackages: deps.uploadKeyPackages ?? uploadMLSKeyPackages.bind(null),
  });
}

// ── MLS Group API ─────────────────────────────────────────────────────────────

/**
 * Get the current GroupInfo for a channel's MLS group.
 * Returns null if no group has been created for this channel yet.
 *
 * @param {string} token - JWT
 * @param {string} channelId - Channel UUID
 * @returns {Promise<{ groupInfo: string, epoch: number }|null>}
 */
export async function getMLSGroupInfo(token, channelId) {
  const res = await fetchWithAuth(token, `/api/mls/groups/${encodeURIComponent(channelId)}/info`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `getMLSGroupInfo ${res.status}`);
  }
  return res.json();
}

/**
 * Upsert the GroupInfo for a channel's MLS group.
 * Called after creating a group or advancing its epoch.
 *
 * @param {string} token - JWT
 * @param {string} channelId - Channel UUID
 * @param {string} groupInfoBase64 - Base64-encoded serialised GroupInfo
 * @param {number} epoch - Current group epoch
 * @returns {Promise<void>}
 */
export async function putMLSGroupInfo(token, channelId, groupInfoBase64, epoch) {
  const res = await fetchWithAuth(token, `/api/mls/groups/${encodeURIComponent(channelId)}/info`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupInfo: groupInfoBase64, epoch }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `putMLSGroupInfo ${res.status}`);
  }
}

/**
 * Post a Commit to the server for distribution to channel members.
 * Also upserts the current GroupInfo so new joiners can catch up.
 *
 * @param {string} token - JWT
 * @param {string} channelId - Channel UUID
 * @param {string} commitBytesBase64 - Base64-encoded commit bytes
 * @param {string} groupInfoBase64 - Base64-encoded updated GroupInfo bytes
 * @param {number} epoch - Epoch after this commit
 * @returns {Promise<void>}
 */
export async function postMLSCommit(token, channelId, commitBytesBase64, groupInfoBase64, epoch) {
  const res = await fetchWithAuth(token, `/api/mls/groups/${encodeURIComponent(channelId)}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commitBytes: commitBytesBase64, groupInfo: groupInfoBase64, epoch }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `postMLSCommit ${res.status}`);
  }
}

// ── MLS Voice Group API ────────────────────────────────────────────────────────

/**
 * Get GroupInfo for a channel's voice MLS group.
 * Returns null if no voice group exists for this channel yet.
 *
 * @param {string} token - JWT
 * @param {string} channelId - Channel UUID
 * @returns {Promise<{ groupInfo: string, epoch: number }|null>}
 */
export async function getMLSVoiceGroupInfo(token, channelId) {
  const res = await fetchWithAuth(
    token,
    `/api/mls/groups/${encodeURIComponent(channelId)}/info?type=voice`,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `getMLSVoiceGroupInfo ${res.status}`);
  }
  return res.json();
}

/**
 * Upsert the GroupInfo for a channel's voice MLS group.
 * Called after creating or advancing the voice group epoch.
 *
 * @param {string} token - JWT
 * @param {string} channelId - Channel UUID
 * @param {string} groupInfoBase64 - Base64-encoded serialised GroupInfo
 * @param {number} epoch - Current group epoch
 * @returns {Promise<void>}
 */
export async function putMLSVoiceGroupInfo(token, channelId, groupInfoBase64, epoch) {
  const res = await fetchWithAuth(
    token,
    `/api/mls/groups/${encodeURIComponent(channelId)}/info?type=voice`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupInfo: groupInfoBase64, epoch }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `putMLSVoiceGroupInfo ${res.status}`);
  }
}

/**
 * Post a Commit to the server for distribution to voice channel participants.
 * Also upserts the current GroupInfo so new joiners can catch up.
 *
 * @param {string} token - JWT
 * @param {string} channelId - Channel UUID
 * @param {string} commitBytesBase64 - Base64-encoded commit bytes
 * @param {number} epoch - Epoch after this commit
 * @param {string} [groupInfoBase64] - Optional Base64-encoded updated GroupInfo
 * @returns {Promise<void>}
 */
export async function postMLSVoiceCommit(token, channelId, commitBytesBase64, epoch, groupInfoBase64) {
  const res = await fetchWithAuth(
    token,
    `/api/mls/groups/${encodeURIComponent(channelId)}/commit?type=voice`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitBytes: commitBytesBase64, groupInfo: groupInfoBase64 ?? '', epoch }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `postMLSVoiceCommit ${res.status}`);
  }
}

/**
 * Fetch Commits that occurred after a given epoch (for catch-up on reconnect).
 *
 * @param {string} token - JWT
 * @param {string} channelId - Channel UUID
 * @param {number} sinceEpoch - Only return commits with epoch > sinceEpoch
 * @param {number} [limit=100] - Max commits to return
 * @returns {Promise<{ commits: Array<{ epoch: number, commitBytes: string, senderId: string }> }>}
 */
export async function getMLSCommitsSinceEpoch(token, channelId, sinceEpoch, limit = 100) {
  const params = new URLSearchParams({
    since_epoch: String(sinceEpoch),
    limit: String(limit),
  });
  const res = await fetchWithAuth(
    token,
    `/api/mls/groups/${encodeURIComponent(channelId)}/commits?${params.toString()}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `getMLSCommitsSinceEpoch ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch pending Welcome messages addressed to the current user.
 * Returns Welcomes that have not yet been acknowledged (processed).
 *
 * @param {string} token - JWT
 * @returns {Promise<{ welcomes: Array<{ id: string, channelId: string, welcomeBytes: string, senderId: string, epoch: number }> }>}
 */
export async function getMLSPendingWelcomes(token) {
  const res = await fetchWithAuth(token, '/api/mls/pending-welcomes');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `getMLSPendingWelcomes ${res.status}`);
  }
  return res.json();
}

/**
 * Acknowledge (delete) a pending Welcome after processing it locally.
 * This prevents re-delivery on the next connection.
 *
 * @param {string} token - JWT
 * @param {string} welcomeId - UUID of the pending Welcome record
 * @returns {Promise<void>}
 */
export async function deleteMLSPendingWelcome(token, welcomeId) {
  const res = await fetchWithAuth(token, `/api/mls/pending-welcomes/${encodeURIComponent(welcomeId)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `deleteMLSPendingWelcome ${res.status}`);
  }
}

// ── Guild Metadata MLS Group ──────────────────────────────────────────────────

/**
 * Fetch the current GroupInfo for a guild metadata MLS group.
 * Used by members joining the guild to join the metadata group via External Commit.
 *
 * @param {string} token - JWT
 * @param {string} guildId - Guild UUID
 * @returns {Promise<{ groupInfo: string, epoch: number }|null>}
 */
export async function getGuildMetadataGroupInfo(token, guildId) {
  const res = await fetchWithAuth(token, `/api/mls/guilds/${encodeURIComponent(guildId)}/group-info`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `getGuildMetadataGroupInfo ${res.status}`);
  }
  return res.json();
}

/**
 * Upload or update the GroupInfo for a guild metadata MLS group.
 * Called by the guild creator after createGuildMetadataGroup and by members
 * after joining via External Commit.
 *
 * @param {string} token - JWT
 * @param {string} guildId - Guild UUID
 * @param {string} groupInfoBase64 - Base64-encoded serialised GroupInfo
 * @param {number} epoch - Current group epoch
 * @returns {Promise<void>}
 */
export async function putGuildMetadataGroupInfo(token, guildId, groupInfoBase64, epoch) {
  const res = await fetchWithAuth(token, `/api/mls/guilds/${encodeURIComponent(guildId)}/group-info`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupInfoBytes: groupInfoBase64, epoch }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `putGuildMetadataGroupInfo ${res.status}`);
  }
}
