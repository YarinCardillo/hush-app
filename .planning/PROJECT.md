# Hush

## What This Is

Hush is a privacy-first Discord alternative with end-to-end encryption on everything: chat, voice, video, and screen sharing. Open source, self-hostable, Discord-like UX. The server sees nothing. One backend deployment equals one community; no multi-tenancy.

Target: communities that need always-on voice/text channels with real privacy — not a meeting tool, a place where people live.

## Core Value

Every message, every call, every screen share is end-to-end encrypted by default. The server is a blind relay. If E2EE breaks, nothing else matters.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Phases A-E complete. -->

- ✓ Go backend with placeholder auth (register, login, guest, JWT sessions) — Phase A (auth will be replaced by BIP39 cryptographic identity in Phase J)
- ✓ PostgreSQL schema with migrations (golang-migrate) — Phase A
- ✓ WebSocket hub (presence, channel subscriptions, broadcast) — Phase A
- ✓ LiveKit token endpoint (replaces lk-jwt-service) — Phase A
- ✓ Signal Protocol pre-key server (upload, retrieve, OPK consumption) — Phase B
- ✓ Rust hush-crypto crate (X3DH, Double Ratchet, WASM + native) — Phase B
- ✓ Client-side Signal integration (key generation, session establishment, encrypt/decrypt) — Phase B
- ✓ Client key storage in IndexedDB (identity, sessions, pre-keys) — Phase B
- ✓ Encrypted message cache (IndexedDB, device-key AES-GCM at rest) — Phase B
- ✓ libsignal-dezire audited, forked, patched (panic DoS + zeroization) — Phase B
- ✓ Interop test suite (30 tests against official libsignal-core) — Phase B
- ✓ Encrypted text chat via WebSocket + Signal Protocol — Phase C
- ✓ Message history with cursor-based pagination — Phase C
- ✓ Typing indicators — Phase C
- ✓ Frame key distribution via Signal (replaced Matrix to-device) — Phase D
- ✓ LiveKit E2EE with Insertable Streams + WebCrypto AES-GCM — Phase D
- ✓ Leader election for frame key management — Phase D
- ✓ Server/channel CRUD with Discord-like UX — Phase E
- ✓ Voice channel modes (low-latency, quality) — Phase E
- ✓ Categories, drag-and-drop reordering — Phase E
- ✓ Invite links — Phase E
- ✓ Member list with presence — Phase E
- ✓ Auth UI migrated to Go backend (Matrix fully removed) — Phase E (placeholder email/password auth; BIP39 identity replaces in Phase J)
- ✓ Persistent voice session across navigation — Phase E
- ✓ Voice state broadcast via LiveKit webhooks — Phase E
- ✓ WS broadcast coverage for all server mutations — Phase E

### Active

<!-- Current scope: MVP path (E+ -> F -> K.1/K.4/K.5 -> B.7 -> I) -->

- [ ] Single-server architecture migration (remove servers/server_members tables, flatten API) — Phase E+
- [ ] Moderation tools (kick, ban, mute, role enforcement, message delete) — Phase F
- [ ] Rate limiting on auth, messages, key upload, general API — Phase F
- [ ] Security headers (CSP, HSTS, X-Frame-Options) — Phase F
- [ ] Instance handshake endpoint (GET /api/handshake, capabilities, versioning) — Phase K.1
- [ ] System messages channel (join, leave, kick, ban, role changes) — Phase K.4
- [ ] Default channel template on instance init (system, general, meeting room) — Phase K.5
- [ ] BIP39 cryptographic identity (mnemonic-based keypair, challenge-response auth, linked devices via QR) — Phase J
- [ ] SPK rotation + OPK replenishment automation — Phase B.7
- [ ] Self-hosting setup script (setup.sh, under 10 min deploy) — Phase I.3
- [ ] Security audit (XSS, nonce audit, input validation) — Phase I.4
- [ ] Code quality pass (CLAUDE.md compliance) — Phase I.5
- [ ] Edge case handling (refresh during voice, network disconnect, two tabs, guest expiry) — Phase I.6
- [ ] Documentation (README, SECURITY.md, ARCHITECTURE.md final state) — Phase I.7

### Out of Scope

<!-- Explicit boundaries. Post-MVP unless stated otherwise. -->

- Sender Key group messaging (B.6) — fan-out works for <50 members, optimization not launch-blocking
- File/media sharing in chat — requires encrypted upload pipeline, deferred to v1.1
- Direct messages — uses existing Signal sessions but needs separate UI/tables, deferred to v1.1
- Desktop app (Tauri + CEF) — Phase G, post-MVP
- Mobile app (React Native + UniFFI) — Phase H, post-MVP
- Guest access via capabilities (K.2) — post-MVP
- Instance discoverability / directory protocol (K.3) — post-MVP
- Federation (Hush-to-Hush) — only if demand justifies it
- Multi-region LiveKit deploy — post-MVP (gethush.live scaling)
- Message editing — v1.1
- Web push notifications — v1.2+
- Advanced media (simulcast UI, encrypted recording) — v1.2+

## Context

**Brownfield refactor:** Hush started on Matrix (Synapse + Olm/Megolm). Matrix crypto was dropped due to CVEs in libolm and fundamental ECDH weaknesses in Olm found by Soatok's 2025 audit. The rewrite replaces Synapse with a custom Go backend and Olm with Signal Protocol (via a Rust crate wrapping libsignal-dezire, a fork audited and patched in-house).

**What carries over:** React UI, LiveKit media pipeline, design system, device management, audio processing (noise gate worklet, bandwidth estimator), connection robustness patterns.

**What's removed:** Synapse, matrix-js-sdk, vodozemac, libolm, lk-jwt-service.

**Architecture model (from going_forward.md):** One backend hosts N guilds. The client connects to N independent backends (desktop/mobile manage an instance list; web client is bound to URL). Each backend has its own user database, auth sessions, and Signal keys.

**Identity model:** Every user has a cryptographic identity derived from a BIP39 12-word mnemonic. The root keypair is deterministic from the mnemonic. The server stores only public keys — no email, no password, no encrypted blobs. Multi-device linking uses QR-based device certification (new device shows QR, existing device scans and signs). Recovery is mnemonic-only; if lost with no linked devices, the account is irrecoverable. Guest access uses ephemeral keypairs (no mnemonic). JWT tokens are used as session tokens after cryptographic proof of key ownership, not as the identity mechanism itself.

**Current code state:** Phases A-E complete on `core-rewrite` branch. Go backend operational with 40+ tests. Signal Protocol end-to-end working. Full Discord-like UX. Zero Matrix dependencies remain. Current schema still has `servers`/`server_members` tables from the multi-server era — Phase E+ removes these.

**Monetization:** Core app is 100% free and open source. Revenue from managed hosting (gethush.live, EUR 15-30/mo per instance) and donations. Hosted-specific logic lives in `hosted/` — core app has zero payment awareness.

## Constraints

- **Tech stack**: Go backend, React 18 frontend, Rust hush-crypto (WASM for web, native for desktop, UniFFI for mobile), PostgreSQL, LiveKit SFU — decided and implemented
- **Crypto**: Signal Protocol only (X3DH + Double Ratchet). No Olm/Megolm, no Matrix compatibility
- **E2EE media**: Insertable Streams (Chromium-only for full support). Desktop uses Tauri + CEF to guarantee Chromium
- **Design system**: Hand-written CSS, no frameworks/libraries. All UI must match existing design language in `design-system.md`
- **Branch strategy**: All work on `core-rewrite`, sub-branches per phase. `main` untouched until refactor ships
- **Self-hosting**: Docker Compose is the default deployment. No cloud-only features in core app
- **Privacy model**: Server is a blind relay. No plaintext ever touches the server. No telemetry, no analytics in core app

## Key Decisions

| Decision | Rationale | Outcome |
|-|-|-|
| Drop Matrix/Synapse | libolm CVEs + Olm ECDH weakness (Soatok 2025 audit) | ✓ Good |
| Signal Protocol via Rust crate | Single implementation across all platforms (WASM/native/UniFFI) | ✓ Good |
| Fork libsignal-dezire | Panic DoS + missing zeroization in upstream. In-house patches applied | ✓ Good |
| Tauri + CEF for desktop | Insertable Streams requires Chromium; hush-crypto native via IPC | -- Pending |
| Single-server model | 1 backend = 1 community. Simplifies everything. Multi-instance is client-side | -- Pending |
| BIP39 cryptographic identity | 12-word mnemonic derives root keypair; server stores only public key; no email/password; JWT remains as session token after challenge-response auth (Phase J) | -- Pending |
| Self-hosted LiveKit only | Always-on voice makes per-minute billing unsustainable. Privacy model forbids third-party relay | ✓ Good |
| No Sender Key for MVP | Fan-out O(N) is acceptable for groups <50. B.6 is a v1.1 optimization | -- Pending |

---
*Last updated: 2026-03-07 — aligned with BIP39 cryptographic identity model*
