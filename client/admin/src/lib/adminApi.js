/**
 * Admin API client for Hush instance administration.
 *
 * All functions take apiKey as first argument and send it as the
 * X-Admin-Key header. No JWT or user auth is involved.
 *
 * All endpoints are at /api/admin/* and require the header.
 */

const BASE = '/api/admin';

/**
 * Builds standard request headers including X-Admin-Key.
 * @param {string} apiKey
 * @returns {Record<string, string>}
 */
function headers(apiKey) {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Key': apiKey,
  };
}

/**
 * Throws an Error with the response body text when status is not ok.
 * @param {Response} res
 * @returns {Promise<Response>}
 */
async function checkResponse(res) {
  if (!res.ok) {
    let message;
    try {
      const body = await res.json();
      message = body?.error || `HTTP ${res.status}`;
    } catch {
      message = `HTTP ${res.status}`;
    }
    throw new Error(message);
  }
  return res;
}

/**
 * GET /api/admin/guilds
 * Returns guild infrastructure metrics. No guild names.
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
export async function listGuilds(apiKey) {
  const res = await fetch(`${BASE}/guilds`, { headers: headers(apiKey) });
  await checkResponse(res);
  return res.json();
}

/**
 * GET /api/admin/users
 * Returns user UUIDs, roles, creation dates, and ban status.
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
export async function listUsers(apiKey) {
  const res = await fetch(`${BASE}/users`, { headers: headers(apiKey) });
  await checkResponse(res);
  return res.json();
}

/**
 * GET /api/admin/health
 * Returns DB status, uptime, and version.
 * @param {string} apiKey
 * @returns {Promise<object>}
 */
export async function getHealth(apiKey) {
  const res = await fetch(`${BASE}/health`, { headers: headers(apiKey) });
  await checkResponse(res);
  return res.json();
}

/**
 * GET /api/admin/config
 * Returns current instance configuration.
 * @param {string} apiKey
 * @returns {Promise<object>}
 */
export async function getConfig(apiKey) {
  const res = await fetch(`${BASE}/config`, { headers: headers(apiKey) });
  await checkResponse(res);
  return res.json();
}

/**
 * PUT /api/admin/config
 * Updates instance configuration fields.
 * @param {string} apiKey
 * @param {object} updates - Partial config fields to update.
 * @returns {Promise<object>}
 */
export async function updateConfig(apiKey, updates) {
  const res = await fetch(`${BASE}/config`, {
    method: 'PUT',
    headers: headers(apiKey),
    body: JSON.stringify(updates),
  });
  await checkResponse(res);
  if (res.status === 204) return {};
  return res.json();
}

/**
 * GET /api/admin/templates
 * Returns all server templates.
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
export async function listTemplates(apiKey) {
  const res = await fetch(`${BASE}/templates`, { headers: headers(apiKey) });
  await checkResponse(res);
  return res.json();
}

/**
 * POST /api/admin/templates
 * Creates a new server template.
 * @param {string} apiKey
 * @param {{ name: string, channels: Array, isDefault: boolean }} data
 * @returns {Promise<object>}
 */
export async function createTemplate(apiKey, data) {
  const res = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify(data),
  });
  await checkResponse(res);
  return res.json();
}

/**
 * PUT /api/admin/templates/{id}
 * Updates an existing server template.
 * @param {string} apiKey
 * @param {string} id
 * @param {{ name: string, channels: Array, isDefault: boolean }} data
 * @returns {Promise<object>}
 */
export async function updateTemplate(apiKey, id, data) {
  const res = await fetch(`${BASE}/templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: headers(apiKey),
    body: JSON.stringify(data),
  });
  await checkResponse(res);
  return res.json();
}

/**
 * DELETE /api/admin/templates/{id}
 * Deletes a server template.
 * @param {string} apiKey
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteTemplate(apiKey, id) {
  const res = await fetch(`${BASE}/templates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: headers(apiKey),
  });
  await checkResponse(res);
}

/**
 * POST /api/admin/bans
 * Instance-bans a user, removing them from all guilds.
 * @param {string} apiKey
 * @param {string} userId
 * @param {string} reason
 * @param {number|null} expiresAt - Unix timestamp in seconds, or null for permanent.
 * @returns {Promise<void>}
 */
export async function instanceBan(apiKey, userId, reason, expiresAt) {
  const body = { userId, reason };
  if (expiresAt !== null && expiresAt !== undefined) {
    body.expiresAt = new Date(expiresAt * 1000).toISOString();
  }
  const res = await fetch(`${BASE}/bans`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify(body),
  });
  await checkResponse(res);
}

/**
 * DELETE /api/admin/bans/{userId}
 * Lifts an instance ban.
 * @param {string} apiKey
 * @param {string} userId
 * @param {string} reason
 * @returns {Promise<void>}
 */
export async function instanceUnban(apiKey, userId, reason) {
  const res = await fetch(`${BASE}/bans/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: headers(apiKey),
    body: JSON.stringify({ reason }),
  });
  await checkResponse(res);
}

/**
 * GET /api/admin/audit-log
 * Returns paginated audit log entries.
 * @param {string} apiKey
 * @param {{ limit?: number, offset?: number, action?: string, targetId?: string }} opts
 * @returns {Promise<Array>}
 */
export async function getAuditLog(apiKey, opts = {}) {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));
  if (opts.action) params.set('action', opts.action);
  if (opts.targetId) params.set('target_id', opts.targetId);
  const url = `${BASE}/audit-log${params.size ? `?${params}` : ''}`;
  const res = await fetch(url, { headers: headers(apiKey) });
  await checkResponse(res);
  return res.json();
}
