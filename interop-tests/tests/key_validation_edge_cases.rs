//! Key validation edge cases extracted from the official libsignal test suite.
//!
//! FINDING: dezire's `is_valid_public_key` has weaker validation than official libsignal.
//! It catches all-zero and pure identity/low-order points, but does NOT reject:
//!   - Torsion-tweaked keys (valid key + torsion component)
//!   - High-bit keys (bit 255 set, scalar >= 2^255)
//!   - Above-modulus keys (non-canonical representations >= p = 2^255-19)
//!
//! These pass key validation and reach signature verification or DH computation.
//! This is NOT a critical vulnerability because X25519 clamping already mitigates
//! small-subgroup attacks, and X25519 reduces u-coordinates mod p automatically.
//! Official libsignal's stricter checks are defense-in-depth.
//!
//! Source: libsignal/rust/core/src/curve.rs (tests module)

use curve25519_dalek::constants::EIGHT_TORSION;
use curve25519_dalek::montgomery::MontgomeryPoint;
use libsignal_dezire::utils::encode_public_key;
use libsignal_dezire::vxeddsa::gen_keypair;
use libsignal_dezire::x3dh::{
    PreKeyBundle, SignedPreKey, X3DHError, x3dh_initiator,
};

/// Build a PreKeyBundle with a specific (possibly invalid) identity key.
/// Uses a dummy signature — key validation runs before signature check.
fn bundle_with_identity_key(identity_pub_33: [u8; 33]) -> PreKeyBundle {
    let bob_spk = gen_keypair();
    PreKeyBundle {
        identity_key: identity_pub_33,
        signed_prekey: SignedPreKey {
            id: 1,
            public_key: bob_spk.public,
            signature: [0u8; 96],
        },
        one_time_prekey: None,
    }
}

/// Build a PreKeyBundle with a valid identity key but a specific SPK.
fn bundle_with_spk(spk_pub_33: [u8; 33]) -> PreKeyBundle {
    let bob_ik = gen_keypair();
    PreKeyBundle {
        identity_key: bob_ik.public,
        signed_prekey: SignedPreKey {
            id: 1,
            public_key: spk_pub_33,
            signature: [0u8; 96],
        },
        one_time_prekey: None,
    }
}

// ============================================================================
// Tests that PASS: dezire correctly rejects these
// ============================================================================

#[test]
fn all_zero_identity_key_rejected() {
    let zero_pub = encode_public_key(&[0u8; 32]);
    let bundle = bundle_with_identity_key(zero_pub);
    let alice = gen_keypair();
    assert_eq!(
        x3dh_initiator(&alice.secret, &bundle),
        Err(X3DHError::InvalidKey),
        "all-zero identity key must be rejected"
    );
}

#[test]
fn all_zero_spk_rejected() {
    let zero_pub = encode_public_key(&[0u8; 32]);
    let bundle = bundle_with_spk(zero_pub);
    let alice = gen_keypair();
    assert_eq!(
        x3dh_initiator(&alice.secret, &bundle),
        Err(X3DHError::InvalidKey),
        "all-zero SPK must be rejected"
    );
}

#[test]
fn high_bit_zero_body_rejected() {
    // Pure 2^255 = [0, 0, ..., 0, 0x80] — this converts to identity in Edwards
    let mut bad_bytes = [0u8; 32];
    bad_bytes[31] = 0x80;
    let bad_pub = encode_public_key(&bad_bytes);
    let bundle = bundle_with_identity_key(bad_pub);
    let alice = gen_keypair();
    assert_eq!(
        x3dh_initiator(&alice.secret, &bundle),
        Err(X3DHError::InvalidKey),
        "key with only high bit set (2^255) must be rejected"
    );
}

#[test]
fn wrong_prefix_rejected_by_decode() {
    let valid = gen_keypair();
    let mut bad_pub = valid.public;
    bad_pub[0] = 0x04;
    let result = libsignal_dezire::utils::decode_public_key(&bad_pub);
    assert!(result.is_err(), "prefix 0x04 must be rejected");
}

// ============================================================================
// FINDING: dezire does NOT reject torsion-tweaked keys
// Official libsignal rejects these via is_torsion_free() check.
// dezire's cofactor check only catches PURE torsion points, not mixed ones.
// Not critical: X25519 clamping mitigates small-subgroup attacks.
// ============================================================================

#[test]
fn torsion_tweaked_keys_not_caught_by_dezire() {
    let valid = gen_keypair();
    let pk_bytes: [u8; 32] = valid.public[1..].try_into().unwrap();
    let mont_pt = MontgomeryPoint(pk_bytes);
    let ed_pt = mont_pt.to_edwards(0).expect("valid key converts to Edwards");

    let alice = gen_keypair();
    let mut accepted_count = 0;

    for (i, torsion) in EIGHT_TORSION.iter().enumerate().skip(1) {
        let tweaked = ed_pt + torsion;
        let tweaked_mont = tweaked.to_montgomery();
        let tweaked_pub_33 = encode_public_key(&tweaked_mont.to_bytes());

        let bundle = bundle_with_identity_key(tweaked_pub_33);
        let result = x3dh_initiator(&alice.secret, &bundle);

        // dezire does NOT reject these at key validation — they reach signature check
        if result == Err(X3DHError::InvalidSignature) {
            accepted_count += 1;
        }

        // Should not succeed (dummy signature)
        assert!(
            result.is_err(),
            "torsion-tweaked key #{i} must not produce a valid handshake with dummy sig"
        );
    }

    // Document: dezire accepts torsion-tweaked keys past key validation
    assert!(
        accepted_count > 0,
        "FINDING: at least some torsion-tweaked keys pass dezire's key validation \
         (reaching InvalidSignature instead of InvalidKey). Official libsignal rejects \
         these with is_torsion_free(). Not critical due to X25519 clamping."
    );
}

// ============================================================================
// FINDING: dezire does NOT reject high-bit / non-canonical keys
// Official libsignal rejects these via scalar_is_in_range() check.
// Not critical: X25519 reduces mod p, so these are equivalent to canonical keys.
// ============================================================================

#[test]
fn high_bit_key_passes_dezire_validation() {
    let valid = gen_keypair();
    let mut pk_bytes: [u8; 32] = valid.public[1..].try_into().unwrap();
    assert_eq!(pk_bytes[31] & 0x80, 0, "honest keys should not have high bit");
    pk_bytes[31] |= 0x80;

    let bad_pub = encode_public_key(&pk_bytes);
    let bundle = bundle_with_identity_key(bad_pub);
    let alice = gen_keypair();
    let result = x3dh_initiator(&alice.secret, &bundle);

    // dezire accepts this — reaches signature check, not key validation
    assert_eq!(
        result,
        Err(X3DHError::InvalidSignature),
        "FINDING: high-bit key passes dezire key validation (official libsignal rejects it)"
    );
}

#[test]
fn all_ff_key_passes_dezire_validation() {
    let bad_pub = encode_public_key(&[0xFF; 32]);
    let bundle = bundle_with_identity_key(bad_pub);
    let alice = gen_keypair();
    let result = x3dh_initiator(&alice.secret, &bundle);

    assert_eq!(
        result,
        Err(X3DHError::InvalidSignature),
        "FINDING: 0xFF*32 key passes dezire key validation (official libsignal rejects it)"
    );
}

// ============================================================================
// FINDING: dezire PANICS on certain non-canonical Montgomery u-coordinates.
// The `to_edwards(0).expect(...)` in utils.rs:43 crashes the process instead
// of returning an error. This is a denial-of-service vector — a malicious
// peer can crash a dezire client by sending a crafted public key.
// ============================================================================

#[test]
fn above_modulus_keys_handled_gracefully() {
    // p = 2^255 - 19. Values in [p, 2^255) are non-canonical.
    // PATCHED: dezire no longer panics on these. Some are rejected at key validation
    // (InvalidKey), others pass to signature check (InvalidSignature).
    // Official libsignal rejects all of them at key validation.
    let two_255_minus_one: [u8; 32] = [
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xFF, 0xFF, 0xFF, 0x7F,
    ];

    let alice = gen_keypair();

    for i in 1u8..=19 {
        let mut pk_bytes = two_255_minus_one;
        pk_bytes[0] = pk_bytes[0].wrapping_sub(i).wrapping_add(1);
        let bad_pub = encode_public_key(&pk_bytes);
        let bundle = bundle_with_identity_key(bad_pub);

        let result = x3dh_initiator(&alice.secret, &bundle);

        // Must not panic (patch verified). Must be some error.
        assert!(
            result.is_err(),
            "above-modulus key 2^255 - {i} must not succeed"
        );
    }
}

#[test]
fn non_curve_points_rejected_gracefully() {
    // 2^255 - 20 is canonical but not on the curve.
    // PATCHED: dezire now returns InvalidKey instead of panicking.
    let mut pk_bytes: [u8; 32] = [
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xFF, 0xFF, 0xFF, 0x7F,
    ];
    pk_bytes[0] = pk_bytes[0].wrapping_sub(19); // 2^255 - 20

    let canonical_pub = encode_public_key(&pk_bytes);
    let bundle = bundle_with_identity_key(canonical_pub);
    let alice = gen_keypair();

    let result = x3dh_initiator(&alice.secret, &bundle);

    // After our patch: graceful InvalidKey instead of panic
    assert_eq!(
        result,
        Err(X3DHError::InvalidKey),
        "non-curve-point must be rejected with InvalidKey (not panic)"
    );
}
