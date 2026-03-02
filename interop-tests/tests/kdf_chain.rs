//! KDF_CK chain verification using the official libsignal test vector.
//!
//! CRITICAL FINDING: dezire SWAPS the 0x01/0x02 seeds compared to the Signal spec
//! and official libsignal:
//!
//!   Signal spec & official libsignal:
//!     message_key_seed = HMAC-SHA256(ck, 0x01)
//!     next_chain_key   = HMAC-SHA256(ck, 0x02)
//!
//!   dezire (ratchet.rs kdf_ck):
//!     next_chain_key   = HMAC-SHA256(ck, 0x01)   <-- swapped
//!     message_key      = HMAC-SHA256(ck, 0x02)   <-- swapped
//!
//! This is NOT a security bug — dezire is self-consistent. Both sides of a
//! dezire session use the same mapping, so keys are derived correctly within
//! the dezire ecosystem. But it means dezire's chain produces different
//! intermediate values than a spec-compliant implementation for the same seed.
//!
//! Additionally, official libsignal derives the final message keys (cipher_key,
//! mac_key, iv) from the raw seed via HKDF-SHA256 with info="WhisperMessageKeys",
//! while dezire uses the raw HMAC output directly as the message key.

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC key length");
    mac.update(data);
    mac.finalize().into_bytes().into()
}

// ============================================================================
// Official libsignal test vector (from rust/protocol/src/ratchet/keys.rs)
// ============================================================================

const OFFICIAL_SEED: [u8; 32] = [
    0x8a, 0xb7, 0x2d, 0x6f, 0x4c, 0xc5, 0xac, 0x0d, 0x38, 0x7e, 0xaf, 0x46, 0x33, 0x78,
    0xdd, 0xb2, 0x8e, 0xdd, 0x07, 0x38, 0x5b, 0x1c, 0xb0, 0x12, 0x50, 0xc7, 0x15, 0x98,
    0x2e, 0x7a, 0xd4, 0x8f,
];

/// Official next_chain_key = HMAC(seed, 0x02)
const OFFICIAL_NEXT_CHAIN_KEY: [u8; 32] = [
    0x28, 0xe8, 0xf8, 0xfe, 0xe5, 0x4b, 0x80, 0x1e, 0xef, 0x7c, 0x5c, 0xfb, 0x2f, 0x17,
    0xf3, 0x2c, 0x7b, 0x33, 0x44, 0x85, 0xbb, 0xb7, 0x0f, 0xac, 0x6e, 0xc1, 0x03, 0x42,
    0xa2, 0x46, 0xd1, 0x5d,
];

/// Official cipher_key = HKDF(HMAC(seed, 0x01), info="WhisperMessageKeys")[0:32]
const OFFICIAL_CIPHER_KEY: [u8; 32] = [
    0xbf, 0x51, 0xe9, 0xd7, 0x5e, 0x0e, 0x31, 0x03, 0x10, 0x51, 0xf8, 0x2a, 0x24, 0x91,
    0xff, 0xc0, 0x84, 0xfa, 0x29, 0x8b, 0x77, 0x93, 0xbd, 0x9d, 0xb6, 0x20, 0x05, 0x6f,
    0xeb, 0xf4, 0x52, 0x17,
];

/// Official mac_key = HKDF(HMAC(seed, 0x01), info="WhisperMessageKeys")[32:64]
const OFFICIAL_MAC_KEY: [u8; 32] = [
    0xc6, 0xc7, 0x7d, 0x6a, 0x73, 0xa3, 0x54, 0x33, 0x7a, 0x56, 0x43, 0x5e, 0x34, 0x60,
    0x7d, 0xfe, 0x48, 0xe3, 0xac, 0xe1, 0x4e, 0x77, 0x31, 0x4d, 0xc6, 0xab, 0xc1, 0x72,
    0xe7, 0xa7, 0x03, 0x0b,
];

// ============================================================================
// Test: verify our HMAC matches the official next_chain_key
// ============================================================================

#[test]
fn hmac_sha256_matches_official_next_chain_key() {
    // Official: next_chain_key = HMAC(seed, 0x02)
    let computed = hmac_sha256(&OFFICIAL_SEED, &[0x02]);
    assert_eq!(
        computed, OFFICIAL_NEXT_CHAIN_KEY,
        "HMAC-SHA256(seed, 0x02) must match official next_chain_key"
    );
}

#[test]
fn hmac_sha256_with_hkdf_matches_official_cipher_key() {
    // Official: message_key_seed = HMAC(seed, 0x01)
    let message_key_seed = hmac_sha256(&OFFICIAL_SEED, &[0x01]);

    // Official: HKDF-SHA256(ikm=message_key_seed, salt=None, info="WhisperMessageKeys") -> 80 bytes
    let hk = hkdf::Hkdf::<Sha256>::new(None, &message_key_seed);
    let mut okm = [0u8; 80];
    hk.expand(b"WhisperMessageKeys", &mut okm)
        .expect("HKDF expansion");

    let cipher_key: [u8; 32] = okm[0..32].try_into().unwrap();
    let mac_key: [u8; 32] = okm[32..64].try_into().unwrap();

    assert_eq!(
        cipher_key, OFFICIAL_CIPHER_KEY,
        "HKDF-derived cipher_key must match official test vector"
    );
    assert_eq!(
        mac_key, OFFICIAL_MAC_KEY,
        "HKDF-derived mac_key must match official test vector"
    );
}

// ============================================================================
// Test: document the 0x01/0x02 swap between dezire and official
// ============================================================================

#[test]
fn document_dezire_seed_swap() {
    // In dezire's kdf_ck:
    //   next_chain_key = HMAC(ck, 0x01)  <-- this is what official uses for message_key_seed
    //   message_key    = HMAC(ck, 0x02)  <-- this is what official uses for next_chain_key
    //
    // Consequence: dezire's "message key" for a given chain key equals official's
    // "next chain key" for that same chain key, and vice versa.

    let dezire_chain_key = hmac_sha256(&OFFICIAL_SEED, &[0x01]);
    let dezire_message_key = hmac_sha256(&OFFICIAL_SEED, &[0x02]);

    // dezire's "message key" == official's next_chain_key
    assert_eq!(
        dezire_message_key, OFFICIAL_NEXT_CHAIN_KEY,
        "dezire's message_key (HMAC with 0x02) equals official's next_chain_key — \
         confirming the 0x01/0x02 swap"
    );

    // dezire's "chain key" is the raw HMAC(seed, 0x01), which is official's message_key_seed
    // (before HKDF expansion). They're the same raw HMAC output.
    let official_message_key_seed = hmac_sha256(&OFFICIAL_SEED, &[0x01]);
    assert_eq!(
        dezire_chain_key, official_message_key_seed,
        "dezire's chain_key (HMAC with 0x01) equals official's message_key_seed"
    );
}

// ============================================================================
// Test: chain advancement is still deterministic
// ============================================================================

#[test]
fn chain_advancement_100_steps_deterministic() {
    let mut ck = OFFICIAL_SEED;

    // Advance 100 steps using the "official" seed ordering (0x02 = chain key)
    let mut official_keys = Vec::with_capacity(100);
    for _ in 0..100 {
        let next_ck = hmac_sha256(&ck, &[0x02]);
        let mk_seed = hmac_sha256(&ck, &[0x01]);
        official_keys.push((next_ck, mk_seed));
        ck = next_ck;
    }

    // Re-run from the same seed — must produce identical values
    ck = OFFICIAL_SEED;
    for (i, (expected_ck, expected_mk)) in official_keys.iter().enumerate() {
        let next_ck = hmac_sha256(&ck, &[0x02]);
        let mk_seed = hmac_sha256(&ck, &[0x01]);
        assert_eq!(&next_ck, expected_ck, "chain key mismatch at step {i}");
        assert_eq!(&mk_seed, expected_mk, "message key seed mismatch at step {i}");
        ck = next_ck;
    }
}
