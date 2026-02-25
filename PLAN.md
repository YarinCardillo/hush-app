# PLAN.md — Hush Development Plan

## Product

Hush is a privacy-first Discord alternative. E2EE on everything (chat, voice, video, screen sharing), open source, self-hostable, Discord-like UX. The server sees nothing.

**Target:** communities that need always-on voice/text channels with real privacy — not a meeting tool, a place where people live.

### Why Not Matrix

Matrix (Synapse + Olm/Megolm) was the original backend. It's been dropped for cryptographic reasons:

- **libolm** (Matrix's C crypto library): CVEs found in 2024 — AES vulnerable to cache-timing attacks, timing leaks on group session key loading. Matrix acknowledged the issues but hadn't fixed them. libolm is now deprecated.
- **vodozemac** (Rust rewrite of libolm): Soatok's February 2025 audit found the same fundamental problems — non-contributory ECDH in the Olm handshake makes session keys predictable by a malicious participant, including a compromised homeserver. Olm distributes both Megolm keys (chat) and frame keys (media) — the problem touches everything.
- Using **Signal Protocol** instead of Olm breaks Matrix compatibility. Since Matrix compatibility no longer provides value without its crypto layer, keeping Synapse adds only complexity.

**Removed:** Synapse, matrix-js-sdk, vodozemac, libolm, lk-jwt-service.

### Discord-to-Hush Mapping

| Discord | Hush | Backend |
|-|-|-|
| Server | Server | PostgreSQL `servers` table + membership |
| Text Channel | Text Channel | WebSocket room + Signal-encrypted messages |
| Voice Channel | Voice Channel (Performance or Quality mode) | LiveKit room + Signal key distribution |
| Category | Category | Channel grouping (`parent_id`) |
| Member / Mod / Admin | Member / Mod / Admin | Role-based permissions: member / mod / admin |
| Invite link | Invite link | Token-based invite codes |
| Server icon | Server icon | File upload endpoint |

### Monetization

No artificial tiers. The core app is 100% free and open source — self-hosters get everything. Revenue comes from managed hosting (gethush.live offers fully-managed instances for communities at EUR 15-30/mo) and donations (GitHub Sponsors after traction). Hosted-specific logic lives in `hosted/` — the core app has zero payment awareness.

Details and launch strategy: `.private/BUSINESS.md` (gitignored, not in repo).

---

## Definitive Stack

| Layer | Technology | Notes |
|-|-|-|
| Frontend (web) | React 18 + Vite | Unchanged |
| Client E2EE | hush-crypto (WASM) | Signal Protocol for chat + key distribution (single Rust implementation on all platforms) |
| Client media crypto | WebCrypto API (AES-GCM) | Frame encryption for audio/video |
| Client media | livekit-client | WebRTC via LiveKit SFU |
| Desktop | Tauri + CEF | Rust shell + bundled Chromium, native `hush-crypto` via IPC |
| Mobile | React Native | iOS + Android, UniFFI bindings to Rust crypto |
| Crypto core | Rust crate (hush-crypto wrapping libsignal) | WASM (wasm-pack) for web, direct Rust for desktop (Tauri), UniFFI for mobile |
| Backend | Go + Chi | Auth, rooms, channels, membership, WebSocket, pre-key server, LiveKit tokens |
| Database | PostgreSQL | New schema |
| Media SFU | LiveKit | Self-hosted or LiveKit Cloud |
| Reverse proxy | Caddy | TLS termination |
| Deployment | Docker Compose | Self-hosting default |

### What Carries Over

- React UI (all pages, components, hooks except Matrix-specific)
- Design system (`global.css`, `design-system.md`)
- LiveKit media pipeline (SFU connection, track management, E2EE worker)
- Caddy reverse proxy (reconfigure routes)
- Docker Compose (replace services)
- `useDevices.js`, `useBreakpoint.js`, `bandwidthEstimator.js` (includes live upload bitrate measurement), `noiseGateWorklet.js`, `constants.js` (includes screen share quality presets)
- Connection robustness patterns in `useRoom.js`: epoch guard (prevents StrictMode double-mount races), stale async bail-out checks, track cleanup on unmount with disconnect timeout

### What's Removed

- Synapse (Matrix homeserver)
- matrix-js-sdk (client SDK)
- vodozemac / libolm (crypto)
- lk-jwt-service (Matrix-to-LiveKit auth bridge)
- Redis dependency on lk-jwt-service (Redis itself stays for self-hosted LiveKit pub/sub; removed only in hosted/Cloud config)
- `useMatrixAuth.js`, Matrix-specific hooks and libraries

---

## What's Already Done

From the previous Matrix-based milestones, the following carries over:

- **React frontend**: All pages (`Home.jsx`, `Room.jsx`), components (`Chat.jsx`, `Controls.jsx`, `StreamView.jsx`, etc.), styles (`global.css`)
- **LiveKit integration**: Room connection, track publishing/subscribing, E2EE worker, `ExternalE2EEKeyProvider` pattern
- **Design system**: Full design language in `design-system.md`, implemented in `global.css`
- **Device management**: `useDevices.js`, `useBreakpoint.js`
- **Audio processing**: `noiseGateWorklet.js`, `bandwidthEstimator.js`

**Invalidated:** Matrix auth (`useMatrixAuth.js`), Matrix chat integration, Olm/Megolm E2EE, Matrix-based key distribution, Synapse configuration, lk-jwt-service integration.

---

## Reference Documents

- `ARCHITECTURE.md` — codebase map and target architecture. **Read before modifying any file.**
- `design-system.md` — UI design language. **Read before touching UI.**
- `SECURITY.md` — E2EE details and threat model. (To be rewritten for Signal Protocol.)
- `CLAUDE.md` — engineering standards and code quality rules.
- `.private/BUSINESS.md` — monetization tiers, pricing, revenue projections (gitignored).

---

## Frontend & Design System (Mandatory)

**Every frontend change MUST follow the existing design system and match the app's visual identity.** This is non-negotiable.

Before writing or modifying any UI code:
1. Read `design-system.md` — it defines colors, typography, spacing, component patterns, and the overall aesthetic
2. Read `client/src/styles/global.css` — it implements the design system as CSS custom properties
3. Study existing components in `client/src/components/` — new UI must be visually indistinguishable from existing UI in terms of style, spacing, and interaction patterns

Rules:
- **Use CSS custom properties** from `global.css` (`--color-*`, `--spacing-*`, `--radius-*`, etc.). Never hardcode colors, font sizes, or spacing values.
- **Match existing component patterns.** If the app uses a specific button style, input style, modal pattern, or layout approach — use that, don't invent a new one.
- **No generic/default-looking UI.** Every element must feel like it belongs in Hush. If a new component looks like it came from a different app, it's wrong.
- **Responsive behavior** must follow existing breakpoint patterns (`useBreakpoint.js`).
- **No CSS frameworks or component libraries.** Hush uses hand-written CSS following its own design language.
- **Animations and transitions** must match existing patterns (subtle, functional, not decorative).

Violation of these rules produces code that will be rejected in review.

---

## Commit Guidelines

Commit after completing each significant task and each phase. Use conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`). Push after each commit. Use `git add <specific files>`, not `git add .`.

---

## Testing Philosophy

**Tests are sacrosanct.** Never modify expected values or assertions to make a failing test pass — that's retrofitting, and it invalidates the test entirely. If a test fails, fix the implementation. The only valid reason to change a test is if the *requirement* has explicitly changed, and that must be noted in the commit message.

**Red-green-refactor** is the mandatory workflow from Phase B onwards:

1. **Red:** Write a failing test that describes the expected behavior
2. **Green:** Write the minimum implementation to make the test pass
3. **Refactor:** Clean up without changing behavior — tests must stay green

No feature code without a test. No test without a clear requirement.

**Test naming:** Names describe behavior, not implementation. Pattern: `Test<Unit>_<Scenario>_<Expected>` (e.g. `TestLogin_InvalidPassword_Returns401`).

---

## Branching Strategy

**Base branch: `core-rewrite`**. Create it from `main` and work there. For individual phases (A, B, C...), create sub-branches if needed (`core-rewrite/phase-a-backend`, etc.) and merge back into `core-rewrite`. `main` stays untouched until the refactor ships. CLAUDE.md branching rules apply post-refactor once `main` is the active development branch.

---

## Target docker-compose Services

| Service | Image | Purpose | Port |
|-|-|-|-|
| hush-api | Custom (Go) | Backend API + WebSocket | 8080 |
| postgres | postgres:16-alpine | Database | 5432 |
| livekit | livekit/livekit-server:latest | SFU for media | 7880, 7881, 50000-60000/udp |
| redis | redis:7-alpine | LiveKit pub/sub (self-hosted only) | 6379 |
| caddy | caddy:2-alpine | Reverse proxy + TLS + static files | 443 |

For gethush.live (LiveKit Cloud): drop `livekit` and `redis` services. `docker-compose.prod.yml` overrides.

---

## Environment Configuration

### Dev (local)

```env
DATABASE_URL=postgres://hush:hush@localhost:5432/hush?sslmode=disable
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
LIVEKIT_URL=ws://localhost:7880
JWT_SECRET=dev-jwt-secret-change-in-production
```

### Production (gethush.live — LiveKit Cloud)

```env
DATABASE_URL=postgres://hush:<password>@postgres:5432/hush?sslmode=require
LIVEKIT_API_KEY=<from LiveKit Cloud dashboard>
LIVEKIT_API_SECRET=<from LiveKit Cloud dashboard>
LIVEKIT_URL=wss://<project>.livekit.cloud
JWT_SECRET=<random 256-bit secret>
```

---

## Known Platform Constraints

1. **LiveKit E2EE (Insertable Streams) is Chromium-only for full support.** Firefox partial, Safari limited.
2. **Signal Protocol requires a pre-key server.** The Go backend must implement pre-key bundle upload and retrieval.
3. **hush-crypto WASM binary size.** libsignal compiled to WASM may be 2-4MB. Use wasm-opt for size optimization and lazy-load the module after initial page render.
4. **WebCrypto AES-GCM nonce management is critical.** Never reuse a nonce with the same key. Use a counter or random 96-bit IV per frame.
5. **Tauri requires Rust toolchain.** Desktop builds need `rustup` installed.
6. **UniFFI bindings must be kept in sync.** When the Rust crate changes, regenerate bindings for all platforms.
7. **OPUS frame size at 10ms doubles packet rate.** Performance mode sends 100 packets/sec per client vs 50 at 20ms default. Account for this in LiveKit bandwidth estimates and server capacity planning.
8. **`jitterBufferTarget` is experimental (Chrome only).** Behavior may vary. Test on Firefox fallback.

---

## Phase A: Go Backend Core (DONE)

Goal: Replace Synapse with a purpose-built Go backend. Auth, WebSocket, PostgreSQL.

### A.1 — Project setup

Initialize Go module. Chi router, structured logging, graceful shutdown.

```
server/
├── cmd/
│   └── hush/
│       └── main.go              # Entry point
├── internal/
│   ├── api/                     # HTTP handlers (Chi routes)
│   ├── auth/                    # Auth logic, JWT, sessions
│   ├── db/                      # Database access
│   ├── models/                  # Domain types
│   ├── ws/                      # WebSocket hub and connections
│   └── livekit/                 # LiveKit token generation
├── migrations/                  # PostgreSQL migrations (golang-migrate)
├── go.mod
└── go.sum
```

**Key pattern — `db.Store` interface:** All API handlers and WebSocket handlers accept `db.Store` (defined in `internal/db/store.go`) instead of `*db.Pool`. This enables dependency injection and mock-based testing. When adding new DB methods for Phase B+ endpoints, add them to the `Store` interface first, then implement on `*Pool`.

### A.2 — PostgreSQL schema

Core tables:
- `users` (id, username, password_hash [nullable — OAuth users have no password], display_name, created_at)
- `sessions` (id, user_id, token_hash, expires_at)
- `servers` (id, name, icon_url, owner_id, created_at)
- `channels` (id, server_id, name, type [text/voice], voice_mode [performance/quality], parent_id, position)
- `channel_config` (channel_id, retention_days, max_media_size_mb) — text channel settings
- `server_members` (server_id, user_id, role, joined_at)
- `messages` (id, channel_id, sender_id, ciphertext, timestamp)
- `signal_identity_keys` (user_id, device_id, identity_key, signed_pre_key, signed_pre_key_signature, registration_id)
- `signal_one_time_pre_keys` (id, user_id, device_id, key_id, public_key, used)
- `devices` (id, user_id, device_id, label, created_at, last_seen)
- `invite_codes` (code, server_id, created_by, expires_at, max_uses, uses)

Migrations managed with `golang-migrate`.

### A.3 — Auth API

- `POST /api/auth/register` — username, password, display_name -> JWT + user
- `POST /api/auth/login` — username, password -> JWT + user
- `POST /api/auth/logout` — invalidate session
- `GET /api/auth/me` — current user info
- `POST /api/auth/guest` — temporary guest account -> JWT + user

Password hashing: bcrypt. Tokens: JWT (HS256) with configurable expiry. OAuth providers (Google, Apple, GitHub) planned post-MVP — `password_hash` is nullable in the schema to accommodate this.

### A.4 — WebSocket server

Chi-compatible WebSocket upgrade. Hub pattern:
- Authenticate on upgrade (JWT in query param or first message)
- Subscribe to channels
- Broadcast messages to channel subscribers
- Presence events (online/offline)

### A.5 — LiveKit token endpoint

`POST /api/livekit/token` — validate JWT, issue LiveKit access token for a voice channel. Replaces lk-jwt-service. Uses `github.com/livekit/server-sdk-go`.

### Phase A Checkpoint (COMPLETE)

Go backend serves auth, WebSocket, and LiveKit tokens. PostgreSQL schema in place. 40 unit tests passing (auth, api, ws, livekit). `db.Store` interface enables DI/mocking for all handler tests. Docker Compose and Caddy configured for `hush-api` service. Frontend migration to new auth endpoints is part of Phase E.

---

## Phase B: Signal Protocol Infrastructure

Goal: Implement Signal Protocol key exchange and messaging. Replaces Matrix Olm/Megolm.

### B.0 — Testing infrastructure and Phase A coverage (PARTIALLY DONE)

Set up testing infrastructure and retroactively cover Phase A before continuing with TDD.

**Go backend (DONE):**

- `go test` with `testify/assert` and `testify/require` for assertions
- `httptest` for HTTP handler tests (Chi-compatible)
- `db.Store` interface for dependency injection — all handlers accept `db.Store`, not `*db.Pool`. New endpoints must follow this pattern.
- `mock_store_test.go` — function-field mock implementing `db.Store` for handler tests
- 40 tests passing: auth (JWT, password), api (register, login, guest, validateUsername), ws (hub presence, subscribe, broadcast), livekit (token generation)

**Remaining:**

- Test database: separate PostgreSQL instance (`hush_test`) with migrations applied before each suite, transactions rolled back after each test (for integration tests)
- Table-driven tests for exhaustive input validation edge cases

**Frontend (TODO):**

- Configure Vitest (already on Vite) with jsdom environment
- Test utilities for WASM crypto mocks (for later phases)

**From this point forward:** Every new feature follows red-green-refactor. Write the test first, watch it fail, implement, watch it pass, refactor.

### B.1 — Pre-key server (Go)

- `POST /api/keys/upload` — upload identity key, signed pre-key, and batch of one-time pre-keys
- `GET /api/keys/:userId` — retrieve pre-key bundle for session establishment
- `GET /api/keys/:userId/:deviceId` — device-specific bundle

One-time pre-keys are consumed on retrieval. When a user's remaining unused one-time pre-keys drop below 10, the server sends a `keys.low` WebSocket message to that user (all active sessions). The client must auto-generate and upload a new batch of 100 one-time pre-keys without user interaction.

### B.2 — Rust crypto crate (DONE)

`hush-crypto` crate wrapping libsignal:
- X3DH key agreement (initiator + responder)
- Double Ratchet encryption/decryption with self-describing wire format
- Session management
- Pre-key bundle generation (returns private keys for local persistence)
- WASM target via `wasm-pack` (web)
- UniFFI bindings for Swift (iOS), Kotlin (Android)

Single Rust implementation on all platforms:
- **Web:** compiled to WASM via `wasm-pack`, loaded as ES module. Use `wasm-opt -Oz` for size optimization, lazy-load after initial page render.
- **Desktop (Tauri):** direct Rust integration via Tauri commands. No WASM, no FFI overhead.
- **Mobile:** UniFFI bindings (Swift for iOS, Kotlin for Android).

**Signal foundation fixes applied (core-rewrite branch):**
- Fixed `x3dh_wrap.rs`: `init_sender_state` was using Alice's ephemeral key instead of Bob's SPK as remote DH key
- Fixed `session.rs`: wire format changed from hardcoded 64-byte header split to self-describing `[4: header_len LE][header][ciphertext]`
- Fixed `ServerBundle` serde: added `#[serde(rename_all = "camelCase")]` to match Go server JSON
- Added X3DH responder flow (`perform_x3dh_responder`) for receiving initial messages
- Pre-key generation now returns private keys (SPK + OPK) for client-side persistence
- WASM bindings updated: `perform_x3dh` returns `{ state_bytes, ephemeral_public }`, added `perform_x3dh_responder`
- Integration tests: 3 e2e tests (with/without OPK, wrong AD rejection)

### B.3 — Client-side integration (web) (DONE)

Integrate `hush-crypto` WASM module into React:
- Load WASM module (lazy, after initial render) via `wasm-pack` generated ES bindings
- On registration/login: generate identity key pair, signed pre-key, batch of one-time pre-keys
- Upload public keys to pre-key server, persist private keys locally
- On first message to a user: fetch pre-key bundle, X3DH handshake, establish session
- On receiving first message: X3DH responder flow, consume OPK
- Encrypt/decrypt via Double Ratchet with proper AD
- Message envelope: PreKey (`0x01` + IK + EK + key IDs + DR payload) or Regular (`0x02` + DR payload)

### B.4 — Client key storage (DONE)

Signal Protocol state in IndexedDB (version 2):
- Identity key pair (public + private)
- Session states with AD (per remote user+device)
- Signed pre-key (public + private + signature)
- One-time pre-key private keys (consumed on first use)
- Registration ID

Store prefix: `hush-signal-${userId}-${deviceId}`.

**TODO — SPK rotation and OPK replenishment:** Infrastructure is in place (private key persistence, `keys.low` WebSocket event defined in B.1). Automation not yet implemented — client should rotate SPK periodically and auto-replenish OPKs when the server signals low count.

### Phase B Checkpoint

Signal Protocol handshake works end-to-end. Two clients establish a session and exchange encrypted messages. Pre-key server operational. X3DH initiator and responder flows implemented and tested. Private key persistence enables receiving initial messages. 3 Rust e2e tests + 16 JS tests passing.

---

## Phase C: Encrypted Chat

Goal: Replace Matrix chat with WebSocket + Signal Protocol encrypted messaging.

### C.1 — Message routing (Go backend)

WebSocket message types:
- `message.send` — client sends encrypted message to a channel
- `message.new` — server broadcasts to channel subscribers
- `message.history` — client requests paginated history
- `typing.start` / `typing.stop` — typing indicators

Messages stored as ciphertext in PostgreSQL. The server never sees plaintext.

### C.2 — Group messaging

For text channels with multiple participants:
- Fan-out encryption for small groups (< 50 members): each message individually encrypted per recipient
- Shared symmetric key for larger channels: key rotated on membership change, distributed via pairwise Signal sessions

### C.3 — Client chat migration

Replace Matrix timeline handling in `Chat.jsx`:
- Remove `matrixClient.sendMessage()` -> WebSocket `message.send`
- Remove Matrix event listeners -> WebSocket message handlers
- Keep: message rendering, UI components
- Add: local echo, delivery status (sent/delivered), failed message retry with inline indicator

### C.4 — Message history

`GET /api/channels/:id/messages?before=<timestamp>&limit=50` — returns ciphertext blobs. Client decrypts locally. Cursor-based pagination.

### Phase C Checkpoint

Text chat works with Signal Protocol encryption. Messages persist (encrypted). History loads on channel join. Typing indicators work.

---

## Phase D: Media E2EE Migration

Goal: Migrate LiveKit E2EE key distribution from Matrix to-device messages to Signal Protocol.

### D.1 — Frame key distribution via Signal

The existing `e2eeKeyManager.js` already implements key generation, leader election (lowest user ID), rekeying on participant leave, and retry with exponential backoff (3 attempts, 1s/2s/4s). This phase is a transport swap: replace `matrixClient.encryptAndSendToDevice()` with Signal-encrypted WebSocket `media.key` messages. Preserve all existing logic.

Replace Matrix to-device key distribution:
- Room creator generates 256-bit AES-GCM key for frame encryption
- Key distributed to each participant via their Signal session (pairwise encrypted)
- WebSocket message type: `media.key` — encrypted frame key delivery
- On participant join: leader sends frame key
- On participant leave: leader generates new key, distributes to remaining participants

### D.2 — LiveKit E2EE integration

Keep the existing pattern:
- `ExternalE2EEKeyProvider` for key injection
- E2EE worker via Vite `?worker` import
- Frame encryption via WebCrypto AES-GCM

Change only the key source: from Matrix to-device -> Signal-encrypted WebSocket message.

### D.3 — Leader election

Deterministic: lowest user ID among connected participants. On leader disconnect: next lowest takes over, generates new key, distributes.

### D.4 — Retry and failure handling

Key exchange via WebSocket with retry: 3 attempts, exponential backoff (1s, 2s, 4s). On failure: persistent error "Secure channel failed. Please rejoin." No silent degradation — if E2EE setup fails, do NOT connect to LiveKit.

### Phase D Checkpoint

Voice/video channels work with E2EE. Frame keys distributed via Signal Protocol. Rekeying on join/leave. No Matrix dependency remains.

---

## Phase E: Servers & Channels (Discord UX)

Goal: Discord-like server and channel structure.

### E.1 — Server API (Go backend)

- `POST /api/servers` — create server
- `GET /api/servers` — list user's servers
- `GET /api/servers/:id` — server details + channels
- `PUT /api/servers/:id` — update server (name, icon)
- `DELETE /api/servers/:id` — delete server (admin only)
- `POST /api/servers/:id/join` — join via invite code
- `POST /api/servers/:id/leave` — leave server

### E.2 — Channel API

- `POST /api/servers/:id/channels` — create channel
- `GET /api/servers/:id/channels` — list channels
- `DELETE /api/channels/:id` — delete channel
- **No PUT endpoint.** Channels are immutable after creation. Type (`text`/`voice`), voice mode (`performance`/`quality`), and all configuration are set once at creation and never changed. If an admin wants different settings, they delete and recreate. This avoids track renegotiation complexity and audio re-initialization edge cases.
- Types: `text`, `voice`
- Voice modes: `performance` (low-latency, audio only) and `quality` (filters, webcam, screen share). Set at creation, immutable.
- Text channels: `retention_days` and `max_media_size_mb` set at creation
- Categories via `parent_id`

### E.3 — Server list sidebar

`client/src/components/ServerList.jsx` — vertical sidebar. Server icons, "Create Server", "Join Server".

### E.4 — Channel list

`client/src/components/ChannelList.jsx` — text and voice channels within selected server. Voice channels show active participants.

**Voice channels are always-on.** No "create a call" — the channel IS the call. Join and leave freely.

### E.5 — Channel views

Refactor `Room.jsx` into:

- `TextChannel.jsx` — chat-only, reuses Chat.jsx logic
- `VoiceChannel.jsx` — media + integrated text chat sidebar (always present, both modes)

**Carry over from Room.jsx:** The current Room.jsx contains a polished video tile grid (symmetric layout with hero tile, mobile square grid, Discord-style uniform tiles, click-to-watch screen shares, CSS virtual fullscreen, mirrored local webcam). Extract this grid logic into VoiceChannel.jsx — do not rewrite.

Routing: `/server/:serverId/channel/:channelId`

**Voice channel modes** — configured at creation, stored in `channels.voice_mode`, immutable after creation. Client reads mode on join and configures LiveKit track accordingly.

`performance` mode:

- OPUS: bitrate 48kbps (CELT range), frame size 10ms
- DTX enabled (`dtx: true`)
- `noiseSuppression: false`, `echoCancellation: true`, `autoGainControl: false`
- Noise gate worklet: OFF (zero processing overhead)
- No video track created — webcam and screen share UI hidden
- `jitterBufferTarget: 20ms`

`quality` mode:

- OPUS: bitrate 32kbps, frame size dynamic (OPUS auto). Audio bitrate is lower than performance to reserve bandwidth for video tracks.
- DTX enabled
- `noiseSuppression: false`, `echoCancellation: true`, `autoGainControl: true`
- Noise gate worklet: ON by default (configurable in user settings)
- Video track available — webcam and screen share UI shown
- `jitterBufferTarget: 75ms`

Both modes use the same E2EE pipeline (LiveKit Insertable Streams + WebCrypto AES-GCM). Mode is immutable after channel creation — no runtime renegotiation needed.

**Noise gate (custom worklet)**

Browser-native `noiseSuppression` is disabled in both modes. Hush uses its own noise gate (`noiseGateWorklet.js`) — an AudioWorklet processor with RMS-based level detection, smooth attack/release, and hold time. Applied to microphone tracks only.

- `performance` mode: noise gate OFF. Zero processing overhead.
- `quality` mode: noise gate ON by default.
- User settings: toggle noise gate on/off, adjust threshold (dB), live monitor mode (hear own voice through the gate in real-time for tuning).
- The worklet is already implemented and integrated into `trackManager.js:publishMic()`. The refactor adds mode-awareness and settings UI.

**Screen share quality (user-level, within quality mode)**

Screen share resolution and framerate are a per-user choice within `quality` mode, independent of the channel-level voice mode. The system already exists:

- `constants.js`: `QUALITY_PRESETS` (High: 1080p60/20Mbps, Lite: 720p30/2.5Mbps) and `WEBCAM_PRESET` (720p30/1.5Mbps)
- `QualityPickerModal.jsx`: bandwidth-aware picker showing recommended quality based on `bandwidthEstimator.js:measureLiveUploadMbps()`
- `trackManager.js`: `publishScreen()`, `changeQuality()`, `switchScreenSource()` — all preset-aware

This carries over unchanged. `performance` mode hides screen share entirely.

### E.6 — Invite links

`gethush.live/invite/ABCDEF`:
1. `GET /api/invites/:code` -> server info
2. `POST /api/servers/:id/join` with invite code
3. Handle: expired, already-joined, not-found, full

### E.7 — Member list and presence

`client/src/components/MemberList.jsx` — online/offline via WebSocket presence.

### Phase E Checkpoint

Servers, text channels, voice channels, member list, invites. User creates server -> adds channels -> invites friends -> chats (E2EE) -> joins voice (E2EE, always-on).

---

## Phase F: Moderation

### F.1 — Permission system

Roles in `server_members.role`:
- `member` (default): send messages, join voice
- `mod`: kick, mute, delete messages
- `admin`: ban, change settings, promote/demote, delete channels

Server creator gets `admin` automatically.

### F.2 — Moderation API

- `POST /api/servers/:id/kick` — kick member
- `POST /api/servers/:id/ban` — ban member
- `POST /api/servers/:id/mute` — mute in voice
- `DELETE /api/messages/:id` — delete message (mod+)
- `PUT /api/server-members/:serverId/:userId` — change role (admin only)

### F.3 — Moderation UI

`client/src/components/ModerationPanel.jsx` — admin controls. Context menu on members.

### Phase F Checkpoint

Mods can kick/mute, admins can ban/promote. Enforced server-side.

---

## Phase G: Tauri Desktop

### G.1 — Tauri project

**Tauri + CEF (`cef-rs`).** Tauri gives native access to `hush-crypto` via Tauri IPC commands — desktop and mobile share the same Rust crypto code path, no WASM overhead, no N-API wrapper. CEF bundles a pinned Chromium instead of relying on OS WebView, because LiveKit E2EE requires Insertable Streams / `RTCRtpScriptTransform` which WKWebView (macOS) and WebKitGTK (Linux) don't support. One build config, one behavior, one test path across all platforms. Bundle ~80-120MB — acceptable tradeoff for guaranteed E2EE media.

Wraps React frontend. No UI changes.

### G.2 — Native crypto

Use `hush-crypto` Rust crate directly via Tauri commands. No WASM.

### G.3 — Desktop features

System tray, native notifications, auto-update.

### Phase G Checkpoint

Desktop on macOS, Windows, Linux. Same functionality as web with native crypto.

---

## Phase H: React Native Mobile

### H.1 — React Native project

Share components and logic with web where possible.

### H.2 — UniFFI crypto bindings

`hush-crypto` via UniFFI: Swift for iOS, Kotlin for Android.

### H.3 — Mobile features

Push notifications, background audio for voice, camera/mic permissions.

### Phase H Checkpoint

Mobile on iOS and Android. Full functionality including E2EE.

---

## Phase I: Production & Polish

### I.1 — Hosted Infrastructure

`hosted/` directory (gethush.live only):
- Managed instance provisioning and lifecycle
- Guest session management
- Monitoring and health checks

### I.2 — Multi-region deploy (gethush.live)

LiveKit is the primary latency bottleneck for hosted users. A single-region deploy disadvantages anyone geographically distant.

Target: 3 LiveKit nodes covering EU, US-East, US-West (Fly.io or Railway). The Go backend assigns a user to the nearest LiveKit node at token issuance based on IP geolocation.

```
POST /api/livekit/token
→ backend selects nearest region
→ returns token + wss://region.livekit.gethush.live
```

Self-hosted instances are unaffected — they run their own LiveKit and routing is irrelevant.

Implementation: After initial launch, not blocking MVP. Add `LIVEKIT_REGIONS` env var (JSON map of region → URL + key/secret) to `docker-compose.prod.yml`. Single-region is still valid for self-hosters.

### I.3 — Self-hosting setup

`scripts/setup.sh`: generate LiveKit keys, JWT secret, prompt for domain, write `.env`. Target: deploy in under 10 minutes.

### I.4 — Security audit

XSS, CSRF, rate limiting, CSP headers, Signal Protocol implementation review, frame encryption nonce audit.

### I.5 — Code quality

CLAUDE.md compliance: function length, file length, JSDoc, naming, error handling.

### I.6 — Edge cases

1. Page refresh during voice -> rejoin LiveKit, re-establish frame key
2. Network disconnect -> WebSocket reconnection, Signal session recovery
3. Two tabs same browser -> detect and warn
4. Guest session expiry mid-call -> graceful error
5. Server creator leaves -> admin transfer
6. Backend restart -> client reconnect
7. LiveKit restart -> E2EE renegotiation
8. Long chat history -> cursor-based pagination

### I.7 — Documentation

- README.md: new architecture, self-hosting guide
- SECURITY.md: Signal Protocol threat model
- ARCHITECTURE.md: final state

### Phase I Checkpoint

Ship it.

---

## Future Work (Post-MVP)

### Key Backup & Device Verification
- Secure key backup (encrypted with user passphrase, stored server-side)
- Device verification UI (Safety Numbers / QR code)
- Multi-device support with Signal Protocol

### Advanced Media
- Simulcast quality layers exposed to UI
- Encrypted recording at rest
- Advanced screen sharing (window picker, annotation)

### Federation (Hush-to-Hush)
- Custom server-to-server protocol (not Matrix)
- Cross-instance rooms with E2EE preserved
- Only if demand justifies it — self-hosting is the primary multi-instance strategy
