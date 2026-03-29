import { describe, it, expect } from 'vitest';
import { parseInviteLink } from './inviteLinks.js';

describe('parseInviteLink', () => {
  it('parses cross-instance invite: /join/{host}/{code}', () => {
    const result = parseInviteLink('https://app.gethush.live/join/89.167.121.15/AbC12345');
    expect(result).toEqual({ instanceHost: '89.167.121.15', code: 'AbC12345' });
  });

  it('parses cross-instance invite with port', () => {
    const result = parseInviteLink('https://myapp.com/join/chat.example.com:8443/XyZ98765');
    expect(result).toEqual({ instanceHost: 'chat.example.com:8443', code: 'XyZ98765' });
  });

  it('parses same-instance invite: /invite/{code}', () => {
    const result = parseInviteLink('https://chat.example.com/invite/AbC12345');
    expect(result).toEqual({ instanceHost: 'chat.example.com', code: 'AbC12345' });
  });

  it('strips URL fragment (guild name)', () => {
    const result = parseInviteLink('https://app.com/join/89.167.121.15/AbC12345#name=My%20Server');
    expect(result).toEqual({ instanceHost: '89.167.121.15', code: 'AbC12345' });
  });

  it('handles bare code (no URL)', () => {
    const result = parseInviteLink('AbC12345');
    expect(result).toEqual({ instanceHost: null, code: 'AbC12345' });
  });

  it('returns null for invalid input', () => {
    expect(parseInviteLink('')).toBeNull();
    expect(parseInviteLink('https://example.com/servers/some-id')).toBeNull();
    expect(parseInviteLink('not a link at all with spaces')).toBeNull();
  });

  it('handles IP-based instance URLs', () => {
    const result = parseInviteLink('https://10.0.0.1/join/89.167.121.15/AbC12345');
    expect(result).toEqual({ instanceHost: '89.167.121.15', code: 'AbC12345' });
  });
});
