/**
 * MLS group lifecycle manager.
 *
 * This module wraps the StorageProvider-backed WASM calls (hushCrypto.js) with:
 *   - preload: load IDB StorageProvider state into sync cache before WASM calls
 *   - flush: persist updated sync cache back to IDB after WASM calls
 *   - server round-trips: POST commits, GET GroupInfo, etc. via api.js
 *
 * All functions are stateless — all state lives in IndexedDB (via mlsStore/StorageProvider).
 * Dependencies are injected via a `deps` object for testability.
 *
 * deps shape:
 *   { db: IDBDatabase, credential: { signingPrivateKey, signingPublicKey, credentialBytes },
 *     token: string, mlsStore, hushCrypto, api, wsClient? }
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encodes a channel UUID to the UTF-8 bytes used as the MLS group ID.
 * @param {string} channelId
 * @returns {Uint8Array}
 */
function channelIdToBytes(channelId) {
  return new TextEncoder().encode(channelId);
}

/**
 * Encodes a channel UUID to the UTF-8 bytes used as the voice MLS group ID.
 * The "voice:" prefix namespaces voice groups away from text channel groups
 * in StorageProvider/IndexedDB to prevent key collisions.
 *
 * @param {string} channelId
 * @returns {Uint8Array}
 */
export function voiceChannelIdToBytes(channelId) {
  return new TextEncoder().encode(`voice:${channelId}`);
}

/**
 * Converts a Uint8Array to a base64 string.
 * @param {Uint8Array} u8
 * @returns {string}
 */
function toBase64(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

/**
 * Converts a base64 string to a Uint8Array.
 * @param {string} b64
 * @returns {Uint8Array}
 */
function fromBase64(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/**
 * Extracts credential fields from a deps object.
 * Throws if no credential is available.
 * @param {object} deps
 * @returns {{ sigPriv: Uint8Array, sigPub: Uint8Array, credBytes: Uint8Array }}
 */
function getCredFields(deps) {
  const cred = deps.credential;
  if (!cred) throw new Error('[mlsGroup] No credential available — run uploadKeyPackagesAfterAuth first');
  return {
    sigPriv: cred.signingPrivateKey,
    sigPub: cred.signingPublicKey,
    credBytes: cred.credentialBytes,
  };
}

// ---------------------------------------------------------------------------
// Group creation / join
// ---------------------------------------------------------------------------

/**
 * Create a new MLS group for a channel.
 * Called when the current user creates the channel (they are the initial member).
 * Stores GroupInfo on the server and records the epoch locally.
 *
 * @param {object} deps
 * @param {string} channelId
 * @returns {Promise<{ groupInfoBytes: Uint8Array, epoch: number }>}
 */
export async function createChannelGroup(deps, channelId) {
  const { db, token, mlsStore, hushCrypto, api } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const channelIdBytes = channelIdToBytes(channelId);

  await mlsStore.preloadGroupState(db);
  const result = await hushCrypto.createGroup(channelIdBytes, sigPriv, sigPub, credBytes);
  await mlsStore.flushStorageCache(db);

  if (!result.groupInfoBytes || result.groupInfoBytes.length === 0) {
    throw new Error(
      `[mlsGroup] createGroup returned empty groupInfoBytes for channel ${channelId}` +
      ` (type=${typeof result.groupInfoBytes}, epoch=${result.epoch})`
    );
  }

  await api.putMLSGroupInfo(token, channelId, toBase64(result.groupInfoBytes), result.epoch);
  await mlsStore.setGroupEpoch(db, channelId, result.epoch);

  return { groupInfoBytes: result.groupInfoBytes, epoch: result.epoch };
}

/**
 * Join an existing MLS group via External Commit (no coordinator needed).
 * Posts the commit to the server so existing members can advance their epoch.
 * Returns silently if no GroupInfo exists on the server (group not yet created).
 *
 * @param {object} deps
 * @param {string} channelId
 * @returns {Promise<void>}
 */
export async function joinChannelGroup(deps, channelId) {
  const { db, token, mlsStore, hushCrypto, api } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const channelIdBytes = channelIdToBytes(channelId);

  const serverInfo = await api.getMLSGroupInfo(token, channelId);
  if (!serverInfo?.groupInfo) return; // No group yet — channel was just created.

  const groupInfoBytes = fromBase64(serverInfo.groupInfo);

  await mlsStore.preloadGroupState(db);
  const joinResult = await hushCrypto.joinGroupExternal(groupInfoBytes, sigPriv, sigPub, credBytes);
  await mlsStore.flushStorageCache(db);

  // Export updated GroupInfo after External Commit so new joiners see the latest state.
  const infoResult = await hushCrypto.exportGroupInfoBytes(channelIdBytes, sigPriv, sigPub, credBytes);
  await mlsStore.flushStorageCache(db);

  await api.postMLSCommit(
    token,
    channelId,
    toBase64(joinResult.commitBytes),
    toBase64(infoResult.groupInfoBytes),
    joinResult.epoch
  );
  await mlsStore.setGroupEpoch(db, channelId, joinResult.epoch);
}

/**
 * Join an existing channel group, or create it if no group exists on the server.
 * Used by joinMissingGroups so template channels (created server-side with no MLS
 * group) get their group created by the first member who enters the guild.
 *
 * @param {object} deps
 * @param {string} channelId
 * @returns {Promise<void>}
 */
export async function joinOrCreateChannelGroup(deps, channelId) {
  const { token, api } = deps;
  const serverInfo = await api.getMLSGroupInfo(token, channelId);
  if (serverInfo?.groupInfo) {
    // Group exists on server — join via External Commit.
    await joinChannelGroup(deps, channelId);
  } else {
    // No group on server — create it (we are the first member to enter).
    await createChannelGroup(deps, channelId);
  }
}

/**
 * Join ALL text channel groups for a guild in sequence.
 * Sequential (not parallel) to avoid KeyPackage exhaustion race conditions.
 *
 * @param {object} deps
 * @param {string[]} channelIds
 * @returns {Promise<void>}
 */
export async function joinAllChannelGroups(deps, channelIds) {
  for (const channelId of channelIds) {
    try {
      await joinChannelGroup(deps, channelId);
    } catch (err) {
      console.warn('[mlsGroup] Failed to join channel group:', channelId, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Member management
// ---------------------------------------------------------------------------

/**
 * Add a member to the channel group via Welcome (called on mls.add_request).
 * The caller posts the resulting commit to the server.
 *
 * @param {object} deps
 * @param {string} channelId
 * @param {Uint8Array} keyPackageBytes - KeyPackage from the new member
 * @returns {Promise<{ welcomeBytes: Uint8Array }>}
 */
export async function addMemberToChannel(deps, channelId, keyPackageBytes) {
  const { db, token, mlsStore, hushCrypto, api } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const channelIdBytes = channelIdToBytes(channelId);
  const keyPackagesBytesJson = JSON.stringify([toBase64(keyPackageBytes)]);

  await mlsStore.preloadGroupState(db);
  const result = await hushCrypto.addMembers(channelIdBytes, sigPriv, sigPub, credBytes, keyPackagesBytesJson);
  await mlsStore.flushStorageCache(db);

  await api.postMLSCommit(
    token,
    channelId,
    toBase64(result.commitBytes),
    toBase64(result.groupInfoBytes),
    result.epoch
  );
  await mlsStore.setGroupEpoch(db, channelId, result.epoch);

  return { welcomeBytes: result.welcomeBytes };
}

/**
 * Remove a member from the channel group (called when handling mls.add_request with action "remove").
 *
 * @param {object} deps
 * @param {string} channelId
 * @param {string} memberIdentity - Identity string of the member to remove
 * @returns {Promise<void>}
 */
export async function removeMemberFromChannel(deps, channelId, memberIdentity) {
  const { db, token, mlsStore, hushCrypto, api } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const channelIdBytes = channelIdToBytes(channelId);
  const memberIdentitiesJson = JSON.stringify([memberIdentity]);

  await mlsStore.preloadGroupState(db);
  const result = await hushCrypto.removeMembers(channelIdBytes, sigPriv, sigPub, credBytes, memberIdentitiesJson);
  await mlsStore.flushStorageCache(db);

  await api.postMLSCommit(
    token,
    channelId,
    toBase64(result.commitBytes),
    toBase64(result.groupInfoBytes),
    result.epoch
  );
  await mlsStore.setGroupEpoch(db, channelId, result.epoch);
}

// ---------------------------------------------------------------------------
// Message encryption / decryption
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext message for a channel group.
 * Stores plaintext in local cache BEFORE encrypting so self-sent messages
 * can be recovered when the self-echo arrives.
 *
 * @param {object} deps
 * @param {string} channelId
 * @param {string} plaintext
 * @returns {Promise<{ messageBytes: Uint8Array, localId: string }>}
 */
export async function encryptMessage(deps, channelId, plaintext) {
  const { db, mlsStore, hushCrypto } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const channelIdBytes = channelIdToBytes(channelId);
  const localId = crypto.randomUUID();

  // Store plaintext in local cache BEFORE encrypting.
  await mlsStore.setLocalPlaintext(db, localId, { plaintext, timestamp: Date.now() });

  await mlsStore.preloadGroupState(db);
  const result = await hushCrypto.createMessage(
    channelIdBytes,
    sigPriv,
    sigPub,
    credBytes,
    new TextEncoder().encode(plaintext)
  );
  await mlsStore.flushStorageCache(db);

  return { messageBytes: result.messageBytes, localId };
}

/**
 * Decrypt a received MLS message (application, commit, or proposal).
 * Returns decrypted plaintext for application messages.
 * Returns null plaintext for commits/proposals (state-only messages).
 *
 * @param {object} deps
 * @param {string} channelId
 * @param {Uint8Array} messageBytes
 * @returns {Promise<{ plaintext: string|null, senderIdentity?: string, type: string, epoch: number }>}
 */
export async function decryptMessage(deps, channelId, messageBytes) {
  const { db, mlsStore, hushCrypto } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const channelIdBytes = channelIdToBytes(channelId);

  await mlsStore.preloadGroupState(db);
  const result = await hushCrypto.processMessage(channelIdBytes, sigPriv, sigPub, credBytes, messageBytes);
  await mlsStore.flushStorageCache(db);

  if (result.type === 'application' && result.plaintext != null) {
    const text = new TextDecoder().decode(result.plaintext);
    return { plaintext: text, senderIdentity: result.senderIdentity, type: result.type, epoch: result.epoch };
  }

  // Commit or proposal — epoch may have advanced.
  if (result.type === 'commit') {
    await mlsStore.setGroupEpoch(db, channelId, result.epoch);
  }

  return { plaintext: null, type: result.type, epoch: result.epoch };
}

// ---------------------------------------------------------------------------
// Commit processing (from WS events)
// ---------------------------------------------------------------------------

/**
 * Process a received MLS Commit (from mls.commit WS event).
 * Advances the local group epoch and persists the updated state.
 *
 * @param {object} deps
 * @param {string} channelId
 * @param {Uint8Array} commitBytes
 * @returns {Promise<void>}
 */
export async function processCommit(deps, channelId, commitBytes) {
  const { db, mlsStore, hushCrypto } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const channelIdBytes = channelIdToBytes(channelId);

  await mlsStore.preloadGroupState(db);
  const result = await hushCrypto.processMessage(channelIdBytes, sigPriv, sigPub, credBytes, commitBytes);
  await mlsStore.flushStorageCache(db);

  if (result.epoch != null) {
    await mlsStore.setGroupEpoch(db, channelId, result.epoch);
  }
}

/**
 * Catch up on missed Commits after a reconnect.
 * Fetches commits since the last known epoch and replays them sequentially.
 * If too many commits are missed (>= 1000), re-joins the group from scratch.
 *
 * @param {object} deps
 * @param {string} channelId
 * @returns {Promise<void>}
 */
export async function catchupCommits(deps, channelId) {
  const { db, token, mlsStore, api } = deps;

  const lastEpoch = (await mlsStore.getGroupEpoch(db, channelId)) ?? 0;
  const { commits } = await api.getMLSCommitsSinceEpoch(token, channelId, lastEpoch);

  if (!commits?.length) return;

  // Too many missed commits — epoch gap too large to replay safely; re-join.
  if (commits.length >= 1000) {
    console.warn('[mlsGroup] Epoch gap too large, re-joining group for channel', channelId);
    await joinChannelGroup(deps, channelId);
    return;
  }

  for (const commit of commits) {
    try {
      await processCommit(deps, channelId, fromBase64(commit.commitBytes));
    } catch (err) {
      console.warn('[mlsGroup] Failed to process catchup commit at epoch', commit.epoch, err);
      // If a single commit fails, try to re-join rather than leave state inconsistent.
      await joinChannelGroup(deps, channelId);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Leave / cleanup
// ---------------------------------------------------------------------------

/**
 * Leave a channel's MLS group (self-remove via leave proposal).
 * Sends the proposal to the server via WS so online members commit the removal.
 * Deletes local group state after sending.
 *
 * @param {object} deps - Must include wsClient
 * @param {string} channelId
 * @returns {Promise<void>}
 */
export async function leaveChannelGroup(deps, channelId) {
  const { db, mlsStore, hushCrypto, wsClient } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const channelIdBytes = channelIdToBytes(channelId);

  try {
    await mlsStore.preloadGroupState(db);
    const result = await hushCrypto.leaveGroup(channelIdBytes, sigPriv, sigPub, credBytes);
    await mlsStore.flushStorageCache(db);

    if (wsClient) {
      wsClient.send('mls.leave_proposal', {
        channel_id: channelId,
        proposal_bytes: toBase64(result.proposalBytes),
      });
    }
  } catch (err) {
    console.warn('[mlsGroup] leaveGroup WASM failed (continuing with local cleanup):', err);
  }

  await mlsStore.deleteGroupEpoch(db, channelId);
}

/**
 * Leave ALL channel groups for a guild (used on kick/ban/leave).
 * For kicked/banned members, no proposals are needed — just clean up local state.
 *
 * @param {object} deps
 * @param {string[]} channelIds
 * @returns {Promise<void>}
 */
export async function leaveAllChannelGroups(deps, channelIds) {
  const { db, mlsStore } = deps;
  for (const channelId of channelIds) {
    try {
      await mlsStore.deleteGroupEpoch(db, channelId);
    } catch (err) {
      console.warn('[mlsGroup] Failed to delete group epoch for channel', channelId, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Self-update (forward secrecy)
// ---------------------------------------------------------------------------

/**
 * Perform a self-update to rotate leaf node key material.
 * Should be called periodically (24h cadence) per CONTEXT.md.
 *
 * @param {object} deps
 * @param {string} channelId
 * @returns {Promise<void>}
 */
export async function performSelfUpdate(deps, channelId) {
  const { db, token, mlsStore, hushCrypto, api } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const channelIdBytes = channelIdToBytes(channelId);

  await mlsStore.preloadGroupState(db);
  const result = await hushCrypto.selfUpdate(channelIdBytes, sigPriv, sigPub, credBytes);
  await mlsStore.flushStorageCache(db);

  await api.postMLSCommit(
    token,
    channelId,
    toBase64(result.commitBytes),
    toBase64(result.groupInfoBytes),
    result.epoch
  );

  // Merge the pending commit into the group state.
  await mlsStore.preloadGroupState(db);
  const mergeResult = await hushCrypto.mergePendingCommit(channelIdBytes, sigPriv, sigPub, credBytes);
  await mlsStore.flushStorageCache(db);
  await mlsStore.setGroupEpoch(db, channelId, mergeResult.epoch);
}

// ---------------------------------------------------------------------------
// Guild metadata group lifecycle
// Guild metadata groups use the guild UUID directly as the group ID.
// They are created by the guild owner, joined by new members via External Commit,
// and used to derive the symmetric key for encrypting guild/channel names.
// ---------------------------------------------------------------------------

/**
 * Encodes a guild UUID to the UTF-8 bytes used as the guild metadata MLS group ID.
 * No prefix — guild UUID is used directly.
 *
 * @param {string} guildId
 * @returns {Uint8Array}
 */
export function guildMetadataIdToBytes(guildId) {
  return new TextEncoder().encode(guildId);
}

/**
 * Create a new MLS group for guild metadata.
 * Called by the guild creator (the initial single member).
 * Stores GroupInfo on the server for subsequent members to join.
 *
 * @param {object} deps
 * @param {string} guildId
 * @returns {Promise<{ groupInfoBytes: Uint8Array, epoch: number }>}
 */
export async function createGuildMetadataGroup(deps, guildId) {
  const { db, token, mlsStore, hushCrypto, api } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const groupIdBytes = guildMetadataIdToBytes(guildId);

  await mlsStore.preloadGroupState(db);
  const result = await hushCrypto.createGroup(groupIdBytes, sigPriv, sigPub, credBytes);
  await mlsStore.flushStorageCache(db);

  if (!result.groupInfoBytes || result.groupInfoBytes.length === 0) {
    throw new Error(
      `[mlsGroup] createGroup returned empty groupInfoBytes for guild ${guildId}` +
      ` (type=${typeof result.groupInfoBytes}, epoch=${result.epoch})`
    );
  }

  await api.putGuildMetadataGroupInfo(token, guildId, toBase64(result.groupInfoBytes), result.epoch);
  await mlsStore.setGroupEpoch(db, `guild-meta:${guildId}`, result.epoch);

  return { groupInfoBytes: result.groupInfoBytes, epoch: result.epoch };
}

/**
 * Join an existing guild metadata MLS group via External Commit.
 * Called by new members when they join a guild.
 * Returns silently if no GroupInfo exists on the server (guild metadata group not yet created).
 *
 * @param {object} deps
 * @param {string} guildId
 * @returns {Promise<void>}
 */
export async function joinGuildMetadataGroup(deps, guildId) {
  const { db, token, mlsStore, hushCrypto, api } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const groupIdBytes = guildMetadataIdToBytes(guildId);

  const serverInfo = await api.getGuildMetadataGroupInfo(token, guildId);
  if (!serverInfo?.groupInfo) return; // No metadata group yet — skip silently.

  const groupInfoBytes = fromBase64(serverInfo.groupInfo);

  await mlsStore.preloadGroupState(db);
  const joinResult = await hushCrypto.joinGroupExternal(groupInfoBytes, sigPriv, sigPub, credBytes);
  await mlsStore.flushStorageCache(db);

  // Export updated GroupInfo after External Commit.
  const infoResult = await hushCrypto.exportGroupInfoBytes(groupIdBytes, sigPriv, sigPub, credBytes);
  await mlsStore.flushStorageCache(db);

  // Upload the commit and updated GroupInfo so subsequent joiners see the latest epoch.
  await api.putGuildMetadataGroupInfo(token, guildId, toBase64(infoResult.groupInfoBytes), joinResult.epoch);
  await mlsStore.setGroupEpoch(db, `guild-meta:${guildId}`, joinResult.epoch);
}

/**
 * Export the 32-byte AES-256-GCM metadata key from the guild MLS group.
 * Read-only — does not mutate group state.
 *
 * @param {object} deps
 * @param {string} guildId
 * @returns {Promise<{ metadataKeyBytes: Uint8Array, epoch: number }>}
 */
export async function exportGuildMetadataKey(deps, guildId) {
  const { db, mlsStore, hushCrypto } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const groupIdBytes = guildMetadataIdToBytes(guildId);

  await mlsStore.preloadGroupState(db);
  const result = await hushCrypto.exportMetadataKey(groupIdBytes, sigPriv, sigPub, credBytes);
  // No flush — export_secret is read-only (same pattern as exportVoiceFrameKey).

  return { metadataKeyBytes: result.metadataKeyBytes, epoch: result.epoch };
}

/**
 * Remove local guild metadata MLS group state (called when leaving a guild).
 * Does NOT send a leave proposal — the server handles epoch cleanup.
 *
 * @param {object} deps
 * @param {string} guildId
 * @returns {Promise<void>}
 */
export async function leaveGuildMetadataGroup(deps, guildId) {
  const { db, mlsStore } = deps;
  await mlsStore.deleteGroupEpoch(db, `guild-meta:${guildId}`);
}

// ---------------------------------------------------------------------------
// Voice group lifecycle
// Voice groups are independent of text channel groups. They use the same MLS
// group machinery but with "voice:{channelId}" as the group ID and voice-specific
// API endpoints (?type=voice). Local state is destroyed when leaving voice.
// ---------------------------------------------------------------------------

/**
 * Create a new MLS voice group for a channel.
 * Called by the first participant entering a voice channel.
 * Stores GroupInfo on the server for subsequent joiners.
 *
 * @param {object} deps
 * @param {string} channelId
 * @returns {Promise<{ epoch: number }>}
 */
export async function createVoiceGroup(deps, channelId) {
  const { db, token, mlsStore, hushCrypto, api } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const groupIdBytes = voiceChannelIdToBytes(channelId);

  await mlsStore.preloadGroupState(db);
  const result = await hushCrypto.createGroup(groupIdBytes, sigPriv, sigPub, credBytes);
  await mlsStore.flushStorageCache(db);

  if (!result.groupInfoBytes || result.groupInfoBytes.length === 0) {
    throw new Error(
      `[mlsGroup] createGroup returned empty groupInfoBytes for voice:${channelId}` +
      ` (type=${typeof result.groupInfoBytes}, epoch=${result.epoch})`
    );
  }

  await api.putMLSVoiceGroupInfo(token, channelId, toBase64(result.groupInfoBytes), result.epoch);
  await mlsStore.setGroupEpoch(db, `voice:${channelId}`, result.epoch);

  return { epoch: result.epoch };
}

/**
 * Join an existing voice MLS group via External Commit.
 * Called by subsequent participants entering a voice channel.
 * Posts the commit to the server so existing members can advance their epoch.
 *
 * @param {object} deps
 * @param {string} channelId
 * @returns {Promise<{ epoch: number }>}
 */
export async function joinVoiceGroup(deps, channelId) {
  const { db, token, mlsStore, hushCrypto, api } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const groupIdBytes = voiceChannelIdToBytes(channelId);

  const serverInfo = await api.getMLSVoiceGroupInfo(token, channelId);
  if (!serverInfo?.groupInfo) {
    // No voice group yet — become the first participant.
    return createVoiceGroup(deps, channelId);
  }

  const groupInfoBytes = fromBase64(serverInfo.groupInfo);

  await mlsStore.preloadGroupState(db);
  const joinResult = await hushCrypto.joinGroupExternal(groupInfoBytes, sigPriv, sigPub, credBytes);
  await mlsStore.flushStorageCache(db);

  // POST the External Commit so existing members advance their epoch.
  await api.postMLSVoiceCommit(
    token,
    channelId,
    toBase64(joinResult.commitBytes),
    joinResult.epoch,
  );

  // Merge the pending commit to obtain the updated GroupInfo.
  await mlsStore.preloadGroupState(db);
  const mergeResult = await hushCrypto.mergePendingCommit(groupIdBytes, sigPriv, sigPub, credBytes);
  await mlsStore.flushStorageCache(db);

  // Update GroupInfo on server so the next joiner sees the latest state.
  await api.putMLSVoiceGroupInfo(
    token,
    channelId,
    toBase64(mergeResult.groupInfoBytes),
    mergeResult.epoch,
  );
  await mlsStore.setGroupEpoch(db, `voice:${channelId}`, mergeResult.epoch);

  return { epoch: mergeResult.epoch };
}

/**
 * Export a 32-byte voice frame key from the current epoch.
 * Read-only — does not mutate group state.
 *
 * @param {object} deps
 * @param {string} channelId
 * @returns {Promise<{ frameKeyBytes: Uint8Array, epoch: number }>}
 */
export async function exportVoiceFrameKey(deps, channelId) {
  const { db, mlsStore, hushCrypto } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const groupIdBytes = voiceChannelIdToBytes(channelId);

  await mlsStore.preloadGroupState(db);
  const result = await hushCrypto.exportVoiceFrameKey(groupIdBytes, sigPriv, sigPub, credBytes);
  // No flush — export_secret is read-only (no state mutation).

  return { frameKeyBytes: result.frameKeyBytes, epoch: result.epoch };
}

/**
 * Process a received MLS commit for the voice group (from mls.commit WS event with group_type=voice).
 * Advances the local voice group epoch and persists the updated state.
 *
 * @param {object} deps
 * @param {string} channelId
 * @param {Uint8Array} commitBytes
 * @returns {Promise<{ type: string, epoch: number }>}
 */
export async function processVoiceCommit(deps, channelId, commitBytes) {
  const { db, mlsStore, hushCrypto } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const groupIdBytes = voiceChannelIdToBytes(channelId);

  await mlsStore.preloadGroupState(db);
  const result = await hushCrypto.processMessage(groupIdBytes, sigPriv, sigPub, credBytes, commitBytes);
  await mlsStore.flushStorageCache(db);

  await mlsStore.setGroupEpoch(db, `voice:${channelId}`, result.epoch);

  return { type: result.type, epoch: result.epoch };
}

/**
 * Perform a self-update on the voice MLS group to rotate leaf node key material.
 * Should be called on the voice_key_rotation_hours cadence.
 *
 * @param {object} deps
 * @param {string} channelId
 * @returns {Promise<{ epoch: number }>}
 */
export async function performVoiceSelfUpdate(deps, channelId) {
  const { db, token, mlsStore, hushCrypto, api } = deps;
  const { sigPriv, sigPub, credBytes } = getCredFields(deps);
  const groupIdBytes = voiceChannelIdToBytes(channelId);

  await mlsStore.preloadGroupState(db);
  const result = await hushCrypto.selfUpdate(groupIdBytes, sigPriv, sigPub, credBytes);
  await mlsStore.flushStorageCache(db);

  await api.postMLSVoiceCommit(
    token,
    channelId,
    toBase64(result.commitBytes),
    result.epoch,
    toBase64(result.groupInfoBytes),
  );

  // Merge the pending commit into the group state.
  await mlsStore.preloadGroupState(db);
  const mergeResult = await hushCrypto.mergePendingCommit(groupIdBytes, sigPriv, sigPub, credBytes);
  await mlsStore.flushStorageCache(db);

  await api.putMLSVoiceGroupInfo(
    token,
    channelId,
    toBase64(mergeResult.groupInfoBytes),
    mergeResult.epoch,
  );
  await mlsStore.setGroupEpoch(db, `voice:${channelId}`, mergeResult.epoch);

  return { epoch: mergeResult.epoch };
}

/**
 * Destroy local voice MLS group state when leaving a voice channel.
 * Does NOT call a server delete — the server handles cleanup via the LiveKit
 * webhook when the last participant leaves (voice_group_destroyed WS event).
 *
 * @param {object} deps
 * @param {string} channelId
 * @returns {Promise<void>}
 */
export async function destroyVoiceGroup(deps, channelId) {
  const { db, mlsStore } = deps;
  await mlsStore.deleteGroupEpoch(db, `voice:${channelId}`);
}
