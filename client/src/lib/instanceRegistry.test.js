/**
 * Unit tests for instanceRegistry.js
 *
 * Uses fake-indexeddb (auto-imported in src/test/setup.js) to simulate IndexedDB
 * without a real browser environment.
 *
 * Each test group opens a uniquely-named database to ensure full isolation between
 * tests (fake-indexeddb persists IDB state within a single test run).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  openInstanceRegistry,
  saveInstance,
  getAllInstances,
  getInstanceByUrl,
  removeInstance,
  getInstanceJwt,
  saveGuildOrder,
  getGuildOrder,
} from './instanceRegistry';

// ---------------------------------------------------------------------------
// Test isolation helpers
// ---------------------------------------------------------------------------

/**
 * Counter incremented for each test to produce unique DB names.
 * fake-indexeddb shares state within a test run, so tests must not share DB names.
 */
let _dbCounter = 0;

/**
 * Open a fresh, isolated registry for a single test.
 * Unique DB name = 'hush-instances-test-N'.
 */
async function openFreshRegistry() {
  _dbCounter += 1;
  return openInstanceRegistry(`hush-instances-test-${_dbCounter}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid instance record for tests that don't care about field values. */
function makeRecord(overrides = {}) {
  return {
    instanceUrl: 'https://hush.example.com',
    jwt: 'eyJhbGciOiJFZERTQSJ9.test.sig',
    userId: 'user-uuid-1',
    username: 'alice',
    displayName: 'Alice',
    connectionState: 'connected',
    lastSeen: Date.now(),
    ...overrides,
  };
}

// ── openInstanceRegistry ──────────────────────────────────────────────────────

describe('openInstanceRegistry', () => {
  it('returns an IDBDatabase', async () => {
    const db = await openFreshRegistry();
    expect(db).toBeDefined();
    expect(typeof db.transaction).toBe('function');
    db.close();
  });

  it('creates the instances object store with keyPath instanceUrl', async () => {
    const db = await openFreshRegistry();
    expect(db.objectStoreNames.contains('instances')).toBe(true);
    const tx = db.transaction('instances', 'readonly');
    const store = tx.objectStore('instances');
    expect(store.keyPath).toBe('instanceUrl');
    db.close();
  });

  it('creates the guild-order object store', async () => {
    const db = await openFreshRegistry();
    expect(db.objectStoreNames.contains('guild-order')).toBe(true);
    db.close();
  });
});

// ── saveInstance / getAllInstances ────────────────────────────────────────────

describe('saveInstance', () => {
  let db;

  beforeEach(async () => {
    db = await openFreshRegistry();
  });

  it('persists a record retrievable by getAllInstances', async () => {
    const record = makeRecord();
    await saveInstance(db, record);
    const all = await getAllInstances(db);
    expect(all).toHaveLength(1);
    expect(all[0].instanceUrl).toBe('https://hush.example.com');
    expect(all[0].jwt).toBe(record.jwt);
  });

  it('upserts — second save with same instanceUrl replaces the first', async () => {
    const record = makeRecord({ jwt: 'jwt-v1' });
    await saveInstance(db, record);
    await saveInstance(db, { ...record, jwt: 'jwt-v2' });
    const all = await getAllInstances(db);
    expect(all).toHaveLength(1);
    expect(all[0].jwt).toBe('jwt-v2');
  });

  it('persists multiple distinct instances', async () => {
    await saveInstance(db, makeRecord({ instanceUrl: 'https://a.example.com' }));
    await saveInstance(db, makeRecord({ instanceUrl: 'https://b.example.com' }));
    const all = await getAllInstances(db);
    expect(all).toHaveLength(2);
  });
});

// ── getInstanceByUrl ──────────────────────────────────────────────────────────

describe('getInstanceByUrl', () => {
  let db;

  beforeEach(async () => {
    db = await openFreshRegistry();
  });

  it('returns the record for a saved instance', async () => {
    const record = makeRecord({ instanceUrl: 'https://lookup.example.com' });
    await saveInstance(db, record);
    const result = await getInstanceByUrl(db, 'https://lookup.example.com');
    expect(result).not.toBeNull();
    expect(result.userId).toBe(record.userId);
  });

  it('returns null when instance is not found', async () => {
    const result = await getInstanceByUrl(db, 'https://nonexistent.example.com');
    expect(result).toBeNull();
  });
});

// ── removeInstance ────────────────────────────────────────────────────────────

describe('removeInstance', () => {
  let db;

  beforeEach(async () => {
    db = await openFreshRegistry();
  });

  it('deletes a saved instance record', async () => {
    const record = makeRecord({ instanceUrl: 'https://delete-me.example.com' });
    await saveInstance(db, record);
    await removeInstance(db, 'https://delete-me.example.com');
    const all = await getAllInstances(db);
    expect(all).toHaveLength(0);
  });

  it('is a no-op when the instance does not exist', async () => {
    // Should not throw.
    await expect(removeInstance(db, 'https://no-such-instance.com')).resolves.toBeUndefined();
  });
});

// ── getInstanceJwt ────────────────────────────────────────────────────────────

describe('getInstanceJwt', () => {
  let db;

  beforeEach(async () => {
    db = await openFreshRegistry();
  });

  it('returns the jwt field from a saved instance', async () => {
    const record = makeRecord({
      instanceUrl: 'https://jwt-test.example.com',
      jwt: 'the-actual-jwt',
    });
    await saveInstance(db, record);
    const jwt = await getInstanceJwt(db, 'https://jwt-test.example.com');
    expect(jwt).toBe('the-actual-jwt');
  });

  it('returns null when instance is not found', async () => {
    const jwt = await getInstanceJwt(db, 'https://no-such.example.com');
    expect(jwt).toBeNull();
  });
});

// ── saveGuildOrder / getGuildOrder ────────────────────────────────────────────

describe('guild order persistence', () => {
  let db;

  beforeEach(async () => {
    db = await openFreshRegistry();
  });

  it('persists an ordered array of guild IDs', async () => {
    const order = ['guild-a', 'guild-b', 'guild-c'];
    await saveGuildOrder(db, order);
    const result = await getGuildOrder(db);
    expect(result).toEqual(order);
  });

  it('returns empty array when no order has been saved', async () => {
    const result = await getGuildOrder(db);
    expect(result).toEqual([]);
  });

  it('overwrites the previous order on subsequent saves', async () => {
    await saveGuildOrder(db, ['guild-x', 'guild-y']);
    await saveGuildOrder(db, ['guild-y', 'guild-x', 'guild-z']);
    const result = await getGuildOrder(db);
    expect(result).toEqual(['guild-y', 'guild-x', 'guild-z']);
  });

  it('persists an empty array (all guilds removed)', async () => {
    await saveGuildOrder(db, ['guild-a']);
    await saveGuildOrder(db, []);
    const result = await getGuildOrder(db);
    expect(result).toEqual([]);
  });
});

// ── Concurrent access ─────────────────────────────────────────────────────────

describe('concurrent access', () => {
  it('handles parallel saves without data corruption', async () => {
    const db = await openFreshRegistry();
    const instances = Array.from({ length: 5 }, (_, i) =>
      makeRecord({ instanceUrl: `https://instance-${i}.example.com`, userId: `user-${i}` }),
    );
    // All saves kicked off simultaneously.
    await Promise.all(instances.map((r) => saveInstance(db, r)));
    const all = await getAllInstances(db);
    expect(all).toHaveLength(5);
    db.close();
  });
});
