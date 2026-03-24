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
