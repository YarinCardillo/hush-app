//! X3DH DH component interop: validates that the 4 raw Diffie-Hellman
//! outputs in X3DH (DH1..DH4) match between dezire and official libsignal
//! when given the same key material.
//!
//! NOTE: The final shared secret differs because the KDF step uses different
//! constants (SHA-512 vs SHA-256, different info strings). We only test the
//! DH layer here.

use libsignal_core::curve::{PrivateKey as OfficialPrivateKey, PublicKey as OfficialPublicKey};
use x25519_dalek::{PublicKey, StaticSecret};

fn dezire_dh(priv_key: &[u8; 32], pub_key: &[u8; 32]) -> [u8; 32] {
    let secret = StaticSecret::from(*priv_key);
    *secret.diffie_hellman(&PublicKey::from(*pub_key)).as_bytes()
}

fn official_dh(priv_key: &[u8; 32], pub_key: &[u8; 32]) -> Box<[u8]> {
    let official = OfficialPrivateKey::deserialize(priv_key).expect("deserialize");
    let official_pub = OfficialPublicKey::from_djb_public_key_bytes(pub_key).expect("parse pubkey");
    official.calculate_agreement(&official_pub).expect("agreement")
}

fn derive_pub(priv_key: &[u8; 32]) -> [u8; 32] {
    *PublicKey::from(&StaticSecret::from(*priv_key)).as_bytes()
}

#[test]
fn x3dh_dh1_ik_a_spk_b() {
    let ik_a: [u8; 32] = [0x11; 32];
    let spk_b: [u8; 32] = [0x22; 32];
    let spk_b_pub = derive_pub(&spk_b);

    assert_eq!(
        &dezire_dh(&ik_a, &spk_b_pub)[..],
        &official_dh(&ik_a, &spk_b_pub)[..],
        "DH1(IK_A, SPK_B) must match"
    );
}

#[test]
fn x3dh_dh2_ek_a_ik_b() {
    let ek_a: [u8; 32] = [0x33; 32];
    let ik_b: [u8; 32] = [0x44; 32];
    let ik_b_pub = derive_pub(&ik_b);

    assert_eq!(
        &dezire_dh(&ek_a, &ik_b_pub)[..],
        &official_dh(&ek_a, &ik_b_pub)[..],
        "DH2(EK_A, IK_B) must match"
    );
}

#[test]
fn x3dh_dh3_ek_a_spk_b() {
    let ek_a: [u8; 32] = [0x55; 32];
    let spk_b: [u8; 32] = [0x66; 32];
    let spk_b_pub = derive_pub(&spk_b);

    assert_eq!(
        &dezire_dh(&ek_a, &spk_b_pub)[..],
        &official_dh(&ek_a, &spk_b_pub)[..],
        "DH3(EK_A, SPK_B) must match"
    );
}

#[test]
fn x3dh_dh4_ek_a_opk_b() {
    let ek_a: [u8; 32] = [0x77; 32];
    let opk_b: [u8; 32] = [0x88; 32];
    let opk_b_pub = derive_pub(&opk_b);

    assert_eq!(
        &dezire_dh(&ek_a, &opk_b_pub)[..],
        &official_dh(&ek_a, &opk_b_pub)[..],
        "DH4(EK_A, OPK_B) must match"
    );
}

#[test]
fn all_four_dh_components_with_random_keys() {
    for _ in 0..20 {
        let ik_a = libsignal_dezire::vxeddsa::gen_keypair();
        let ek_a = libsignal_dezire::vxeddsa::gen_keypair();
        let ik_b = libsignal_dezire::vxeddsa::gen_keypair();
        let spk_b = libsignal_dezire::vxeddsa::gen_keypair();
        let opk_b = libsignal_dezire::vxeddsa::gen_keypair();

        let ik_b_pub: [u8; 32] = ik_b.public[1..].try_into().unwrap();
        let spk_b_pub: [u8; 32] = spk_b.public[1..].try_into().unwrap();
        let opk_b_pub: [u8; 32] = opk_b.public[1..].try_into().unwrap();

        assert_eq!(&dezire_dh(&ik_a.secret, &spk_b_pub)[..], &official_dh(&ik_a.secret, &spk_b_pub)[..], "DH1");
        assert_eq!(&dezire_dh(&ek_a.secret, &ik_b_pub)[..], &official_dh(&ek_a.secret, &ik_b_pub)[..], "DH2");
        assert_eq!(&dezire_dh(&ek_a.secret, &spk_b_pub)[..], &official_dh(&ek_a.secret, &spk_b_pub)[..], "DH3");
        assert_eq!(&dezire_dh(&ek_a.secret, &opk_b_pub)[..], &official_dh(&ek_a.secret, &opk_b_pub)[..], "DH4");
    }
}
