import { describe, it, expect, beforeEach } from 'vitest';
import {
  getStoredCredentials,
  setStoredCredentials,
  clearStoredCredentials,
  GUEST_SESSION_KEY,
} from './authStorage';

describe('authStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('getStoredCredentials returns null when empty', () => {
    expect(getStoredCredentials()).toBeNull();
  });

  it('setStoredCredentials and getStoredCredentials round-trip', () => {
    const creds = {
      userId: 'u1',
      deviceId: 'd1',
      accessToken: 'token',
      baseUrl: 'https://example.com',
    };
    setStoredCredentials(creds);
    expect(getStoredCredentials()).toEqual(creds);
  });

  it('clearStoredCredentials removes stored credentials', () => {
    setStoredCredentials({
      userId: 'u1',
      deviceId: 'd1',
      accessToken: 't',
      baseUrl: 'https://x.com',
    });
    clearStoredCredentials();
    expect(getStoredCredentials()).toBeNull();
  });

  it('GUEST_SESSION_KEY is defined', () => {
    expect(GUEST_SESSION_KEY).toBe('hush_guest_session');
  });
});
