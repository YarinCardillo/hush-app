import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTH_INSTANCE_URL,
  getActiveAuthInstanceUrlSync,
  getInstanceDisplayName,
  getSelectedAuthInstanceUrlSync,
  loadKnownAuthInstances,
  markAuthInstanceUsed,
  normalizeInstanceUrl,
  selectAuthInstance,
} from './authInstanceStore';

function deleteAuthInstanceDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('hush-auth-instances');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

describe('authInstanceStore', () => {
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await deleteAuthInstanceDb();
  });

  it('normalizes bare hosts to https origins', () => {
    expect(normalizeInstanceUrl('app.gethush.live')).toBe(DEFAULT_AUTH_INSTANCE_URL);
    expect(normalizeInstanceUrl('https://chat.example.com/path?q=1')).toBe('https://chat.example.com');
  });

  it('returns the default instance on first use', () => {
    expect(getSelectedAuthInstanceUrlSync()).toBe(DEFAULT_AUTH_INSTANCE_URL);
    expect(getActiveAuthInstanceUrlSync()).toBe(DEFAULT_AUTH_INSTANCE_URL);
  });

  it('keeps the default instance pinned while sorting others by recency', async () => {
    await selectAuthInstance('chat.example.com');
    await markAuthInstanceUsed('alpha.example.com');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await markAuthInstanceUsed('beta.example.com');

    const records = await loadKnownAuthInstances();

    expect(records.map((record) => record.url)).toEqual([
      DEFAULT_AUTH_INSTANCE_URL,
      'https://beta.example.com',
      'https://alpha.example.com',
      'https://chat.example.com',
    ]);
  });

  it('stores the selected and active instance separately from display formatting', async () => {
    await selectAuthInstance('https://chat.example.com');
    expect(getSelectedAuthInstanceUrlSync()).toBe('https://chat.example.com');
    expect(getInstanceDisplayName(getSelectedAuthInstanceUrlSync())).toBe('chat.example.com');

    await markAuthInstanceUsed('https://alpha.example.com');
    expect(getActiveAuthInstanceUrlSync()).toBe('https://alpha.example.com');
    expect(getSelectedAuthInstanceUrlSync()).toBe('https://alpha.example.com');
  });
});
