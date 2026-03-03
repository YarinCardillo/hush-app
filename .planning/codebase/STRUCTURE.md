# Codebase Structure

**Analysis Date:** 2026-03-03

## Directory Layout

```
hush-app/
├── server/                              # Go backend (Chi router, PostgreSQL)
│   ├── cmd/
│   │   └── hush/
│   │       └── main.go                  # Entry point: config, DB, migrations, router setup
│   ├── internal/
│   │   ├── api/                         # HTTP handlers
│   │   │   ├── auth.go                  # Register, login, guest, logout, me
│   │   │   ├── auth_test.go
│   │   │   ├── channels.go              # GET /api/channels/:id/messages
│   │   │   ├── channels_test.go
│   │   │   ├── channels_crud_test.go
│   │   │   ├── context.go               # Request context helpers (userID, sessionID)
│   │   │   ├── keys.go                  # POST/GET Signal pre-key bundle endpoints
│   │   │   ├── keys_test.go
│   │   │   ├── middleware.go            # RequireAuth (JWT + session validation)
│   │   │   ├── livekit.go               # POST /api/livekit/token
│   │   │   ├── servers.go               # CRUD for servers, channels, members, invites
│   │   │   ├── servers_test.go
│   │   │   ├── invites.go               # POST /api/invites/claim
│   │   │   ├── invites_test.go
│   │   │   ├── webhook.go               # LiveKit webhook handler
│   │   │   ├── webhook_test.go
│   │   │   └── mock_store_test.go       # Mock Store for testing
│   │   │
│   │   ├── auth/                        # Auth utilities
│   │   │   ├── jwt.go                   # Sign, verify, claims extraction
│   │   │   ├── jwt_test.go
│   │   │   ├── password.go              # bcrypt hash/compare
│   │   │   └── password_test.go
│   │   │
│   │   ├── config/
│   │   │   └── config.go                # Env-based config (DB_URL, JWT_SECRET, etc.)
│   │   │
│   │   ├── db/                          # PostgreSQL layer
│   │   │   ├── store.go                 # Store interface (DI pattern)
│   │   │   ├── db.go                    # Pool wrapper around pgxpool.Pool
│   │   │   ├── users.go                 # CreateUser, GetUserByUsername, GetUserByID
│   │   │   ├── sessions.go              # CreateSession, GetSessionByTokenHash, DeleteSessionByID
│   │   │   ├── messages.go              # InsertMessage, GetMessages
│   │   │   ├── messages_test.go
│   │   │   ├── keys.go                  # Signal key CRUD (identity, pre-keys)
│   │   │   ├── servers.go               # Server/channel/member/invite queries
│   │   │   ├── channels.go              # Channel queries
│   │   │   ├── testdb.go                # Test DB setup/teardown
│   │   │   └── integration_test.go      # End-to-end DB tests
│   │   │
│   │   ├── livekit/
│   │   │   ├── token.go                 # GenerateAccessToken (server-sdk-go)
│   │   │   └── token_test.go
│   │   │
│   │   ├── models/
│   │   │   └── models.go                # User, Session, Message, Server, Channel, ServerMember, DTOs
│   │   │
│   │   └── ws/                          # WebSocket hub
│   │       ├── client.go                # Client: read/write pumps, message relay
│   │       ├── client_test.go
│   │       ├── handler.go               # HTTP upgrade + JWT validation
│   │       ├── handlers.go              # Message routing (message.send, history, typing, media.key)
│   │       ├── handlers_test.go
│   │       ├── hub.go                   # Hub: presence, subscriptions, broadcast
│   │       └── hub_test.go
│   │
│   ├── migrations/
│   │   ├── 000001_init_schema.up.sql    # Full schema: users, sessions, servers, channels, members, messages, signal keys
│   │   ├── 000001_init_schema.down.sql
│   │   ├── 000002_messages_recipient_id.up.sql   # Fan-out encryption per-recipient
│   │   └── 000002_messages_recipient_id.down.sql
│   │
│   ├── go.mod                           # Go module definition
│   └── go.sum                           # Go dependency lock file
│
├── client/                              # React frontend (Vite, Signal Protocol, LiveKit)
│   ├── src/
│   │   ├── main.jsx                     # React entry point (root mount)
│   │   ├── App.jsx                      # Route definitions, theme sync, suspense
│   │   │
│   │   ├── pages/                       # Route components
│   │   │   ├── Home.jsx                 # Login/register/guest forms
│   │   │   ├── ServerLayout.jsx         # Main app layout (server list + channel list + content)
│   │   │   ├── ServerLayout.test.jsx
│   │   │   ├── Room.jsx                 # Voice call with LiveKit (legacy, pre-servers)
│   │   │   ├── VoiceChannel.jsx         # Voice channel in server
│   │   │   ├── VoiceChannel.test.jsx
│   │   │   ├── TextChannel.jsx          # Text-only chat in server
│   │   │   ├── TextChannel.test.jsx
│   │   │   ├── Invite.jsx               # Invite code handler
│   │   │   └── Roadmap.jsx              # Public roadmap page
│   │   │
│   │   ├── components/                  # UI components
│   │   │   ├── ServerList.jsx           # Vertical sidebar: servers
│   │   │   ├── ServerList.test.jsx
│   │   │   ├── ChannelList.jsx          # Channels within active server
│   │   │   ├── ChannelList.test.jsx
│   │   │   ├── MemberList.jsx           # Users in active server
│   │   │   ├── MemberList.test.jsx
│   │   │   ├── Chat.jsx                 # Chat panel (Signal-encrypted messages)
│   │   │   ├── Controls.jsx             # Mic/camera/screen share buttons + quality/device settings
│   │   │   ├── StreamView.jsx           # <video> wrapper with stats overlay
│   │   │   ├── VideoGrid.jsx            # Grid of participant videos
│   │   │   ├── ScreenShareCard.jsx      # Screen share display
│   │   │   ├── DevicePickerModal.jsx    # Camera/mic device selection
│   │   │   ├── QualityPickerModal.jsx   # Resolution/framerate picker
│   │   │   ├── UserSettingsModal.jsx    # Theme, display name
│   │   │   ├── ServerSettingsModal.jsx  # Server metadata edit (owner only)
│   │   │   ├── ConfirmModal.jsx         # Generic confirm dialog
│   │   │   ├── AppBackground.jsx        # Ambient background effect
│   │   │   ├── LogoWordmark.jsx         # Logo component
│   │   │   ├── HushOrb.jsx              # Animated orb component
│   │   │   └── modalStyles.js           # Shared modal CSS module
│   │   │
│   │   ├── hooks/                       # Custom React hooks
│   │   │   ├── useAuth.js               # Auth state (login, register, guest, session rehydration)
│   │   │   ├── useAuth.test.jsx
│   │   │   ├── useRoom.js               # LiveKit room + E2EE setup
│   │   │   ├── useSignal.js             # Signal Protocol session management (encrypt/decrypt)
│   │   │   ├── useDevices.js            # Camera/mic enumeration (cached)
│   │   │   ├── useBreakpoint.js         # Responsive breakpoint detection
│   │   │   ├── useSidebarResize.js      # Draggable sidebar resizing
│   │   │
│   │   ├── lib/                         # Utility libraries (non-React)
│   │   │   ├── api.js                   # HTTP client for Go backend (fetchWithAuth, server/channel/key methods)
│   │   │   ├── api.test.js
│   │   │   ├── ws.js                    # WebSocket client (JWT auth, reconnect, event listeners)
│   │   │   ├── ws.test.js
│   │   │   ├── signalStore.js           # IndexedDB persistence for Signal state (identity, sessions, pre-keys)
│   │   │   ├── signalStore.test.js
│   │   │   ├── hushCrypto.js            # WASM wrapper (X3DH, Double Ratchet, key generation)
│   │   │   ├── uploadKeysAfterAuth.js   # Post-auth key generation + upload
│   │   │   ├── e2eeKeyManager.js        # LiveKit frame key generation + distribution via Signal
│   │   │   ├── e2eeKeyManager.test.js
│   │   │   ├── trackManager.js          # LiveKit track publishing/subscribing
│   │   │   ├── bandwidthEstimator.js    # Upload speed test → quality recommendation
│   │   │   ├── noiseGateWorklet.js      # AudioWorklet processor for noise gating
│   │   │   └── authStorage.js           # Credential persistence (localStorage, legacy)
│   │   │
│   │   ├── contexts/
│   │   │   └── AuthContext.jsx          # React Context: auth state, JWT-based (no Matrix)
│   │   │
│   │   ├── assets/
│   │   │   └── logo-wordmark.svg        # Logo wordmark SVG
│   │   │
│   │   ├── utils/
│   │   │   └── constants.js             # QUALITY_PRESETS, DEFAULT_QUALITY, MEDIA_SOURCES
│   │   │
│   │   ├── styles/
│   │   │   └── global.css               # Design system: colors, fonts, dark theme
│   │   │
│   │   ├── test/
│   │   │   ├── setup.js                 # Vitest global setup (IndexedDB mock)
│   │   │   └── cryptoMocks.js           # Mock crypto APIs
│   │   │
│   │   └── wasm/                        # hush-crypto WASM build output (generated)
│   │       ├── hush_crypto.js           # WASM JS bindings (generated by wasm-pack)
│   │       └── hush_crypto_bg.wasm      # WASM binary (generated)
│   │
│   ├── public/                          # Static assets (served by Vite)
│   ├── vitest.config.js                 # Vitest config (jsdom, test setup)
│   └── package.json                     # Dependencies, npm scripts
│
├── hush-crypto/                         # Rust crate: libsignal wrapper (WASM + native)
│   ├── src/
│   │   ├── lib.rs                       # Public API re-exports
│   │   ├── identity.rs                  # Identity key pair + registration ID generation
│   │   ├── prekey.rs                    # SPK + OPK generation
│   │   ├── x3dh_wrap.rs                 # X3DH initiator + responder flows
│   │   ├── session.rs                   # Double Ratchet encrypt/decrypt, wire format
│   │   └── wasm.rs                      # wasm-bindgen bindings (exposed to JS)
│   ├── tests/
│   │   └── e2e_signal_flow.rs           # Integration tests (X3DH + Double Ratchet round-trip)
│   └── Cargo.toml                       # Rust package definition
│
├── caddy/
│   └── Caddyfile                        # Reverse proxy config: routes to Go backend + LiveKit + static
│
├── livekit/
│   └── livekit.yaml                     # LiveKit server config
│
├── scripts/
│   ├── setup.sh                         # Docker setup automation
│   ├── build-wasm.js                    # Build hush-crypto WASM
│   ├── copy-icons.js                    # Copy favicon/icons to public/
│   ├── checkpoint-B-test.md             # Manual test checklist
│   └── [other utility scripts]
│
├── docs/
│   ├── plans/                           # Implementation plan documents
│   └── [reference docs]
│
├── .signal-specs/                       # Signal Protocol specification docs
├── .planning/
│   └── codebase/                        # GSD codebase analysis (this file's location)
│
├── ARCHITECTURE.md                      # Current/target architecture (git-committed)
├── PLAN.md                              # Development roadmap (local only, gitignored)
├── CLAUDE.md                            # Project engineering standards
├── design-system.md                     # UI design language
├── README.md                            # Project overview
├── docker-compose.yml                   # Local dev: hush-api, postgres, livekit, redis, caddy
├── docker-compose.prod.yml              # Production config
├── package.json                         # Root npm scripts (mostly unused, per-dir scripts used)
└── go.sum / go.mod                      # (in server/ dir)
```

## Directory Purposes

**`server/cmd/hush/`:**
- Purpose: Go application entry point
- Contains: main.go (config load, DB/migrations, router setup, graceful shutdown)
- Key files: `main.go`

**`server/internal/api/`:**
- Purpose: HTTP request handlers (business logic at request boundary)
- Contains: Auth, server/channel/member CRUD, Signal key endpoints, LiveKit tokens, WebSocket upgrades
- Key files: `auth.go`, `servers.go`, `channels.go`, `keys.go`, `livekit.go`, `middleware.go`
- Pattern: Each handler file grouped by domain (auth, servers, channels, etc.); tests adjacent (*_test.go)

**`server/internal/db/`:**
- Purpose: Data persistence layer (queries, transactions)
- Contains: Store interface, pool wrapper, CRUD methods per entity
- Key files: `store.go` (interface), `db.go` (pool), `users.go`, `servers.go`, `messages.go`, `keys.go`
- Pattern: Store interface decouples handlers from DB; tests use mock Store

**`server/internal/auth/`:**
- Purpose: Authentication utilities (JWT, bcrypt)
- Contains: JWT generation/validation, password hashing
- Key files: `jwt.go`, `password.go`

**`server/internal/ws/`:**
- Purpose: WebSocket coordination (hub, client connections, message routing)
- Contains: Hub (presence, subscriptions, broadcast), client read/write pumps, message handlers
- Key files: `hub.go`, `client.go`, `handler.go`, `handlers.go`
- Pattern: Hub protects state with mutex; clients communicate via channels

**`server/internal/models/`:**
- Purpose: Domain data structures (DTOs, request/response types)
- Contains: User, Session, Server, Channel, Message, PreKeyBundle, etc.
- Key files: `models.go`

**`server/migrations/`:**
- Purpose: Database schema versioning (golang-migrate)
- Contains: .up.sql (apply) and .down.sql (rollback) files numbered sequentially
- Key files: `000001_init_schema.up.sql` (full schema), `000002_messages_recipient_id.up.sql` (fan-out)

**`client/src/pages/`:**
- Purpose: Route components (full page views)
- Contains: Home (auth), ServerLayout (main app), Room/VoiceChannel/TextChannel, Invite, Roadmap
- Pattern: Each page is a lazy-loaded component, wrapped by suspense in App.jsx

**`client/src/components/`:**
- Purpose: Reusable UI components
- Contains: Modals, sidebar lists, media controls, chat, video grid
- Pattern: Stateless or simple component state; complex logic lifted to hooks

**`client/src/hooks/`:**
- Purpose: Stateful logic extraction (useAuth, useRoom, useSignal, etc.)
- Contains: Auth state, LiveKit integration, Signal Protocol sessions, device enumeration
- Pattern: Each hook exports functions/state for use in components; async operations use useState/useEffect

**`client/src/lib/`:**
- Purpose: Non-React utility libraries (API client, WebSocket, crypto, storage)
- Contains: HTTP client (api.js), WebSocket (ws.js), Signal key store (signalStore.js), WASM wrapper (hushCrypto.js), E2EE manager
- Pattern: Pure JS functions, no React dependency; indexed DB for persistence; exportable for testing

**`client/src/styles/`:**
- Purpose: Global design tokens and theme
- Contains: CSS custom properties (colors, fonts), dark theme, responsive utilities
- Key files: `global.css`

**`hush-crypto/src/`:**
- Purpose: Rust Signal Protocol wrapper (X3DH, Double Ratchet)
- Contains: Key generation, X3DH flows, session management, WASM bindings
- Pattern: Public API exposed via lib.rs; wasm.rs provides JS bindings

## Key File Locations

**Entry Points:**
- `server/cmd/hush/main.go`: Backend startup
- `client/src/main.jsx`: React root mount
- `client/src/App.jsx`: Route definitions

**Configuration:**
- `server/internal/config/config.go`: Env-based config (DATABASE_URL, JWT_SECRET, CORS_ORIGIN, etc.)
- `.env`: Local dev environment variables (contains secrets, never committed)
- `docker-compose.yml`: Local dev compose config

**Core Logic:**
- `server/internal/api/`: All HTTP handlers (request → response)
- `server/internal/db/`: All database queries (Store interface)
- `server/internal/ws/`: WebSocket hub and client management
- `client/src/hooks/useAuth.js`: Auth state and lifecycle
- `client/src/hooks/useRoom.js`: LiveKit room setup and track management
- `client/src/hooks/useSignal.js`: Signal Protocol encryption/decryption
- `client/src/lib/api.js`: HTTP client for backend API
- `client/src/lib/ws.js`: WebSocket client for real-time events

**Testing:**
- `server/internal/api/*_test.go`: Handler tests (mock Store, HTTP assertions)
- `server/internal/db/testdb.go`: Test database setup (create/drop schemas)
- `server/internal/db/integration_test.go`: End-to-end DB tests
- `client/src/**/*.test.jsx`: React component tests (Vitest + jsdom)
- `client/src/lib/*.test.js`: Utility library tests
- `hush-crypto/tests/e2e_signal_flow.rs`: Rust integration tests

**Crypto & Encryption:**
- `hush-crypto/src/lib.rs`: Public API exports
- `hush-crypto/src/identity.rs`: Key pair generation
- `hush-crypto/src/prekey.rs`: Pre-key generation
- `hush-crypto/src/x3dh_wrap.rs`: X3DH initiator/responder
- `hush-crypto/src/session.rs`: Double Ratchet encrypt/decrypt
- `client/src/lib/signalStore.js`: IndexedDB storage for Signal state
- `client/src/lib/hushCrypto.js`: WASM wrapper for hush-crypto
- `client/src/lib/uploadKeysAfterAuth.js`: Post-auth key generation/upload
- `server/internal/api/keys.go`: Pre-key server endpoints

## Naming Conventions

**Files:**

- Go files: `snake_case.go` (e.g., `auth_test.go`, `channels_crud_test.go`)
- React components: `PascalCase.jsx` (e.g., `Home.jsx`, `ChannelList.jsx`)
- Utilities/hooks: `camelCase.js` (e.g., `useAuth.js`, `api.js`, `signalStore.js`)
- Tests: append `.test.js` or `_test.go` (e.g., `api.test.js`, `auth_test.go`)

**Directories:**

- API handler packages: lowercase plural (e.g., `api/`, `hooks/`, `lib/`, `pages/`, `components/`)
- Internal packages: lowercase singular (e.g., `internal/auth/`, `internal/db/`, `internal/ws/`)

**Go Naming:**

- Functions: camelCase (e.g., `CreateUser`, `GetUserByID`, `BroadcastToServer`)
- Types: PascalCase (e.g., `User`, `Server`, `Hub`, `Store`)
- Interfaces: PascalCase (e.g., `Store`)
- Unexported helpers: camelCase with lowercase first letter (e.g., `hasOtherClientForUser`)
- Constants: UPPER_SNAKE_CASE (e.g., `minPasswordLen`, `maxUsernameLen`)

**JavaScript Naming:**

- Functions: camelCase (e.g., `fetchWithAuth`, `createServer`, `encryptMessage`)
- Classes/Components: PascalCase (e.g., `Home`, `Chat`, `ServerList`)
- Constants: UPPER_SNAKE_CASE (e.g., `JWT_KEY`, `DEVICE_ID_KEY`, `DEFAULT_QUALITY`)
- Private/internal: prefixed with `_` (e.g., `_validateInput`) or `#` (private fields)
- Booleans: prefix with `is`, `has`, `can` (e.g., `isLoading`, `hasError`, `canEdit`)

## Where to Add New Code

**New Feature:**
- Primary code: Handler in `server/internal/api/[domain].go`, DB queries in `server/internal/db/[domain].go`
- Frontend: Hook in `client/src/hooks/` (if stateful) or component in `client/src/components/` (if UI)
- Tests: Adjacent `*_test.go` or `.test.js` files

**New Component/Module:**
- Frontend component: `client/src/components/[Name].jsx` + `[Name].test.jsx`
- Custom hook: `client/src/hooks/use[Feature].js` + `.test.jsx`
- Backend service: `server/internal/[domain]/handler.go` + test file

**Utilities:**
- Shared JS helpers: `client/src/lib/[utility].js` + `.test.js`
- Go helpers: `server/internal/[domain]/helpers.go` or new file in appropriate package

**Database Migration:**
- Create file: `server/migrations/NNNNNN_description.up.sql` (incrementing number)
- Create rollback: `server/migrations/NNNNNN_description.down.sql`
- Run at startup via golang-migrate in main.go

## Special Directories

**`server/migrations/`:**
- Purpose: Database schema versioning
- Generated: No (hand-written SQL)
- Committed: Yes (essential for consistency)
- Pattern: Numbered sequentially; .up.sql applies, .down.sql rolls back

**`client/src/wasm/`:**
- Purpose: WASM build output from hush-crypto crate
- Generated: Yes (built by scripts/build-wasm.js)
- Committed: Yes (to git, for reproducibility)
- Pattern: Recompile before client build; not edited manually

**`client/public/`:**
- Purpose: Static assets served by Vite (favicons, icons)
- Generated: Partially (icons copied by scripts/copy-icons.js)
- Committed: Yes

**`hush-crypto/target/`:**
- Purpose: Rust build artifacts
- Generated: Yes (Cargo output)
- Committed: No (in .gitignore)

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis documents (this location)
- Generated: Yes (by GSD mapper agents)
- Committed: No (local analysis)

---

*Structure analysis: 2026-03-03*
