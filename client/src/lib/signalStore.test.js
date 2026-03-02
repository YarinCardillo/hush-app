import { describe, it, expect } from 'vitest';
import {
  openStore,
  getIdentity,
  setIdentity,
  getRegistrationId,
  setRegistrationId,
  getSession,
  setSession,
  getPreKeys,
  setPreKeys,
  getSignedPreKey,
  setSignedPreKey,
  getOneTimePreKey,
  setOneTimePreKey,
  deleteOneTimePreKey,
  getCachedMessage,
  setCachedMessage,
} from './signalStore';

describe('signalStore', () => {
  it('exports all store functions', () => {
    expect(typeof openStore).toBe('function');
    expect(typeof getIdentity).toBe('function');
    expect(typeof setIdentity).toBe('function');
    expect(typeof getRegistrationId).toBe('function');
    expect(typeof setRegistrationId).toBe('function');
    expect(typeof getSession).toBe('function');
    expect(typeof setSession).toBe('function');
    expect(typeof getPreKeys).toBe('function');
    expect(typeof setPreKeys).toBe('function');
    expect(typeof getSignedPreKey).toBe('function');
    expect(typeof setSignedPreKey).toBe('function');
    expect(typeof getOneTimePreKey).toBe('function');
    expect(typeof setOneTimePreKey).toBe('function');
    expect(typeof deleteOneTimePreKey).toBe('function');
    expect(typeof getCachedMessage).toBe('function');
    expect(typeof setCachedMessage).toBe('function');
  });

  it('openStore returns a promise', () => {
    const p = openStore('u', 'd');
    expect(p).toBeInstanceOf(Promise);
  });

  describe('message cache (B.5)', () => {
    it('getCachedMessage on empty store returns null', async () => {
      const db = await openStore('msg-user', 'msg-dev');
      if (typeof db.transaction !== 'function') {
        db.close?.();
        return; // Skip when IndexedDB is a minimal mock (no object stores)
      }
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      const result = await getCachedMessage(db, 'msg-1', key);
      expect(result).toBeNull();
      db.close();
    });

    it('setCachedMessage then getCachedMessage returns same payload', async () => {
      const db = await openStore('msg-user-2', 'msg-dev');
      if (typeof db.transaction !== 'function') {
        db.close?.();
        return;
      }
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      const payload = { content: 'hello', senderId: 'user-a', timestamp: 1234567890 };
      await setCachedMessage(db, 'msg-2', payload, key);
      const got = await getCachedMessage(db, 'msg-2', key);
      expect(got).toEqual(payload);
      db.close();
    });
  });
});
