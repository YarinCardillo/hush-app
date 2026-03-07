# Requirements: Hush MVP

**Defined:** 2026-03-03
**Revised:** 2026-03-07 — BIP39 cryptographic identity model adopted; IDEN requirements moved to v1 (Phase J); OAuth removed
**Core Value:** Every message, every call, every screen share is end-to-end encrypted by default. The server is a blind relay.

---

## v1 Requirements

Requirements for MVP launch. Each maps to roadmap phases.

### Architecture — Single-Tenant (SUPERSEDED)

The following requirements were implemented in Phase E+ and are now superseded by the Multi-Tenant requirements below. Phase E+ will be reversed by Phase E+2.

- [x] ~~**ARCH-01**: Backend serves one community per deployment (no multi-tenancy)~~ — superseded by MTNT-01
- [x] ~~**ARCH-02**: `servers` and `server_members` tables removed, replaced by `instance_config` and `members`~~ — superseded by MTNT-02
- [x] ~~**ARCH-03**: API endpoints flattened (no `/:serverId` path params)~~ — superseded by MTNT-03
- [x] ~~**ARCH-04**: WebSocket hub broadcasts to all connected clients (no server-scoped routing)~~ — superseded by MTNT-04
- [x] ~~**ARCH-05**: Frontend removes server list, server creation, server switching~~ — superseded by MTNT-05
- [x] ~~**ARCH-06**: All existing tests updated and passing with new schema~~ — superseded by MTNT-07

### Architecture — Multi-Tenant (Active)

- [x] **MTNT-01**: One instance (backend + DB + LiveKit) hosts N guilds; guild data is isolated (channels, members, invites are per-guild)
- [x] **MTNT-02**: `servers` and `server_members` tables exist; `channels` and `invite_codes` have `server_id` FK; `instance_config` is retained for instance-level settings
- [x] **MTNT-03**: Guild-scoped API routes: channels under `/api/servers/:id/channels`, members under `/api/servers/:id/members`, invites under `/api/servers/:id/invites`
- [x] **MTNT-04**: WebSocket hub has `BroadcastToServer(serverID, msg)` — events are delivered only to members of the target guild
- [x] **MTNT-05**: Frontend shows guild list sidebar, guild creation (when policy allows), guild switching; a user sees only guilds they have joined
- [x] **MTNT-06**: `instance_config` controls `registration_mode` (`open`, `invite_only`, `waitlist`, `closed`) and `server_creation_policy` (`any_member`, `admin_only`, `paid_only`)
- [x] **MTNT-07**: All existing Go tests and frontend tests pass against the multi-tenant schema; no test modifications to expected behavior

### Instance Roles

- [x] **IROLE-01**: Two independent role layers: `users.role` (instance-level: `owner`, `admin`, `member`) and `server_members.role` (guild-level: `owner`, `admin`, `mod`, `member`)
- [x] **IROLE-02**: Instance admin is not automatically a member of any guild; must join explicitly or use admin override
- [x] **IROLE-03**: Instance ban removes a user from all guilds, revokes all auth tokens, and prevents re-registration
- [x] **IROLE-04**: Guild ban is guild-scoped; banned user can still participate in other guilds on the same instance
- [x] **IROLE-05**: Instance admin override actions are logged separately from normal guild moderation actions

### Moderation

- [x] **MOD-01**: Moderator can kick a member from a guild (removes from that guild, broadcasts event to guild members)
- [x] **MOD-02**: Admin can ban a member from a guild with reason (prevents rejoin via invite link, optional expiry)
- [x] **MOD-03**: Moderator can mute a member within a guild with duration (prevents sending messages/speaking in that guild)
- [x] **MOD-04**: User can delete own messages; moderator can delete any message in their guild
- [x] **MOD-05**: Admin can change member roles within a guild (member/mod/admin)
- [x] **MOD-06**: All moderation actions require reason field
- [x] **MOD-07**: Audit log records all moderation actions per guild (actor, target, action, reason, timestamp)
- [x] **MOD-08**: All moderation enforced server-side (no client-only enforcement)
- [x] **MOD-09**: Moderation context menu on member list (right-click or long-press)

### Security Hardening

- [x] **SEC-01**: Rate limiting on auth endpoints (5 req/min per IP)
- [x] **SEC-02**: Rate limiting on message send (30 msg/min per user per guild)
- [x] **SEC-03**: Rate limiting on key upload (10 req/min per user)
- [x] **SEC-04**: General API rate limiting (100 req/min per IP)
- [x] **SEC-05**: WebSocket message rate limiting inside read loop (not HTTP middleware)
- [x] **SEC-06**: Security headers: CSP (with explicit `wss://`), X-Content-Type-Options, X-Frame-Options
- [x] **SEC-07**: HSTS header in production (without preload initially)
- [x] **SEC-08**: WebSocket Origin header validation on upgrade

### Instance Management

- [x] **INST-01**: `GET /api/handshake` returns `server_version`, `api_version`, `min_client_version`, `opk_low_threshold`, `server_creation_policy`, `registration_mode`, and `capabilities`
- [x] **INST-02**: Handshake is public (no auth required), stateless, mounts before auth middleware
- [x] **INST-03**: System messages channel type (plaintext, server-generated, guild member read-only)
- [x] **INST-04**: System events emitted per guild: member joined, member left, member kicked, member banned, role changed
- [ ] **INST-05**: Default guild template on creation: `#system` (type=system), `#general` (type=text), `General` (type=voice, quality mode)
- [x] **INST-06**: Capability list includes: `e2ee.chat`, `e2ee.media`, `voice.channels`

### Crypto Lifecycle

- [ ] **CRYP-01**: Client rotates SPK every 7 days (client-driven, server tracks `spk_uploaded_at`)
- [ ] **CRYP-02**: Old SPK retained for 24h grace period (in-flight session compatibility)
- [ ] **CRYP-03**: Schema extended for SPK version history
- [ ] **CRYP-04**: Server sends `keys.low` when OPK count drops below threshold declared in handshake
- [ ] **CRYP-05**: Client auto-generates and uploads 100 OPKs on `keys.low` event
- [ ] **CRYP-06**: OPK replenishment also triggered on login/app startup

### Cryptographic Identity (BIP39)

- [ ] **IDEN-01**: BIP39 12-word mnemonic generated at registration; root keypair derived deterministically; mnemonic shown ONCE with explicit irrecoverability warning
- [ ] **IDEN-02**: Server stores ONLY root public key per account; no email, no password, no encrypted blob
- [ ] **IDEN-03**: Challenge-response auth: server sends nonce, client signs with private key, server verifies, issues JWT session token
- [ ] **IDEN-04**: Multi-device: each device has independent keypair; QR-based device certification; server maintains per-account certified device public key list
- [ ] **IDEN-05**: Recovery with mnemonic (no device): re-enter 12 words → regenerate root IK → re-certify; past messages irrecoverable, account identity recovered
- [ ] **IDEN-06**: Recovery with neither mnemonic nor device: account irrecoverable
- [ ] **IDEN-07**: Guest access uses ephemeral keypair (no mnemonic, no recovery, no device linking)

### Launch Preparation

- [ ] **LNCH-01**: `scripts/setup.sh` generates secrets, writes .env, runs migrations, starts stack
- [ ] **LNCH-02**: Self-hosting deploy achievable in under 10 minutes
- [ ] **LNCH-03**: XSS review on chat rendering (input sanitization)
- [ ] **LNCH-04**: AES-GCM nonce audit in e2eeKeyManager.js
- [ ] **LNCH-05**: Message content size enforcement
- [ ] **LNCH-06**: Code quality pass (CLAUDE.md compliance: function length, naming, error handling)
- [ ] **LNCH-07**: Edge case: page refresh during voice reconnects LiveKit + re-establishes frame key
- [ ] **LNCH-08**: Edge case: network disconnect triggers WebSocket reconnection + Signal session recovery
- [ ] **LNCH-09**: Edge case: two tabs same browser detected and warned
- [ ] **LNCH-10**: Edge case: guest session expiry mid-call shows graceful error
- [ ] **LNCH-11**: README.md with new architecture and self-hosting guide
- [ ] **LNCH-12**: SECURITY.md with Signal Protocol threat model
- [ ] **LNCH-13**: ARCHITECTURE.md final state documentation

---

## v2 Requirements

Deferred to post-MVP. Tracked but not in current roadmap.

### Group Optimization

- **GRP-01**: Sender Key protocol for O(1) group encryption (channels >50 members)

### Content

- **CONT-01**: File/media sharing with client-side encryption
- **CONT-02**: Message editing with "edited" indicator
- **CONT-03**: Direct messages (1:1 and small-group) via shared instance, P2P, or mailbox relay

### Platform

- **PLAT-01**: Desktop app (Tauri + CEF)
- **PLAT-02**: Mobile app (React Native + UniFFI)
- **PLAT-03**: Push notifications via mailbox relay (Firebase/APNs)

### Social

- **SOC-01**: Friend system via Hush ID (public key derived, shareable cross-platform)
- **SOC-02**: DM routing: shared instance → P2P WebRTC → mailbox relay (transparent to user)
- **SOC-03**: Friend list stored in encrypted blob (portable, not per-instance)
- **SOC-04**: Mailbox relay — open source, self-hostable, ciphertext-only buffer with push support
- **SOC-05**: P2P rendezvous server for WebRTC signaling (publicKey → current endpoint)

### ~~Identity~~ (moved to v1 — see Cryptographic Identity (BIP39) section above, Phase J)

### Discovery

- **DISC-01**: Guest access via instance capabilities
- **DISC-02**: Guild discoverability / directory protocol (opt-in per guild)
- ~~**DISC-03**: OAuth providers (Google, GitHub, Apple)~~ — removed; identity is cryptographic keypair, no email/password to federate

### Monetization

- **MON-01**: `subscriptions` table (user_id, server_id, stripe_subscription_id, plan, status) — payer linked to guild, not hardcoded on server row
- **MON-02**: `server_creation_policy = 'paid_only'` enforced at guild creation endpoint
- **MON-03**: Plan tier limits (max_members, retention, voice channels) defined in instance config, not hardcoded per server

---

## Out of Scope

| Feature | Reason |
|-|-|
| Content scanning / AI moderation | Requires server to read plaintext — breaks E2EE guarantee |
| Server-side message reporting with content review | Sending decrypted content to server is a backdoor |
| Server-side edit history | Storing N ciphertext versions is expensive and leaks edit metadata |
| Federation (Hush-to-Hush) | Not needed given portable identity + P2P DM model; revisit if community demand emerges |
| Multi-region LiveKit | Post-MVP scaling concern |
| IP ban | Optional enhancement; user_id ban is sufficient for MVP |
| Message retention enforcement | Post-MVP; storage is cheap during beta, implement when actual cost pressure emerges |
| servers.plan / servers.max_members columns | Anti-pattern — limits belong to plan tier config, not per-server schema |
| servers.stripe_subscription_id column | Anti-pattern — subscription belongs to user-server relationship, not server row |

---

## Traceability

| Requirement | Phase | Status |
|-|-|-|
| ARCH-01 | Phase E+ | Superseded |
| ARCH-02 | Phase E+ | Superseded |
| ARCH-03 | Phase E+ | Superseded |
| ARCH-04 | Phase E+ | Superseded |
| ARCH-05 | Phase E+ | Superseded |
| ARCH-06 | Phase E+ | Superseded |
| MTNT-01 | Phase E+2 | Complete |
| MTNT-02 | Phase E+2 | Complete |
| MTNT-03 | Phase E+2 | Complete |
| MTNT-04 | Phase E+2 | Complete |
| MTNT-05 | Phase E+2 | Complete |
| MTNT-06 | Phase E+2 | Complete |
| MTNT-07 | Phase E+2 | Complete |
| IROLE-01 | Phase E+2 | Complete |
| IROLE-02 | Phase E+2 | Complete |
| IROLE-03 | Phase G | Complete |
| IROLE-04 | Phase E+2 | Complete |
| IROLE-05 | Phase G | Complete |
| MOD-01 | Phase F | Complete |
| MOD-02 | Phase F | Complete |
| MOD-03 | Phase F | Complete |
| MOD-04 | Phase F | Complete |
| MOD-05 | Phase F | Complete |
| MOD-06 | Phase F | Complete |
| MOD-07 | Phase F | Complete |
| MOD-08 | Phase F | Complete |
| MOD-09 | Phase F | Complete |
| SEC-01 | Phase F | Complete |
| SEC-02 | Phase F | Complete |
| SEC-03 | Phase F | Complete |
| SEC-04 | Phase F | Complete |
| SEC-05 | Phase F | Complete |
| SEC-06 | Phase F | Complete |
| SEC-07 | Phase F | Complete |
| SEC-08 | Phase F | Complete |
| INST-01 | Phase K.1 | Complete |
| INST-02 | Phase K.1 | Complete |
| INST-03 | Phase K.4 | Complete |
| INST-04 | Phase K.4 | Complete |
| INST-05 | Phase K.5 | Pending |
| INST-06 | Phase K.1 | Complete |
| CRYP-01 | Phase B.7 | Pending |
| CRYP-02 | Phase B.7 | Pending |
| CRYP-03 | Phase B.7 | Pending |
| CRYP-04 | Phase B.7 | Pending |
| CRYP-05 | Phase B.7 | Pending |
| CRYP-06 | Phase B.7 | Pending |
| IDEN-01 | Phase J | Pending |
| IDEN-02 | Phase J | Pending |
| IDEN-03 | Phase J | Pending |
| IDEN-04 | Phase J | Pending |
| IDEN-05 | Phase J | Pending |
| IDEN-06 | Phase J | Pending |
| IDEN-07 | Phase J | Pending |
| LNCH-01 | Phase I | Pending |
| LNCH-02 | Phase I | Pending |
| LNCH-03 | Phase I | Pending |
| LNCH-04 | Phase I | Pending |
| LNCH-05 | Phase I | Pending |
| LNCH-06 | Phase I | Pending |
| LNCH-07 | Phase I | Pending |
| LNCH-08 | Phase I | Pending |
| LNCH-09 | Phase I | Pending |
| LNCH-10 | Phase I | Pending |
| LNCH-11 | Phase I | Pending |
| LNCH-12 | Phase I | Pending |
| LNCH-13 | Phase I | Pending |

**Coverage:**
- v1 active requirements: 56 total (7 MTNT + 5 IROLE + 9 MOD + 8 SEC + 6 INST + 6 CRYP + 7 IDEN + 13 LNCH — 6 superseded ARCH excluded)
- Mapped to phases: 56
- Unmapped: 0

---
*Requirements defined: 2026-03-03*
*Last updated: 2026-03-07 — BIP39 identity model; IDEN-01→07 moved to v1 (Phase J); OAuth removed*
