import { encodeGuildNameForInvite } from './guildMetadata';

/**
 * Parses a pasted invite link into instance host and invite code.
 * Supports formats:
 *   - Full cross-instance: https://any.origin/join/{instanceHost}/{code}
 *   - Full same-instance:  https://instance.host/invite/{code}
 *   - Bare invite code:    AbC12345 (6-12 alphanumeric chars)
 *
 * @param {string} input - User-pasted invite link or code
 * @returns {{ instanceHost: string|null, code: string } | null}
 */
export function parseInviteLink(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split('/').filter(Boolean);

    if (segments[0] === 'join' && segments.length >= 3) {
      return { instanceHost: segments[1], code: segments[2] };
    }

    if (segments[0] === 'invite' && segments.length >= 2) {
      return { instanceHost: url.host, code: segments[1] };
    }

    return null;
  } catch {
    if (/^[A-Za-z0-9]{6,12}$/.test(trimmed)) {
      return { instanceHost: null, code: trimmed };
    }
    return null;
  }
}

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
