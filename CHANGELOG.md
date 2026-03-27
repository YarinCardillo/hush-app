# Changelog

All notable changes to Hush are documented here.

This changelog is a human-readable narrative of the project's evolution, intended for security auditors, contributors, and community members who want to understand what was built and in what order. It is not a git log dump.

---

## [v1.0] — 2026-03 — Production Launch Preparation

**Phase I: Hardening, documentation, and self-hosting packaging.**

The final polish pass before v1.0. Focus on correctness, security hardening, and operator experience rather than new features.

**Security hardening:** Security audit covering XSS surfaces (confirmed clean — React JSX escaping is the sole render path), AES-GCM nonce audit (PBKDF2-SHA256 at 200k iterations, 12-byte CSPRNG nonces confirmed correct), and message size enforcement. Server ciphertext limit tightened from 64 KiB to 8 KiB to match MLS overhead budget. Client switched from character count to byte-based enforcement (TextEncoder, 4,000 byte plaintext limit with ~2x headroom for UTF-8 multi-byte characters).

**Edge case hardening:** Single-tab enforcement via BroadcastChannel API (MLS group state is not safe for concurrent tabs). Voice channel reconnect overlay with retry on page refresh. Network disconnect recovery with automatic WS reconnect and MLS catch-up. Guest session expiry warning and clean exit flow.

**Self-hosting packaging:** `scripts/setup.sh` rewritten as a fully autonomous first-run script — checks Docker, generates six secrets, writes `.env` and Caddy config, pulls images, runs migrations, starts the stack, and health-checks the running instance. `scripts/update.sh` adds a pg_dump backup step before any image pull. `docker-compose.prod.yml` finalized as a standalone production compose (no override chaining). Caddy auto-HTTPS via Let's Encrypt configured from domain name alone.

**Documentation:** README, SECURITY.md, ARCHITECTURE.md, and CHANGELOG rewritten from scratch to accurately reflect the current MLS-encrypted, BIP39-identity, backend-opaque, multi-tenant architecture.

---

## [v0.9] — 2026-03 — Multi-Instance Client

**Phase U: Unified multi-instance client.**

The client connects to N Hush instances simultaneously. Guilds from all instances appear in a flat sidebar aggregated by instance color. Each instance maintains an independent WebSocket connection with JWT authentication. Instance registry lives in browser storage. This is the architecture for a federated identity model where users host their own instances but interact across them.

---

## [v0.8] — 2026-03 — MLS Migration (Signal → MLS)

**Phase M: Signal Protocol → MLS (RFC 9420) via OpenMLS 0.8.1.**

This was the largest architectural pivot in the project's history. The Signal Protocol implementation (`libsignal-dezire`) was removed entirely and replaced with MLS (Messaging Layer Security), the IETF standard group key agreement protocol.

**Why MLS over Signal:** Signal's X3DH + Double Ratchet is designed for 1:1 messaging, not groups. Group messaging in Signal requires per-recipient fan-out encryption that scales O(N) with group size. MLS uses TreeKEM — O(log N) group key operations — and provides the same forward secrecy and post-compromise security guarantees with efficient group membership management.

**What changed:** The `hush-crypto` Rust crate was rewritten to wrap OpenMLS. One MLS group per channel replaces per-recipient session fan-out. MLS `export_secret()` replaces the previous Signal-based voice frame key distribution. The server no longer needs to process per-recipient ciphertext routing. Database schema migrated: `signal_*` tables dropped, `mls_credentials` and `mls_key_packages` tables added. Voice group MLS added for frame key derivation. Backend opacity migration: `servers` and `channels` tables now store only `encrypted_metadata BYTEA` — guild names, channel names, and all human-readable metadata are encrypted client-side.

**Security note on the removed dependency:** The pre-MLS `libsignal-dezire` dependency had two vulnerabilities found and patched in our fork: a DoS panic on invalid Montgomery u-coordinates (High severity) and missing zeroization of DH private keys (Medium). These are fully removed from the codebase.

---

## [v0.7] — 2026-02 — Key Transparency

**Phase K: Transparency log for key operations.**

A signed Merkle tree records all key operations: user registration, device add, device revoke, KeyPackage rotation. Clients verify their own inclusion proofs at login and on key changes via `/api/transparency/verify`. This provides T.1 transparency: detection of unauthorized key changes by the instance operator's own log. The log uses Ed25519-signed leaf nodes; the signing key seed is generated once by `setup.sh` and stored as `TRANSPARENCY_LOG_PRIVATE_KEY`.

---

## [v0.7] — 2026-02 — BIP39 Cryptographic Identity

**Phase J: BIP39 mnemonic-based identity.**

Replaced username/password auth with cryptographic identity. A 12-word BIP39 mnemonic deterministically generates an Ed25519 root keypair. Authentication is a challenge-response: server sends a random nonce, client signs with the root private key, server verifies. No password hash, no email — the server stores only the public key.

Multi-device: each device has its own independent keypair. An existing authenticated device signs a certificate for the new device's public key via QR scan. The server maintains the list of certified device keys per account. Private keys never leave the device.

The identity vault encrypts the mnemonic seed at rest using AES-256-GCM with a key derived from the user's vault PIN via PBKDF2-SHA256 (200k iterations, 16-byte random salt). The decrypted seed lives in memory only for the duration of the session.

---

## [v0.6] — 2026-02 — Multi-Tenant Restoration and Rate Limiting

**Phase F/G: Multi-tenant architecture, rate limiting, admin dashboard.**

Restored multi-guild architecture after a single-tenant refactor: `servers` and `server_members` tables with guild-scoped foreign keys, WebSocket hub with `BroadcastToServer(serverID, msg)` for per-guild broadcast. Rate limiting added to all API endpoints and WebSocket message paths. Standalone admin dashboard (`client/admin/`) with API key authentication — sees only UUIDs and metrics, never plaintext content.

---

## [v0.5] — 2026-02 — Go Backend + Guild/Channel Architecture

**Phase E+/E+2: Go backend, Discord-like guild structure.**

Replaced the Node.js backend with Go (Chi router). Architected the guild/channel model: servers with text and voice channels, drag-and-drop channel reordering with server-side persistence, member list with real-time presence, invite links, guild settings. Real-time via WebSocket with per-guild broadcast hub. LiveKit SFU integration for voice/video/screen share replacing the earlier mediasoup implementation. Frame-level E2EE via LiveKit Insertable Streams.

**Previous Signal Protocol implementation:** This phase originally shipped with Signal Protocol (X3DH + Double Ratchet) via `hush-crypto` WASM for 1:1 session-based encryption. This was superseded by MLS in v0.8 (see above). The migration is documented in Phase M.

---

## [v0.4] — 2026-02 — End-to-End Encryption (Matrix/Olm Era, Superseded)

**Phases A–D: Initial Matrix + Olm/Megolm E2EE implementation.**

The first E2EE attempt used Matrix Synapse for auth and room management with Olm/Megolm for encryption. This entire approach was superseded: Matrix was removed and replaced with the Go backend (Phase E+), and Olm/Megolm was replaced by Signal Protocol (Phase E+) and then MLS (Phase M). These phases are preserved in changelog history for auditability but the corresponding code is no longer present.

---

## [v0.1–v0.3] — 2026-01 — Foundation

**Initial implementation: WebRTC rooms, mediasoup SFU, ephemeral chat.**

Original platform: WebRTC rooms via mediasoup (up to 4 participants), quality presets (1080p/720p), noise gate AudioWorklet, screen share, webcam, microphone. Ephemeral text chat within rooms. iOS Safari compatibility. Logo wordmark. No E2EE at this stage — security was added in subsequent phases.
