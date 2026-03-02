//! DH agreement interop: validates that X25519 Diffie-Hellman produces
//! identical shared secrets across both libraries.

use libsignal_core::curve::{PrivateKey as OfficialPrivateKey, PublicKey as OfficialPublicKey};
use x25519_dalek::{PublicKey, StaticSecret};

#[test]
fn cross_library_dh_agreement() {
    let alice_kp = libsignal_dezire::vxeddsa::gen_keypair();
    let bob_kp = libsignal_dezire::vxeddsa::gen_keypair();

    // Alice (dezire/x25519-dalek) computes shared secret with Bob's public key
    let bob_pub_32: [u8; 32] = bob_kp.public[1..].try_into().unwrap();
    let alice_secret = StaticSecret::from(alice_kp.secret);
    let shared_alice = alice_secret.diffie_hellman(&PublicKey::from(bob_pub_32));

    // Alice (official) computes same DH
    let alice_official = OfficialPrivateKey::deserialize(&alice_kp.secret).expect("deserialize");
    let bob_official_pub = OfficialPublicKey::deserialize(&bob_kp.public).expect("parse pubkey");
    let shared_official = alice_official.calculate_agreement(&bob_official_pub).expect("agreement");

    assert_eq!(
        shared_alice.as_bytes()[..],
        shared_official[..],
        "cross-library DH must produce identical shared secret"
    );
}

#[test]
fn bidirectional_dh_with_50_random_pairs() {
    for _ in 0..50 {
        let alice_kp = libsignal_dezire::vxeddsa::gen_keypair();
        let bob_kp = libsignal_dezire::vxeddsa::gen_keypair();

        // dezire side
        let alice_secret = StaticSecret::from(alice_kp.secret);
        let bob_pub_32: [u8; 32] = bob_kp.public[1..].try_into().unwrap();
        let shared_dezire = alice_secret.diffie_hellman(&PublicKey::from(bob_pub_32));

        // official side
        let alice_official = OfficialPrivateKey::deserialize(&alice_kp.secret).expect("deserialize");
        let bob_official_pub = OfficialPublicKey::deserialize(&bob_kp.public).expect("parse pubkey");
        let shared_official = alice_official.calculate_agreement(&bob_official_pub).expect("agreement");

        assert_eq!(shared_dezire.as_bytes()[..], shared_official[..]);
    }
}

#[test]
fn fixed_key_dh_matches_known_vector() {
    let alice_private: [u8; 32] = [
        0xc8, 0x06, 0x43, 0x9d, 0xc9, 0xd2, 0xc4, 0x76, 0xff, 0xed, 0x8f, 0x25, 0x80, 0xc0,
        0x88, 0x8d, 0x58, 0xab, 0x40, 0x6b, 0xf7, 0xae, 0x36, 0x98, 0x87, 0x90, 0x21, 0xb9,
        0x6b, 0xb4, 0xbf, 0x59,
    ];
    let bob_public: [u8; 32] = [
        0x65, 0x36, 0x14, 0x99, 0x3d, 0x2b, 0x15, 0xee, 0x9e, 0x5f, 0xd3, 0xd8, 0x6c, 0xe7,
        0x19, 0xef, 0x4e, 0xc1, 0xda, 0xae, 0x18, 0x86, 0xa8, 0x7b, 0x3f, 0x5f, 0xa9, 0x56,
        0x5a, 0x27, 0xa2, 0x2f,
    ];
    let expected_shared: [u8; 32] = [
        0x32, 0x5f, 0x23, 0x93, 0x28, 0x94, 0x1c, 0xed, 0x6e, 0x67, 0x3b, 0x86, 0xba, 0x41,
        0x01, 0x74, 0x48, 0xe9, 0x9b, 0x64, 0x9a, 0x9c, 0x38, 0x06, 0xc1, 0xdd, 0x7c, 0xa4,
        0xc4, 0x77, 0xe6, 0x29,
    ];

    // dezire side
    let dezire_secret = StaticSecret::from(alice_private);
    let dezire_shared = dezire_secret.diffie_hellman(&PublicKey::from(bob_public));

    // official side
    let official = OfficialPrivateKey::deserialize(&alice_private).expect("deserialize");
    let bob_official_pub = OfficialPublicKey::from_djb_public_key_bytes(&bob_public).expect("parse");
    let official_shared = official.calculate_agreement(&bob_official_pub).expect("agreement");

    assert_eq!(dezire_shared.as_bytes(), &expected_shared);
    assert_eq!(&official_shared[..], &expected_shared[..]);
}
