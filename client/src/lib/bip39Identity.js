/**
 * BIP39 cryptographic identity module.
 *
 * Provides mnemonic generation, deterministic Ed25519 keypair derivation,
 * mnemonic validation, challenge signing, and wordlist access for autocomplete.
 *
 * Uses audited libraries:
 *   - @scure/bip39 by Paul Miller (MIT)
 *   - @noble/ed25519 by Paul Miller (MIT)
 *
 * Key design:
 *   - 12-word mnemonic (128 bits of entropy, BIP39 standard)
 *   - Seed = BIP39 seed (64 bytes); private key seed = first 32 bytes
 *   - Public key derived deterministically from private key seed via Ed25519
 *   - No passphrase extension (BIP39 passphrase = "", consistent identity recovery)
 */
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js';
import * as ed from '@noble/ed25519';
import { encode as cborEncode } from 'cborg';

// BIP39 entropy for 12 words (128 bits).
const ENTROPY_BITS = 128;

/**
 * Generates a random 12-word BIP39 mnemonic from the English wordlist.
 *
 * @returns {string} Space-separated 12-word mnemonic phrase.
 */
export function generateIdentityMnemonic() {
  return generateMnemonic(englishWordlist, ENTROPY_BITS);
}

/**
 * Derives a deterministic Ed25519 keypair from a BIP39 mnemonic.
 *
 * The BIP39 seed (64 bytes, no passphrase) is sliced to 32 bytes to serve
 * as the Ed25519 private key seed. The same mnemonic always produces the
 * same keypair, enabling account recovery from the 12 words alone.
 *
 * @param {string} mnemonic - Space-separated 12-word BIP39 mnemonic.
 * @returns {Promise<{ privateKey: Uint8Array, publicKey: Uint8Array }>}
 *   privateKey: 32-byte Ed25519 seed (secret, never leaves device)
 *   publicKey: 32-byte Ed25519 public key (shared with server)
 */
export async function mnemonicToIdentityKey(mnemonic) {
  const seed = mnemonicToSeedSync(mnemonic);
  const privateKey = seed.slice(0, 32);
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { privateKey, publicKey };
}

/**
 * Validates a BIP39 mnemonic against the English wordlist.
 *
 * @param {string} mnemonic - Mnemonic phrase to validate.
 * @returns {boolean} True if the mnemonic is a valid BIP39 phrase.
 */
export function isMnemonicValid(mnemonic) {
  return validateMnemonic(mnemonic, englishWordlist);
}

/**
 * Signs a challenge nonce with an Ed25519 private key.
 *
 * Used in the cryptographic authentication flow: the server issues a nonce,
 * the client signs it, the server verifies the signature against the stored
 * public key to authenticate without transmitting the private key.
 *
 * @param {Uint8Array} nonce - Challenge nonce to sign (typically 32 bytes).
 * @param {Uint8Array} privateKey - 32-byte Ed25519 private key seed.
 * @returns {Promise<Uint8Array>} 64-byte Ed25519 signature.
 */
export async function signChallenge(nonce, privateKey) {
  return ed.signAsync(nonce, privateKey);
}

/**
 * Returns the full BIP39 English wordlist (2048 words).
 *
 * Intended for use in autocomplete/word-suggestion UI during mnemonic entry.
 *
 * @returns {readonly string[]} Array of 2048 BIP39 English words.
 */
export function getEnglishWordlist() {
  return englishWordlist;
}

/**
 * Signs a transparency log entry with the Ed25519 private key.
 *
 * The payload is CBOR-encoded using integer map keys (1-4) matching the
 * server's fxamacker/cbor CoreDetEncOptions with keyasint struct tags.
 * Both sides use RFC 8949 Core Deterministic Encoding, which sorts integer
 * keys numerically — this cross-platform consistency ensures leaf hashes match.
 *
 * Field mapping:
 *   1 → operationType (text string)
 *   2 → userPubKey    (bstr, 32 bytes)
 *   3 → subjectKey    (bstr, 32 bytes, or null)
 *   4 → timestamp     (integer, Unix seconds)
 *
 * @param {Uint8Array} privateKey     - 32-byte Ed25519 private key seed.
 * @param {string}     operationType  - One of: register, key_update, device_add,
 *                                      device_revoke, recovery, key_revoke.
 * @param {Uint8Array} userPubKey     - 32-byte Ed25519 root public key.
 * @param {Uint8Array|null} subjectKey - 32-byte subject device key, or null.
 * @param {number}     timestamp      - Unix seconds (integer).
 * @returns {Promise<{ cborBytes: Uint8Array, signature: Uint8Array }>}
 */
export async function signTransparencyEntry(privateKey, operationType, userPubKey, subjectKey, timestamp) {
  // Build a Map with integer keys so cborg emits CBOR map with integer keys,
  // matching fxamacker/cbor keyasint output (RFC 8949 §4.2.1 sorted by key).
  const payload = new Map([
    [1, operationType],
    [2, userPubKey],
    [3, subjectKey ?? null],
    [4, timestamp],
  ]);
  const cborBytes = cborEncode(payload);
  const signature = await ed.signAsync(cborBytes, privateKey);
  return { cborBytes, signature };
}
