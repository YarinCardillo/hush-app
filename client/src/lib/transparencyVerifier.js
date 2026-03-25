/**
 * Client-side transparency log verification.
 *
 * Implements RFC 6962 Merkle inclusion proof verification via WebCrypto SHA-256,
 * Ed25519 log signature verification, and the TransparencyVerifier class that
 * abstracts the instance log URL for future T.2 federated extension.
 *
 * Hash conventions (RFC 6962 §2.1):
 *   leafHash(data)        = SHA-256(0x00 || data)
 *   nodeHash(left, right) = SHA-256(0x01 || left || right)
 *
 * Hard-fail policy (own key): mismatch blocks the app.
 * Soft-fail policy (other user key): mismatch shows a warning, app continues.
 */

import { verifyTransparency } from './api.js';

// ── Hex utilities ──────────────────────────────────────────────────────────────

/**
 * Converts a hex string to a Uint8Array.
 * @param {string} hex
 * @returns {Uint8Array}
 */
function hexToBytes(hex) {
  if (!hex || hex.length % 2 !== 0) return new Uint8Array(0);
  const result = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    result[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return result;
}

/**
 * Converts a Uint8Array to a lowercase hex string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Decodes a base64 string to a Uint8Array.
 * @param {string} b64
 * @returns {Uint8Array}
 */
function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ── Core Merkle primitives (exported for tests) ────────────────────────────────

/**
 * Compute a Merkle leaf hash per RFC 6962 §2.1:
 *   SHA-256(0x00 || data)
 *
 * @param {Uint8Array} data - Raw leaf content (entry CBOR bytes).
 * @returns {Promise<Uint8Array>} 32-byte hash.
 */
export async function leafHash(data) {
  const input = new Uint8Array(1 + data.length);
  input[0] = 0x00;
  input.set(data, 1);
  const buf = await crypto.subtle.digest('SHA-256', input);
  return new Uint8Array(buf);
}

/**
 * Compute a Merkle interior node hash per RFC 6962 §2.1:
 *   SHA-256(0x01 || left || right)
 *
 * @param {Uint8Array} left  - 32-byte left child hash.
 * @param {Uint8Array} right - 32-byte right child hash.
 * @returns {Promise<Uint8Array>} 32-byte hash.
 */
export async function nodeHash(left, right) {
  const input = new Uint8Array(1 + left.length + right.length);
  input[0] = 0x01;
  input.set(left, 1);
  input.set(right, 1 + left.length);
  const buf = await crypto.subtle.digest('SHA-256', input);
  return new Uint8Array(buf);
}

/**
 * Verify a Merkle inclusion proof per RFC 6962 §2.1.3.
 *
 * Starting from the leaf hash, walk the audit path (sibling hashes) from
 * bottom to top and reconstruct the root. Compare against expectedRoot.
 *
 * @param {Uint8Array} leafData       - Raw leaf content to hash.
 * @param {number}     leafIndex      - Zero-based leaf index in the tree.
 * @param {number}     treeSize       - Total number of leaves.
 * @param {string[]}   auditPath      - Array of hex-encoded 32-byte sibling hashes.
 * @param {string}     expectedRoot   - Hex-encoded 32-byte expected tree root.
 * @returns {Promise<boolean>} True if the proof reconstructs to expectedRoot.
 */
export async function verifyInclusion(leafData, leafIndex, treeSize, auditPath, expectedRoot) {
  try {
    let current = await leafHash(leafData);
    let idx = leafIndex;
    let n = treeSize;

    for (const siblingHex of auditPath) {
      const sibling = hexToBytes(siblingHex);
      if (idx % 2 === 0) {
        // Current is left child; sibling is right.
        current = await nodeHash(current, sibling);
      } else {
        // Current is right child; sibling is left.
        current = await nodeHash(sibling, current);
      }
      idx = Math.floor(idx / 2);
      n = Math.ceil(n / 2);
    }

    const computed = bytesToHex(current);
    return computed === expectedRoot.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Verify an Ed25519 signature over arbitrary data using WebCrypto.
 *
 * Uses crypto.subtle.verify with the Ed25519 algorithm (Chrome 113+,
 * Firefox 128+, Safari 17+). Falls back to @noble/ed25519 on older runtimes
 * that don't support Ed25519 in SubtleCrypto.
 *
 * @param {Uint8Array} logPubKey  - 32-byte Ed25519 public key.
 * @param {Uint8Array} data       - Signed data.
 * @param {Uint8Array} signature  - 64-byte Ed25519 signature.
 * @returns {Promise<boolean>}
 */
export async function verifyLogSignature(logPubKey, data, signature) {
  try {
    // Attempt WebCrypto Ed25519 first (preferred path in modern browsers).
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      logPubKey,
      { name: 'Ed25519' },
      true,
      ['verify'],
    );
    return await crypto.subtle.verify('Ed25519', cryptoKey, signature, data);
  } catch (subtleErr) {
    // Fall back to @noble/ed25519 for Node.js test environments or older
    // browsers that don't yet support Ed25519 in SubtleCrypto.
    try {
      const { verifyAsync } = await import('@noble/ed25519');
      return await verifyAsync(signature, data, logPubKey);
    } catch {
      return false;
    }
  }
}

// ── TransparencyVerifier class ─────────────────────────────────────────────────

/**
 * Client-side transparency log verifier.
 *
 * Abstracts the instance log URL so T.2 federated extensions can swap the
 * underlying transport without changing callers.
 *
 * Usage:
 *   const verifier = new TransparencyVerifier(instanceUrl, logPublicKeyHex);
 *   const { ok } = await verifier.verifyOwnKey(pubKeyHex, token);
 */
export class TransparencyVerifier {
  /**
   * @param {string} instanceUrl       - Base URL of the transparency-enabled instance.
   * @param {string} logPublicKeyHex   - Hex-encoded 32-byte Ed25519 public key of the log.
   */
  constructor(instanceUrl, logPublicKeyHex) {
    this._instanceUrl = instanceUrl;
    this._logPubKey = logPublicKeyHex ? hexToBytes(logPublicKeyHex) : null;
  }

  /**
   * Fetch and verify all transparency log entries for a public key.
   *
   * For each (entry, proof) pair:
   *   1. Decode the entry CBOR bytes (stored as base64 in entryCbor).
   *   2. Compute leafHash and verify against the Merkle proof.
   *   3. Verify the tree head signature with the log public key.
   *
   * @param {string} pubkeyHex - Hex-encoded 32-byte Ed25519 public key.
   * @param {string} token     - JWT for authenticated API calls.
   * @returns {Promise<{ verified: boolean, entries: object[], treeHead: object }>}
   */
  async verify(pubkeyHex, token) {
    const response = await verifyTransparency(token, pubkeyHex, this._instanceUrl);
    const { entries = [], proofs = [], treeHead = {} } = response;

    if (entries.length === 0) {
      return { verified: false, entries: [], treeHead };
    }

    // Verify each entry's Merkle inclusion proof.
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const proof = proofs[i];
      if (!proof) {
        return { verified: false, entries, treeHead };
      }

      const entryBytes = base64ToBytes(entry.entryCbor);
      const valid = await verifyInclusion(
        entryBytes,
        proof.leafIndex,
        proof.treeSize,
        proof.auditPath,
        proof.rootHash,
      );

      if (!valid) {
        return { verified: false, entries, treeHead };
      }
    }

    // Verify the tree head signature if we have the log public key.
    // The log signs the last proof's rootHash so we can anchor the verified chain.
    if (this._logPubKey && proofs.length > 0) {
      const lastProof = proofs[proofs.length - 1];
      if (lastProof.logSignature) {
        const sig = base64ToBytes(lastProof.logSignature);
        const treeHeadData = new TextEncoder().encode(`treeHead:${lastProof.rootHash}`);
        const sigValid = await verifyLogSignature(this._logPubKey, treeHeadData, sig);
        if (!sigValid) {
          return { verified: false, entries, treeHead };
        }
      }
    }

    return { verified: true, entries, treeHead };
  }

  /**
   * Verify the caller's own identity key against the transparency log.
   *
   * HARD FAIL: if the log has no entry for this key, or if entries exist but
   * any proof fails to validate, returns { ok: false, error }.
   *
   * The caller MUST block the app UI on hard fail — do not dismiss silently.
   *
   * @param {string} identityPubKeyHex - Hex-encoded 32-byte Ed25519 public key.
   * @param {string} token             - JWT for authenticated API calls.
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async verifyOwnKey(identityPubKeyHex, token) {
    try {
      const { verified, entries } = await this.verify(identityPubKeyHex, token);

      if (entries.length === 0) {
        return {
          ok: false,
          error: 'Key mismatch detected. Your account may be compromised.',
        };
      }

      if (!verified) {
        return {
          ok: false,
          error: 'Key mismatch detected. Your account may be compromised.',
        };
      }

      return { ok: true };
    } catch (err) {
      // Network or API error — propagate so the caller can decide to warn vs block.
      throw err;
    }
  }

  /**
   * Verify another user's key against the transparency log.
   *
   * SOFT FAIL: if verification fails, returns { ok: false, warning } but does
   * not block the app. The caller should show a non-blocking warning.
   *
   * @param {string} pubkeyHex - Hex-encoded 32-byte Ed25519 public key to verify.
   * @param {string} token     - JWT for authenticated API calls.
   * @returns {Promise<{ ok: boolean, warning?: string }>}
   */
  async verifyOtherUserKey(pubkeyHex, token) {
    try {
      const { verified, entries } = await this.verify(pubkeyHex, token);

      if (entries.length === 0 || !verified) {
        return {
          ok: false,
          warning: 'Key verification failed for this user. Proceed with caution.',
        };
      }

      return { ok: true };
    } catch (err) {
      // Network error — soft fail with a warning.
      return {
        ok: false,
        warning: `Key verification could not be completed: ${err.message}`,
      };
    }
  }
}
