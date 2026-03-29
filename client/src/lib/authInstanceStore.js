const DB_NAME = 'hush-auth-instances';
const DB_VERSION = 1;
const STORE_INSTANCES = 'instances';
const FALLBACK_INSTANCES_KEY = 'hush_auth_instances_fallback';
const SELECTED_INSTANCE_KEY = 'hush_auth_instance_selected';
const ACTIVE_INSTANCE_KEY = 'hush_auth_instance_active';

export const DEFAULT_AUTH_INSTANCE_URL = 'https://app.gethush.live';

function createDefaultRecord() {
  return {
    url: DEFAULT_AUTH_INSTANCE_URL,
    lastUsedAt: 0,
  };
}

function normalizeRecord(record) {
  const url = normalizeInstanceUrl(record?.url);
  if (!url) return null;
  return {
    url,
    lastUsedAt: Number(record?.lastUsedAt) || 0,
  };
}

function mergeWithDefault(records) {
  const byUrl = new Map();
  byUrl.set(DEFAULT_AUTH_INSTANCE_URL, createDefaultRecord());

  records.forEach((record) => {
    const normalized = normalizeRecord(record);
    if (!normalized) return;
    const existing = byUrl.get(normalized.url);
    byUrl.set(normalized.url, {
      url: normalized.url,
      lastUsedAt: Math.max(existing?.lastUsedAt || 0, normalized.lastUsedAt),
    });
  });

  return Array.from(byUrl.values());
}

function sortRecords(records) {
  return [...records].sort((left, right) => {
    if (left.url === DEFAULT_AUTH_INSTANCE_URL) return -1;
    if (right.url === DEFAULT_AUTH_INSTANCE_URL) return 1;
    if (right.lastUsedAt !== left.lastUsedAt) return right.lastUsedAt - left.lastUsedAt;
    return getInstanceDisplayName(left.url).localeCompare(getInstanceDisplayName(right.url));
  });
}

function readFallbackRecords() {
  try {
    const raw = localStorage.getItem(FALLBACK_INSTANCES_KEY);
    if (!raw) return [createDefaultRecord()];
    const parsed = JSON.parse(raw);
    return sortRecords(mergeWithDefault(Array.isArray(parsed) ? parsed : []));
  } catch {
    return [createDefaultRecord()];
  }
}

function writeFallbackRecords(records) {
  try {
    localStorage.setItem(FALLBACK_INSTANCES_KEY, JSON.stringify(records));
  } catch {
    // Best-effort only.
  }
}

function openAuthInstanceDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb unavailable'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_INSTANCES)) {
        db.createObjectStore(STORE_INSTANCES, { keyPath: 'url' });
      }
    };
  });
}

async function readIndexedDbRecords() {
  const db = await openAuthInstanceDB();
  try {
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_INSTANCES, 'readonly');
      const store = tx.objectStore(STORE_INSTANCES);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
    return sortRecords(mergeWithDefault(records));
  } finally {
    db.close();
  }
}

async function writeIndexedDbRecord(record) {
  const db = await openAuthInstanceDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_INSTANCES, 'readwrite');
      const store = tx.objectStore(STORE_INSTANCES);
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function upsertKnownInstance(url, markUsed = false) {
  const normalizedUrl = normalizeInstanceUrl(url);
  if (!normalizedUrl) {
    throw new Error('Enter a valid instance URL.');
  }

  const nextLastUsedAt = markUsed ? Date.now() : 0;

  try {
    const records = await readIndexedDbRecords();
    const existing = records.find((record) => record.url === normalizedUrl);
    await writeIndexedDbRecord({
      url: normalizedUrl,
      lastUsedAt: Math.max(existing?.lastUsedAt || 0, nextLastUsedAt),
    });
  } catch {
    const records = readFallbackRecords();
    const existing = records.find((record) => record.url === normalizedUrl);
    const nextRecords = sortRecords(mergeWithDefault([
      ...records.filter((record) => record.url !== normalizedUrl),
      {
        url: normalizedUrl,
        lastUsedAt: Math.max(existing?.lastUsedAt || 0, nextLastUsedAt),
      },
    ]));
    writeFallbackRecords(nextRecords);
  }

  return normalizedUrl;
}

export function normalizeInstanceUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.origin;
  } catch {
    return null;
  }
}

export function getInstanceDisplayName(value) {
  const normalized = normalizeInstanceUrl(value);
  if (!normalized) {
    return String(value || '').trim() || 'instance';
  }
  try {
    return new URL(normalized).host;
  } catch {
    return normalized;
  }
}

export function getSelectedAuthInstanceUrlSync() {
  if (typeof localStorage === 'undefined') return DEFAULT_AUTH_INSTANCE_URL;
  return normalizeInstanceUrl(localStorage.getItem(SELECTED_INSTANCE_KEY)) || DEFAULT_AUTH_INSTANCE_URL;
}

export function getActiveAuthInstanceUrlSync() {
  if (typeof sessionStorage !== 'undefined') {
    const active = normalizeInstanceUrl(sessionStorage.getItem(ACTIVE_INSTANCE_KEY));
    if (active) return active;
  }
  return getSelectedAuthInstanceUrlSync();
}

export function setSelectedAuthInstanceUrlSync(value) {
  const normalized = normalizeInstanceUrl(value) || DEFAULT_AUTH_INSTANCE_URL;
  try {
    localStorage.setItem(SELECTED_INSTANCE_KEY, normalized);
  } catch {
    // Best-effort only.
  }
  return normalized;
}

export function setActiveAuthInstanceUrlSync(value) {
  const normalized = setSelectedAuthInstanceUrlSync(value);
  try {
    sessionStorage.setItem(ACTIVE_INSTANCE_KEY, normalized);
  } catch {
    // Best-effort only.
  }
  return normalized;
}

export async function loadKnownAuthInstances() {
  try {
    return await readIndexedDbRecords();
  } catch {
    return readFallbackRecords();
  }
}

export async function selectAuthInstance(value) {
  const normalized = setSelectedAuthInstanceUrlSync(value);
  await upsertKnownInstance(normalized, false);
  return normalized;
}

export async function markAuthInstanceUsed(value) {
  const normalized = setActiveAuthInstanceUrlSync(value);
  await upsertKnownInstance(normalized, true);
  return normalized;
}
