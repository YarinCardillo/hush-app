# Security

This document describes Hush's end-to-end encryption (E2EE) implementation, trust model, HTTP security posture, and known limitations.

## Encryption algorithms

| Layer | Algorithm | Purpose |
|-|-|-|
| Key agreement | X3DH (Extended Triple Diffie-Hellman) | Initial session establishment between two devices |
| Chat messages | Double Ratchet (Signal Protocol) | Per-message encryption with forward secrecy |
| Group chat key distribution | Pairwise Signal sessions | Symmetric key distributed via encrypted 1:1 channels |
| Media frames | AES-256-GCM via Insertable Streams | Frame-level encryption for voice, video, and screen share |

## Chat encryption

**Protocol**: Signal Protocol via `hush-crypto` Rust crate, compiled to WASM for web, direct Rust for desktop (Tauri), UniFFI for mobile. Single implementation on all platforms.

**Session establishment**:
1. On registration, client generates a BIP39 12-word mnemonic phrase, shown once. The root identity key pair is deterministically derived from the mnemonic. Additionally: signed pre-key, batch of one-time pre-keys.
2. The root public key and pre-keys are uploaded to the Go backend (`POST /api/keys/upload`). The server never receives the private key, mnemonic, or any password.
3. To message a new contact: fetch their pre-key bundle (`GET /api/keys/:userId`), perform X3DH handshake
4. Subsequent messages use Double Ratchet; each message has a unique key, compromising one does not reveal others

**Group messaging**:
- Small groups (< 50 members): fan-out encryption (each message individually encrypted per recipient via their Signal session)
- Large channels: shared symmetric key rotated on membership change, distributed via pairwise Signal sessions

**Forward secrecy**: The Double Ratchet provides forward secrecy at the message level. Compromising a device's current state does not reveal previously decrypted messages (assuming local storage is secure).

**Storage**: Signal Protocol state (identity keys, session states, pre-keys) persisted in IndexedDB, prefixed per user: `hush-signal-${userId}-${deviceId}`.

## Media encryption

**Protocol**: WebRTC media streams (voice, video, screen share) are encrypted using LiveKit's Insertable Streams with AES-256-GCM. The SFU forwards encrypted frames without access to plaintext.

**Key generation**: The room leader generates a random 256-bit key using `crypto.getRandomValues(new Uint8Array(32))`.

**Key distribution**: Frame keys are distributed via Signal Protocol sessions over WebSocket:
1. Leader generates AES-256-GCM key
2. Key encrypted via Signal session to each participant, sent as `media.key` WebSocket message
3. Participants decrypt the frame key using their Signal session and apply it to `ExternalE2EEKeyProvider`
4. LiveKit E2EE worker encrypts/decrypts media frames using the shared key

**Key rotation (rekeying)**: When a participant leaves, the leader generates a new key and distributes it to all remaining participants. This provides forward secrecy for media; a departed participant cannot decrypt future frames.

**Leader election**: Deterministic: the participant with the lowest user ID. On leader disconnect, next lowest takes over, generates a new key, and distributes.

**No silent degradation**: If the E2EE worker fails to load or key exchange fails after 3 retry attempts (exponential backoff: 1s, 2s, 4s), the client does NOT connect to LiveKit. Media without encryption is never permitted.

## Cryptographic dependency audit

Hush's Signal Protocol implementation (`hush-crypto`) depends on `libsignal-dezire`, a third-party pure-Rust Signal Protocol library. Before adopting it, we performed an independent audit comparing dezire's behavior against the official `libsignal-core` reference implementation (Signal Foundation). The audit produced 30 interop tests across 6 test files (`interop-tests/`).

### Patched vulnerabilities

Two issues were found and patched in our fork ([YarinCardillo/libsignal-dezire@3a16e43](https://github.com/YarinCardillo/libsignal-dezire/commit/3a16e43)):

| Finding | Severity | File | Description |
|-|-|-|-|
| DoS panic on invalid Montgomery u-coordinates | **High** | `utils.rs` | Non-canonical u-coordinates (values in `[p, 2^255)`) caused `to_edwards(0).expect(...)` to panic, crashing the process. A malicious peer could crash any dezire client by sending a crafted public key. Patched to return `InvalidKey` error instead. |
| Missing zeroization of DH private key | **Medium** | `ratchet.rs` | The Double Ratchet state kept DH private keys in memory after the ratchet step completed. Per Signal spec, old ratchet private keys must be securely deleted. Patched to zeroize after use. |

### Accepted weaker validations

The audit also documented areas where dezire's key validation is less strict than official libsignal. These are **not patched** because existing cryptographic guarantees already mitigate them:

| Finding | Why not critical |
|-|-|
| Torsion-tweaked keys pass validation (official libsignal rejects via `is_torsion_free()`) | X25519 clamping mitigates small-subgroup attacks |
| High-bit / non-canonical keys not rejected (official libsignal rejects via `scalar_is_in_range()`) | X25519 reduces mod p automatically; these are equivalent to canonical keys |

These are defense-in-depth gaps, not exploitable vulnerabilities. Full details and test cases are in `interop-tests/tests/key_validation_edge_cases.rs`.

### Dependency pinning

The patched fork is pinned to a specific commit to prevent supply-chain drift:

```toml
libsignal-dezire = { git = "https://github.com/YarinCardillo/libsignal-dezire.git", rev = "3a16e43" }
```

## Trust model

- **Cryptographic identity**: Each user's identity is a keypair derived from a BIP39 12-word mnemonic. The server stores only the root public key — no email, no password, no private key material. Authentication is cryptographic proof of key ownership.
- **Trust on first use (TOFU)**: Devices are trusted when first seen. Safety Numbers comparison is planned to allow in-app device verification. Until then, users must rely on out-of-band verification to confirm a device.
- **Pre-key server trust**: The Go backend stores public pre-keys. A compromised server could serve malicious pre-keys (MITM). This is mitigated in a future milestone by Safety Numbers verification (Signal's identity key fingerprint comparison).
- **Multi-device trust**: Each device has its own independent keypair. A new device is authorized when an existing (already authenticated) device scans a QR code displayed by the new device and signs a certificate: `certificate = Sign(IK_existing_priv, IK_new_pub)`. The server maintains a list of certified public keys per account and verifies each certificate. Private keys never leave the device that generated them.

## Server behavior

The server never sees plaintext for chat or media, and never receives private keys, passwords, or mnemonic phrases:
- **Authentication**: The server authenticates users via cryptographic proof of key ownership. It stores only public keys. There are no passwords in the protocol.
- **Chat**: Messages stored as ciphertext blobs in PostgreSQL. The server routes them by channel ID without decryption.
- **Media**: LiveKit SFU forwards encrypted frames. Frame keys are never sent to the server; they travel via Signal-encrypted WebSocket messages between clients.
- **LiveKit tokens**: The Go backend validates the user's JWT and issues a LiveKit access token. It does not check room-level permissions beyond membership (enforced at the application layer).

## Browser support

| Browser | Chat E2EE (Signal Protocol) | Media E2EE (LiveKit) |
|-|-|-|
| Chromium (Chrome, Edge, Brave, Arc) | Full | Full (Insertable Streams) |
| Firefox | Full | Partial (Insertable Streams support varies) |
| Safari | Full | Limited (Insertable Streams / E2EE worker limitations) |

Full media E2EE requires Insertable Streams and the LiveKit E2EE worker. If the worker fails to load, the app blocks media entirely and shows "Media encryption unavailable."

## Known limitations

- **No device verification UI:** Planned for a future milestone. Users cannot verify identity keys in-app. MITM by a compromised pre-key server is theoretically possible until Safety Numbers are implemented.
- **Past message recovery:** If a user loses all linked devices and re-derives their identity from the 12-word mnemonic, the account and server memberships are recovered, but past encrypted messages are irrecoverable (session state is gone). This is by design — there is no server-side key escrow.
- **Mnemonic is the sole recovery mechanism:** If a user loses both the mnemonic and all linked devices, the account is irrecoverable. A new account must be created. There is no email, password, or central recovery server.
- **Guest accounts:** Share the same TOFU trust model as registered accounts. Guest sessions are temporary; keys are lost when the session ends.
- **WebCrypto nonce management:** AES-GCM frame encryption uses a counter-based nonce. Nonce reuse with the same key would break confidentiality. The implementation must ensure counters never repeat (even across page reloads within the same key lifecycle).

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

Chat messages are stored as ciphertext blobs; the server never processes plaintext content.

## CORS

- **Development:** Default `CORS_ORIGIN` is `*`.
- **Production:** Set `CORS_ORIGIN` to your frontend origin in `.env`. Both the Go backend and Caddy use this value.

## Production checklist

| Item | Action |
|-|-|
| **CORS** | Set `CORS_ORIGIN` to your frontend origin. Do not use `*` in production. |
| **HSTS** | Use `caddy/Caddyfile.prod` for `Strict-Transport-Security`. |
| **COOP** | `Cross-Origin-Opener-Policy: same-origin` must be sent. COEP is not required. |
| **Secrets** | Do not use default values. Generate strong `JWT_SECRET`, `LIVEKIT_API_SECRET`, `POSTGRES_PASSWORD`. See `docs/SETUP.md`. |
| **Dependencies** | Run `npm audit` in `client/` and `cargo audit` in `hush-crypto/` before production. |

## Rate limiting

Rate limiting is planned for Phase F. Target limits:
- Registration / key challenge endpoints (`/api/auth/*`): 5 req/min per IP
- Message send: 30 msg/min per user
- Key upload: 10 req/min per user
- General API: 100 req/min per IP

## Content-Security-Policy

CSP is planned for Phase F. Will be configured in Caddy.
