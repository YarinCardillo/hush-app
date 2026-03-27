# Security

This document describes Hush's end-to-end encryption (E2EE) implementation, trust model, HTTP security posture, and known limitations.

## Encryption algorithms

| Layer | Algorithm | Purpose |
|-|-|-|
| Key agreement | MLS TreeKEM (RFC 9420) | Group key establishment and epoch advancement |
| Chat messages | MLS Application Messages (AES-128-GCM) | Per-message encryption with forward secrecy via epoch |
| Group key management | MLS TreeKEM | Efficient O(log N) key tree operations for group membership changes |
| Media frames | AES-256-GCM via Insertable Streams | Frame-level encryption for voice, video, and screen share |
| Media frame key derivation | MLS export_secret (label: `hush-voice-frame-key`) | Frame key derived from voice group epoch, rotated on membership change |
| Guild/channel metadata | AES-256-GCM (key from MLS export_secret, label: `hush-guild-metadata`) | Client-side encryption of guild names, channel names before server storage |
| Ciphersuite | MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 | X25519 DHKEM, AES-128-GCM, SHA-256, Ed25519 signatures |

## Chat encryption

**Protocol**: MLS (RFC 9420, Messaging Layer Security) via the `hush-crypto` Rust crate wrapping OpenMLS 0.8.1, compiled to WASM for web and desktop (Electron runs the same WASM in Chromium), UniFFI for mobile. Single implementation on all platforms.

**MLS group per channel**: Each text channel has its own MLS group. Messages are encrypted using `MlsGroup::create_message()` and decrypted using `process_message()`. The ciphersuite is `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`.

**Credential and KeyPackage lifecycle**:
1. On registration, client generates a BIP39 12-word mnemonic phrase, shown once. The root identity key pair (Ed25519) is deterministically derived from the mnemonic. The client generates an MLS BasicCredential binding the identity to Ed25519, plus a batch of MLS KeyPackages.
2. Credential and KeyPackages are uploaded to the Go backend (`POST /api/mls/key-packages`). The server stores only public material. It never receives the private key, mnemonic, or any password.
3. To add a member to a channel: fetch their KeyPackage from the server, create an MLS Add proposal, commit. The resulting Welcome message is delivered to the new member, who uses it to initialize their group state.
4. Subsequent messages use MLS Application Messages. Each epoch has unique key material; compromising one epoch does not reveal others.

**Group membership changes**:
- **Add**: Proposer fetches target's KeyPackage, proposes Add, commits. Welcome message sent to new member. All existing members advance to new epoch.
- **Remove**: Proposer proposes Remove, commits. Remaining members advance to new epoch. Removed member's leaf is blanked; they cannot derive future epoch keys.
- **Self-update**: Members can update their own leaf node (key rotation) by proposing Update and committing.

**Forward secrecy**: MLS provides forward secrecy through epoch advancement. Each Commit creates a new epoch with fresh key material derived via TreeKEM. Compromising a device's current epoch state does not reveal messages from prior epochs (assuming prior epoch secrets have been deleted from local storage).

**Post-compromise security**: After a device compromise, a single Update + Commit by the compromised member is sufficient to restore security for subsequent epochs. The TreeKEM ratchet tree ensures the attacker is excluded from future key derivations.

**MLS state storage**: MLS state (credentials, group state, epoch secrets) persisted in IndexedDB via `mlsStore.js`, keyed per user.

**KeyPackage replenishment**: The client periodically checks remaining KeyPackage count on the server and uploads fresh ones when the count drops below threshold (`useKeyPackageMaintenance.js`). This replaces Signal-era signed pre-key rotation and one-time pre-key replenishment.

## Media encryption

**Protocol**: WebRTC media streams (voice, video, screen share) are encrypted using LiveKit's Insertable Streams with AES-256-GCM. The SFU forwards encrypted frames without access to plaintext.

**Key derivation**: Frame keys are derived from the voice channel's MLS group, not generated randomly or distributed via a side channel:
1. When a user joins a voice channel, a voice-type MLS group is created (or the user is added to the existing one).
2. Frame key derived via `MlsGroup::export_secret()` with label `hush-voice-frame-key` and the current epoch.
3. The derived key is applied to LiveKit's `ExternalE2EEKeyProvider`.
4. LiveKit E2EE worker encrypts/decrypts media frames using the derived key.

**Key rotation (rekeying)**: Epoch-based. When a participant joins or leaves, the MLS group membership changes, advancing the epoch. All remaining members derive the new frame key from the new epoch's `export_secret`. A departed participant cannot derive the new epoch's key and therefore cannot decrypt future frames.

**No leader election**: Unlike the previous Signal-based implementation, there is no leader election or fan-out key distribution. Every participant independently derives the same frame key from their local MLS group state.

**No silent degradation**: If the E2EE worker fails to load or key derivation fails, the client does NOT connect to LiveKit. Media without encryption is never permitted.

## Guild metadata encryption

**Protocol**: Guild names, channel names, and other metadata are encrypted client-side using AES-256-GCM before being sent to the server. The server stores only opaque BYTEA blobs in the `encrypted_metadata` columns of the `servers` and `channels` tables.

**Key derivation**: The metadata encryption key is derived from a guild-level metadata MLS group's `export_secret` with label `hush-guild-metadata`. Each guild has a dedicated metadata-type MLS group for this purpose.

**What the server stores**: For guilds: `encrypted_metadata` (BYTEA), `access_policy` (enum string), `discoverable` (boolean), `member_count`, metric counters. For channels: `encrypted_metadata` (BYTEA), `type` (text/voice/category — needed for routing). For members: `permission_level` (integer 0-3). The server never stores guild names, channel names, role labels, or any other human-readable metadata.

**MLS group types**:
| Type | Purpose | Scope |
|-|-|-|
| `text` | Channel message encryption | Per text channel |
| `voice` | Voice frame key derivation | Per voice channel |
| `metadata` | Guild/channel name encryption | Per guild |

## Cryptographic dependency audit

### Current dependencies (post-MLS migration)

Hush's MLS implementation (`hush-crypto`) depends on the following Rust crates:

| Crate | Version | Purpose |
|-|-|-|
| `openmls` | 0.8.1 | MLS protocol implementation (RFC 9420) |
| `openmls_rust_crypto` | 0.5.1 | Rust-native crypto backend for OpenMLS |
| `openmls_basic_credential` | 0.5.0 | BasicCredential type |
| `openmls_memory_storage` | 0.5.0 | In-memory storage provider |
| `openmls_traits` | 0.5.0 | Trait definitions |
| `ed25519-dalek` | 2.0 | Ed25519 key generation |

OpenMLS is the reference open-source implementation of RFC 9420, maintained by the OpenMLS project. It is used in production by multiple organizations and undergoes regular security review.

### Historical context: libsignal-dezire (removed)

The pre-MLS implementation depended on `libsignal-dezire`, a third-party pure-Rust Signal Protocol library. Two vulnerabilities were found and patched in our fork: a DoS panic on invalid Montgomery u-coordinates (High) and missing zeroization of DH private keys (Medium). This dependency was fully removed during the M.1 migration phase. The patched fork, interop tests, and all Signal Protocol code are no longer part of the codebase.

## Trust model

- **Cryptographic identity**: Each user's identity is a keypair derived from a BIP39 12-word mnemonic. The server stores only the root public key. No email, no password, no private key material. Authentication is cryptographic proof of key ownership.
- **Blind relay server**: The server never sees plaintext for any user data. Chat messages are MLS ciphertext blobs. Guild names and channel names are AES-256-GCM ciphertext blobs. Media frames are encrypted end-to-end. Permission levels are opaque integers. The admin dashboard shows only UUIDs, counts, and dates.
- **Trust on first use (TOFU)**: Devices are trusted when first seen. Safety Numbers comparison is planned to allow in-app device verification. Until then, users must rely on out-of-band verification to confirm a device.
- **KeyPackage server trust**: The Go backend stores public KeyPackages. A compromised server could serve malicious KeyPackages (MITM). This is mitigated in a future milestone by Safety Numbers verification (comparing identity key fingerprints out-of-band).
- **Multi-device trust**: Each device has its own independent keypair. A new device is authorized when an existing (already authenticated) device scans a QR code displayed by the new device and signs a certificate: `certificate = Sign(IK_existing_priv, IK_new_pub)`. The server maintains a list of certified public keys per account and verifies each certificate. Private keys never leave the device that generated them.
- **MLS group integrity**: MLS commits are authenticated by the proposer's credential. The server cannot forge commits or inject members without a valid credential and KeyPackage. Group state consistency is enforced by the MLS transcript hash.

## Server behavior

The server is a blind relay. It never sees plaintext for chat, media, metadata, or identity information:
- **Authentication**: The server authenticates users via cryptographic proof of key ownership. It stores only public keys. There are no passwords in the protocol.
- **Chat**: Messages stored as MLS ciphertext blobs in PostgreSQL. The server routes them by channel ID without decryption.
- **Guild metadata**: Guild names, channel names, and descriptive metadata are stored as `encrypted_metadata BYTEA` columns. The server cannot read them.
- **Permission levels**: Member permissions are stored as integers (0=member, 1=mod, 2=admin, 3=owner). Human-readable role labels exist only in encrypted MLS group state, visible only to group members.
- **Media**: LiveKit SFU forwards encrypted frames. Frame keys are derived from MLS export_secret on each client; they never traverse the server.
- **LiveKit tokens**: The Go backend validates the user's JWT and issues a LiveKit access token. It does not check room-level permissions beyond membership (enforced at the application layer).
- **Admin dashboard**: The standalone admin app (`client/admin/`) authenticates via API key (X-Admin-Key header), not as a Hush user. It displays only opaque data: UUIDs, member counts, message counts, timestamps. The admin cannot see guild names, channel names, or message content.

## Browser support

| Browser | Chat E2EE (MLS) | Media E2EE (LiveKit) |
|-|-|-|
| Chromium (Chrome, Edge, Brave, Arc) | Full | Full (Insertable Streams) |
| Firefox | Full | Partial (Insertable Streams support varies) |
| Safari | Full | Limited (Insertable Streams / E2EE worker limitations) |

Full media E2EE requires Insertable Streams and the LiveKit E2EE worker. If the worker fails to load, the app blocks media entirely and shows "Media encryption unavailable."

## Known limitations

- **No device verification UI:** Planned for a future milestone. Users cannot verify identity keys in-app. MITM by a compromised KeyPackage server is theoretically possible until Safety Numbers are implemented.
- **Past message recovery:** If a user loses all linked devices and re-derives their identity from the 12-word mnemonic, the account and server memberships are recovered, but past encrypted messages are irrecoverable (MLS group state is gone). This is by design -- there is no server-side key escrow.
- **Mnemonic is the sole recovery mechanism:** If a user loses both the mnemonic and all linked devices, the account is irrecoverable. A new account must be created. There is no email, password, or central recovery server.
- **Guest accounts:** Share the same TOFU trust model as registered accounts. Guest sessions are temporary; MLS state is lost when the session ends.
- **MLS ratchet tree size:** For very large groups (thousands of members), the ratchet tree size grows logarithmically but may still impose noticeable overhead on commits and Welcome messages. Current design assumes channels under a few hundred members.
- **WebCrypto nonce management:** AES-GCM frame encryption uses a counter-based nonce. Nonce reuse with the same key would break confidentiality. The implementation ensures counters never repeat (even across page reloads within the same key lifecycle).
- **MLS epoch synchronization:** If a client goes offline during rapid membership changes, it must process all intermediate commits sequentially to catch up. Network partitions during commits may require group state reconciliation.

## HTTP security headers

Caddy sets the following headers on all responses:

| Header | Purpose |
|-|-|
| `X-Content-Type-Options: nosniff` | Disable MIME sniffing |
| `X-Frame-Options: DENY` | Mitigate clickjacking |
| `Cross-Origin-Opener-Policy: same-origin` | Window isolation (prevents cross-origin popup access) |
| `Strict-Transport-Security` | HSTS (production only; see `caddy/Caddyfile.prod`) |

**Note on COEP:** `Cross-Origin-Embedder-Policy: require-corp` is NOT used. LiveKit E2EE uses Insertable Streams with a Web Worker and `Transferable` objects, not `SharedArrayBuffer`. Enabling COEP would break browser extensions and cross-origin resources without benefit.

## Input validation

API request body fields are validated server-side in the Go backend (`server/internal/api/`).

| Field | Endpoint | Rule |
|-|-|-|
| `username` | `POST /api/auth/register` | Non-empty string, max 64 chars (display name only, not an authentication credential) |
| `publicKey` | `POST /api/auth/register` | Valid public key (root identity key derived from BIP39 mnemonic) |
| `roomName` | `POST /api/livekit/token` | Non-empty string, pattern `[a-zA-Z0-9._=-]+`, max 256 chars |
| `participantName` | `POST /api/livekit/token` | Optional; trimmed; max 128 chars; no control characters |
| `encrypted_metadata` | `POST /PUT /api/servers/*`, `POST /PUT /api/channels/*` | Accepted as opaque BYTEA; server does not parse or validate contents |
| `permission_level` | `PUT /api/servers/:id/members/:uid` | Integer 0-3 |
| `X-Admin-Key` | `GET /api/admin/*` | Required header for admin endpoints; validated against server config |

Chat messages are stored as MLS ciphertext blobs; the server never processes plaintext content.

## CORS

- **Development:** Default `CORS_ORIGIN` is `*`.
- **Production:** Set `CORS_ORIGIN` to your frontend origin in `.env`. Both the Go backend and Caddy use this value.

## Production checklist

| Item | Action |
|-|-|
| **CORS** | Set `CORS_ORIGIN` to your frontend origin. Do not use `*` in production. |
| **HSTS** | Use `caddy/Caddyfile.prod` for `Strict-Transport-Security`. |
| **COOP** | `Cross-Origin-Opener-Policy: same-origin` must be sent. COEP is not required. |
| **Secrets** | Do not use default values. Generate strong `JWT_SECRET`, `LIVEKIT_API_SECRET`, `POSTGRES_PASSWORD`, `ADMIN_API_KEY`. See `docs/SETUP.md`. |
| **Dependencies** | Run `npm audit` in `client/` and `cargo audit` in `hush-crypto/` before production. |

## Rate limiting

Rate limiting is implemented (Phase F) in the Go backend via `server/internal/api/ratelimit.go` and `server/internal/ws/ratelimit.go`:
- Registration / key challenge endpoints (`/api/auth/*`): 5 req/min per IP
- Message send: 30 msg/min per user
- KeyPackage upload: 10 req/min per user
- General API: 100 req/min per IP

## Content-Security-Policy

CSP is configured in Caddy. See `caddy/Caddyfile` for the current policy.
