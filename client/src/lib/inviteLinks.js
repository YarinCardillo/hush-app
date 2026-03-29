import { encodeGuildNameForInvite } from './guildMetadata';

/**
 * Returns the host portion of an instance URL, or null when it cannot be parsed.
 *
 * @param {string|null|undefined} instanceUrl
 * @returns {string|null}
 */
export function getInviteInstanceHost(instanceUrl) {
  if (!instanceUrl) return null;
  try {
    return new URL(instanceUrl).host;
  } catch {
    return null;
  }
}

/**
 * Builds a user-facing invite URL for the web app.
 *
 * New links always prefer the instance-aware /join/:instance/:code route so
 * the client knows which backend instance owns the invite before login.
 *
 * @param {string} appOrigin
 * @param {string|null|undefined} instanceUrl
 * @param {string} code
 * @param {string|null|undefined} guildName
 * @returns {string}
 */
export function buildGuildInviteLink(appOrigin, instanceUrl, code, guildName) {
  const url = new URL(appOrigin);
  const instanceHost = getInviteInstanceHost(instanceUrl);

  if (instanceHost) {
    url.pathname = `/join/${instanceHost}/${encodeURIComponent(code)}`;
  } else {
    url.pathname = `/invite/${encodeURIComponent(code)}`;
  }

  url.search = '';
  url.hash = guildName ? `name=${encodeGuildNameForInvite(guildName)}` : '';
  return url.toString();
}
