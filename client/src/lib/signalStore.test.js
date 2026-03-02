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
import { deriveMessageStoreKey } from '../hooks/useSignal';

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

  it('openStore returns an IDBDatabase', async () => {
    const db = await openStore('u', 'd');
    expect(typeof db.transaction).toBe('function');
    db.close();
  });

  describe('identity', () => {
    it('getIdentity returns null on empty store', async () => {
      const db = await openStore('id-test', 'dev');
      const result = await getIdentity(db);
      expect(result).toBeNull();
      db.close();
    });

    it('setIdentity then getIdentity round-trips', async () => {
      const db = await openStore('id-test-2', 'dev');
      const identity = {
        publicKey: new Uint8Array([1, 2, 3]),
        privateKey: new Uint8Array([4, 5, 6]),
      };
      await setIdentity(db, identity);
      const got = await getIdentity(db);
      expect(got).not.toBeNull();
      expect(Array.from(got.publicKey)).toEqual([1, 2, 3]);
      expect(Array.from(got.privateKey)).toEqual([4, 5, 6]);
      db.close();
    });
  });

  describe('registrationId', () => {
    it('round-trips a registration ID', async () => {
      const db = await openStore('reg-test', 'dev');
      await setRegistrationId(db, 42);
      const got = await getRegistrationId(db);
      expect(got).toBe(42);
      db.close();
    });
  });

  describe('message cache (B.5)', () => {
    it('getCachedMessage on empty store returns null', async () => {
      const db = await openStore('msg-user', 'msg-dev');
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

    it('getCachedMessage with wrong key returns null', async () => {
      const db = await openStore('msg-user-3', 'msg-dev');
      const key1 = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      const key2 = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      const payload = { content: 'secret', senderId: 'user-b', timestamp: 9999 };
      await setCachedMessage(db, 'msg-3', payload, key1);
      const got = await getCachedMessage(db, 'msg-3', key2);
      expect(got).toBeNull();
      db.close();
    });
  });
});

describe('deriveMessageStoreKey', () => {
  it('produces deterministic output for same input', async () => {
    const privateKey = crypto.getRandomValues(new Uint8Array(32));
    const key1 = await deriveMessageStoreKey(privateKey);
    const key2 = await deriveMessageStoreKey(privateKey);
    // Verify determinism: encrypt with key1, decrypt with key2
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode('determinism check');
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key1,
      plaintext
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key2,
      ciphertext
    );
    expect(new TextDecoder().decode(decrypted)).toBe('determinism check');
  });

  it('round-trips encrypt/decrypt with derived key', async () => {
    const privateKey = crypto.getRandomValues(new Uint8Array(32));
    const key = await deriveMessageStoreKey(privateKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode('test message');
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key,
      plaintext
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key,
      ciphertext
    );
    expect(new TextDecoder().decode(decrypted)).toBe('test message');
  });
});
