# Roadmap: Hush MVP

## Overview

Phases A–E are complete on `core-rewrite`. Phase E+ (single-tenant migration) was completed but is being reversed: the architecture has pivoted back to multi-tenant (N guilds per instance) to make infrastructure costs sustainable. Phase E+2 restores the servers/server_members schema and re-scopes all APIs, hub broadcasts, and frontend to the guild model.

The MVP path forward: E+2 (multi-tenant restoration) → F (security hardening + moderation, guild-scoped) → K.1 (instance handshake) → K.4 (system messages per guild) → K.5 (default guild template) → B.7 (crypto key lifecycle) → K.6 (integration wiring fixes) → J (BIP39 cryptographic identity + linked devices) → I (launch preparation).

## Phases

**Completed (Phases A–E):**
- [x] **Phase A: Go Backend Foundation** — Placeholder auth (email/password + JWT), PostgreSQL, WebSocket hub, LiveKit token endpoint (auth replaced by BIP39 identity in Phase J)
- [x] **Phase B: Signal Protocol Core** — hush-crypto Rust crate, client key storage, E2EE message cache
- [x] **Phase C: Encrypted Chat** — WebSocket text messaging, history pagination, typing indicators
- [x] **Phase D: E2EE Voice/Video** — LiveKit Insertable Streams, frame key distribution, leader election
- [x] **Phase E: Discord-like UX** — Server/channel CRUD, categories, invites, member list, auth UI migration

**Superseded:**
- [~] **Phase E+: Single-Tenant Migration** — Completed 2026-03-03, reversed by E+2. `servers`/`server_members` dropped, API flattened, hub global broadcast. Architecture pivot on 2026-03-04 made single-tenant unsustainable for hosted deployment.

**Active (MVP path):**
- [x] **Phase E+2: Multi-Tenant Restoration** — Restore servers/server_members, re-scope APIs, guild-scoped hub broadcast, frontend guild list (completed 2026-03-04)
- [x] **Phase E+2.5: Critical Integration Fixes** — Fix route mismatch (message history 404), kick/ban force disconnect, missing API client functions (completed 2026-03-04)
- [x] **Phase F: Security Hardening + Moderation** — Rate limiting, security headers, kick/ban/mute (guild-scoped), audit log, voice mute enforcement, audit log viewer (completed 2026-03-05)
- [x] **Phase G: Instance-Level Admin Moderation** — Instance ban across all guilds, instance admin override logging (completed 2026-03-05)
- [x] **Phase K.1: Instance Handshake** — GET /api/handshake with capabilities, server_creation_policy, registration_mode (completed 2026-03-06; `registration_mode` will govern mnemonic generation policy after Phase J)
- [x] **Phase K.4: System Messages** — System channel type per guild, moderation event broadcasting (completed 2026-03-08)
- [x] **Phase K.5: Default Guild Template** — Seed #system, #general, voice room on guild creation (completed 2026-03-08)
- [x] **Phase B.7: Crypto Key Lifecycle** — SPK rotation with grace period, OPK replenishment automation (completed 2026-03-16)
- [ ] **Phase K.6: Cross-Phase Integration Wiring** — Fix voluntary leave client path, instance_updated WS payload, unstyled system events, OPK threshold propagation
- [ ] **Phase J: BIP39 Cryptographic Identity** — Mnemonic-based registration, challenge-response auth, linked-device QR flow, recovery via 12 words
- [ ] **Phase I: Launch Preparation** — Setup script, security audit, edge cases, documentation

---

## Phase Details

### Phase E+: Single-Tenant Migration (SUPERSEDED)
**Status**: Reversed by Phase E+2
**Was completed**: 2026-03-03
**Why reversed**: Single-tenant (one community per backend) makes hosted deployment (gethush.live) resource-prohibitive at scale. Multi-tenant (N guilds per instance, one DB + one LiveKit) is the correct architecture.
**Requirements covered**: ARCH-01→06 (all superseded)

---

### Phase E+2: Multi-Tenant Restoration
**Goal**: The backend hosts N guilds under one deployment; all APIs, hub events, and frontend are guild-scoped; instance_config governs instance-level policy
**Depends on**: Phase E (the pre-E+ codebase is the reference; E+ is being undone)
**Requirements**: MTNT-01, MTNT-02, MTNT-03, MTNT-04, MTNT-05, MTNT-06, MTNT-07, IROLE-01, IROLE-02, IROLE-03, IROLE-04, IROLE-05
**Success Criteria** (what must be TRUE):
  1. The `servers` and `server_members` tables exist; `channels.server_id` and `invite_codes.server_id` FKs are present; `instance_config` is retained with `registration_mode` and `server_creation_policy` columns
  2. A user authenticated on the instance sees only the guilds they have joined — not all guilds on the instance
  3. Every API route that creates, lists, or modifies channels/members/invites requires a `/:serverId` scope; a request without a valid guild membership returns 403
  4. WebSocket hub delivers guild events only to members of that guild (`BroadcastToServer(serverID, msg)`)
  5. The frontend sidebar shows the guild list, allows guild creation (when `server_creation_policy` permits), and switches guild context
  6. `GET /api/instance` returns `server_creation_policy` and `registration_mode`; the frontend hides/shows the "Create Guild" button accordingly
  7. Two-level role system: `users.role` (instance-level) and `server_members.role` (guild-level) coexist; instance ban removes user from all guilds and revokes tokens
  8. All existing Go tests pass against the restored multi-tenant schema
**Plans:** 5/5 plans complete

Plans:
- [x] E+2-01-PLAN.md — Schema + Store foundation (migration 000007, models, Store interface, db implementations)
- [x] E+2-02-PLAN.md — Hub BroadcastToServer + RequireGuildMember middleware + guild-scoped API handlers + routes
- [x] E+2-03-PLAN.md — Go test rewrite (mockStore, WS mock, server tests, updated existing tests)
- [x] E+2-04-PLAN.md — Frontend guild UX (guild strip, creation modal, guild switching, guild-scoped API client)
- [ ] E+2-05-PLAN.md — Gap closure: guild-scope moderation/moveChannel client paths + fix test assertions

---

### Phase E+2.5: Critical Integration Fixes
**Goal**: All integration bugs discovered by the v1.0 audit are resolved — message history loads, kicked/banned users are force-disconnected, and all moderation API client functions exist
**Depends on**: Phase E+2 (fixes bugs in E+2 output)
**Requirements**: — (no standalone requirements; closes integration gaps and broken flows)
**Gap Closure**: Closes gaps from v1.0 audit
**Success Criteria** (what must be TRUE):
  1. `getChannelMessages` in `api.js` builds the guild-scoped path (`/api/servers/:serverId/channels/:channelId/messages`); all call sites in `Chat.jsx` pass `serverId`; message history loads without 404
  2. `kickMember` and `banMember` in `moderation.go` call `hub.DisconnectUser()` after successful removal; kicked/banned user's WebSocket closes within one server tick
  3. `unbanUser` and `unmuteUser` functions exist in `api.js` and call the correct backend routes
**Plans:** 2/2 plans complete

Plans:
- [ ] E+2.5-01-PLAN.md — Fix message history 404 (guild-scoped getChannelMessages + Chat serverId prop) + kick/ban force-disconnect with toast UX
- [ ] E+2.5-02-PLAN.md — Unban/unmute surface (backend list endpoints, client API functions, BanMuteListModal + ChannelList gear trigger)

---

### Phase F: Security Hardening + Moderation
**Goal**: The instance is safe to expose to the internet and guild admins can enforce community rules
**Depends on**: Phase E+2 (server_members must exist for guild-scoped role enforcement)
**Requirements**: MOD-01, MOD-02, MOD-03, MOD-04, MOD-05, MOD-06, MOD-07, MOD-08, MOD-09, SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07, SEC-08
**Success Criteria** (what must be TRUE):
  1. A guild moderator can right-click a member and kick, mute, or delete their messages within that guild; each action requires a reason field and is rejected without one
  2. A guild admin can ban a member from their guild with optional expiry; the banned user cannot rejoin via any invite link for that guild and receives a clear rejection message
  3. Every moderation action (kick, ban, mute, role change, message delete) appears in the guild audit log with actor, target, action, reason, and timestamp
  4. Sending more than 30 messages/min or 5 auth attempts/min triggers a 429 response; WebSocket rate limiting fires inside the read pump (not HTTP middleware)
  5. Response headers include a valid CSP with explicit `wss://` in `connect-src`, HSTS with `max-age=300`, X-Frame-Options, and X-Content-Type-Options; WebSocket upgrade validates the Origin header
**Plans:** 4/4 plans complete
**Status:** Complete (2026-03-05)

Plans:
- [x] 0F-01-PLAN.md — DB indices for moderation tables + audit log backend filtering
- [x] 0F-02-PLAN.md — Voice mute enforcement (LiveKit token denial + client handling)
- [x] 0F-03-PLAN.md — Audit log viewer frontend (AuditLogModal + ChannelList integration)
- [x] 0F-04-PLAN.md — Full test suite + requirements verification checklist

---

### Phase G: Instance-Level Admin Moderation
**Goal**: Instance administrators can enforce instance-wide bans that cascade across all guilds, and all admin override actions are audited separately from guild moderation
**Depends on**: Phase F (moderation infrastructure must exist)
**Requirements**: IROLE-03, IROLE-05
**Gap Closure**: Closes gaps from v1.0 audit (requirements deferred from E+2)
**Success Criteria** (what must be TRUE):
  1. An instance admin can ban a user by ID; the ban removes the user from all guilds on the instance, revokes all auth tokens (via `DeleteSessionsByUserID`), and prevents re-registration with the same username
  2. A banned user attempting to register or login receives a clear rejection with ban reason
  3. Instance admin override actions (instance ban, instance unban) are recorded in a separate `instance_audit_log` table, not the guild-scoped `audit_log`
  4. Guild-scoped bans remain independent — a guild ban does not affect other guilds
**Plans:** 2/2 plans complete

Plans:
- [x] 0G-01-PLAN.md — Backend: migration 000009, models, Store interface, DB implementations, API handlers (ban/unban/search/audit-log), auth ban checks
- [ ] 0G-02-PLAN.md — Frontend: Instance Admin section in UserSettingsModal (User Management, Audit Log, Instance Config)

---

### Phase K.1: Instance Handshake
**Goal**: Any client can discover instance capabilities, version requirements, and instance policy without authenticating
**Depends on**: Phase E+2 (stable multi-tenant schema)
**Requirements**: INST-01, INST-02, INST-06
**Success Criteria** (what must be TRUE):
  1. `GET /api/handshake` returns 200 with no auth header; the response includes `server_version`, `api_version`, `min_client_version`, `opk_low_threshold`, `server_creation_policy`, `registration_mode`, and a `capabilities` object
  2. The capabilities object contains at minimum `e2ee.chat: true`, `e2ee.media: true`, and `voice.channels: true`
  3. The endpoint is stateless — no database query is made; response is identical under any load
**Plans:** 1/1 plans complete

Plans:
- [ ] K.1-01-PLAN.md — Version package, handshake handler with instance cache, route wiring, cache invalidation

---

### Phase K.4: System Messages
**Goal**: Moderation actions and membership events are visible to all guild members as server-generated plaintext records, without touching the encrypted messages table
**Depends on**: Phase F (kick/ban handlers must exist to emit events), Phase E+2 (channel schema must support type=system, scoped per guild)
**Requirements**: INST-03, INST-04
**Success Criteria** (what must be TRUE):
  1. When a member is kicked, banned, or their role changes within a guild, a plaintext system message appears in that guild's #system channel for all connected guild members within one WebSocket round-trip
  2. Regular members cannot send to the system channel — only the server can write system messages; any attempt returns a 403
  3. System messages are stored in a separate `system_messages` table with a `server_id` column; the `messages.ciphertext` column is never written with plaintext content
**Plans:** 3/3 plans complete
**Status:** Complete (2026-03-08)

Plans:
- [x] K.4-01-PLAN.md — Migration 000010, models, Store interface, DB implementations, system messages API, channel protections, leave endpoint, guild creation hook
- [x] K.4-02-PLAN.md — Wire EmitSystemMessage into all 7 moderation/membership handlers, background cleanup goroutine
- [x] K.4-03-PLAN.md — Frontend: SystemChannel page, SystemMessageRow component, ChannelList pinning, ServerLayout routing

---

### Phase K.5: Default Guild Template
**Goal**: A newly created guild has a working channel structure without manual setup
**Depends on**: Phase K.4 (system channel type must exist before seeding), Phase E+2 (guild creation endpoint must exist)
**Requirements**: INST-05
**Success Criteria** (what must be TRUE):
  1. When a guild is created, it is automatically populated with exactly three channels: `#system` (type=system), `#general` (type=text), and `General` (type=voice, quality mode)
  2. The template creation is idempotent — a failure mid-creation and retry does not create duplicate channels
  3. Existing guilds are not affected; the template only applies at guild creation time
**Plans:** 2/2 plans complete
**Status:** Complete (2026-03-08)

Plans:
- [x] K.5-01-PLAN.md — Backend: migration 000011 (server_template JSONB), models, Store interface, DB implementations, createServer template loop, template update API endpoint, tests
- [x] K.5-02-PLAN.md — Frontend: Multiple named server templates with CRUD API, admin UI in UserSettingsModal, template picker in GuildCreateModal, auth resilience fix

---

### Phase B.7: Crypto Key Lifecycle
**Goal**: Signal Protocol sessions stay healthy over time — SPKs rotate automatically with no session breakage, and OPK depletion is prevented before it silently degrades PFS
**Depends on**: Phase K.1 (client reads `opk_low_threshold` from handshake to drive replenishment trigger)
**Requirements**: CRYP-01, CRYP-02, CRYP-03, CRYP-04, CRYP-05, CRYP-06
**Success Criteria** (what must be TRUE):
  1. After 7 days, a client that has not rotated its SPK automatically generates a new SPK, uploads it, and marks the old one superseded — without breaking any in-transit sessions that used the old SPK
  2. A session established using a superseded SPK (during the 48h grace period) decrypts successfully; the server returns the correct historical private key during X3DH
  3. When OPK count on the server drops below `opk_low_threshold` (declared in handshake), the server emits a `keys.low` WebSocket event; the client responds by uploading 100 new OPKs within the same session
  4. On login and app startup, the client checks OPK count and proactively uploads if below threshold — no `keys.low` event required
**Plans:** 2/2 plans complete

Plans:
- [ ] B.7-01-PLAN.md — Server: migration 000013 (signal_spk_history, spk_uploaded_at, OPK created_at), Store interface, DB implementations, OPK count endpoint, keys.spk_stale broadcast, background cleanup goroutines, tests
- [ ] B.7-02-PLAN.md — Client: signalStore.js SPK lifecycle extensions, keyMaintenance.js unified maintenance function, useKeyMaintenance.js hook, api.js getOPKCount, ServerLayout wiring

---

### Phase K.6: Cross-Phase Integration Wiring
**Goal**: All cross-phase integration issues and broken E2E flows identified by the v1.0 audit are resolved — voluntary guild leave works end-to-end, instance config changes reflect live, system message events are fully styled, and OPK threshold is dynamically configured from handshake
**Depends on**: Phases K.4, K.5, E+2, B.7 (fixes wiring gaps between these completed phases)
**Requirements**: INST-04 (integration), MTNT-06 (integration)
**Gap Closure**: Closes integration and flow gaps from v1.0 milestone audit
**Success Criteria** (what must be TRUE):
  1. A guild member can voluntarily leave a guild via the UI; the action calls `POST /api/servers/:serverId/leave`, removes membership, emits a system message, and the user is redirected away from the guild
  2. When an instance admin updates instance config, connected clients receive an `instance_updated` WS event with the updated field values (`name`, `icon_url`, `registration_mode`) and the UI reflects changes without page reload
  3. `server_created` and `template_partial_failure` system message event types render with proper icons and styling in `SystemMessageRow`, not as unstyled grey text
  4. The client reads `opk_low_threshold` from the handshake response and uses it as the OPK replenishment trigger instead of the hardcoded `DEFAULT_OPK_THRESHOLD = 10`
**Plans:** 1/2 plans executed

Plans:
- [ ] K.6-01-PLAN.md — Backend: enrich instance_updated WS payload with config fields; Frontend: add server_created and template_partial_failure styling to SystemMessageRow
- [ ] K.6-02-PLAN.md — Frontend: leaveGuild + getHandshake API functions, Leave Server UI in ServerSettingsModal, member_left self-navigate in ServerLayout, OPK threshold from handshake

---

### Phase J: BIP39 Cryptographic Identity
**Goal**: Replace placeholder email/password auth with BIP39 mnemonic-derived cryptographic identity. Every user's root identity is a keypair derived from a 12-word mnemonic. The server stores only public keys — no email, no password, no encrypted blobs. JWT tokens remain as session tokens issued after cryptographic proof of key ownership. Explicit logout is a full local wipe.
**Depends on**: Phase B.7 (Signal key lifecycle must be stable before identity migration)
**Requirements**: IDEN-01, IDEN-02, IDEN-03, IDEN-04, IDEN-05, IDEN-06, IDEN-07, IDEN-08
**Success Criteria** (what must be TRUE):
  1. Registration generates a BIP39 12-word mnemonic, derives a root keypair deterministically, shows the mnemonic ONCE with explicit irrecoverability warning, and sends only the public key to the server
  2. Login is challenge-response: server sends nonce, client signs with private key, server verifies against stored public key, issues JWT session token
  3. Multi-device linking: new device displays QR (containing IK_new_device_pub, ephemeral EK_pub, expiry, nonce), existing device scans QR, produces certificate = Sign(IK_existing_priv, IK_new_pub), sends to server; server maintains per-account list of certified device public keys
  4. Server verifies each device certificate against the signing device's stored public key; private keys never leave the device that generated them
  5. Recovery with mnemonic but no device: re-enter 12 words → regenerate root IK → re-certify new devices; past messages are irrecoverable, account identity (guilds, roles) is recovered
  6. Recovery with neither mnemonic nor device: account is irrecoverable; user must create new account
  7. Guest access uses an ephemeral keypair (no mnemonic, no recovery, no device linking); guest sessions expire normally
  8. The `users` table no longer contains email or password_hash columns; `registration_mode` in instance_config means mnemonic generation policy (open, invite_only, closed), not email-based registration
  9. Explicit logout wipes all local cryptographic state: IK_priv removed from IndexedDB, Signal Protocol store (sessions, pre-keys) deleted, JWT invalidated, localStorage/sessionStorage cleared; re-entry requires 12 words
**Plans**: TBD

---

### Phase I: Launch Preparation
**Goal**: The instance is hardened, documented, and deployable by a self-hoster in under 10 minutes
**Depends on**: All previous phases (packages the complete stable stack)
**Requirements**: LNCH-01, LNCH-02, LNCH-03, LNCH-04, LNCH-05, LNCH-06, LNCH-07, LNCH-08, LNCH-09, LNCH-10, LNCH-11, LNCH-12, LNCH-13
**Success Criteria** (what must be TRUE):
  1. Running `scripts/setup.sh` on a clean Ubuntu server with Docker installed produces a live, TLS-terminated Hush instance in under 10 minutes — including secret generation, migration, and health verification
  2. Refreshing the page during an active voice call reconnects LiveKit and re-establishes the frame key within 5 seconds with no user action required
  3. Opening the same account in two browser tabs shows a warning to the user; a network disconnect triggers automatic WebSocket reconnection and Signal session recovery
  4. The chat renderer passes XSS review — no user-supplied content reaches the DOM as raw HTML; AES-GCM nonces in e2eeKeyManager.js are non-repeating per the audit
  5. README.md, SECURITY.md, and ARCHITECTURE.md accurately describe the current multi-tenant architecture, self-hosting process, and Signal Protocol threat model
**Plans**: TBD

---

## Progress

**Execution Order:** E+2 → E+2.5 → F → G → K.1 → K.4 → K.5 → B.7 → K.6 → J → I

| Phase | Plans | Status | Completed |
|-|-|-|-|
| A. Go Backend Foundation | - | Complete | 2026-02-xx |
| B. Signal Protocol Core | - | Complete | 2026-02-xx |
| C. Encrypted Chat | - | Complete | 2026-02-xx |
| D. E2EE Voice/Video | - | Complete | 2026-02-xx |
| E. Discord-like UX | - | Complete | 2026-02-xx |
| E+. Single-Tenant Migration | 4/4 | Superseded | 2026-03-03 |
| E+2. Multi-Tenant Restoration | 5/5 | Complete    | 2026-03-04 |
| E+2.5. Critical Integration Fixes | 2/2 | Complete    | 2026-03-04 |
| F. Security Hardening + Moderation | 4/4 | Complete    | 2026-03-05 |
| G. Instance-Level Admin Moderation | 2/2 | Complete   | 2026-03-05 |
| K.1. Instance Handshake | 1/1 | Complete    | 2026-03-06 |
| K.4. System Messages | 3/3 | Complete    | 2026-03-08 |
| K.5. Default Guild Template | 2/2 | Complete   | 2026-03-08 |
| B.7. Crypto Key Lifecycle | 2/2 | Complete    | 2026-03-16 |
| K.6. Cross-Phase Integration Wiring | 1/2 | In Progress|  |
| J. BIP39 Cryptographic Identity | 0/TBD | Not started | - |
| I. Launch Preparation | 0/TBD | Not started | - |

---

## Backlog (Post-MVP)

Ideas captured during development that are out of scope for the current milestone but worth tracking.

- **Safety Number Verification & Identity Key Change Notifications** — When a contact re-registers or links a new device (identity key changes), emit a "Safety number changed" system message in affected conversations. Optionally, add a UI for comparing safety number fingerprints (Signal-style). Depends on Phase J (BIP39 identity model) and Phase K.4 (system message infrastructure). Referenced in SECURITY.md as a planned future milestone.
