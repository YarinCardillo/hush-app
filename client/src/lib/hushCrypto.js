/**
 * Lazy-loaded hush-crypto WASM module.
 * Call init() before any other method (e.g. on first encrypt or after login).
 *
 * All WASM functions return structured JS objects via serde_wasm_bindgen.
 * Vec<u8> fields arrive as Uint8Array; u32/u64 fields as JS numbers.
 *
 * Exports MLS credential, KeyPackage generation, and group lifecycle operations.
 * Signal Protocol functions (generateIdentity, generatePreKeyBundle,
 * performX3DH, encrypt, decrypt) have been removed — superseded by MLS (Phase M.2+).
 *
 * NOTE: All group functions operate on groupId (channel UUID bytes), NOT groupStateBytes.
 * The WASM StorageProvider auto-persists state via window.mlsStorageBridge.
 */

let module = null;
let initPromise = null;

/**
 * Loads the WASM module. Idempotent and safe against concurrent calls.
 * @returns {Promise<void>}
 */
export async function init() {
  if (module) return;
  if (!initPromise) {
    initPromise = (async () => {
      const m = await import('../wasm/hush_crypto.js');
      await m.default();
      m.init();
      module = m;
    })();
  }
  return initPromise;
}

/**
 * Generates an MLS credential (BasicCredential + signing keypair).
 * The credential must be uploaded to /api/mls/credentials (public material only).
 * The signing private key must be stored locally in mlsStore for KeyPackage generation.
 *
 * @param {string} identity - Opaque identity string (format: "${userId}:${deviceId}")
 * @returns {Promise<{ signingPublicKey: Uint8Array, signingPrivateKey: Uint8Array, credentialBytes: Uint8Array }>}
 */
export async function generateCredential(identity) {
  await init();
  const out = module.generateCredential(identity);
  return {
    signingPublicKey: new Uint8Array(out.signingPublicKey),
    signingPrivateKey: new Uint8Array(out.signingPrivateKey),
    credentialBytes: new Uint8Array(out.credentialBytes),
  };
}

/**
 * Generates a single MLS KeyPackage for the given credential.
 * Only keyPackageBytes should be uploaded to the server.
 * privateKeyBytes must be stored locally in mlsStore keyed by hex(hashRefBytes).
 *
 * @param {Uint8Array} signingPrivateKey - From generateCredential (64 bytes: seed||public)
 * @param {Uint8Array} signingPublicKey - From generateCredential
 * @param {Uint8Array} credentialBytes - From generateCredential
 * @returns {Promise<{ keyPackageBytes: Uint8Array, privateKeyBytes: Uint8Array, hashRefBytes: Uint8Array }>}
 */
export async function generateKeyPackage(signingPrivateKey, signingPublicKey, credentialBytes) {
  await init();
  const out = module.generateKeyPackage(signingPrivateKey, signingPublicKey, credentialBytes);
  return {
    keyPackageBytes: new Uint8Array(out.keyPackageBytes),
    privateKeyBytes: new Uint8Array(out.privateKeyBytes),
    hashRefBytes: new Uint8Array(out.hashRefBytes),
  };
}

// ---------------------------------------------------------------------------
// MLS Group lifecycle (Phase M.2+)
// All functions use the WASM StorageProvider (window.mlsStorageBridge).
// Call mlsStore.preloadGroupState() before these and mlsStore.flushStorageCache() after.
// ---------------------------------------------------------------------------

/**
 * Create a new MLS group for a channel.
 * The caller becomes the group creator and initial member.
 *
 * @param {Uint8Array} channelIdBytes - Channel UUID encoded as UTF-8 bytes
 * @param {Uint8Array} sigPriv - Signing private key
 * @param {Uint8Array} sigPub - Signing public key
 * @param {Uint8Array} credBytes - Credential bytes
 * @returns {Promise<{ groupInfoBytes: Uint8Array, epoch: number }>}
 */
export async function createGroup(channelIdBytes, sigPriv, sigPub, credBytes) {
  await init();
  const out = await module.createGroup(channelIdBytes, sigPriv, sigPub, credBytes);
  return {
    groupInfoBytes: new Uint8Array(out.groupInfoBytes),
    epoch: out.epoch,
  };
}

/**
 * Join an existing MLS group via External Commit (no Welcome needed).
 * Sends a commit to the server afterwards.
 *
 * @param {Uint8Array} groupInfoBytes - Serialised GroupInfo from server
 * @param {Uint8Array} sigPriv
 * @param {Uint8Array} sigPub
 * @param {Uint8Array} credBytes
 * @returns {Promise<{ commitBytes: Uint8Array, epoch: number }>}
 */
export async function joinGroupExternal(groupInfoBytes, sigPriv, sigPub, credBytes) {
  await init();
  const out = await module.joinGroupExternal(groupInfoBytes, sigPriv, sigPub, credBytes);
  return {
    commitBytes: new Uint8Array(out.commitBytes),
    epoch: out.epoch,
  };
}

/**
 * Add one or more members to a channel group via Welcome.
 *
 * @param {Uint8Array} groupIdBytes - Channel UUID as UTF-8 bytes (group identifier)
 * @param {Uint8Array} sigPriv
 * @param {Uint8Array} sigPub
 * @param {Uint8Array} credBytes
 * @param {string} keyPackagesBytesJson - JSON array of base64-encoded KeyPackage bytes
 * @returns {Promise<{ commitBytes: Uint8Array, welcomeBytes: Uint8Array, groupInfoBytes: Uint8Array, epoch: number }>}
 */
export async function addMembers(groupIdBytes, sigPriv, sigPub, credBytes, keyPackagesBytesJson) {
  await init();
  const out = await module.addMembers(groupIdBytes, sigPriv, sigPub, credBytes, keyPackagesBytesJson);
  return {
    commitBytes: new Uint8Array(out.commitBytes),
    welcomeBytes: new Uint8Array(out.welcomeBytes),
    groupInfoBytes: new Uint8Array(out.groupInfoBytes),
    epoch: out.epoch,
  };
}

/**
 * Encrypt a plaintext message for the group (single ciphertext for all members).
 *
 * @param {Uint8Array} groupIdBytes - Channel UUID as UTF-8 bytes
 * @param {Uint8Array} sigPriv
 * @param {Uint8Array} sigPub
 * @param {Uint8Array} credBytes
 * @param {Uint8Array} plaintext - UTF-8 encoded message content
 * @returns {Promise<{ messageBytes: Uint8Array }>}
 */
export async function createMessage(groupIdBytes, sigPriv, sigPub, credBytes, plaintext) {
  await init();
  const out = await module.createMessage(groupIdBytes, sigPriv, sigPub, credBytes, plaintext);
  return {
    messageBytes: new Uint8Array(out.messageBytes),
  };
}

/**
 * Process a received MLS message (application message, commit, or proposal).
 *
 * @param {Uint8Array} groupIdBytes - Channel UUID as UTF-8 bytes
 * @param {Uint8Array} sigPriv
 * @param {Uint8Array} sigPub
 * @param {Uint8Array} credBytes
 * @param {Uint8Array} messageBytes - Raw MLS message bytes from wire
 * @returns {Promise<{ type: string, plaintext?: Uint8Array, epoch: number, senderIdentity?: string }>}
 */
export async function processMessage(groupIdBytes, sigPriv, sigPub, credBytes, messageBytes) {
  await init();
  const out = await module.processMessage(groupIdBytes, sigPriv, sigPub, credBytes, messageBytes);
  return {
    type: out.type,
    plaintext: out.plaintext != null ? new Uint8Array(out.plaintext) : undefined,
    epoch: out.epoch,
    senderIdentity: out.senderIdentity,
  };
}

/**
 * Remove one or more members from the channel group.
 *
 * @param {Uint8Array} groupIdBytes
 * @param {Uint8Array} sigPriv
 * @param {Uint8Array} sigPub
 * @param {Uint8Array} credBytes
 * @param {string} memberIdentitiesJson - JSON array of identity strings
 * @returns {Promise<{ commitBytes: Uint8Array, groupInfoBytes: Uint8Array, epoch: number }>}
 */
export async function removeMembers(groupIdBytes, sigPriv, sigPub, credBytes, memberIdentitiesJson) {
  await init();
  const out = await module.removeMembers(groupIdBytes, sigPriv, sigPub, credBytes, memberIdentitiesJson);
  return {
    commitBytes: new Uint8Array(out.commitBytes),
    groupInfoBytes: new Uint8Array(out.groupInfoBytes),
    epoch: out.epoch,
  };
}

/**
 * Perform a self-update to rotate leaf node key material (forward secrecy).
 *
 * @param {Uint8Array} groupIdBytes
 * @param {Uint8Array} sigPriv
 * @param {Uint8Array} sigPub
 * @param {Uint8Array} credBytes
 * @returns {Promise<{ commitBytes: Uint8Array, groupInfoBytes: Uint8Array, epoch: number }>}
 */
export async function selfUpdate(groupIdBytes, sigPriv, sigPub, credBytes) {
  await init();
  const out = await module.selfUpdate(groupIdBytes, sigPriv, sigPub, credBytes);
  return {
    commitBytes: new Uint8Array(out.commitBytes),
    groupInfoBytes: new Uint8Array(out.groupInfoBytes),
    epoch: out.epoch,
  };
}

/**
 * Send a leave proposal for the channel group.
 * The server broadcasts mls.add_request so an online member commits the removal.
 *
 * @param {Uint8Array} groupIdBytes
 * @param {Uint8Array} sigPriv
 * @param {Uint8Array} sigPub
 * @param {Uint8Array} credBytes
 * @returns {Promise<{ proposalBytes: Uint8Array }>}
 */
export async function leaveGroup(groupIdBytes, sigPriv, sigPub, credBytes) {
  await init();
  const out = await module.leaveGroup(groupIdBytes, sigPriv, sigPub, credBytes);
  return {
    proposalBytes: new Uint8Array(out.proposalBytes),
  };
}

/**
 * Merge a pending commit into the group state (after sending a commit to the server).
 *
 * @param {Uint8Array} groupIdBytes
 * @param {Uint8Array} sigPriv
 * @param {Uint8Array} sigPub
 * @param {Uint8Array} credBytes
 * @returns {Promise<{ groupInfoBytes: Uint8Array, epoch: number }>}
 */
export async function mergePendingCommit(groupIdBytes, sigPriv, sigPub, credBytes) {
  await init();
  const out = await module.mergePendingCommit(groupIdBytes, sigPriv, sigPub, credBytes);
  return {
    groupInfoBytes: new Uint8Array(out.groupInfoBytes),
    epoch: out.epoch,
  };
}

/**
 * Export the current GroupInfo for a channel group.
 * Used to update the server's stored GroupInfo after epoch advances.
 *
 * @param {Uint8Array} groupIdBytes
 * @param {Uint8Array} sigPriv
 * @param {Uint8Array} sigPub
 * @param {Uint8Array} credBytes
 * @returns {Promise<{ groupInfoBytes: Uint8Array }>}
 */
export async function exportGroupInfoBytes(groupIdBytes, sigPriv, sigPub, credBytes) {
  await init();
  const out = await module.exportGroupInfo(groupIdBytes, sigPriv, sigPub, credBytes);
  return {
    groupInfoBytes: new Uint8Array(out.groupInfoBytes),
  };
}

/**
 * Export a 32-byte voice frame key from the current MLS epoch.
 * Uses MLS export_secret with label "hush-voice-frame-key" (RFC 9420 §8.4).
 * Pure derivation — no group state mutation.
 *
 * @param {Uint8Array} groupIdBytes - Voice group ID bytes (e.g. "voice:{channelId}" as UTF-8)
 * @param {Uint8Array} sigPriv - Signing private key
 * @param {Uint8Array} sigPub - Signing public key
 * @param {Uint8Array} credBytes - Credential bytes
 * @returns {Promise<{ frameKeyBytes: Uint8Array, epoch: number }>}
 */
export async function exportVoiceFrameKey(groupIdBytes, sigPriv, sigPub, credBytes) {
  await init();
  const out = await module.exportVoiceFrameKey(groupIdBytes, sigPriv, sigPub, credBytes);
  return {
    frameKeyBytes: new Uint8Array(out.frameKeyBytes),
    epoch: out.epoch,
  };
}
