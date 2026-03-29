/**
 * HTTP client for the Go backend API.
 * Assumes auth token is passed per-request or set elsewhere.
 */

import * as mlsStore from './mlsStore';
import * as hushCrypto from './hushCrypto';
import { uploadKeyPackagesAfterAuth as uploadKeyPackagesAfterAuthImpl } from './uploadKeyPackages';

/**
 * @param {string} token - JWT
 * @param {string} path - e.g. /api/keys/upload
 * @param {RequestInit} [opts]
 * @param {string} [baseUrl] - Optional base URL for cross-instance calls (e.g. 'https://other.instance.com'). Defaults to '' (relative URL).
 * @returns {Promise<Response>}
 */
export async function fetchWithAuth(token, path, opts = {}, baseUrl = '') {
  const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
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
export async function uploadMLSCredential(token, body, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/mls/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, baseUrl);
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
export async function uploadMLSKeyPackages(token, body, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/mls/key-packages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, baseUrl);
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
export async function getKeyPackageCount(token, deviceId, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/mls/key-packages/count?deviceId=${encodeURIComponent(deviceId)}`, {}, baseUrl);
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
export async function getPreKeyBundle(token, userId, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/keys/${userId}`, {}, baseUrl);
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
export async function getPreKeyBundleByDevice(token, userId, deviceId, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/keys/${userId}/${encodeURIComponent(deviceId)}`, {}, baseUrl);
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
export async function getChannelMessages(token, serverId, channelId, opts = {}, baseUrl = '') {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  if (opts.limit != null) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const path = `/api/servers/${encodeURIComponent(serverId)}/channels/${encodeURIComponent(channelId)}/messages${qs ? `?${qs}` : ''}`;
  const res = await fetchWithAuth(token, path, {}, baseUrl);
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
export async function getInstance(token, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/instance', {}, baseUrl);
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
export async function updateInstance(token, body, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/instance', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, baseUrl);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `update instance ${res.status}`);
  }
}

// ── Transparency Log API ──────────────────────────────────────────────────────

/**
 * Fetch Merkle inclusion proofs for all transparency log entries for a public key.
 *
 * Called by TransparencyVerifier to independently verify that key operations
 * were logged correctly by the server.
 *
 * @param {string} token      - JWT for authenticated API calls.
 * @param {string} pubkeyHex  - Hex-encoded 32-byte Ed25519 public key.
 * @param {string} [baseUrl]  - Optional base URL for cross-instance calls.
 * @returns {Promise<{ entries: object[], proofs: object[], treeHead: object }>}
 */
export async function verifyTransparency(token, pubkeyHex, baseUrl = '') {
  const url = `${baseUrl}/api/transparency/verify?pubkey=${encodeURIComponent(pubkeyHex)}`;
  const r = await fetchWithAuth(token, url, {}, '');
  if (!r.ok) throw new Error(`Transparency verify failed: ${r.status}`);
  return r.json();
}

// ── BIP39 Auth API ────────────────────────────────────────────────────────────

/**
 * Request a challenge nonce for a given public key.
 * The server issues a nonce that must be signed with the matching private key.
 *
 * @param {string} publicKeyBase64 - Base64-encoded 32-byte Ed25519 public key.
 * @returns {Promise<{ nonce: string }>} Hex-encoded nonce.
 */
export async function requestChallenge(publicKeyBase64, baseUrl = '') {
  const res = await fetch(`${baseUrl}/api/auth/challenge`, {
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
export async function verifyChallenge(publicKeyBase64, nonce, signatureBase64, deviceId, baseUrl = '') {
  const res = await fetch(`${baseUrl}/api/auth/verify`, {
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
/**
 * Request an ephemeral guest session token.
 * No account is created. The JWT carries is_guest=true and a short expiry.
 *
 * @param {string} [baseUrl='']
 * @returns {Promise<{ token: string, guestId: string, expiresAt: string }>}
 */
export async function requestGuestSession(baseUrl = '') {
  const res = await fetch(`${baseUrl}/api/auth/guest`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `requestGuestSession ${res.status}`);
  return data;
}

/**
 * Check if a username is available for registration.
 * @param {string} username
 * @param {string} [baseUrl='']
 * @returns {Promise<boolean>} true if available
 */
export async function checkUsernameAvailable(username, baseUrl = '') {
  const res = await fetch(`${baseUrl}/api/auth/check-username/${encodeURIComponent(username)}`);
  if (!res.ok) return false;
  const data = await res.json();
  return data.available === true;
}

/**
 * Register a new account with a BIP39-derived public key.
 *
 * @param {string} username
 * @param {string} displayName
 * @param {string} publicKeyBase64      - Base64-encoded Ed25519 public key.
 * @param {string} deviceId             - Stable per-device identifier (UUID).
 * @param {string} [inviteCode]         - Optional invite code.
 * @param {string} [baseUrl='']         - Optional base URL for cross-instance calls.
 * @param {string} [transparencySig]    - Base64-encoded Ed25519 signature over CBOR entry payload.
 * @param {number} [transparencyTs]     - Unix seconds timestamp used in CBOR entry payload.
 * @returns {Promise<{ token: string, user: object }>}
 */
export async function registerWithPublicKey(
  username,
  displayName,
  publicKeyBase64,
  deviceId,
  inviteCode,
  baseUrl = '',
  transparencySig = null,
  transparencyTs = null,
) {
  const body = { username, displayName, publicKey: publicKeyBase64, deviceId };
  if (inviteCode) body.inviteCode = inviteCode;
  if (transparencySig != null) {
    body.transparency_sig = transparencySig;
    body.transparency_ts = transparencyTs;
  }
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `registerWithPublicKey ${res.status}`);
  return data;
}

/**
 * List all registered device keys for the authenticated user.
 *
 * @param {string} token - JWT
 * @returns {Promise<Array<{ deviceId: string, publicKey: string, createdAt: string, lastSeenAt: string }>>}
 */
export async function listDeviceKeys(token, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/auth/devices', {}, baseUrl);
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
/**
 * Revoke a registered device key. The device can no longer authenticate.
 *
 * @param {string} token             - JWT
 * @param {string} deviceId          - Device ID to revoke.
 * @param {string} [baseUrl='']      - Optional base URL for cross-instance calls.
 * @param {string} [transparencySig] - Base64-encoded Ed25519 signature over CBOR entry payload.
 * @param {number} [transparencyTs]  - Unix seconds timestamp used in CBOR entry payload.
 * @returns {Promise<void>}
 */
export async function revokeDeviceKey(token, deviceId, baseUrl = '', transparencySig = null, transparencyTs = null) {
  const body = {};
  if (transparencySig != null) {
    body.transparency_sig = transparencySig;
    body.transparency_ts = transparencyTs;
  }
  const opts = {
    method: 'DELETE',
  };
  if (Object.keys(body).length > 0) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetchWithAuth(token, `/api/auth/devices/${encodeURIComponent(deviceId)}`, opts, baseUrl);
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
/**
 * Register a new device key certified by an existing authenticated device.
 * Used in the multi-device linking flow (Plan 06).
 *
 * @param {string} token                    - JWT of the certifying device.
 * @param {string} newDevicePublicKeyBase64  - Base64-encoded Ed25519 public key of the new device.
 * @param {string} certificate              - Base64-encoded signature: Sign(IK_existing_priv, IK_new_pub).
 * @param {string} deviceId                 - Device ID for the new device.
 * @param {string} signingDeviceId          - Device ID of the certifying (existing) device.
 * @param {string} [label]                  - Optional human-readable label for the new device.
 * @param {string} [baseUrl='']             - Optional base URL for cross-instance calls.
 * @param {string} [transparencySig]        - Base64-encoded Ed25519 signature over CBOR entry payload.
 * @param {number} [transparencyTs]         - Unix seconds timestamp used in CBOR entry payload.
 * @returns {Promise<void>}
 */
export async function certifyNewDevice(
  token,
  newDevicePublicKeyBase64,
  certificate,
  deviceId,
  signingDeviceId,
  label,
  baseUrl = '',
  transparencySig = null,
  transparencyTs = null,
) {
  const body = {
    devicePublicKey: newDevicePublicKeyBase64,
    certificate,
    deviceId,
    signingDeviceId,
    label,
  };
  if (transparencySig != null) {
    body.transparency_sig = transparencySig;
    body.transparency_ts = transparencyTs;
  }
  const res = await fetchWithAuth(token, '/api/auth/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, baseUrl);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `certifyNewDevice ${res.status}`);
  }
}

/**
 * Create a new device-link request from an unauthenticated device.
 *
 * @param {{ devicePublicKey: string, sessionPublicKey: string, deviceId: string, label?: string, instanceUrl?: string }} body
 * @param {string} [baseUrl='']
 * @returns {Promise<{ requestId: string, secret: string, code: string, expiresAt: string }>}
 */
export async function createDeviceLinkRequest(body, baseUrl = '') {
  const res = await fetch(`${baseUrl}/api/auth/link-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `createDeviceLinkRequest ${res.status}`);
  return data;
}

/**
 * Resolve a pending device-link request on an authenticated existing device.
 *
 * @param {string} token
 * @param {{ requestId?: string, secret?: string, code?: string }} body
 * @param {string} [baseUrl='']
 * @returns {Promise<{ claimToken: string, requestId: string, deviceId: string, devicePublicKey: string, sessionPublicKey: string, label?: string, instanceUrl?: string, expiresAt: string }>}
 */
export async function resolveDeviceLinkRequest(token, body, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/auth/link-resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, baseUrl);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `resolveDeviceLinkRequest ${res.status}`);
  return data;
}

/**
 * Verify a claimed device-link request and store the blind relay payload.
 *
 * @param {string} token
 * @param {{ claimToken: string, certificate: string, signingDeviceId: string, relayCiphertext: string, relayIv: string, relayPublicKey: string }} body
 * @param {string} [baseUrl='']
 * @returns {Promise<void>}
 */
export async function verifyDeviceLinkRequest(token, body, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/auth/link-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, baseUrl);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `verifyDeviceLinkRequest ${res.status}`);
}

/**
 * Consume the blind relay payload for a new device-link request.
 *
 * Returns `{ status: 'pending' }` while the existing device has not yet
 * approved the request.
 *
 * @param {{ requestId: string, secret: string }} body
 * @param {string} [baseUrl='']
 * @returns {Promise<{ status: 'pending' }|{ relayCiphertext: string, relayIv: string, relayPublicKey: string, deviceId: string, instanceUrl?: string }>}
 */
export async function consumeDeviceLinkResult(body, baseUrl = '') {
  const res = await fetch(`${baseUrl}/api/auth/link-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 202) {
    return { status: 'pending' };
  }
  if (!res.ok) throw new Error(data.error || `consumeDeviceLinkResult ${res.status}`);
  return data;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch server handshake data (no auth required).
 * Returns server version, API version, KeyPackage low threshold, and other instance metadata.
 * @returns {Promise<{ server_version: string, api_version: string, min_client_version: string, key_package_low_threshold: number }>}
 */
export async function getHandshake(baseUrl = '') {
  const res = await fetch(`${baseUrl}/api/handshake`);
  if (!res.ok) throw new Error(`handshake failed: ${res.status}`);
  return res.json();
}

// ── Guild API ─────────────────────────────────────────────────────────────────

/**
 * List all guilds the authenticated user belongs to.
 * @param {string} token - JWT
 * @returns {Promise<Array<{ id: string, name: string, ownerId: string, createdAt: string }>>}
 */
export async function getMyGuilds(token, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/servers', {}, baseUrl);
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
export async function createGuild(token, encryptedMetadata, templateId, baseUrl = '', name = '') {
  const body = {};
  if (encryptedMetadata != null) body.encryptedMetadata = encryptedMetadata;
  if (templateId) body.templateId = templateId;
  if (name) body.name = name;
  const res = await fetchWithAuth(token, '/api/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, baseUrl);
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
export async function updateGuildMetadata(token, serverId, encryptedMetadata, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encryptedMetadata }),
  }, baseUrl);
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
export async function leaveGuild(token, serverId, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}/leave`, {
    method: 'POST',
  }, baseUrl);
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
export async function deleteGuild(token, serverId, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}`, {
    method: 'DELETE',
  }, baseUrl);
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
export async function getGuildChannels(token, serverId, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}/channels`, {}, baseUrl);
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
export async function createGuildChannel(token, serverId, body, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, baseUrl);
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
export async function deleteGuildChannel(token, serverId, channelId, baseUrl = '') {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/channels/${encodeURIComponent(channelId)}`,
    { method: 'DELETE' },
    baseUrl,
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
export async function moveChannel(token, serverId, channelId, body, baseUrl = '') {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/channels/${encodeURIComponent(channelId)}/move`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    baseUrl,
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
export async function getGuildMembers(token, serverId, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}/members`, {}, baseUrl);
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
export async function createGuildInvite(token, serverId, opts = {}, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  }, baseUrl);
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
export async function getInviteInfo(code, baseUrl = '') {
  const res = await fetch(`${baseUrl}/api/invites/${encodeURIComponent(code)}`);
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
export async function claimInvite(token, code, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/invites/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  }, baseUrl);
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
export async function kickUser(token, serverId, userId, reason, baseUrl = '') {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/kick`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, reason }),
    },
    baseUrl,
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
export async function banUser(token, serverId, userId, reason, expiresIn, baseUrl = '') {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/ban`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, reason, expiresIn: expiresIn ?? null }),
    },
    baseUrl,
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
export async function muteUser(token, serverId, userId, reason, expiresIn, baseUrl = '') {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/mute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, reason, expiresIn: expiresIn ?? null }),
    },
    baseUrl,
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
export async function unbanUser(token, serverId, userId, reason, baseUrl = '') {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/unban`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, reason }),
    },
    baseUrl,
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
export async function unmuteUser(token, serverId, userId, reason, baseUrl = '') {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/unmute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, reason }),
    },
    baseUrl,
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
export async function listBans(token, serverId, baseUrl = '') {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/bans`,
    {},
    baseUrl,
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
export async function listMutes(token, serverId, baseUrl = '') {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/mutes`,
    {},
    baseUrl,
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
export async function changePermissionLevel(token, serverId, userId, permissionLevel, baseUrl = '') {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/level`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionLevel }),
    },
    baseUrl,
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
export async function changeUserRole(token, serverId, userId, newRole, baseUrl = '') {
  // Map legacy role strings to integer levels
  const levelMap = { member: 0, mod: 1, admin: 2, owner: 3 };
  const level = levelMap[newRole] ?? 0;
  return changePermissionLevel(token, serverId, userId, level, baseUrl);
}

/**
 * Delete a message within a guild (mod action or self-delete).
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID
 * @param {string} messageId - Message UUID
 * @returns {Promise<void>}
 */
export async function deleteMessage(token, serverId, messageId, baseUrl = '') {
  const res = await fetchWithAuth(
    token,
    `/api/servers/${encodeURIComponent(serverId)}/moderation/messages/${encodeURIComponent(messageId)}`,
    { method: 'DELETE' },
    baseUrl,
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
export async function getAuditLog(token, serverId, opts = {}, baseUrl = '') {
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
    {},
    baseUrl,
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
export async function getSystemMessages(token, serverId, opts = {}, baseUrl = '') {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  if (opts.limit != null) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const path = `/api/servers/${encodeURIComponent(serverId)}/system-messages${qs ? '?' + qs : ''}`;
  const res = await fetchWithAuth(token, path, {}, baseUrl);
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
export async function searchInstanceUsers(token, query, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/instance/users?q=${encodeURIComponent(query)}`, {}, baseUrl);
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
export async function instanceBanUser(token, userId, reason, expiresIn, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/instance/bans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, reason, expiresIn: expiresIn ?? null }),
  }, baseUrl);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Ban failed');
}

/**
 * Unban a user at the instance level (admin+).
 * @param {string} token - JWT
 * @param {string} userId - Target user UUID
 * @param {string} reason - Unban reason (required)
 * @returns {Promise<void>}
 */
export async function instanceUnbanUser(token, userId, reason, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/instance/unban', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, reason }),
  }, baseUrl);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Unban failed');
}

/**
 * Fetch instance-level audit log entries (owner only).
 * @param {string} token - JWT
 * @param {{ limit?: number, offset?: number, action?: string, targetId?: string }} [opts]
 * @returns {Promise<Array<{ id: string, actorId: string, targetId?: string, action: string, reason: string, metadata?: object, createdAt: string }>>}
 */
export async function getInstanceAuditLog(token, opts = {}, baseUrl = '') {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set('limit', String(opts.limit));
  if (opts.offset != null) params.set('offset', String(opts.offset));
  if (opts.action) params.set('action', opts.action);
  if (opts.targetId) params.set('target_id', opts.targetId);
  const qs = params.toString();
  const res = await fetchWithAuth(token, `/api/instance/audit-log${qs ? '?' + qs : ''}`, {}, baseUrl);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load audit log');
  return res.json();
}

/**
 * Update instance configuration (owner only).
 * @param {string} token - JWT
 * @param {{ registrationMode?: string, serverCreationPolicy?: string }} updates
 * @returns {Promise<void>}
 */
export async function updateInstanceConfig(token, updates, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/instance', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  }, baseUrl);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Config update failed');
}

// ── Server Templates ─────────────────────────────────────────────────────────

/**
 * List all server templates (owner only).
 * @param {string} token - JWT
 * @returns {Promise<Array<{ id: string, name: string, channels: Array, isDefault: boolean, position: number }>>}
 */
export async function listServerTemplates(token, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/instance/server-templates', {}, baseUrl);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load templates');
  return res.json();
}

/**
 * Create a new server template (owner only).
 * @param {string} token - JWT
 * @param {{ name: string, channels: Array, isDefault: boolean }} body
 * @returns {Promise<object>} Created template
 */
export async function createServerTemplate(token, body, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/instance/server-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, baseUrl);
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
export async function updateServerTemplate(token, id, body, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/instance/server-templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, baseUrl);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to update template');
}

/**
 * Delete a server template (owner only, cannot delete default).
 * @param {string} token - JWT
 * @param {string} id - Template UUID
 * @returns {Promise<void>}
 */
export async function deleteServerTemplate(token, id, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/instance/server-templates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }, baseUrl);
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
export async function uploadKeyPackagesAfterAuth(token, userId, deviceId, deps = {}, baseUrl = '') {
  await uploadKeyPackagesAfterAuthImpl(token, userId, deviceId, {
    mlsStore: deps.mlsStore ?? mlsStore,
    crypto: deps.crypto ?? hushCrypto,
    uploadCredential: deps.uploadCredential ?? ((t, b) => uploadMLSCredential(t, b, baseUrl)),
    uploadKeyPackages: deps.uploadKeyPackages ?? ((t, b) => uploadMLSKeyPackages(t, b, baseUrl)),
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
export async function getMLSGroupInfo(token, channelId, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/mls/groups/${encodeURIComponent(channelId)}/info`, {}, baseUrl);
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
export async function putMLSGroupInfo(token, channelId, groupInfoBase64, epoch, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/mls/groups/${encodeURIComponent(channelId)}/info`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupInfo: groupInfoBase64, epoch }),
  }, baseUrl);
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
export async function postMLSCommit(token, channelId, commitBytesBase64, groupInfoBase64, epoch, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/mls/groups/${encodeURIComponent(channelId)}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commitBytes: commitBytesBase64, groupInfo: groupInfoBase64, epoch }),
  }, baseUrl);
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
export async function getMLSVoiceGroupInfo(token, channelId, baseUrl = '') {
  const res = await fetchWithAuth(
    token,
    `/api/mls/groups/${encodeURIComponent(channelId)}/info?type=voice`,
    {},
    baseUrl,
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
export async function putMLSVoiceGroupInfo(token, channelId, groupInfoBase64, epoch, baseUrl = '') {
  const res = await fetchWithAuth(
    token,
    `/api/mls/groups/${encodeURIComponent(channelId)}/info?type=voice`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupInfo: groupInfoBase64, epoch }),
    },
    baseUrl,
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
export async function postMLSVoiceCommit(token, channelId, commitBytesBase64, epoch, groupInfoBase64, baseUrl = '') {
  const res = await fetchWithAuth(
    token,
    `/api/mls/groups/${encodeURIComponent(channelId)}/commit?type=voice`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitBytes: commitBytesBase64, groupInfo: groupInfoBase64 ?? '', epoch }),
    },
    baseUrl,
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
export async function getMLSCommitsSinceEpoch(token, channelId, sinceEpoch, limit = 100, baseUrl = '') {
  const params = new URLSearchParams({
    since_epoch: String(sinceEpoch),
    limit: String(limit),
  });
  const res = await fetchWithAuth(
    token,
    `/api/mls/groups/${encodeURIComponent(channelId)}/commits?${params.toString()}`,
    {},
    baseUrl,
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
export async function getMLSPendingWelcomes(token, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/mls/pending-welcomes', {}, baseUrl);
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
export async function deleteMLSPendingWelcome(token, welcomeId, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/mls/pending-welcomes/${encodeURIComponent(welcomeId)}`, {
    method: 'DELETE',
  }, baseUrl);
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
export async function getGuildMetadataGroupInfo(token, guildId, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/mls/guilds/${encodeURIComponent(guildId)}/group-info`, {}, baseUrl);
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
export async function putGuildMetadataGroupInfo(token, guildId, groupInfoBase64, epoch, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/mls/guilds/${encodeURIComponent(guildId)}/group-info`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupInfo: groupInfoBase64, epoch }),
  }, baseUrl);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `putGuildMetadataGroupInfo ${res.status}`);
  }
}

// ── DM and Guild Discovery API ────────────────────────────────────────────────

/**
 * Create or retrieve an existing DM guild between the current user and another user.
 * Idempotent: returns 201 on creation, 200 when the DM already exists.
 *
 * @param {string} token - JWT
 * @param {string} otherUserId - UUID of the other user
 * @param {string} [baseUrl] - Optional base URL for cross-instance calls
 * @returns {Promise<{ id: string, isDm: boolean, otherUser: { id: string, username: string, displayName: string }, channelId: string }>}
 */
export async function createOrFindDM(token, otherUserId, baseUrl = '') {
  const res = await fetchWithAuth(token, '/api/guilds/dm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ otherUserId }),
  }, baseUrl);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `createOrFindDM ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch a paginated list of discoverable guilds.
 *
 * @param {string} token - JWT
 * @param {{ category?: string, search?: string, sort?: string, page?: number, pageSize?: number }} [params]
 * @param {string} [baseUrl] - Optional base URL for cross-instance calls
 * @returns {Promise<{ guilds: Array<object>, total: number, page: number, pageSize: number }>}
 */
export async function discoverGuilds(token, params = {}, baseUrl = '') {
  const qs = new URLSearchParams();
  if (params.category) qs.set('category', params.category);
  if (params.search) qs.set('search', params.search);
  if (params.sort) qs.set('sort', params.sort);
  if (params.page != null) qs.set('page', String(params.page));
  if (params.pageSize != null) qs.set('pageSize', String(params.pageSize));
  const query = qs.toString();
  const res = await fetchWithAuth(token, `/api/guilds/discover${query ? `?${query}` : ''}`, {}, baseUrl);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `discoverGuilds ${res.status}`);
  }
  return res.json();
}

/**
 * Search for users by username fragment for the DM recipient picker.
 *
 * @param {string} token - JWT
 * @param {string} query - Username search term
 * @param {string} [baseUrl] - Optional base URL for cross-instance calls
 * @returns {Promise<Array<{ id: string, username: string, displayName: string }>>}
 */
export async function searchUsersForDM(token, query, baseUrl = '') {
  const res = await fetchWithAuth(
    token,
    `/api/guilds/users/search?q=${encodeURIComponent(query)}`,
    {},
    baseUrl,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `searchUsersForDM ${res.status}`);
  }
  return res.json();
}

/**
 * Join an open guild from the explore page.
 * Returns 201 on success, 409 when already a member, 202 for request-policy guilds.
 *
 * @param {string} token - JWT
 * @param {string} serverId - Guild UUID to join
 * @param {string} [baseUrl] - Optional base URL for cross-instance calls
 * @returns {Promise<{ status: number, data: object }>}
 */
export async function joinGuildFromExplore(token, serverId, baseUrl = '') {
  const res = await fetchWithAuth(token, `/api/servers/${encodeURIComponent(serverId)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, baseUrl);
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409 && res.status !== 202) {
    throw new Error(data.error || `joinGuildFromExplore ${res.status}`);
  }
  return { status: res.status, data };
}
