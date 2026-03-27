# Security

This document describes Hush's end-to-end encryption implementation, threat models, cryptographic primitives, and responsible disclosure policy. It is written for security auditors, penetration testers, and privacy-conscious users who want to understand exactly what Hush protects and what it does not.

---

## 1. MLS Threat Model

Hush uses MLS (Messaging Layer Security, RFC 9420) for all text channel encryption. The implementation is the `hush-crypto` Rust crate wrapping OpenMLS 0.8.1, compiled to WASM. Every text channel has its own independent MLS group.

### What MLS protects

| Property | Description |
|-|-|
| **Message confidentiality** | Messages are encrypted with AES-128-GCM inside MLS Application Messages. Only group members with valid epoch key material can decrypt. |
| **Forward secrecy** | Each MLS Commit advances the epoch and derives new key material via TreeKEM. Compromising a device's current epoch state does not reveal messages from prior epochs, provided prior epoch secrets have been deleted from local storage. |
| **Post-compromise security** | After a device is compromised, a single Update + Commit by the compromised member restores security for subsequent epochs. The ratchet tree excludes the attacker from future key derivations. |
| **Group membership authentication** | Commits are authenticated by the proposer's MLS credential. The server cannot forge commits or inject members without a valid credential and KeyPackage. Group state consistency is enforced by the MLS transcript hash. |
| **Member removal** | When a member is removed, the remaining members advance to a new epoch. The removed member's leaf is blanked; they cannot derive future epoch keys. |

### What MLS does NOT protect

| Property | Limitation |
|-|-|
| **Metadata** | The server sees: sender UUID, timestamp, channel UUID, and approximate message size. It does not see plaintext content, but it does observe the communication graph. |
| **Group membership visibility** | The server knows which public keys are in which MLS group (it stores KeyPackages and processes Add/Remove proposals). It knows who is in which channel, but not the channel's name. |
| **Message ordering guarantees** | MLS does not enforce in-order delivery. Clients process commits in receipt order. Out-of-order commits require sequential catch-up. |
| **Delivery guarantees** | MLS is a cryptographic protocol, not a transport. If the WebSocket drops, messages may be lost without explicit catch-up. |
| **Metadata group membership** | The guild-level metadata group encrypts guild/channel names but the server knows how many metadata groups exist per instance. |

### Ciphersuite

`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`

- Key encapsulation: X25519 DHKEM
- Symmetric encryption: AES-128-GCM
- Hash: SHA-256
- Signature: Ed25519

---

## 2. Key Transparency Threat Model

Hush implements T.1 key transparency: a signed Merkle tree of key operations per instance.

### What key transparency provides

| Guarantee | Description |
|-|-|
| **Auditability** | All key operations (registration, device add, device revoke, KeyPackage rotation) are recorded in a signed Merkle log. |
| **Tamper detection** | The log uses Ed25519-signed leaf nodes. A client that checks its own inclusion proof can detect if the server has modified or omitted its key operations. |
| **Verification endpoint** | Clients verify inclusion proofs at login and on key changes via `GET /api/transparency/verify`. |
| **Non-repudiation** | The instance operator cannot retroactively remove a legitimate key operation without breaking the Merkle chain. |

### What key transparency does NOT provide

| Limitation | Description |
|-|-|
| **Cross-instance verification (T.2)** | The log is scoped to a single instance. There is no gossip protocol or global auditor. A malicious instance could serve different log views to different users (split-view attack). |
| **Split-view resistance** | Without T.2, the instance operator could show user A a log that includes a malicious device for user B, while showing user B a clean log. Safety Numbers (out-of-band verification) mitigate this but are not yet implemented. |
| **Real-time alerting** | Clients check the log at login and key change events only. Passive monitoring between logins is not implemented. |

### Implementation

- Log signing key: Ed25519 seed generated once by `setup.sh`, stored as `TRANSPARENCY_LOG_PRIVATE_KEY` in `.env`
- This seed must never change after the first log entry — rotating it invalidates all existing proofs
- Merkle tree structure: SHA-256 leaf hashes, binary tree, inclusion proof returned as path array

---

## 3. Server Blind Relay Model

The Hush server is designed to be a blind relay. It routes and stores encrypted data without access to plaintext.

### What the server sees (stores and processes)

| Data | Format | Purpose |
|-|-|-|
| Chat messages | MLS ciphertext (BYTEA) | Storage and routing to channel subscribers |
| Guild/channel metadata | AES-256-GCM ciphertext (BYTEA) | Stored as `encrypted_metadata`; opaque to server |
| Sender UUID | UUID | Message routing |
| Timestamp | UTC timestamp | Message ordering |
| Channel UUID | UUID | Routing to correct group |
| MLS KeyPackages | Public key material (BYTEA) | Used by other clients to add members to groups |
| MLS Commits, Proposals, Welcome messages | MLS protocol messages | Distributed to group members |
| Permission levels | Integer (0–3) | Guild-level role enforcement |
| Access policy | Enum string (open/invite-only) | Join flow control |
| Member count | Integer | Rate limiting and metrics |
| Public key (root identity) | Ed25519 public key | Authentication verification |

### What the server never sees

| Data | Why |
|-|-|
| Plaintext message content | Encrypted with MLS before transmission |
| Guild names | Encrypted with MLS-derived AES-256-GCM before transmission |
| Channel names | Encrypted with MLS-derived AES-256-GCM before transmission |
| Role labels (admin, moderator) | Exist only in encrypted guild metadata |
| Private keys or mnemonics | Never transmitted; client-generated and client-held |
| Voice/video frame content | Encrypted by LiveKit Insertable Streams; SFU forwards encrypted frames |
| Voice frame keys | Derived client-side from MLS `export_secret()`; never sent to server |

### Admin dashboard

The standalone admin dashboard (`client/admin/`) authenticates via API key (`X-Admin-Key` header), not as a Hush user. It has access only to opaque data: UUIDs, member counts, message counts, timestamps. It cannot see guild names, channel names, or message content.

---

## 4. Cryptographic Identity (BIP39)

### Identity derivation

1. A 12-word BIP39 mnemonic is generated client-side using a cryptographically random entropy source (`crypto.getRandomValues()`).
2. The mnemonic is shown once at registration and must be saved by the user.
3. The root Ed25519 keypair is derived deterministically from the mnemonic. The same mnemonic always produces the same keypair.
4. The server stores only the root public key. No email, no password, no encrypted recovery blob.

### Authentication

Challenge-response protocol:
1. Client requests a nonce from `POST /api/auth/challenge`.
2. Server generates a random nonce and stores it with a short TTL.
3. Client signs the nonce with the root Ed25519 private key.
4. Server verifies the signature against the stored public key and issues a JWT session token.

### Recovery

If a user loses all devices, re-entering the 12-word mnemonic re-derives the root keypair and recovers account access and server memberships. Past encrypted messages are irrecoverable — MLS group state exists only on member devices. There is no server-side key escrow by design.

### Multi-device

Each device has its own independent Ed25519 keypair (device key). A new device is authorized when an existing authenticated device scans a QR code displayed by the new device and signs a certificate: `certificate = Sign(IK_existing_priv, IK_new_pub)`. The server verifies each certificate signature. Private keys never leave the device that generated them.

### Vault (local encryption)

The mnemonic seed is encrypted at rest using AES-256-GCM. The encryption key is derived from the user's vault PIN via PBKDF2-SHA256 (200,000 iterations, 16-byte random salt, stored in both localStorage and IndexedDB for iOS Safari eviction resilience). The decrypted seed lives in memory only for the active session.

---

## 5. Responsible Disclosure

If you discover a security vulnerability in Hush, please report it responsibly.

**Email:** `security@gethush.live`

**Scope:** All code in this repository and the hosted instance at `gethush.live`.

**Response timeline:**
- Acknowledge within 48 hours
- Triage and severity assessment within 7 days
- Fix timeline communicated within 14 days

**Out of scope:**
- Vulnerabilities requiring physical access to a device
- Social engineering attacks against users or operators
- Denial-of-service attacks that require volumetric traffic

**Guidelines:**
- Do not access or modify data that is not yours
- Do not disclose publicly until a fix is available (coordinated disclosure)
- Provide sufficient detail to reproduce the issue
- We will credit researchers who report valid vulnerabilities (unless you prefer anonymity)

---

## 6. Cryptographic Primitives Inventory

| Primitive | Library | Version | Specification | Usage |
|-|-|-|-|-|
| MLS group key agreement | OpenMLS (Rust) | 0.8.1 | RFC 9420 | Chat channel encryption, voice frame key derivation, metadata encryption |
| X25519 DHKEM | openmls_rust_crypto | 0.5.1 | RFC 9420 §17.1 | MLS TreeKEM key encapsulation |
| AES-128-GCM | openmls_rust_crypto | 0.5.1 | RFC 9420 ciphersuite | MLS Application Message encryption |
| AES-256-GCM (media) | WebCrypto API | Browser | NIST SP 800-38D | Voice/video/screen share frame encryption via LiveKit |
| AES-256-GCM (metadata) | WebCrypto API | Browser | NIST SP 800-38D | Guild/channel name encryption (key from MLS export_secret) |
| AES-256-GCM (vault) | WebCrypto API | Browser | NIST SP 800-38D | Local identity vault (PIN-protected mnemonic storage) |
| Ed25519 (MLS credential) | ed25519-dalek | 2.0 | RFC 8032 | MLS BasicCredential signing |
| Ed25519 (identity) | TweetNaCl / WebCrypto | Browser | RFC 8032 | BIP39 root identity, challenge-response auth |
| Ed25519 (transparency log) | Go standard library | Go 1.21 | RFC 8032 | Transparency log leaf signing |
| SHA-256 | openmls_rust_crypto | 0.5.1 | FIPS 180-4 | MLS transcript hash, Merkle tree |
| PBKDF2-SHA256 | WebCrypto API | Browser | RFC 2898 | Vault key derivation from PIN (200,000 iterations) |
| BIP39 | client/src/lib/bip39Identity.js | — | BIP-0039 | Mnemonic generation and seed derivation |
| HKDF-SHA256 | WebCrypto API | Browser | RFC 5869 | Subkey derivation from MLS export_secret |

---

## 7. Known Limitations

These are honest disclosures of properties that Hush does not currently guarantee. They are not bugs — they are design boundaries that users and operators should understand.

### Browser crypto

- **WebCrypto availability required:** Hush requires `window.crypto.subtle`. Private browsing modes, some enterprise configurations, and non-HTTPS origins may disable WebCrypto. The app will fail to load in these environments — it does not fall back to non-encrypted operation.
- **No hardware key isolation:** Private keys are held in memory or in IndexedDB, not in a hardware security module (HSM) or secure enclave. A process with full memory access to the browser tab can extract keys.
- **WebCrypto non-extractable keys:** The vault AES key is created as a non-extractable CryptoKey. This depends on the browser correctly implementing the `extractable: false` flag. Browsers are trusted not to export it through side channels.

### Local message cache

- **Plaintext on disk after decryption:** Decrypted messages are cached in IndexedDB for offline access. This cache is plaintext (post-decryption). The vault PIN protects the identity key, but a full disk image of a logged-in browser profile exposes the message cache.
- **No at-rest encryption for cached messages:** The cache is protected by the OS user account and browser process isolation, not by an additional encryption layer.
- **Forward secrecy does not apply to cached messages:** If a device is compromised, past messages in the local cache are readable. Forward secrecy prevents decryption of past messages by a third party who later obtains key material — it does not protect messages already decrypted and cached on the device.

### Single-tab enforcement

- **BroadcastChannel-based:** Two-tab detection uses the BroadcastChannel API. This is enforced within the same browser profile on the same device. It is not enforced across different browsers, different browser profiles, or different devices.
- **Not a security boundary:** Single-tab enforcement prevents MLS group state corruption from concurrent clients. It is not a security guarantee — a user who deliberately works around it accepts the risk of MLS epoch conflicts.

### Trust on first use

- **No in-app Safety Numbers:** Users cannot currently compare identity key fingerprints in-app. A compromised instance could serve malicious KeyPackages (MITM on group add). Out-of-band verification is the current mitigation.
- **Device verification UI deferred:** Planned for a future milestone.

### MLS epoch synchronization

- **Sequential catch-up required:** If a client goes offline during rapid membership changes, it must process all intermediate commits in order. Network partitions during commits may require group state reconciliation that is not yet automated.
- **Large group overhead:** For channels with hundreds of members, MLS TreeKEM commit and Welcome message sizes grow logarithmically but may impose noticeable latency. The current design assumes channels under a few hundred members.

### Audit finding (I-01, deferred to v1.1)

- **XSS-01 (LOW) — avatarUrl img src:** The `PinUnlockScreen` component accepts an `avatarUrl` prop rendered as `<img src>`. A `javascript:` URL in `src` has no execution vector in modern browsers (browsers ignore it for img tags). The prop is `null` at all current call sites. Remediation deferred to v1.1 when avatar upload is implemented.

---

## Browser Support

| Browser | Chat E2EE (MLS) | Media E2EE (LiveKit) |
|-|-|-|
| Chromium (Chrome, Edge, Brave, Arc) | Full | Full (Insertable Streams) |
| Firefox | Full | Partial (Insertable Streams support varies) |
| Safari | Full | Limited (Insertable Streams / E2EE worker limitations) |

Full media E2EE requires Insertable Streams and the LiveKit E2EE worker. If the worker fails to load, the app blocks media entirely and shows "Media encryption unavailable." There is no silent fallback to unencrypted media.

---

## HTTP Security Headers

Caddy sets the following headers on all responses:

| Header | Value | Purpose |
|-|-|-|
| `X-Content-Type-Options` | `nosniff` | Disable MIME sniffing |
| `X-Frame-Options` | `DENY` | Mitigate clickjacking |
| `Cross-Origin-Opener-Policy` | `same-origin` | Window isolation |
| `Strict-Transport-Security` | `max-age=...` | HSTS (production only) |

**Note on COEP:** `Cross-Origin-Embedder-Policy: require-corp` is intentionally not set. LiveKit E2EE uses Insertable Streams with Transferable objects, not SharedArrayBuffer. Enabling COEP would break browser extensions and cross-origin resources without benefit.

---

## Rate Limiting

| Endpoint | Limit |
|-|-|
| `POST /api/auth/*` (registration, challenge) | 5 req/min per IP |
| WebSocket message send | 30 msg/min per user |
| `POST /api/mls/key-packages` | 10 req/min per user |
| General API | 100 req/min per IP |

---

## Input Validation

API request bodies are validated server-side in the Go backend.

| Field | Rule |
|-|-|
| `username` | Non-empty string, max 64 chars (display name; not an auth credential) |
| `publicKey` | Valid Ed25519 public key |
| `encrypted_metadata` | Accepted as opaque BYTEA; server does not parse contents |
| `permission_level` | Integer 0–3 |
| `X-Admin-Key` | Required header for admin endpoints; validated against server config |

Chat messages are stored as MLS ciphertext blobs. The server never processes plaintext content.

---

## Production Checklist

| Item | Action |
|-|-|
| **CORS** | Set `CORS_ORIGIN` to your frontend origin in `.env`. Do not use `*` in production. |
| **HSTS** | Use `caddy/Caddyfile.self-hoster.tmpl` for automatic `Strict-Transport-Security`. |
| **Secrets** | Do not use default values. `setup.sh` generates all secrets automatically. |
| **Dependencies** | Run `npm audit` in `client/` and `cargo audit` in `hush-crypto/` before production. |
| **TRANSPARENCY_LOG_PRIVATE_KEY** | Never change after the first log entry. Back it up separately from other `.env` values. |
