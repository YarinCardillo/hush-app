/**
 * Tests for bip39Identity.js — BIP39 mnemonic generation, Ed25519 keypair derivation,
 * mnemonic validation, challenge signing, and wordlist access.
 */
import { describe, it, expect } from 'vitest';
import {
  generateIdentityMnemonic,
  mnemonicToIdentityKey,
  isMnemonicValid,
  signChallenge,
  getEnglishWordlist,
} from './bip39Identity.js';

describe('generateIdentityMnemonic', () => {
  it('returns a string of exactly 12 space-separated words', () => {
    const mnemonic = generateIdentityMnemonic();
    expect(typeof mnemonic).toBe('string');
    const words = mnemonic.split(' ');
    expect(words).toHaveLength(12);
  });

  it('each word is in the BIP39 English wordlist', () => {
    const mnemonic = generateIdentityMnemonic();
    const wordlist = getEnglishWordlist();
    const wordSet = new Set(wordlist);
    const words = mnemonic.split(' ');
    for (const word of words) {
      expect(wordSet.has(word)).toBe(true);
    }
  });

  it('generates different mnemonics on each call', () => {
    const a = generateIdentityMnemonic();
    const b = generateIdentityMnemonic();
    // Astronomically unlikely to collide
    expect(a).not.toBe(b);
  });
});

describe('mnemonicToIdentityKey', () => {
  it('returns an object with privateKey and publicKey as Uint8Array(32)', async () => {
    const mnemonic = generateIdentityMnemonic();
    const { privateKey, publicKey } = await mnemonicToIdentityKey(mnemonic);
    expect(privateKey).toBeInstanceOf(Uint8Array);
    expect(privateKey).toHaveLength(32);
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(publicKey).toHaveLength(32);
  });

  it('is deterministic: same mnemonic produces same keypair', async () => {
    const mnemonic = generateIdentityMnemonic();
    const first = await mnemonicToIdentityKey(mnemonic);
    const second = await mnemonicToIdentityKey(mnemonic);
    expect(first.privateKey).toEqual(second.privateKey);
    expect(first.publicKey).toEqual(second.publicKey);
  });

  it('different mnemonics produce different keypairs', async () => {
    const mnemonicA = generateIdentityMnemonic();
    const mnemonicB = generateIdentityMnemonic();
    const keyA = await mnemonicToIdentityKey(mnemonicA);
    const keyB = await mnemonicToIdentityKey(mnemonicB);
    expect(keyA.publicKey).not.toEqual(keyB.publicKey);
    expect(keyA.privateKey).not.toEqual(keyB.privateKey);
  });
});

describe('isMnemonicValid', () => {
  it('returns true for a valid 12-word BIP39 mnemonic', () => {
    const mnemonic = generateIdentityMnemonic();
    expect(isMnemonicValid(mnemonic)).toBe(true);
  });

  it('returns false for garbage input', () => {
    expect(isMnemonicValid('not a valid mnemonic at all here foo bar')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isMnemonicValid('')).toBe(false);
  });

  it('returns false for a mnemonic with invalid words', () => {
    expect(isMnemonicValid('zzz yyy xxx www vvv uuu ttt sss rrr qqq ppp ooo')).toBe(false);
  });
});

describe('signChallenge', () => {
  it('returns a Uint8Array of length 64', async () => {
    const mnemonic = generateIdentityMnemonic();
    const { privateKey } = await mnemonicToIdentityKey(mnemonic);
    const nonce = new Uint8Array(32);
    crypto.getRandomValues(nonce);
    const sig = await signChallenge(nonce, privateKey);
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig).toHaveLength(64);
  });

  it('produces a valid Ed25519 signature verifiable by the paired public key', async () => {
    // Import noble/ed25519 directly to verify
    const ed = await import('@noble/ed25519');
    const mnemonic = generateIdentityMnemonic();
    const { privateKey, publicKey } = await mnemonicToIdentityKey(mnemonic);
    const nonce = new Uint8Array(32).fill(42);
    const sig = await signChallenge(nonce, privateKey);
    const isValid = await ed.verifyAsync(sig, nonce, publicKey);
    expect(isValid).toBe(true);
  });

  it('different nonces produce different signatures', async () => {
    const mnemonic = generateIdentityMnemonic();
    const { privateKey } = await mnemonicToIdentityKey(mnemonic);
    const nonceA = new Uint8Array(32).fill(1);
    const nonceB = new Uint8Array(32).fill(2);
    const sigA = await signChallenge(nonceA, privateKey);
    const sigB = await signChallenge(nonceB, privateKey);
    expect(sigA).not.toEqual(sigB);
  });
});

describe('getEnglishWordlist', () => {
  it('returns an array of 2048 words', () => {
    const wordlist = getEnglishWordlist();
    expect(Array.isArray(wordlist)).toBe(true);
    expect(wordlist).toHaveLength(2048);
  });

  it('contains well-known BIP39 words', () => {
    const wordlist = getEnglishWordlist();
    expect(wordlist).toContain('abandon');
    expect(wordlist).toContain('zoo');
  });
});
