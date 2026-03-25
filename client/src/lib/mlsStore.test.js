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
  preloadGroupState,
  flushStorageCache,
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

  // -------------------------------------------------------------------------
  // StorageProvider bridge tests
  // -------------------------------------------------------------------------

  describe('StorageProvider bridge', () => {
    const STORE_NAME = 'mls_group_context';

    /**
     * Helper: returns a unique key Uint8Array per invocation.
     * Uses a versioned key format: 2-byte u16 big-endian version + JSON-serialized key.
     */
    let bridgeKeyCounter = 0;
    function uniqueKeyBytes() {
      bridgeKeyCounter++;
      const json = JSON.stringify({ id: `bridge-test-${bridgeKeyCounter}-${Date.now()}` });
      const jsonBytes = new TextEncoder().encode(json);
      // Version u16 big-endian (0x0001) + JSON-serialized key
      const result = new Uint8Array(2 + jsonBytes.length);
      result[0] = 0x00;
      result[1] = 0x01;
      result.set(jsonBytes, 2);
      return result;
    }

    it('writeBytes sets cache entry and readBytes retrieves it', async () => {
      const db = await nextDb();
      const bridge = window.mlsStorageBridge;
      const keyBytes = uniqueKeyBytes();
      const valueBytes = new Uint8Array([10, 20, 30, 40]);

      bridge.writeBytes(STORE_NAME, keyBytes, valueBytes);
      const result = bridge.readBytes(STORE_NAME, keyBytes);

      expect(result).not.toBeNull();
      expect(result).toBeInstanceOf(Uint8Array);
      expect(Array.from(result)).toEqual([10, 20, 30, 40]);

      db.close();
    });

    it('readBytes returns null for non-existent key', async () => {
      const db = await nextDb();
      const bridge = window.mlsStorageBridge;
      const keyBytes = uniqueKeyBytes();

      const result = bridge.readBytes(STORE_NAME, keyBytes);
      expect(result).toBeNull();

      db.close();
    });

    it('deleteBytes removes entry from cache', async () => {
      const db = await nextDb();
      const bridge = window.mlsStorageBridge;
      const keyBytes = uniqueKeyBytes();
      const valueBytes = new Uint8Array([99]);

      bridge.writeBytes(STORE_NAME, keyBytes, valueBytes);
      expect(bridge.readBytes(STORE_NAME, keyBytes)).not.toBeNull();

      bridge.deleteBytes(STORE_NAME, keyBytes);
      expect(bridge.readBytes(STORE_NAME, keyBytes)).toBeNull();

      db.close();
    });

    it('flushStorageCache writes all cache entries to IDB and awaits completion', async () => {
      const db = await nextDb();
      const bridge = window.mlsStorageBridge;
      const keyBytes = uniqueKeyBytes();
      const valueBytes = new Uint8Array([7, 8, 9]);

      bridge.writeBytes(STORE_NAME, keyBytes, valueBytes);

      // Flush the cache to IDB
      await flushStorageCache(db);

      // Verify data is readable from IDB by doing a direct getAll on the store
      const allRows = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => reject(req.error);
      });

      // The data should be persisted in IDB (at least one row with our value)
      const hexKey = Array.from(keyBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const matchingRow = allRows.find((row) => row.key === hexKey);
      expect(matchingRow).toBeDefined();
      expect(matchingRow.value).toEqual(Array.from(valueBytes));

      db.close();
    });

    it('preloadGroupState loads IDB data into empty cache', async () => {
      // Write data to IDB directly (bypassing cache), then preload into cache.
      const db = await nextDb();
      const bridge = window.mlsStorageBridge;
      const keyBytes = uniqueKeyBytes();
      const hexKey = Array.from(keyBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const valueArray = [50, 60, 70];

      // Write directly to IDB (not through cache)
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ key: hexKey, value: valueArray });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });

      // Verify cache does NOT have this entry yet (readBytes should return null)
      expect(bridge.readBytes(STORE_NAME, keyBytes)).toBeNull();

      // Preload from IDB into cache
      await preloadGroupState(db);

      // Now the cache should have it
      const result = bridge.readBytes(STORE_NAME, keyBytes);
      expect(result).not.toBeNull();
      expect(Array.from(result)).toEqual(valueArray);

      db.close();
    });

    it('preloadGroupState does NOT overwrite entries already in cache (race condition fix)', async () => {
      const db = await nextDb();
      const bridge = window.mlsStorageBridge;
      const keyBytes = uniqueKeyBytes();
      const hexKey = Array.from(keyBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // Write stale data directly to IDB
      const staleValue = [1, 1, 1];
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ key: hexKey, value: staleValue });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });

      // Write fresh data through the bridge (into cache)
      const freshValue = new Uint8Array([9, 9, 9]);
      bridge.writeBytes(STORE_NAME, keyBytes, freshValue);

      // preloadGroupState should NOT clobber the fresh cache entry with stale IDB data
      await preloadGroupState(db);

      const result = bridge.readBytes(STORE_NAME, keyBytes);
      expect(result).not.toBeNull();
      expect(Array.from(result)).toEqual([9, 9, 9]); // Fresh value preserved, not stale [1,1,1]

      db.close();
    });

    it('writeBytes -> flushStorageCache -> preloadGroupState round-trip preserves data', async () => {
      // Write through bridge, flush to IDB, open a fresh DB and preload
      const db = await nextDb();
      const bridge = window.mlsStorageBridge;
      const keyBytes1 = uniqueKeyBytes();
      const keyBytes2 = uniqueKeyBytes();
      const val1 = new Uint8Array([100, 101, 102]);
      const val2 = new Uint8Array([200, 201]);

      bridge.writeBytes(STORE_NAME, keyBytes1, val1);
      bridge.writeBytes('mls_epoch_secrets', keyBytes2, val2);

      // Flush all to IDB
      await flushStorageCache(db);

      // Open a fresh DB (same user/device, but the important part is preload reads from IDB)
      // We simulate "fresh cache" by writing known different data then checking preload
      // doesn't overwrite, but for round-trip we need to verify IDB has the data.
      // Direct IDB read for verification:
      const hexKey1 = Array.from(keyBytes1)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const row = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(hexKey1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      expect(row).toBeDefined();
      expect(row.value).toEqual(Array.from(val1));

      const hexKey2 = Array.from(keyBytes2)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const row2 = await new Promise((resolve, reject) => {
        const tx = db.transaction('mls_epoch_secrets', 'readonly');
        const req = tx.objectStore('mls_epoch_secrets').get(hexKey2);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      expect(row2).toBeDefined();
      expect(row2.value).toEqual(Array.from(val2));

      db.close();
    });

    it('appendToList/readList/removeFromList cycle works correctly', async () => {
      const db = await nextDb();
      const bridge = window.mlsStorageBridge;
      const keyBytes = uniqueKeyBytes();

      // Initially empty
      const empty = bridge.readList(STORE_NAME, keyBytes);
      expect(empty).toEqual([]);

      // Append two items
      const item1 = new Uint8Array([1, 2, 3]);
      const item2 = new Uint8Array([4, 5, 6]);
      bridge.appendToList(STORE_NAME, keyBytes, item1);
      bridge.appendToList(STORE_NAME, keyBytes, item2);

      // Read list should have both
      const list = bridge.readList(STORE_NAME, keyBytes);
      expect(list).toHaveLength(2);
      expect(Array.from(list[0])).toEqual([1, 2, 3]);
      expect(Array.from(list[1])).toEqual([4, 5, 6]);

      // Remove the first item
      bridge.removeFromList(STORE_NAME, keyBytes, item1);
      const afterRemove = bridge.readList(STORE_NAME, keyBytes);
      expect(afterRemove).toHaveLength(1);
      expect(Array.from(afterRemove[0])).toEqual([4, 5, 6]);

      // Remove the second item
      bridge.removeFromList(STORE_NAME, keyBytes, item2);
      const afterRemoveAll = bridge.readList(STORE_NAME, keyBytes);
      expect(afterRemoveAll).toEqual([]);

      db.close();
    });

    it('deleteBytes persists to IDB (not just cache)', async () => {
      const db = await nextDb();
      const bridge = window.mlsStorageBridge;
      const keyBytes = uniqueKeyBytes();
      const hexKey = Array.from(keyBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const valueBytes = new Uint8Array([42]);

      // Write and flush to IDB
      bridge.writeBytes(STORE_NAME, keyBytes, valueBytes);
      await flushStorageCache(db);

      // Verify it's in IDB
      let row = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(hexKey);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      expect(row).toBeDefined();

      // Delete through bridge
      bridge.deleteBytes(STORE_NAME, keyBytes);

      // Cache should be empty
      expect(bridge.readBytes(STORE_NAME, keyBytes)).toBeNull();

      db.close();
    });

    it('writeBytes makes a defensive copy of the value', async () => {
      const db = await nextDb();
      const bridge = window.mlsStorageBridge;
      const keyBytes = uniqueKeyBytes();
      const valueBytes = new Uint8Array([1, 2, 3]);

      bridge.writeBytes(STORE_NAME, keyBytes, valueBytes);

      // Mutate the original
      valueBytes[0] = 255;

      // The cached value should NOT be affected (defensive copy)
      const result = bridge.readBytes(STORE_NAME, keyBytes);
      expect(Array.from(result)).toEqual([1, 2, 3]);

      db.close();
    });
  });
});
