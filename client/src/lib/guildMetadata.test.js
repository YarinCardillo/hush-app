/**
 * Unit tests for guildMetadata.js
 * Tests encrypt/decrypt round-trips using Web Crypto API (AES-GCM).
 *
 * Node 18+ provides globalThis.crypto — no polyfill required.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  encryptGuildMetadata,
  decryptGuildMetadata,
  encryptChannelMetadata,
  decryptChannelMetadata,
  toBase64,
  fromBase64,
  encodeGuildNameForInvite,
  decodeGuildNameFromInvite,
} from './guildMetadata';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a test AES-256-GCM CryptoKey from 32 random bytes.
 * @returns {Promise<CryptoKey>}
 */
async function makeTestKey() {
  const rawKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return globalThis.crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---------------------------------------------------------------------------
// Guild metadata round-trip
// ---------------------------------------------------------------------------

describe('encryptGuildMetadata / decryptGuildMetadata', () => {
  let key;
  beforeEach(async () => { key = await makeTestKey(); });

  it('encrypts to a Uint8Array starting with version byte 0x01', async () => {
    const blob = await encryptGuildMetadata(key, { name: 'Test Guild', description: 'A desc', icon: null });
    expect(blob).toBeInstanceOf(Uint8Array);
    expect(blob[0]).toBe(0x01);
  });

  it('blob format is [1 byte version][12 byte nonce][N byte ciphertext]', async () => {
    const blob = await encryptGuildMetadata(key, { name: 'G', description: '', icon: null });
    expect(blob[0]).toBe(0x01);             // version byte
    expect(blob.length).toBeGreaterThan(13); // 1 + 12 + at least some ciphertext
    // Nonce is bytes 1-12 (inclusive), ciphertext starts at byte 13
    expect(blob.length - 13).toBeGreaterThan(0);
  });

  it('round-trips name, description, and icon correctly', async () => {
    const original = { name: 'My Server', description: 'Hello world', icon: null };
    const blob = await encryptGuildMetadata(key, original);
    const recovered = await decryptGuildMetadata(key, blob);
    expect(recovered).toEqual(original);
  });

  it('round-trips with icon data', async () => {
    const original = { name: 'Icon Guild', description: 'desc', icon: 'data:image/png;base64,AAAA' };
    const blob = await encryptGuildMetadata(key, original);
    const recovered = await decryptGuildMetadata(key, blob);
    expect(recovered.icon).toBe(original.icon);
  });

  it('produces different ciphertexts for same plaintext (random nonce)', async () => {
    const meta = { name: 'Same', description: '', icon: null };
    const blob1 = await encryptGuildMetadata(key, meta);
    const blob2 = await encryptGuildMetadata(key, meta);
    // Blobs should differ because nonces are random
    expect(Buffer.from(blob1).toString('hex')).not.toBe(Buffer.from(blob2).toString('hex'));
  });

  it('rejects unknown version byte', async () => {
    const blob = await encryptGuildMetadata(key, { name: 'G', description: '', icon: null });
    blob[0] = 0x02; // corrupt version
    await expect(decryptGuildMetadata(key, blob)).rejects.toThrow(/version/i);
  });

  it('rejects tampered ciphertext (AES-GCM authentication tag failure)', async () => {
    const blob = await encryptGuildMetadata(key, { name: 'G', description: '', icon: null });
    blob[blob.length - 1] ^= 0xff; // flip last byte
    await expect(decryptGuildMetadata(key, blob)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Channel metadata round-trip
// ---------------------------------------------------------------------------

describe('encryptChannelMetadata / decryptChannelMetadata', () => {
  let key;
  beforeEach(async () => { key = await makeTestKey(); });

  it('round-trips channel name and description', async () => {
    const original = { name: 'general', description: 'General chat' };
    const blob = await encryptChannelMetadata(key, original);
    const recovered = await decryptChannelMetadata(key, blob);
    expect(recovered).toEqual(original);
  });

  it('blob starts with version byte 0x01', async () => {
    const blob = await encryptChannelMetadata(key, { name: 'x', description: '' });
    expect(blob[0]).toBe(0x01);
  });

  it('round-trips empty description', async () => {
    const original = { name: 'announcements', description: '' };
    const blob = await encryptChannelMetadata(key, original);
    const recovered = await decryptChannelMetadata(key, blob);
    expect(recovered.name).toBe('announcements');
    expect(recovered.description).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Base64 helpers
// ---------------------------------------------------------------------------

describe('toBase64 / fromBase64', () => {
  it('round-trips arbitrary bytes', () => {
    const original = new Uint8Array([1, 2, 3, 255, 0, 128]);
    const b64 = toBase64(original);
    expect(typeof b64).toBe('string');
    const recovered = fromBase64(b64);
    expect(recovered).toEqual(original);
  });

  it('round-trips empty array', () => {
    const original = new Uint8Array(0);
    const b64 = toBase64(original);
    const recovered = fromBase64(b64);
    expect(recovered).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// Invite URL fragment helpers
// ---------------------------------------------------------------------------

describe('encodeGuildNameForInvite / decodeGuildNameFromInvite', () => {
  it('encodes and decodes ASCII names', () => {
    const name = 'My Awesome Guild';
    const encoded = encodeGuildNameForInvite(name);
    expect(decodeGuildNameFromInvite(encoded)).toBe(name);
  });

  it('encodes and decodes names with special characters', () => {
    const name = 'Guild & More / Test + 100%';
    const encoded = encodeGuildNameForInvite(name);
    expect(decodeGuildNameFromInvite(encoded)).toBe(name);
  });

  it('decodeGuildNameFromInvite returns null for invalid URI component', () => {
    // %ZZ is not a valid percent-encoded sequence
    expect(decodeGuildNameFromInvite('%ZZ')).toBeNull();
  });

  it('decodeGuildNameFromInvite handles empty string', () => {
    expect(decodeGuildNameFromInvite('')).toBe('');
  });
});
