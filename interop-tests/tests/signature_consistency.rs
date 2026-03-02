//! Signature consistency tests.
//!
//! IMPORTANT: dezire uses VXEdDSA (96-byte signatures with VRF output),
//! while official libsignal uses XEdDSA (64-byte signatures). These are
//! DIFFERENT schemes from the same spec document — cross-verification is
//! impossible by design.
//!
//! What we CAN test:
//! 1. Dezire's VXEdDSA self-verifies (roundtrip)
//! 2. Montgomery-to-Edwards key conversion produces the same point
//! 3. Both derive the same public key from the same private key
//!
//! NOTE: We cannot test official XEdDSA sign/verify here because
//! calculate_signature requires a rand::CryptoRng and libsignal-core
//! uses rand 0.8 internally while we depend on rand 0.9. The official
//! lib's own test suite covers XEdDSA self-verification.

use libsignal_core::curve::{PrivateKey as OfficialPrivateKey, PublicKey as OfficialPublicKey};

#[test]
fn dezire_vxeddsa_self_verifies() {
    for _ in 0..20 {
        let kp = libsignal_dezire::vxeddsa::gen_keypair();
        let message = b"interop test message for VXEdDSA self-verification";
        let output = libsignal_dezire::vxeddsa::vxeddsa_sign(&kp.secret, message)
            .expect("VXEdDSA sign must succeed");
        assert_eq!(output.signature.len(), 96, "VXEdDSA signature must be 96 bytes");

        let vrf = libsignal_dezire::vxeddsa::vxeddsa_verify(&kp.public, message, &output.signature);
        assert!(vrf.is_some(), "dezire VXEdDSA must self-verify");
    }
}

#[test]
fn same_private_key_same_montgomery_point() {
    for _ in 0..50 {
        let kp = libsignal_dezire::vxeddsa::gen_keypair();
        let dezire_pub_32: &[u8] = &kp.public[1..];

        let official = OfficialPrivateKey::deserialize(&kp.secret).expect("deserialize");
        let official_pub = official.public_key().expect("derive pubkey");

        assert_eq!(
            dezire_pub_32,
            official_pub.public_key_bytes(),
            "Montgomery u-coordinate must be identical for same private key"
        );
    }
}

/// Documents the incompatibility: VXEdDSA and XEdDSA are different schemes.
#[test]
fn vxeddsa_signature_rejected_by_official_verifier() {
    let kp = libsignal_dezire::vxeddsa::gen_keypair();
    let message = b"cross-verification test";

    let vxeddsa_output = libsignal_dezire::vxeddsa::vxeddsa_sign(&kp.secret, message)
        .expect("sign must succeed");
    assert_eq!(vxeddsa_output.signature.len(), 96);

    // Official expects 64-byte XEdDSA signature
    let official_pub = OfficialPublicKey::deserialize(&kp.public).expect("parse pubkey");

    // Truncating to 64 bytes demonstrates incompatibility
    let truncated_sig: &[u8] = &vxeddsa_output.signature[..64];
    let result = official_pub.verify_signature(message, truncated_sig);
    assert!(!result, "VXEdDSA signature must NOT verify as XEdDSA — different schemes");
}

/// Large message signing test (extracted from libsignal test_large_signatures).
/// Verifies VXEdDSA handles 1MB messages without truncation or overflow.
#[test]
fn vxeddsa_large_message_1mb() {
    let kp = libsignal_dezire::vxeddsa::gen_keypair();
    let message = vec![0xABu8; 1024 * 1024]; // 1 MB

    let output = libsignal_dezire::vxeddsa::vxeddsa_sign(&kp.secret, &message)
        .expect("VXEdDSA sign on 1MB must succeed");
    assert_eq!(output.signature.len(), 96);

    let vrf = libsignal_dezire::vxeddsa::vxeddsa_verify(&kp.public, &message, &output.signature);
    assert!(vrf.is_some(), "VXEdDSA must verify 1MB message");

    // Flip first byte — must fail verification
    let mut tampered = message.clone();
    tampered[0] ^= 0x01;
    let vrf_bad = libsignal_dezire::vxeddsa::vxeddsa_verify(&kp.public, &tampered, &output.signature);
    assert!(vrf_bad.is_none(), "tampered 1MB message must fail verification");
}

/// Bit-flip every byte of a VXEdDSA signature — all must fail verification.
/// Extracted from libsignal test_signature (which does this for XEdDSA).
#[test]
fn vxeddsa_signature_bitflip_exhaustive() {
    let kp = libsignal_dezire::vxeddsa::gen_keypair();
    let message = b"bitflip exhaustive test";

    let output = libsignal_dezire::vxeddsa::vxeddsa_sign(&kp.secret, message)
        .expect("sign must succeed");

    for i in 0..96 {
        let mut bad_sig = output.signature;
        bad_sig[i] ^= 0x01;
        let result = libsignal_dezire::vxeddsa::vxeddsa_verify(&kp.public, message, &bad_sig);
        assert!(result.is_none(), "flipping byte {i} of signature must fail verification");
    }
}
