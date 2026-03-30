/**
 * Tests for transparencyVerifier.js — Merkle proof verification (RFC 6962),
 * Ed25519 log signature verification, and TransparencyVerifier class paths.
 *
 * Also tests signTransparencyEntry from bip39Identity.js.
 *
 * Merkle tree convention (RFC 6962):
 *   leafHash(data)       = SHA-256(0x00 || data)
 *   nodeHash(left, right) = SHA-256(0x01 || left || right)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ed from '@noble/ed25519';
import {
  leafHash,
  nodeHash,
  verifyInclusion,
  verifyLogSignature,
  TransparencyVerifier,
} from './transparencyVerifier.js';
import { signTransparencyEntry } from './bip39Identity.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function hexToBytes(hex) {
  const result = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    result[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return result;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Compute SHA-256 via WebCrypto (Node 20+ / browser).
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
async function sha256(data) {
  const buf = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(buf);
}

/**
 * Build a complete binary Merkle tree over an array of leaf byte arrays.
 * Returns { root: Uint8Array, leaves: Uint8Array[] } where leaves[i] is the
 * raw leaf hash for index i.
 */
async function buildTree(entries) {
  const leafHashes = await Promise.all(entries.map(e => leafHash(e)));
  let level = leafHashes;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(await nodeHash(level[i], level[i + 1]));
      } else {
        next.push(level[i]);
      }
    }
    level = next;
  }
  return { root: level[0], leafHashes };
}

/**
 * Build an audit path (sibling hashes) for a given leaf index in a complete
 * power-of-2 tree.
 */
async function buildAuditPath(leafHashes, leafIndex) {
  const path = [];
  let level = [...leafHashes];
  let idx = leafIndex;
  while (level.length > 1) {
    const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (sibling < level.length) {
      path.push(bytesToHex(level[sibling]));
    }
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(await nodeHash(level[i], level[i + 1]));
      } else {
        next.push(level[i]);
      }
    }
    level = next;
    idx = Math.floor(idx / 2);
  }
  return path;
}

// ── leafHash / nodeHash — RFC 6962 compliance ──────────────────────────────────

describe('leafHash', () => {
  it('returns SHA-256(0x00 || data)', async () => {
    const data = new TextEncoder().encode('hello');
    const expected = await sha256(new Uint8Array([0x00, ...data]));
    const actual = await leafHash(data);
    expect(actual).toEqual(expected);
  });

  it('returns a 32-byte Uint8Array', async () => {
    const h = await leafHash(new Uint8Array([1, 2, 3]));
    expect(h).toBeInstanceOf(Uint8Array);
    expect(h).toHaveLength(32);
  });

  it('differs from raw SHA-256 (0x00 prefix matters)', async () => {
    const data = new TextEncoder().encode('test');
    const rawHash = await sha256(data);
    const lh = await leafHash(data);
    expect(lh).not.toEqual(rawHash);
  });
});

describe('nodeHash', () => {
  it('returns SHA-256(0x01 || left || right)', async () => {
    const left = new Uint8Array(32).fill(0xaa);
    const right = new Uint8Array(32).fill(0xbb);
    const expected = await sha256(new Uint8Array([0x01, ...left, ...right]));
    const actual = await nodeHash(left, right);
    expect(actual).toEqual(expected);
  });

  it('returns a 32-byte Uint8Array', async () => {
    const h = await nodeHash(new Uint8Array(32), new Uint8Array(32));
    expect(h).toBeInstanceOf(Uint8Array);
    expect(h).toHaveLength(32);
  });

  it('is not commutative (left != right matters)', async () => {
    const a = new Uint8Array(32).fill(0x11);
    const b = new Uint8Array(32).fill(0x22);
    const ab = await nodeHash(a, b);
    const ba = await nodeHash(b, a);
    expect(ab).not.toEqual(ba);
  });
});

// ── verifyInclusion ────────────────────────────────────────────────────────────

describe('verifyInclusion', () => {
  it('single-leaf tree: root == leafHash, empty audit path', async () => {
    const data = new TextEncoder().encode('only-leaf');
    const root = await leafHash(data);
    const result = await verifyInclusion(data, 0, 1, [], bytesToHex(root));
    expect(result).toBe(true);
  });

  it('single-leaf tree: wrong root returns false', async () => {
    const data = new TextEncoder().encode('only-leaf');
    const wrongRoot = bytesToHex(new Uint8Array(32).fill(0xff));
    const result = await verifyInclusion(data, 0, 1, [], wrongRoot);
    expect(result).toBe(false);
  });

  it('2-leaf tree: index 0 verifies with sibling hash', async () => {
    const entries = [
      new TextEncoder().encode('leaf-0'),
      new TextEncoder().encode('leaf-1'),
    ];
    const { root, leafHashes } = await buildTree(entries);
    const auditPath = await buildAuditPath(leafHashes, 0);
    const result = await verifyInclusion(entries[0], 0, 2, auditPath, bytesToHex(root));
    expect(result).toBe(true);
  });

  it('2-leaf tree: index 1 verifies with sibling hash', async () => {
    const entries = [
      new TextEncoder().encode('leaf-0'),
      new TextEncoder().encode('leaf-1'),
    ];
    const { root, leafHashes } = await buildTree(entries);
    const auditPath = await buildAuditPath(leafHashes, 1);
    const result = await verifyInclusion(entries[1], 1, 2, auditPath, bytesToHex(root));
    expect(result).toBe(true);
  });

  it('2-leaf tree: tampered leaf data returns false', async () => {
    const entries = [
      new TextEncoder().encode('leaf-0'),
      new TextEncoder().encode('leaf-1'),
    ];
    const { root, leafHashes } = await buildTree(entries);
    const auditPath = await buildAuditPath(leafHashes, 0);
    const tamperedData = new TextEncoder().encode('tampered-leaf-0');
    const result = await verifyInclusion(tamperedData, 0, 2, auditPath, bytesToHex(root));
    expect(result).toBe(false);
  });

  it('2-leaf tree: tampered audit path returns false', async () => {
    const entries = [
      new TextEncoder().encode('leaf-0'),
      new TextEncoder().encode('leaf-1'),
    ];
    const { root } = await buildTree(entries);
    const tamperedPath = [bytesToHex(new Uint8Array(32).fill(0xde))];
    const result = await verifyInclusion(entries[0], 0, 2, tamperedPath, bytesToHex(root));
    expect(result).toBe(false);
  });

  it('4-leaf tree: mid-tree (index 2) verifies correctly', async () => {
    const entries = [0, 1, 2, 3].map(i => new TextEncoder().encode(`leaf-${i}`));
    const { root, leafHashes } = await buildTree(entries);
    const auditPath = await buildAuditPath(leafHashes, 2);
    const result = await verifyInclusion(entries[2], 2, 4, auditPath, bytesToHex(root));
    expect(result).toBe(true);
  });

  it('8-leaf tree: index 3 (mid-tree) verifies correctly', async () => {
    const entries = [0, 1, 2, 3, 4, 5, 6, 7].map(i => new TextEncoder().encode(`leaf-${i}`));
    const { root, leafHashes } = await buildTree(entries);
    const auditPath = await buildAuditPath(leafHashes, 3);
    const result = await verifyInclusion(entries[3], 3, 8, auditPath, bytesToHex(root));
    expect(result).toBe(true);
  });

  it('8-leaf tree: index 7 (last leaf) verifies correctly', async () => {
    const entries = [0, 1, 2, 3, 4, 5, 6, 7].map(i => new TextEncoder().encode(`leaf-${i}`));
    const { root, leafHashes } = await buildTree(entries);
    const auditPath = await buildAuditPath(leafHashes, 7);
    const result = await verifyInclusion(entries[7], 7, 8, auditPath, bytesToHex(root));
    expect(result).toBe(true);
  });
});

// ── verifyLogSignature ─────────────────────────────────────────────────────────

describe('verifyLogSignature', () => {
  it('returns true for a valid Ed25519 signature', async () => {
    const privKey = new Uint8Array(32);
    crypto.getRandomValues(privKey);
    const pubKey = await ed.getPublicKeyAsync(privKey);
    const data = new TextEncoder().encode('tree-head-data');
    const signature = await ed.signAsync(data, privKey);
    const result = await verifyLogSignature(pubKey, data, signature);
    expect(result).toBe(true);
  });

  it('returns false for an invalid signature', async () => {
    const privKey = new Uint8Array(32);
    crypto.getRandomValues(privKey);
    const pubKey = await ed.getPublicKeyAsync(privKey);
    const data = new TextEncoder().encode('tree-head-data');
    const wrongSig = new Uint8Array(64).fill(0xab);
    const result = await verifyLogSignature(pubKey, data, wrongSig);
    expect(result).toBe(false);
  });

  it('returns false when data is modified after signing', async () => {
    const privKey = new Uint8Array(32);
    crypto.getRandomValues(privKey);
    const pubKey = await ed.getPublicKeyAsync(privKey);
    const data = new TextEncoder().encode('original');
    const signature = await ed.signAsync(data, privKey);
    const tamperedData = new TextEncoder().encode('tampered');
    const result = await verifyLogSignature(pubKey, tamperedData, signature);
    expect(result).toBe(false);
  });
});

// ── signTransparencyEntry ──────────────────────────────────────────────────────

describe('signTransparencyEntry', () => {
  it('produces a 64-byte Ed25519 signature', async () => {
    const privKey = new Uint8Array(32);
    crypto.getRandomValues(privKey);
    const pubKeyBytes = await ed.getPublicKeyAsync(privKey);
    const ts = Math.floor(Date.now() / 1000);
    const { signature } = await signTransparencyEntry(privKey, 'register', pubKeyBytes, null, ts);
    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature).toHaveLength(64);
  });

  it('produces deterministic CBOR bytes for the same inputs', async () => {
    const privKey = new Uint8Array(32);
    crypto.getRandomValues(privKey);
    const pubKeyBytes = await ed.getPublicKeyAsync(privKey);
    const ts = 1711123456;
    const { cborBytes: bytes1 } = await signTransparencyEntry(privKey, 'register', pubKeyBytes, null, ts);
    const { cborBytes: bytes2 } = await signTransparencyEntry(privKey, 'register', pubKeyBytes, null, ts);
    expect(bytes1).toEqual(bytes2);
  });

  it('the signature is verifiable against the produced CBOR bytes', async () => {
    const privKey = new Uint8Array(32);
    crypto.getRandomValues(privKey);
    const pubKeyBytes = await ed.getPublicKeyAsync(privKey);
    const ts = Math.floor(Date.now() / 1000);
    const { cborBytes, signature } = await signTransparencyEntry(
      privKey, 'device_add', pubKeyBytes, pubKeyBytes, ts,
    );
    const verified = await ed.verifyAsync(signature, cborBytes, pubKeyBytes);
    expect(verified).toBe(true);
  });

  it('different operation types produce different CBOR bytes', async () => {
    const privKey = new Uint8Array(32);
    crypto.getRandomValues(privKey);
    const pubKeyBytes = await ed.getPublicKeyAsync(privKey);
    const ts = 1711123456;
    const { cborBytes: r } = await signTransparencyEntry(privKey, 'register', pubKeyBytes, null, ts);
    const { cborBytes: d } = await signTransparencyEntry(privKey, 'device_add', pubKeyBytes, null, ts);
    expect(r).not.toEqual(d);
  });
});

// ── TransparencyVerifier class ─────────────────────────────────────────────────

describe('TransparencyVerifier', () => {
  let privKey;
  let pubKey;

  beforeEach(async () => {
    privKey = new Uint8Array(32);
    crypto.getRandomValues(privKey);
    pubKey = await ed.getPublicKeyAsync(privKey);
  });

  /**
   * Build a mock API response for verifyTransparency.
   * Creates a 1-entry tree with a valid Merkle proof and log signature.
   */
  async function buildMockApiResponse(entryBytes, pubKeyHex) {
    const lh = await leafHash(entryBytes);
    const rootHex = bytesToHex(lh);

    // Countersign: CBOR(entry) || leafIndex(8B BE) || rootHash(32B)
    const leafIndex = 0;
    const rootBytes = hexToBytes(rootHex);
    const indexBuf = new ArrayBuffer(8);
    new DataView(indexBuf).setBigUint64(0, BigInt(leafIndex), false);
    const indexBytes = new Uint8Array(indexBuf);
    const signedMsg = new Uint8Array(entryBytes.length + 8 + rootBytes.length);
    signedMsg.set(entryBytes, 0);
    signedMsg.set(indexBytes, entryBytes.length);
    signedMsg.set(rootBytes, entryBytes.length + 8);
    const logSig = await ed.signAsync(signedMsg, privKey);

    return {
      entries: [{
        leafIndex: 0,
        operation: 'register',
        userPubKey: pubKeyHex,
        subjectKey: null,
        entryCbor: toBase64(entryBytes),
        userSig: toBase64(new Uint8Array(64)),
        logSig: toBase64(logSig),
        loggedAt: new Date().toISOString(),
      }],
      proofs: [{
        leafIndex: 0,
        treeSize: 1,
        auditPath: [],
        rootHash: rootHex,
        logSignature: toBase64(logSig),
      }],
      treeHead: {
        size: 1,
        root: rootHex,
        signature: toBase64(signedMsg), // pass-through for test (verifier uses per-entry logSig)
      },
    };
  }

  it('verify() returns { verified: true } when proof validates', async () => {
    const pubKeyHex = bytesToHex(pubKey);
    const entryBytes = new TextEncoder().encode('test-entry-cbor');
    const mockResponse = await buildMockApiResponse(entryBytes, pubKeyHex);

    // Simulate the verifier using only proof-level Merkle verification
    // (log signature verification is skipped when logPubKeyHex is not provided
    // or when we mock the fetch — we just verify the inclusion proof path).
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const verifier = new TransparencyVerifier('https://example.com', pubKeyHex);
    const result = await verifier.verify(pubKeyHex, 'mock-token');
    expect(result.entries).toHaveLength(1);
    // The proof should validate (single-leaf: root == leafHash of entryBytes)
    expect(result.verified).toBe(true);
    vi.restoreAllMocks();
  });

  it('verify() returns { verified: false } when proof does not validate', async () => {
    const pubKeyHex = bytesToHex(pubKey);
    const entryBytes = new TextEncoder().encode('real-entry');
    const lh = await leafHash(entryBytes);
    const correctRoot = bytesToHex(lh);

    const mockResponse = {
      entries: [{
        leafIndex: 0,
        operation: 'register',
        userPubKey: pubKeyHex,
        subjectKey: null,
        entryCbor: toBase64(entryBytes),
        userSig: toBase64(new Uint8Array(64)),
        logSig: toBase64(new Uint8Array(64)),
        loggedAt: new Date().toISOString(),
      }],
      proofs: [{
        leafIndex: 0,
        treeSize: 1,
        auditPath: [],
        rootHash: 'deadbeef'.repeat(8), // Wrong root
        logSignature: toBase64(new Uint8Array(64)),
      }],
      treeHead: {
        size: 1,
        root: correctRoot,
        signature: toBase64(new Uint8Array(64)),
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const verifier = new TransparencyVerifier('https://example.com', pubKeyHex);
    const result = await verifier.verify(pubKeyHex, 'mock-token');
    expect(result.verified).toBe(false);
    vi.restoreAllMocks();
  });

  it('verifyOwnKey() returns { ok: true, warning } when no entries found', async () => {
    const pubKeyHex = bytesToHex(pubKey);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entries: [], proofs: [], treeHead: { size: 0, root: '', signature: '' } }),
    });

    const verifier = new TransparencyVerifier('https://example.com', pubKeyHex);
    const result = await verifier.verifyOwnKey(pubKeyHex, 'mock-token');
    expect(result.ok).toBe(true);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('No transparency log entries');
    vi.restoreAllMocks();
  });

  it('verifyOwnKey() returns { ok: true } when proof validates', async () => {
    const pubKeyHex = bytesToHex(pubKey);
    const entryBytes = new TextEncoder().encode('entry-cbor-data');
    const mockResponse = await buildMockApiResponse(entryBytes, pubKeyHex);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const verifier = new TransparencyVerifier('https://example.com', pubKeyHex);
    const result = await verifier.verifyOwnKey(pubKeyHex, 'mock-token');
    expect(result.ok).toBe(true);
    vi.restoreAllMocks();
  });

  it('verifyOtherUserKey() returns { ok: true, warning: undefined } when proof validates', async () => {
    const pubKeyHex = bytesToHex(pubKey);
    const entryBytes = new TextEncoder().encode('other-user-entry');
    const mockResponse = await buildMockApiResponse(entryBytes, pubKeyHex);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const verifier = new TransparencyVerifier('https://example.com', pubKeyHex);
    const result = await verifier.verifyOtherUserKey(pubKeyHex, 'mock-token');
    expect(result.ok).toBe(true);
    expect(result.warning).toBeUndefined();
    vi.restoreAllMocks();
  });

  it('verify() returns { verified: false } when entry userPubKey does not match queried key', async () => {
    const pubKeyHex = bytesToHex(pubKey);
    const entryBytes = new TextEncoder().encode('entry-for-wrong-key');
    const mockResponse = await buildMockApiResponse(entryBytes, pubKeyHex);
    // Tamper: change the entry's userPubKey to a different key
    mockResponse.entries[0].userPubKey = 'aa'.repeat(32);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const verifier = new TransparencyVerifier('https://example.com', pubKeyHex);
    const result = await verifier.verify(pubKeyHex, 'mock-token');
    expect(result.verified).toBe(false);
    vi.restoreAllMocks();
  });

  it('verifyOtherUserKey() returns { ok: false, warning } on proof failure', async () => {
    const pubKeyHex = bytesToHex(pubKey);
    const entryBytes = new TextEncoder().encode('other-entry');

    const mockResponse = {
      entries: [{
        leafIndex: 0,
        operation: 'register',
        userPubKey: pubKeyHex,
        subjectKey: null,
        entryCbor: toBase64(entryBytes),
        userSig: toBase64(new Uint8Array(64)),
        logSig: toBase64(new Uint8Array(64)),
        loggedAt: new Date().toISOString(),
      }],
      proofs: [{
        leafIndex: 0,
        treeSize: 1,
        auditPath: [],
        rootHash: 'cafebabe'.repeat(8), // Wrong root
        logSignature: toBase64(new Uint8Array(64)),
      }],
      treeHead: { size: 1, root: 'deadbeef'.repeat(8), signature: '' },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const verifier = new TransparencyVerifier('https://example.com', pubKeyHex);
    const result = await verifier.verifyOtherUserKey(pubKeyHex, 'mock-token');
    expect(result.ok).toBe(false);
    expect(result.warning).toBeDefined();
    vi.restoreAllMocks();
  });
});
