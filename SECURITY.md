# Security

This document describes Hush's end-to-end encryption (E2EE) implementation, trust model, and known limitations.

## Encryption algorithms

| Layer | Algorithm | Purpose |
|-|-|-|
| Key agreement | X3DH (Extended Triple Diffie-Hellman) | Initial session establishment between two devices |
| Chat messages | Double Ratchet (Signal Protocol) | Per-message encryption with forward secrecy |
| Group chat key distribution | Pairwise Signal sessions | Symmetric key distributed via encrypted 1:1 channels |
| Media frames | AES-256-GCM via Insertable Streams | Frame-level encryption for voice, video, and screen share |

## Chat encryption

**Protocol**: Signal Protocol via `libsignal-protocol-typescript` (web) and `hush-crypto` Rust crate (desktop/mobile).

**Session establishment**:
1. On registration, client generates: identity key pair, signed pre-key, batch of one-time pre-keys
2. Keys uploaded to Go backend pre-key server (`POST /api/keys/upload`)
3. To message a new contact: fetch their pre-key bundle (`GET /api/keys/:userId`), perform X3DH handshake
4. Subsequent messages use Double Ratchet — each message has a unique key, compromising one does not reveal others

**Group messaging**:
- Small groups (< 50 members): fan-out encryption — each message individually encrypted per recipient via their Signal session
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

**Key rotation (rekeying)**: When a participant leaves, the leader generates a new key and distributes it to all remaining participants. This provides forward secrecy for media — a departed participant cannot decrypt future frames.

**Leader election**: Deterministic — the participant with the lowest user ID. On leader disconnect, next lowest takes over, generates a new key, and distributes.

**No silent degradation**: If the E2EE worker fails to load or key exchange fails after 3 retry attempts (exponential backoff: 1s, 2s, 4s), the client does NOT connect to LiveKit. Media without encryption is never permitted.

## Trust model

- **Trust on first use (TOFU)**: Devices are trusted when first seen. There is no in-app device verification yet (no Safety Numbers comparison, no QR scan). Users must rely on out-of-band verification to confirm a device.
- **Pre-key server trust**: The Go backend stores public pre-keys. A compromised server could serve malicious pre-keys (MITM). This is mitigated in a future milestone by Safety Numbers verification (Signal's identity key fingerprint comparison).

## Server behavior

The server never sees plaintext for chat or media:
- **Chat**: Messages stored as ciphertext blobs in PostgreSQL. The server routes them by channel ID without decryption.
- **Media**: LiveKit SFU forwards encrypted frames. Frame keys are never sent to the server — they travel via Signal-encrypted WebSocket messages between clients.
- **LiveKit tokens**: The Go backend validates the user's JWT and issues a LiveKit access token. It does not check room-level permissions beyond membership (enforced at the application layer).

## Browser support

| Browser | Chat E2EE (Signal Protocol) | Media E2EE (LiveKit) |
|-|-|-|
| Chromium (Chrome, Edge, Brave, Arc) | Full | Full (Insertable Streams) |
| Firefox | Full | Partial (Insertable Streams support varies) |
| Safari | Full | Limited (Insertable Streams / E2EE worker limitations) |

Full media E2EE requires Insertable Streams and the LiveKit E2EE worker. If the worker fails to load, the app blocks media entirely and shows "Media encryption unavailable."

## Known limitations

- **No device verification UI** — Planned for a future milestone. Users cannot verify identity keys in-app. MITM by a compromised pre-key server is theoretically possible until Safety Numbers are implemented.
- **No key backup** — Losing browser data (clearing IndexedDB) means losing the ability to decrypt past chat history and losing Signal session state. Planned: encrypted key backup with user passphrase.
- **No multi-device** — Signal Protocol sessions are per-device. A user logged in on two devices has two separate sets of sessions. Planned: multi-device sync via encrypted key transfer.
- **No cross-signing** — Verification does not propagate across devices.
- **Guest accounts** — Share the same TOFU trust model as registered accounts. Guest sessions are temporary; keys are lost when the session ends.
- **WebCrypto nonce management** — AES-GCM frame encryption uses a counter-based nonce. Nonce reuse with the same key would break confidentiality. The implementation must ensure counters never repeat (even across page reloads within the same key lifecycle).
