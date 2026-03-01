# ARCHITECTURE.md — Hush Codebase Reference

> This file is read by orchestra agents (architect + programmer).
> It maps the CURRENT state and the TARGET state of the codebase.
> Update this file as the refactor progresses.

---

## Current Stack

| Layer | Technology | Status |
|-|-|-|
| Frontend | React 18 + Vite + hush-crypto (WASM) + livekit-client | Phases A-D DONE |
| Media SFU | LiveKit Server | DONE |
| Signaling | Go WebSocket (ws hub + client) | DONE |
| Auth | Go backend (JWT, bcrypt, guest) | DONE |
| Chat | WebSocket + Signal Protocol (fan-out encryption) | DONE |
| E2EE Chat | Signal Protocol (X3DH + Double Ratchet) via hush-crypto WASM | DONE |
| E2EE Media | LiveKit Insertable Streams + Signal-encrypted WebSocket key distribution | DONE |
| Rooms | Go backend + PostgreSQL (servers/channels schema in place, API in Phase E) | Schema DONE, API TODO |
| LiveKit Auth | Go token endpoint (POST /api/livekit/token) | DONE |
| Deployment | docker-compose: Go backend + Postgres + LiveKit + Redis + Caddy | DONE |

---

## Current File Map

```
server/
├── cmd/
│   └── hush/
│       └── main.go              # Go entry point, Chi router, graceful shutdown
├── internal/
│   ├── api/
│   │   ├── auth.go              # Register, login, guest, logout, me
│   │   ├── auth_test.go         # Auth handler tests
│   │   ├── channels.go          # GET /api/channels/:id/messages
│   │   ├── channels_test.go     # Channel message retrieval tests
│   │   ├── context.go           # Request context helpers (userID, sessionID)
│   │   ├── keys.go              # POST/GET Signal pre-key bundle endpoints
│   │   ├── keys_test.go         # Pre-key upload/retrieval tests
│   │   ├── livekit.go           # POST /api/livekit/token
│   │   ├── middleware.go        # RequireAuth (JWT + session validation)
│   │   └── mock_store_test.go   # Function-field mock for db.Store
│   ├── auth/
│   │   ├── jwt.go               # JWT sign/verify/claims
│   │   ├── jwt_test.go
│   │   ├── password.go          # bcrypt hash/compare
│   │   └── password_test.go
│   ├── config/
│   │   └── config.go            # Env-based config
│   ├── db/
│   │   ├── db.go                # PostgreSQL connection pool
│   │   ├── integration_test.go  # End-to-end DB tests
│   │   ├── keys.go              # Signal identity + OTP key queries
│   │   ├── messages.go          # Message insert/query
│   │   ├── messages_test.go
│   │   ├── sessions.go          # Session CRUD
│   │   ├── store.go             # Store interface (DI for testing)
│   │   ├── testdb.go            # Test DB setup/migration utilities
│   │   └── users.go             # User CRUD
│   ├── livekit/
│   │   ├── token.go             # LiveKit access token generation
│   │   └── token_test.go
│   ├── models/
│   │   └── models.go            # User, Session, Message, PreKeyBundle, DTOs
│   └── ws/
│       ├── client.go            # Read/write pumps, media.key relay (self-relay guard, payload cap)
│       ├── client_test.go       # 5 tests: relay, missing target, self-relay, oversized, nonexistent
│       ├── handler.go           # HTTP upgrade + JWT auth
│       ├── handlers.go          # Message routing (message.send, history, typing)
│       ├── handlers_test.go     # Message handler tests
│       ├── hub.go               # Hub: presence, channels, broadcast, BroadcastToUser
│       └── hub_test.go          # Hub presence/subscribe/broadcast tests
├── migrations/
│   ├── 000001_init_schema.up.sql   # Full schema: users, sessions, servers, channels, members, messages, signal keys, devices, invites
│   ├── 000001_init_schema.down.sql
│   ├── 000002_messages_recipient_id.up.sql   # Fan-out recipient_id column
│   └── 000002_messages_recipient_id.down.sql
├── go.mod
└── go.sum

client/
├── src/
│   ├── App.jsx                   # Router: / → Home, /room/:name → Room, /roadmap → Roadmap
│   ├── main.jsx                  # React entry point
│   │
│   ├── assets/
│   │   └── logo-wordmark.svg     # SVG wordmark
│   │
│   ├── contexts/
│   │   └── AuthContext.jsx       # Auth context (JWT-based, wraps useAuth)
│   │
│   ├── hooks/
│   │   ├── useAuth.js            # Go backend auth (JWT, register, login, guest, session rehydration)
│   │   ├── useRoom.js            # LiveKit room: E2EE via Signal, track management, wsClient guard
│   │   ├── useSignal.js          # Signal Protocol session management, encrypt/decrypt
│   │   ├── useDevices.js         # Device enumeration (cameras, mics)
│   │   └── useBreakpoint.js      # Responsive breakpoint detection
│   │
│   ├── lib/
│   │   ├── api.js                # HTTP client for Go backend REST API
│   │   ├── api.test.js           # API client tests
│   │   ├── authStorage.js        # Credential persistence (localStorage)
│   │   ├── authStorage.test.js   # Auth storage tests
│   │   ├── e2eeKeyManager.js     # LiveKit E2EE key generation, distribution via Signal over WebSocket
│   │   ├── e2eeKeyManager.test.js # 16 tests: retrySend, mediaKey listener, leader logic, rekey, base64
│   │   ├── hushCrypto.js         # WASM wrapper: X3DH, Double Ratchet, key generation
│   │   ├── signalStore.js        # Signal Protocol state in IndexedDB (identity, sessions, pre-keys)
│   │   ├── signalStore.test.js   # Signal store tests
│   │   ├── trackManager.js       # LiveKit track publishing/subscribing, quality settings
│   │   ├── uploadKeysAfterAuth.js # Post-auth Signal key generation and upload
│   │   ├── ws.js                 # WebSocket client for Go backend (JWT auth, reconnect, events)
│   │   ├── ws.test.js            # WebSocket client tests
│   │   ├── bandwidthEstimator.js # Upload speed test → quality recommendation
│   │   └── noiseGateWorklet.js   # AudioWorklet processor for mic noise gating
│   │
│   ├── pages/
│   │   ├── Home.jsx              # Auth UI + room create/join (still uses Matrix auth as bridge)
│   │   ├── Room.jsx              # Main room: stream grid, controls, chat, participants
│   │   └── Roadmap.jsx           # Public roadmap page
│   │
│   ├── components/
│   │   ├── AppBackground.jsx     # Ambient background effect
│   │   ├── Chat.jsx              # Chat panel (Signal Protocol encrypted, WebSocket transport)
│   │   ├── Controls.jsx          # Mic, camera, screen share, quality, settings
│   │   ├── DevicePickerModal.jsx # Camera/mic device selection
│   │   ├── LogoWordmark.jsx      # Logo component (Cormorant Garamond + orange dot)
│   │   ├── QualityPickerModal.jsx# Resolution/framerate picker
│   │   ├── ScreenShareCard.jsx   # Screen share display card
│   │   └── StreamView.jsx        # Video element wrapper with stats overlay
│   │
│   ├── test/
│   │   └── setup.js              # Vitest global setup (IndexedDB mock)
│   │
│   ├── utils/
│   │   └── constants.js          # QUALITY_PRESETS, DEFAULT_QUALITY, MEDIA_SOURCES
│   │
│   └── styles/
│       └── global.css            # Design system: deep dark, orange accent #d54f12
│
├── public/
│   └── wasm/                     # hush-crypto WASM build output
│
├── vitest.config.js              # Vitest config (jsdom, test setup)

hush-crypto/                      # Rust crate wrapping libsignal
├── src/
│   ├── lib.rs                    # Public API re-exports
│   ├── identity.rs               # Identity key pair + registration ID
│   ├── prekey.rs                 # SPK + OPK generation (returns private keys)
│   ├── x3dh_wrap.rs              # X3DH initiator + responder flows
│   ├── session.rs                # Double Ratchet encrypt/decrypt, wire format
│   └── wasm.rs                   # wasm-bindgen bindings
├── tests/
│   └── e2e_signal_flow.rs        # 3 integration tests (with/without OPK, wrong AD)
└── Cargo.toml

caddy/
└── Caddyfile                     # Reverse proxy: routes to Go backend + LiveKit + static

livekit/
└── livekit.yaml                  # LiveKit server config

scripts/
├── setup.sh                      # Docker setup script
└── checkpoint-B-test.md          # Manual test checklist

```

---

## Target Stack (post-refactor)

| Layer | Technology |
|-|-|
| Frontend | React 18 + Vite + hush-crypto (WASM) + livekit-client |
| Client media crypto | WebCrypto API (AES-GCM frame encryption) |
| Desktop | Tauri + CEF (Rust shell + bundled Chromium, native `hush-crypto` via IPC) |
| Mobile | React Native + UniFFI bindings to Rust crypto |
| Crypto core | Rust crate (hush-crypto wrapping libsignal) — WASM for web, direct Rust for Tauri, UniFFI for mobile |
| Backend | Go + Chi (auth, rooms, channels, membership, WebSocket, pre-key server, LiveKit tokens) |
| Database | PostgreSQL (new schema, owned by Go backend) |
| Media SFU | LiveKit Server |
| Reverse proxy | Caddy |
| Deployment | docker-compose: Go backend + Postgres + LiveKit + Redis + Caddy |

---

## Target File Map

```
server/
├── cmd/
│   └── hush/
│       └── main.go              # Entry point, Chi router, graceful shutdown
├── internal/
│   ├── api/                     # HTTP handlers (auth, servers, channels, keys, invites)
│   ├── auth/                    # JWT generation/validation, bcrypt, session logic
│   ├── db/                      # PostgreSQL queries, connection pool
│   ├── models/                  # Domain types (User, Server, Channel, Message, etc.)
│   ├── ws/                      # WebSocket hub, connection management, message routing
│   └── livekit/                 # LiveKit token generation (server-sdk-go)
├── migrations/                  # PostgreSQL migrations (golang-migrate)
├── go.mod
└── go.sum

client/
├── src/
│   ├── App.jsx                  # Router with server/channel structure
│   ├── main.jsx                 # React entry point
│   │
│   ├── assets/
│   │   └── logo-wordmark.svg
│   │
│   ├── contexts/
│   │   └── AuthContext.jsx      # Auth state (JWT-based, no Matrix)
│   │
│   ├── hooks/
│   │   ├── useAuth.js           # Auth: register, login, guest, session rehydration
│   │   ├── useRoom.js           # LiveKit room connection, E2EE setup
│   │   ├── useSignal.js         # Signal Protocol: session management, encrypt/decrypt
│   │   ├── useServers.js        # Server CRUD, membership
│   │   ├── useChannels.js       # Channel CRUD, types (text/voice)
│   │   ├── useDevices.js        # Device enumeration (KEEP)
│   │   └── useBreakpoint.js     # Responsive breakpoints (KEEP)
│   │
│   ├── lib/
│   │   ├── api.js               # HTTP client for Go backend REST API
│   │   ├── ws.js                # WebSocket client (replaces Matrix sync)
│   │   ├── signalStore.js       # Signal Protocol key storage (IndexedDB)
│   │   ├── e2eeKeyManager.js    # LiveKit frame key generation + distribution via Signal
│   │   ├── trackManager.js      # LiveKit track management (KEEP, adapt)
│   │   ├── bandwidthEstimator.js# Upload speed test (KEEP)
│   │   └── noiseGateWorklet.js  # Audio noise gate (KEEP)
│   │
│   ├── pages/
│   │   ├── Home.jsx             # Auth UI (login/register/guest)
│   │   ├── ServerView.jsx       # Server layout: channel list + content area
│   │   ├── TextChannel.jsx      # Chat-only view (Signal-encrypted)
│   │   ├── VoiceChannel.jsx     # Media + optional chat sidebar
│   │   └── Invite.jsx           # Invite link handler
│   │
│   ├── components/
│   │   ├── ServerList.jsx       # Vertical server sidebar
│   │   ├── ChannelList.jsx      # Text/voice channels within a server
│   │   ├── MemberList.jsx       # Server members with presence
│   │   ├── ModerationPanel.jsx  # Admin controls
│   │   ├── Chat.jsx             # Chat panel (Signal Protocol, no Matrix)
│   │   ├── Controls.jsx         # Media controls (KEEP, adapt)
│   │   ├── StreamView.jsx       # Video wrapper (KEEP)
│   │   ├── ScreenShareCard.jsx  # Screen share card (KEEP)
│   │   ├── DevicePickerModal.jsx# Device picker (KEEP)
│   │   ├── QualityPickerModal.jsx# Quality picker (KEEP)
│   │   ├── AppBackground.jsx    # Background effect (KEEP)
│   │   └── LogoWordmark.jsx     # Logo (KEEP)
│   │
│   ├── utils/
│   │   └── constants.js         # Quality presets (KEEP)
│   │
│   └── styles/
│       └── global.css           # Design system (KEEP)

hush-crypto/                     # Rust crate (libsignal wrapper)
├── src/
│   ├── lib.rs                   # Public API re-exports
│   ├── identity.rs              # Identity key pair + registration ID generation
│   ├── prekey.rs                # SPK + OPK generation (returns private keys)
│   ├── x3dh_wrap.rs             # X3DH initiator + responder flows
│   ├── session.rs               # Double Ratchet encrypt/decrypt, wire format
│   └── wasm.rs                  # wasm-bindgen bindings for web
├── tests/
│   └── e2e_signal_flow.rs       # Integration tests (X3DH + Double Ratchet round-trip)
├── Cargo.toml
└── uniffi/                      # UniFFI bindings (Swift, Kotlin)

caddy/
└── Caddyfile                    # Routes to Go backend + LiveKit + static

livekit/
└── livekit.yaml                 # LiveKit server config (KEEP)
```

---

## Target docker-compose Services

| Service | Image | Purpose | Port |
|-|-|-|-|
| hush-api | Custom (Go) | Backend API + WebSocket | 8080 |
| postgres | postgres:16-alpine | Database | 5432 |
| livekit | livekit/livekit-server:latest | SFU for media | 7880, 7881, 50000-60000/udp |
| redis | redis:7-alpine | LiveKit pub/sub (self-hosted only) | 6379 |
| caddy | caddy:2-alpine | Reverse proxy + TLS + static files | 443 |

**Removed:** Synapse, lk-jwt-service.

---

## Key Design Decisions

1. **Go over Node.js**: The backend is a clean rewrite. Go gives strong concurrency (goroutines for WebSocket hub), single binary deployment, and no runtime dependency. Chi is minimal and composable.
2. **Signal Protocol over Olm/Megolm**: Matrix's crypto libraries (libolm, vodozemac) have documented vulnerabilities (cache-timing, non-contributory ECDH). Signal Protocol is battle-tested with a clean track record. See PLAN.md "Why Not Matrix" for details.
3. **Custom backend over Synapse**: Using Signal Protocol breaks Matrix compatibility. Without Matrix compatibility, Synapse adds only complexity (federation overhead, Matrix event model, Spaces API). A purpose-built Go backend is simpler, faster, and fully controlled.
4. **LiveKit stays**: LiveKit's Insertable Streams E2EE is solid. Only the key distribution layer changes (Matrix to-device -> Signal Protocol via WebSocket).
5. **Guest access is mandatory**: Users must try Hush without creating an account. The Go backend supports temporary guest accounts with limited permissions.
6. **Hosted logic is isolated**: `hosted/` contains gethush.live-specific logic (managed instance provisioning, monitoring). The core app has zero payment or hosting awareness.
7. **Single Rust crypto crate**: `hush-crypto` wraps libsignal. Web uses WASM (via wasm-pack). Desktop (Tauri) uses the crate directly via Tauri commands. Mobile uses UniFFI bindings (Swift, Kotlin). One implementation, zero cross-platform interop risk.

---

## End-to-End Encryption (E2EE)

### Signal Protocol for Chat

**Protocol**: Chat messages are encrypted using Signal Protocol (X3DH key agreement + Double Ratchet). This replaces Matrix Olm/Megolm.

**Key Exchange**:
1. On registration, client generates: identity key pair, signed pre-key, batch of one-time pre-keys
2. Keys uploaded to Go backend pre-key server (`POST /api/keys/upload`)
3. To message a new contact: fetch their pre-key bundle (`GET /api/keys/:userId`), perform X3DH handshake
4. Subsequent messages use Double Ratchet for forward secrecy

**Group Messaging**:
- Small groups (< 50): fan-out encryption (message encrypted individually per recipient)
- Large channels: shared symmetric key rotated on membership change, distributed via pairwise Signal sessions

**Key Storage**: Signal Protocol state in IndexedDB (version 2), prefixed per user: `hush-signal-${userId}-${deviceId}`. Stores:
- Identity key pair (public + private)
- Registration ID
- Session states with associated data (AD = `Encode(IK_A) || Encode(IK_B)`, 66 bytes)
- Signed pre-key (public + private + signature) — needed for X3DH responder
- One-time pre-key private keys — consumed and deleted after first use

Only public keys are uploaded to the server. Private keys never leave the client.

**X3DH Flows**:
- *Initiator* (sending first message): fetch recipient's pre-key bundle, compute shared secret, initialize sender ratchet state. Wrap ciphertext in PreKey envelope (`0x01` + sender IK + EK + key IDs + DR payload).
- *Responder* (receiving first message): parse PreKey envelope, load local SPK/OPK private keys, compute shared secret, initialize receiver ratchet state. Delete consumed OPK.
- *Subsequent messages*: Regular envelope (`0x02` + DR payload) with stored session state and AD.

**Implementation Files**:
- `client/src/hooks/useSignal.js` — Signal session management, encrypt/decrypt, message envelope
- `client/src/lib/signalStore.js` — IndexedDB persistence for all Signal state
- `client/src/lib/hushCrypto.js` — WASM wrapper (X3DH, Double Ratchet, key generation)
- `client/src/lib/uploadKeysAfterAuth.js` — Post-auth key generation and upload
- `hush-crypto/` — Rust crate (X3DH initiator + responder, Double Ratchet, WASM bindings)
- `server/internal/api/keys.go` — Pre-key server endpoints

### LiveKit E2EE for Media

**Protocol**: WebRTC media streams encrypted using LiveKit's Insertable Streams with AES-256-GCM. Same mechanism as current implementation — only the key distribution changes.

**Key Distribution** (implemented — Phase D):
1. Room creator generates 256-bit AES-GCM key (`crypto.getRandomValues(new Uint8Array(32))`)
2. Key encrypted via Signal session and sent to each participant over WebSocket (`media.key` message type)
3. On participant join: leader sends frame key via Signal (encrypted once, retried on send failure)
4. On participant leave: leader generates new key, distributes to remaining via `Promise.allSettled`
5. Server hardening: self-relay blocked, payload capped at 4096 bytes

**Leader Election**: Deterministic — lowest user ID among connected participants. On leader disconnect, next lowest takes over.

**Implementation Files**:
- `client/src/lib/e2eeKeyManager.js` — Key generation, distribution via Signal sessions over WebSocket
- `client/src/lib/e2eeKeyManager.test.js` — 16 tests (retrySend, media.key listener, leader logic, rekey, base64)
- `client/src/hooks/useRoom.js` — LiveKit Room with `ExternalE2EEKeyProvider`, E2EE worker
- `server/internal/ws/client.go` — media.key relay with self-relay guard and payload cap

**No Silent Degradation**: If E2EE setup fails (worker load failure, key exchange failure), do NOT connect to LiveKit. Show error: "Media encryption unavailable."

---

## Preserve List (DO NOT delete/break these)

- `client/src/styles/global.css` — design system
- `client/src/lib/noiseGateWorklet.js` — reuse in LiveKit audio pipeline
- `client/src/lib/bandwidthEstimator.js` — quality recommendation
- `client/src/utils/constants.js` — quality presets (adapt to LiveKit encoding params)
- `client/src/hooks/useBreakpoint.js` — responsive utils
- `client/src/hooks/useDevices.js` — device enumeration
- `client/src/components/StreamView.jsx` — video wrapper
- `client/src/components/Controls.jsx` — media controls (adapt)
- `client/src/components/AppBackground.jsx` — ambient background
- `client/src/components/LogoWordmark.jsx` — brand wordmark
- `client/src/assets/logo-wordmark.svg` — SVG wordmark asset
- `design-system.md` — UI design language
- `livekit/livekit.yaml` — LiveKit server config

## Remove List (completed)

All Matrix/Synapse components removed:
- `server/src/` — entire old Node.js server (replaced by Go backend)
- `synapse/` — Synapse config and data
- `client/src/hooks/useMatrixAuth.js`, `client/src/lib/matrixClient.js` — Matrix client code
- `client/src/contexts/AuthContext.jsx` — rewritten for JWT (no Matrix)
- `scripts/test-synapse.sh`, `scripts/generate-synapse-config.sh`, `scripts/test-chat.sh` — Matrix test scripts
- `docker-compose.yml` — Synapse service, old Node.js `hush` service, Matrix env vars
- `Dockerfile` — old Node.js root Dockerfile (Go backend has its own)
- `docs/reference/MATRIX_REFERENCE.md` — Matrix protocol reference
- All `matrix-js-sdk` imports removed from client
