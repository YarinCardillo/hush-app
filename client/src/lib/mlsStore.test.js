/**
 * Tests for mlsStore.js (MLS IndexedDB store).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  openStore,
  getCredential,
  setCredential,
  getKeyPackage,
  setKeyPackage,
  deleteKeyPackage,
  getLastResort,
  setLastResort,
  listAllKeyPackages,
} from './mlsStore';

// Each test group uses a unique user+device pair to isolate DB instances.
let storeCounter = 0;
function nextDb() {
  storeCounter++;
  return openStore(`user-${storeCounter}`, `dev-${storeCounter}`);
}

describe('mlsStore', () => {
  it('exports all required functions', () => {
    expect(typeof openStore).toBe('function');
    expect(typeof getCredential).toBe('function');
    expect(typeof setCredential).toBe('function');
    expect(typeof getKeyPackage).toBe('function');
    expect(typeof setKeyPackage).toBe('function');
    expect(typeof deleteKeyPackage).toBe('function');
    expect(typeof getLastResort).toBe('function');
    expect(typeof setLastResort).toBe('function');
    expect(typeof listAllKeyPackages).toBe('function');
  });

  it('openStore returns an IDBDatabase', async () => {
    const db = await nextDb();
    expect(typeof db.transaction).toBe('function');
    db.close();
  });

  describe('credential', () => {
    it('getCredential returns null on empty store', async () => {
      const db = await nextDb();
      const result = await getCredential(db);
      expect(result).toBeNull();
      db.close();
    });

    it('setCredential then getCredential round-trips signing keys and credential bytes', async () => {
      const db = await nextDb();
      const signingPublicKey = new Uint8Array([1, 2, 3, 4]);
      const signingPrivateKey = new Uint8Array([5, 6, 7, 8]);
      const credentialBytes = new Uint8Array([9, 10, 11, 12]);

      await setCredential(db, { signingPublicKey, signingPrivateKey, credentialBytes });
      const retrieved = await getCredential(db);

      expect(retrieved).not.toBeNull();
      expect(retrieved.signingPublicKey).toBeInstanceOf(Uint8Array);
      expect(retrieved.signingPrivateKey).toBeInstanceOf(Uint8Array);
      expect(retrieved.credentialBytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(retrieved.signingPublicKey)).toEqual([1, 2, 3, 4]);
      expect(Array.from(retrieved.signingPrivateKey)).toEqual([5, 6, 7, 8]);
      expect(Array.from(retrieved.credentialBytes)).toEqual([9, 10, 11, 12]);

      db.close();
    });

    it('overwriting credential replaces the previous value', async () => {
      const db = await nextDb();
      await setCredential(db, {
        signingPublicKey: new Uint8Array([1]),
        signingPrivateKey: new Uint8Array([2]),
        credentialBytes: new Uint8Array([3]),
      });
      await setCredential(db, {
        signingPublicKey: new Uint8Array([10]),
        signingPrivateKey: new Uint8Array([20]),
        credentialBytes: new Uint8Array([30]),
      });
      const retrieved = await getCredential(db);
      expect(Array.from(retrieved.signingPublicKey)).toEqual([10]);
      db.close();
    });
  });

  describe('keyPackages', () => {
    it('getKeyPackage returns null when key does not exist', async () => {
      const db = await nextDb();
      const result = await getKeyPackage(db, 'nonexistent-hash');
      expect(result).toBeNull();
      db.close();
    });

    it('setKeyPackage then getKeyPackage round-trips by hashRefHex key', async () => {
      const db = await nextDb();
      const hashRefHex = 'aabbccdd1122334455';
      const keyPackageBytes = new Uint8Array([1, 2, 3]);
      const privateKeyBytes = new Uint8Array([4, 5, 6]);
      const createdAt = Date.now();

      await setKeyPackage(db, hashRefHex, { keyPackageBytes, privateKeyBytes, createdAt });
      const retrieved = await getKeyPackage(db, hashRefHex);

      expect(retrieved).not.toBeNull();
      expect(Array.from(retrieved.keyPackageBytes)).toEqual([1, 2, 3]);
      expect(Array.from(retrieved.privateKeyBytes)).toEqual([4, 5, 6]);
      expect(retrieved.createdAt).toBe(createdAt);

      db.close();
    });

    it('deleteKeyPackage removes the entry', async () => {
      const db = await nextDb();
      const hashRefHex = 'deadbeef';

      await setKeyPackage(db, hashRefHex, {
        keyPackageBytes: new Uint8Array([1]),
        privateKeyBytes: new Uint8Array([2]),
        createdAt: 0,
      });

      await deleteKeyPackage(db, hashRefHex);
      const result = await getKeyPackage(db, hashRefHex);
      expect(result).toBeNull();

      db.close();
    });

    it('deleteKeyPackage on non-existent key is a no-op', async () => {
      const db = await nextDb();
      await expect(deleteKeyPackage(db, 'does-not-exist')).resolves.toBeUndefined();
      db.close();
    });

    it('multiple KeyPackages coexist independently', async () => {
      const db = await nextDb();

      await setKeyPackage(db, 'hash-a', {
        keyPackageBytes: new Uint8Array([0xa]),
        privateKeyBytes: new Uint8Array([0x1a]),
        createdAt: 1000,
      });
      await setKeyPackage(db, 'hash-b', {
        keyPackageBytes: new Uint8Array([0xb]),
        privateKeyBytes: new Uint8Array([0x1b]),
        createdAt: 2000,
      });

      const a = await getKeyPackage(db, 'hash-a');
      const b = await getKeyPackage(db, 'hash-b');

      expect(Array.from(a.keyPackageBytes)).toEqual([0xa]);
      expect(Array.from(b.keyPackageBytes)).toEqual([0xb]);

      db.close();
    });
  });

  describe('lastResort', () => {
    it('getLastResort returns null on empty store', async () => {
      const db = await nextDb();
      const result = await getLastResort(db);
      expect(result).toBeNull();
      db.close();
    });

    it('setLastResort then getLastResort round-trips', async () => {
      const db = await nextDb();
      const keyPackageBytes = new Uint8Array([0xff, 0xfe]);
      const privateKeyBytes = new Uint8Array([0x01, 0x02]);
      const hashRefHex = 'cafebabe';

      await setLastResort(db, { keyPackageBytes, privateKeyBytes, hashRefHex });
      const retrieved = await getLastResort(db);

      expect(retrieved).not.toBeNull();
      expect(Array.from(retrieved.keyPackageBytes)).toEqual([0xff, 0xfe]);
      expect(Array.from(retrieved.privateKeyBytes)).toEqual([0x01, 0x02]);
      expect(retrieved.hashRefHex).toBe('cafebabe');

      db.close();
    });
  });

  describe('listAllKeyPackages', () => {
    it('returns empty array when no KeyPackages exist', async () => {
      const db = await nextDb();
      const result = await listAllKeyPackages(db);
      expect(result).toEqual([]);
      db.close();
    });

    it('returns all stored KeyPackages', async () => {
      const db = await nextDb();

      await setKeyPackage(db, 'hash-1', {
        keyPackageBytes: new Uint8Array([1]),
        privateKeyBytes: new Uint8Array([10]),
        createdAt: 0,
      });
      await setKeyPackage(db, 'hash-2', {
        keyPackageBytes: new Uint8Array([2]),
        privateKeyBytes: new Uint8Array([20]),
        createdAt: 0,
      });

      const all = await listAllKeyPackages(db);
      expect(all).toHaveLength(2);

      db.close();
    });
  });
});
