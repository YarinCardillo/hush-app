/**
 * Key upload after auth: ensures identity exists and uploads to server.
 * Pure logic; all deps (store, crypto, uploadKeys) are passed in for testability.
 * Use from api.js with real deps for production.
 *
 * @param {string} token - JWT
 * @param {string} userId - User UUID
 * @param {string} deviceId - Stable device ID
 * @param {{ store: { openStore: (u: string, d: string) => Promise<unknown>, getIdentity: (db: unknown) => Promise<{ publicKey: unknown, privateKey: unknown }|null>, setIdentity: (db: unknown, id: object) => Promise<void>, setRegistrationId: (db: unknown, id: number) => Promise<void> }, crypto: { init: () => Promise<void>, generateIdentity: () => Promise<{ publicKey: unknown, privateKey: unknown, registrationId: number }>, generatePreKeyBundle: (...args: unknown[]) => Promise<object> }, uploadKeys: (token: string, body: object) => Promise<void> }} deps
 * @returns {Promise<void>}
 */
const NUM_ONE_TIME_PRE_KEYS = 100;

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
    await doUploadKeys(token, {
      deviceId,
      identityKey: Array.from(bundle.identity_key ?? bundle.identityKey ?? []),
      signedPreKey: Array.from(bundle.signed_pre_key ?? bundle.signedPreKey ?? []),
      signedPreKeySignature: Array.from(bundle.signed_pre_key_signature ?? bundle.signedPreKeySignature ?? []),
      registrationId: bundle.registration_id ?? bundle.registrationId,
      oneTimePreKeys: (bundle.one_time_pre_keys ?? bundle.oneTimePreKeys ?? []).map((k) => ({
        keyId: k.key_id ?? k.keyId,
        publicKey: Array.from(k.public_key ?? k.publicKey ?? []),
      })),
    });
  }
}
