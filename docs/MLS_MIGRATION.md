# Signal Protocol to MLS Migration

**Decision date:** 2026-03-16
**Status:** Complete (M.1, M.2, M.3 shipped; Phase O extends with metadata encryption)
**RFC:** 9420 (Messaging Layer Security)
**Implementation:** OpenMLS (Rust crate)

## Why

Signal Protocol has fundamental scaling issues for Discord-like servers:

| Concern | Signal (current) | MLS (target) |
|-|-|-|
| Message encryption cost | O(N x D) per-recipient per-device | O(log N) via TreeKEM |
| Multi-device support | Bolt-on (Sesame), partial | Native (leaf nodes per device) |
| Group membership changes | Re-establish pairwise sessions | Tree update (Commit) |
| Key rotation in groups | Per-recipient re-encryption | Epoch advancement |

Signal excels at 1:1 messaging. Hush channels are group messaging with potentially thousands of members. MLS is designed for exactly this use case.

**No hybrid stack.** MLS replaces Signal for everything: channel messages, DMs, and voice key distribution. One crypto layer.

## What Does NOT Change

- BIP39 mnemonic identity (Phase J) — identity model is protocol-independent
- Challenge-response auth (nonce signing)
- QR device linking / device certification
- Vault PIN/timeout
- Explicit logout wipe
- JWT session tokens
- Server as blind relay (server never sees plaintext)
- WebSocket hub, presence, broadcast infrastructure
- Moderation, roles, audit log
- LiveKit SFU (only the key distribution method changes)

## Phase O: Metadata Encryption (2026-03-24)

Phase O extends the MLS crypto model to metadata. Guild and channel names are now encrypted client-side with an AES-256-GCM key derived from the MLS group secret. The server stores only opaque BYTEA blobs and never sees plaintext for any data -- messages, metadata, media, guild names, or channel names. Permission levels (integer 0-3) replace role strings. A standalone admin dashboard (`client/admin/`) uses API key auth for instance administration without requiring a Hush identity.

---

## Component Mapping (Historical Reference)

The tables below describe the Signal-to-MLS migration that was completed across phases M.1, M.2, and M.3. They are preserved as a reference for what changed.

### Crypto Library (hush-crypto/)

| Signal (current) | MLS (target) | Notes |
|-|-|-|
| `libsignal-dezire` dependency | `openmls` + `openmls_rust_crypto` | Core crypto crate swap |
| `identity.rs` — X25519 IK generation | `credential.rs` — Ed25519 signing key + BasicCredential | MLS uses signing keys, not DH keys, for identity |
| `prekey.rs` — SPK + OPK generation (VXEdDSA) | `key_package.rs` — KeyPackage builder | OpenMLS handles key generation internally |
| `x3dh_wrap.rs` — X3DH initiator/responder | **Removed** — MLS Welcome replaces X3DH | Group join via Welcome message, not pairwise DH |
| `session.rs` — Double Ratchet encrypt/decrypt | **Removed** — MLS group encrypt/decrypt | `MlsGroup::create_message()` / `process_message()` |
| `wasm.rs` — WASM FFI bindings | `wasm.rs` — new WASM bindings for MLS ops | Credential gen, KeyPackage gen, group ops, encrypt/decrypt |

**Ciphersuite:** `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` (X25519 + AES-128-GCM + Ed25519 — closest to current Signal crypto primitives)

### Server (Go)

| Signal (current) | MLS (target) | Notes |
|-|-|-|
| `signal_identity_keys` table | `mls_credentials` table | user_id, device_id, credential_bytes, signing_public_key |
| `signal_one_time_pre_keys` table | `mls_key_packages` table | user_id, device_id, key_package_bytes, consumed (bool) |
| `signal_spk_history` table | **Removed** | No SPK concept in MLS |
| `keys.go` — upload bundle (IK + SPK + OPKs) | `key_packages.go` — upload KeyPackages | Simpler: just opaque KeyPackage blobs |
| `keys.go` — fetch bundle (consume OPK) | `key_packages.go` — fetch KeyPackage (consume) | Same pattern: atomic consume on fetch |
| `keys.go` — OPK count endpoint | `key_packages.go` — KeyPackage count | Same pattern |
| `keys.low` WS broadcast | `key_packages.low` WS broadcast | Trigger when KeyPackage count drops below threshold |
| `keys.spk_stale` WS broadcast | **Removed** | No SPK staleness in MLS |
| `maybeSendKeysLow()` | `maybeSendKeyPackagesLow()` | Same logic, different key type |
| `messages` table (ciphertext BYTEA) | `messages` table (ciphertext BYTEA) | **Unchanged** — server stores opaque blobs |

**Migration:** New migration drops `signal_*` tables, creates `mls_*` tables. All existing Signal sessions and keys are invalidated. Users must re-authenticate.

### Client (JavaScript)

| Signal (current) | MLS (target) | Notes |
|-|-|-|
| `signalStore.js` — IndexedDB (IK, SPK, OPK, sessions) | `mlsStore.js` — IndexedDB (credentials, KeyPackages, group states) | Different schema, same storage pattern |
| `useSignal.js` — X3DH + Double Ratchet orchestration | `useMLS.js` — MLS group ops (create, join, send, receive) | Simpler: no manual session establishment |
| `uploadKeysAfterAuth.js` — generate + upload pre-key bundle | `uploadKeyPackages.js` — generate + upload KeyPackages | Same flow, different key type |
| `keyMaintenance.js` — SPK rotation + OPK replenishment | `keyPackageMaintenance.js` — KeyPackage replenishment | Simpler: no SPK rotation, just replenish KeyPackages |
| `useKeyMaintenance.js` — React hook for maintenance | `useKeyPackageMaintenance.js` — React hook | Same hook pattern |
| `hushCrypto.js` — lazy WASM loader | `hushCrypto.js` — lazy WASM loader (updated exports) | Same pattern, different WASM API |
| `e2eeKeyManager.js` — voice key via per-recipient Signal encryption | `e2eeKeyManager.js` — voice key via MLS group secret export | `MlsGroup::export_key()` replaces fan-out encryption |

### MLS Group Mapping

| Hush Concept | MLS Concept | Lifecycle |
|-|-|-|
| Text channel | MLS Group (group_id = channel UUID) | Created when channel created; members added/removed with Commit |
| Voice channel | MLS Group (separate, for frame key derivation) | Created on first join; epoch advances on member change; frame key = `export_key()` |
| DM (v2) | MLS Group (2-member) | Created on first message; same API as channels |
| Guild membership | Not directly mapped | Channel MLS groups manage their own membership |

### Wire Format

| Signal (current) | MLS (target) |
|-|-|
| PreKey envelope (0x01): 75-byte header + DR ciphertext | MLS Welcome message (for initial group join) |
| Regular envelope (0x02): 1-byte type + DR ciphertext | MLS ApplicationMessage (for ongoing messages) |
| Custom wire format (type byte + header + payload) | MLS TLS serialization (`MlsMessageOut::to_bytes()`) |

### Key Lifecycle

| Signal (current) | MLS (target) |
|-|-|
| SPK rotation every 7 days | Self-update Proposal (periodic leaf node key rotation) |
| SPK 48h grace period | Not needed — no SPK concept |
| OPK batch upload (100 keys) | KeyPackage batch upload |
| OPK consumption on session establishment | KeyPackage consumption on group add |
| `keys.low` → replenish OPKs | `key_packages.low` → replenish KeyPackages |
| `keys.spk_stale` → force SPK rotation | Not needed |

## Phases (Completed)

| Phase | Replaces | What it does | Status |
|-|-|-|-|
| M.1: MLS Core | Phase B (Signal Protocol Core) | OpenMLS crate, WASM bindings, server KeyPackage storage, credential management | Complete (2026-03) |
| M.2: MLS Encrypted Chat | Phase C (Encrypted Chat) + B.7 (Key Lifecycle) | MLS groups per channel, message encrypt/decrypt, member add/remove, KeyPackage replenishment | Complete (2026-03) |
| M.3: MLS Voice/Video | Phase D (E2EE Voice/Video) | Frame key via MLS group secret export, epoch-based key rotation | Complete (2026-03) |
| Phase O: Metadata Encryption | -- | Guild/channel names encrypted with MLS-derived AES-256-GCM key, permission levels, admin dashboard | Complete (2026-03-24) |

**Execution order (actual):** K.6 (done) -> M.1 -> M.2 -> M.3 -> Phase O

## Risks (Post-Migration Assessment)

| Risk | Original Mitigation | Outcome |
|-|-|-|
| OpenMLS WASM maturity | OpenMLS has `openmls-wasm` crate with working JS bindings. Discord's DAVE protocol uses OpenMLS for voice E2EE. | Mitigated. WASM bindings worked reliably; custom wrappers built for voice frame key export. |
| MLS group state size | Use `use_ratchet_tree_extension(true)` for inline tree distribution. | Mitigated. Inline ratchet tree extension enabled; no issues at current scale. |
| Breaking change for existing users | All Signal sessions invalidated. Users must re-authenticate. Acceptable pre-launch. | Accepted. Migration executed pre-launch; all Signal tables dropped. |
| MLS server requirements | MLS Delivery Service is simpler than Signal pre-key server. Server just stores/relays opaque blobs. | Confirmed. Server is simpler post-migration -- blind relay for all data. |
| 1:1 DM overhead | A 2-member MLS group has slightly more overhead than a Signal session. Acceptable tradeoff for unified crypto layer. | Accepted. Unified crypto layer outweighs marginal overhead. |

## Requirements Impact

CRYP-01 through CRYP-06 (Signal-specific) will be superseded by new MLS requirements:

| Old (Signal) | New (MLS) |
|-|-|
| CRYP-01: SPK rotation every 7 days | MLS-CRYP-01: Periodic self-update Proposal for leaf node key rotation |
| CRYP-02: Old SPK retained 48h grace | (Not needed — no SPK in MLS) |
| CRYP-03: Schema for SPK version history | MLS-CRYP-02: Schema for MLS credentials + KeyPackages |
| CRYP-04: `keys.low` when OPK count drops | MLS-CRYP-03: `key_packages.low` when KeyPackage count drops |
| CRYP-05: Client uploads 100 OPKs on low | MLS-CRYP-04: Client uploads KeyPackage batch on low |
| CRYP-06: OPK replenishment on login/startup | MLS-CRYP-05: KeyPackage replenishment on login/startup |

---

*Created: 2026-03-16 — Signal to MLS architectural pivot*
*Updated: 2026-03-24 — Migration complete (M.1, M.2, M.3); Phase O metadata encryption shipped*
