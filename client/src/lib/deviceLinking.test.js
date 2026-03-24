/**
 * Tests for deviceLinking.js — Ed25519 device certification, QR payload
 * encode/decode, and linking code generation.
 */
import { describe, it, expect } from 'vitest';
import {
  certifyDevice,
  verifyCertificate,
  encodeQRPayload,
  decodeQRPayload,
  generateLinkingCode,
} from './deviceLinking.js';
import { mnemonicToIdentityKey, generateIdentityMnemonic } from './bip39Identity.js';

/** Generate a fresh Ed25519 keypair for use in tests. */
async function makeKeypair() {
  return mnemonicToIdentityKey(generateIdentityMnemonic());
}

describe('certifyDevice', () => {
  it('returns a Uint8Array of exactly 64 bytes', async () => {
    const existing = await makeKeypair();
    const newDevice = await makeKeypair();
    const cert = await certifyDevice(newDevice.publicKey, existing.privateKey);
    expect(cert).toBeInstanceOf(Uint8Array);
    expect(cert).toHaveLength(64);
  });

  it('different new device public keys produce different certificates', async () => {
    const existing = await makeKeypair();
    const deviceA = await makeKeypair();
    const deviceB = await makeKeypair();
    const certA = await certifyDevice(deviceA.publicKey, existing.privateKey);
    const certB = await certifyDevice(deviceB.publicKey, existing.privateKey);
    expect(certA).not.toEqual(certB);
  });
});

describe('verifyCertificate', () => {
  it('returns true for a valid certificate from the same keypair', async () => {
    const existing = await makeKeypair();
    const newDevice = await makeKeypair();
    const cert = await certifyDevice(newDevice.publicKey, existing.privateKey);
    const isValid = await verifyCertificate(
      newDevice.publicKey,
      cert,
      existing.publicKey,
    );
    expect(isValid).toBe(true);
  });

  it('returns false for a tampered certificate (single byte flipped)', async () => {
    const existing = await makeKeypair();
    const newDevice = await makeKeypair();
    const cert = await certifyDevice(newDevice.publicKey, existing.privateKey);

    const tampered = cert.slice();
    tampered[0] ^= 0xff;

    const isValid = await verifyCertificate(
      newDevice.publicKey,
      tampered,
      existing.publicKey,
    );
    expect(isValid).toBe(false);
  });

  it('returns false when certificate was signed by a different key', async () => {
    const signer = await makeKeypair();
    const impostor = await makeKeypair();
    const newDevice = await makeKeypair();

    const cert = await certifyDevice(newDevice.publicKey, signer.privateKey);
    // Verify with impostor's public key — should fail
    const isValid = await verifyCertificate(
      newDevice.publicKey,
      cert,
      impostor.publicKey,
    );
    expect(isValid).toBe(false);
  });

  it('returns false when verifying against the wrong new device public key', async () => {
    const existing = await makeKeypair();
    const realDevice = await makeKeypair();
    const wrongDevice = await makeKeypair();

    const cert = await certifyDevice(realDevice.publicKey, existing.privateKey);
    const isValid = await verifyCertificate(
      wrongDevice.publicKey,
      cert,
      existing.publicKey,
    );
    expect(isValid).toBe(false);
  });
});

describe('encodeQRPayload / decodeQRPayload', () => {
  it('returns a base64 string from encodeQRPayload', async () => {
    const device = await makeKeypair();
    const ephemeral = await makeKeypair();
    const payload = {
      devicePublicKey: device.publicKey,
      ephemeralPublicKey: ephemeral.publicKey,
      expiry: new Date(Date.now() + 300_000).toISOString(),
      nonce: crypto.getRandomValues(new Uint8Array(16)),
    };
    const encoded = encodeQRPayload(payload);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('round-trips: decode(encode(payload)) equals original payload', async () => {
    const device = await makeKeypair();
    const ephemeral = await makeKeypair();
    const expiry = new Date(Date.now() + 300_000).toISOString();
    const nonce = crypto.getRandomValues(new Uint8Array(16));

    const original = {
      devicePublicKey: device.publicKey,
      ephemeralPublicKey: ephemeral.publicKey,
      expiry,
      nonce,
    };

    const encoded = encodeQRPayload(original);
    const decoded = decodeQRPayload(encoded);

    expect(decoded.devicePublicKey).toBeInstanceOf(Uint8Array);
    expect(decoded.ephemeralPublicKey).toBeInstanceOf(Uint8Array);
    expect(decoded.devicePublicKey).toEqual(device.publicKey);
    expect(decoded.ephemeralPublicKey).toEqual(ephemeral.publicKey);
    expect(decoded.expiry).toBe(expiry);
    expect(decoded.nonce).toBeInstanceOf(Uint8Array);
    expect(decoded.nonce).toEqual(nonce);
  });

  it('different payloads produce different encoded strings', async () => {
    const keyA = await makeKeypair();
    const keyB = await makeKeypair();
    const ephemeral = await makeKeypair();
    const expiry = new Date().toISOString();
    const nonce = new Uint8Array(16);

    const encA = encodeQRPayload({
      devicePublicKey: keyA.publicKey,
      ephemeralPublicKey: ephemeral.publicKey,
      expiry,
      nonce,
    });
    const encB = encodeQRPayload({
      devicePublicKey: keyB.publicKey,
      ephemeralPublicKey: ephemeral.publicKey,
      expiry,
      nonce,
    });

    expect(encA).not.toBe(encB);
  });
});

describe('generateLinkingCode', () => {
  it('returns an 8-character string', () => {
    const code = generateLinkingCode();
    expect(typeof code).toBe('string');
    expect(code).toHaveLength(8);
  });

  it('contains only uppercase alphanumeric characters (A-Z, 0-9)', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateLinkingCode();
      expect(code).toMatch(/^[A-Z0-9]{8}$/);
    }
  });

  it('generates different codes on each call', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateLinkingCode()));
    // With 36^8 possibilities, 50 codes should almost certainly be unique
    expect(codes.size).toBeGreaterThan(45);
  });
});
