/**
 * Key upload after auth: ensures identity exists, persists private keys locally,
 * and uploads public keys to the server.
 *
 * Pure logic; all deps (store, crypto, uploadKeys) are passed in for testability.
 *
 * @param {string} token - JWT
 * @param {string} userId - User UUID
 * @param {string} deviceId - Stable device ID
 * @param {{ store: object, crypto: object, uploadKeys: (token: string, body: object) => Promise<void> }} deps
 * @returns {Promise<void>}
 */
const NUM_ONE_TIME_PRE_KEYS = 100;
const SIGNED_PRE_KEY_ID = 1;

export async function uploadKeysAfterAuth(token, userId, deviceId, deps) {
  const { store, crypto, uploadKeys: doUploadKeys } = deps;
  const db = await store.openStore(userId, deviceId);
  let identity = await store.getIdentity(db);
  if (!identity) {
    await crypto.init();
    const gen = await crypto.generateIdentity();
    identity = { publicKey: gen.publicKey, privateKey: gen.privateKey };
    await store.setIdentity(db, identity);
    await store.setRegistrationId(db, gen.registrationId);
    const bundle = await crypto.generatePreKeyBundle(
      gen.publicKey,
      gen.privateKey,
      gen.registrationId,
      NUM_ONE_TIME_PRE_KEYS,
    );

    // Persist SPK private key locally (needed for X3DH responder flow).
    await store.setSignedPreKey(db, {
      id: SIGNED_PRE_KEY_ID,
      publicKey: Array.from(bundle.signed_pre_key ?? bundle.signedPreKey ?? []),
      privateKey: Array.from(bundle.signed_pre_key_private ?? bundle.signedPreKeyPrivate ?? []),
      signature: Array.from(bundle.signed_pre_key_signature ?? bundle.signedPreKeySignature ?? []),
    });

    // Persist OPK private keys locally (deleted after X3DH consumption).
    const otpks = bundle.one_time_pre_keys ?? bundle.oneTimePreKeys ?? [];
    for (const k of otpks) {
      await store.setOneTimePreKey(db, {
        keyId: k.key_id ?? k.keyId,
        publicKey: Array.from(k.public_key ?? k.publicKey ?? []),
        privateKey: Array.from(k.private_key ?? k.privateKey ?? []),
      });
    }

    // Upload only PUBLIC keys to the server.
    await doUploadKeys(token, {
      deviceId,
      identityKey: Array.from(bundle.identity_key ?? bundle.identityKey ?? []),
      signedPreKey: Array.from(bundle.signed_pre_key ?? bundle.signedPreKey ?? []),
      signedPreKeySignature: Array.from(bundle.signed_pre_key_signature ?? bundle.signedPreKeySignature ?? []),
      registrationId: bundle.registration_id ?? bundle.registrationId,
      oneTimePreKeys: otpks.map((k) => ({
        keyId: k.key_id ?? k.keyId,
        publicKey: Array.from(k.public_key ?? k.publicKey ?? []),
      })),
    });
  }
}
