# ARCHITECTURE.md: Hush Codebase Reference

> This file is read by orchestra agents (architect + programmer).
> It maps the CURRENT state of the codebase.
> Update this file as the codebase evolves.

---

## Current Stack

| Layer | Technology | Status |
|-|-|-|
| Frontend | React 18 + Vite + hush-crypto (WASM) + livekit-client | DONE |
| Admin Dashboard | Standalone Vite app (client/admin/), API key auth | DONE |
| Media SFU | LiveKit Server | DONE |
| Signaling | Go WebSocket (ws hub + client) | DONE |
| Auth | Go backend (BIP39 mnemonic identity, cryptographic auth, JWT sessions, guest) | DONE |
| Chat | WebSocket + MLS group encryption (per-channel MLS groups) | DONE |
| E2EE Chat | MLS (RFC 9420) via OpenMLS Rust crate, compiled to WASM | DONE |
| E2EE Media | LiveKit Insertable Streams + MLS export_secret frame key derivation | DONE |
| Backend Opacity | Server is blind relay: guild/channel metadata encrypted (AES-256-GCM), permission_level integers | DONE |
| Rooms | Go backend + PostgreSQL (servers/channels/members) | DONE |
| LiveKit Auth | Go token endpoint (POST /api/livekit/token) | DONE |
| Rate Limiting | Go middleware (per-IP and per-user) | DONE |
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
│   │   ├── admin.go             # RequireAdminAPIKey middleware + admin routes (opaque data only)
│   │   ├── admin_test.go        # Admin handler tests
│   │   ├── auth.go              # Register (public key), authenticate (signature challenge), guest, logout, me
│   │   ├── auth_test.go         # Auth handler tests
│   │   ├── channels.go          # Channel CRUD, message retrieval
│   │   ├── channels_crud_test.go# Channel CRUD tests
│   │   ├── channels_test.go     # Channel message retrieval tests
│   │   ├── context.go           # Request context helpers (userID, sessionID)
│   │   ├── handshake.go         # Client handshake endpoints
│   │   ├── handshake_test.go    # Handshake tests
│   │   ├── headers.go           # Security headers middleware
│   │   ├── headers_test.go      # Security headers tests
│   │   ├── instance.go          # Instance configuration endpoints
│   │   ├── instance_test.go     # Instance tests
│   │   ├── invites.go           # Invite link endpoints
│   │   ├── invites_test.go      # Invite tests
│   │   ├── livekit.go           # POST /api/livekit/token
│   │   ├── livekit_test.go      # LiveKit token tests
│   │   ├── middleware.go        # RequireAuth (JWT + session validation)
│   │   ├── mls.go               # MLS key package + credential endpoints (upload, fetch, group info)
│   │   ├── mls_test.go          # MLS endpoint tests
│   │   ├── mock_store_test.go   # Function-field mock for db.Store
│   │   ├── moderation.go        # Ban, mute, kick, audit log
│   │   ├── moderation_test.go   # Moderation tests
│   │   ├── ratelimit.go         # Rate limiting middleware
│   │   ├── ratelimit_test.go    # Rate limit tests
│   │   ├── servers.go           # Server (guild) CRUD, join/leave, membership
│   │   ├── servers_test.go      # Server handler tests
│   │   ├── system_messages.go   # System message endpoints
│   │   ├── system_messages_test.go
│   │   ├── webhook.go           # LiveKit webhook handler (voice state)
│   │   ├── webhook_test.go      # Webhook tests
│   │   └── webhook_voice_test.go# Voice webhook tests
│   ├── auth/
│   │   ├── jwt.go               # JWT sign/verify/claims (session tokens after cryptographic auth)
│   │   ├── jwt_test.go
│   │   ├── challenge.go         # Ed25519 nonce generation + signature verification (BIP39 auth)
│   │   └── challenge_test.go
│   ├── config/
│   │   └── config.go            # Env-based config
│   ├── db/
│   │   ├── auth_nonces.go       # Challenge-response nonce queries
│   │   ├── channels.go          # Channel queries
│   │   ├── db.go                # PostgreSQL connection pool
│   │   ├── device_keys.go       # Device key certificate queries (multi-device)
│   │   ├── instance.go          # Instance config queries
│   │   ├── integration_test.go  # End-to-end DB tests
│   │   ├── invites.go           # Invite queries
│   │   ├── messages.go          # Message insert/query (ciphertext blobs)
│   │   ├── messages_test.go
│   │   ├── mls.go               # MLS credential + key package queries
│   │   ├── mls_groups.go        # MLS group info queries (text, voice, metadata groups)
│   │   ├── moderation.go        # Moderation queries (bans, mutes, audit log)
│   │   ├── server_members.go    # Server membership queries (permission_level integers)
│   │   ├── servers.go           # Server (guild) queries (encrypted_metadata, access_policy)
│   │   ├── sessions.go          # Session CRUD
│   │   ├── store.go             # Store interface (DI for testing)
│   │   ├── system_messages.go   # System message queries
│   │   ├── testdb.go            # Test DB setup/migration utilities
│   │   └── users.go             # User CRUD (root_public_key, no password_hash)
│   ├── livekit/
│   │   ├── token.go             # LiveKit access token generation
│   │   └── token_test.go
│   ├── models/
│   │   └── models.go            # User, Session, Message, Server, Channel, Member, MLS DTOs
│   └── ws/
│       ├── client.go            # Read/write pumps, message relay
│       ├── client_test.go       # Client relay tests
│       ├── handler.go           # HTTP upgrade + JWT auth
│       ├── handlers.go          # Message routing (message.send, history, typing)
│       ├── handlers_test.go     # Message handler tests
│       ├── hub.go               # Hub: presence, channels, broadcast, BroadcastToServer, BroadcastToUser
│       ├── hub_test.go          # Hub presence/subscribe/broadcast tests
│       └── ratelimit.go         # WebSocket rate limiting
├── migrations/
│   ├── 000001_init_schema.up/down.sql       # Base schema: users, sessions, servers, channels, members, messages, devices, invites
│   ├── 000002_messages_recipient_id.up/down.sql
│   ├── 000003_voice_mode_low_latency.up/down.sql
│   ├── 000004_add_category_type.up/down.sql
│   ├── 000005_single_tenant.up/down.sql
│   ├── 000006_moderation.up/down.sql
│   ├── 000007_multi_tenant.up/down.sql
│   ├── 000008_moderation_indices.up/down.sql
│   ├── 000009_instance_admin.up/down.sql
│   ├── 000010_system_messages.up/down.sql
│   ├── 000011_server_template.up/down.sql
│   ├── 000012_server_templates_table.up/down.sql
│   ├── 000013_spk_lifecycle.up/down.sql
│   ├── 000014_mls_migration.up/down.sql     # Drop signal_* tables, add mls_credentials + mls_key_packages
│   ├── 000015_mls_groups.up/down.sql        # Add mls_group_info table (text, voice group types)
│   ├── 000016_voice_mls.up/down.sql         # Voice MLS group support
│   └── 000017_backend_opacity.up/down.sql   # Drop name/icon_url/owner_id/role, add encrypted_metadata/permission_level/access_policy/discoverable
├── go.mod
└── go.sum

client/
├── src/
│   ├── App.jsx                   # Router: guild/channel layout
│   ├── main.jsx                  # React entry point
│   │
│   ├── assets/
│   │   └── logo-wordmark.svg     # SVG wordmark
│   │
│   ├── contexts/
│   │   └── AuthContext.jsx       # Auth context (BIP39 identity + JWT session, wraps useAuth)
│   │
│   ├── hooks/
│   │   ├── useAuth.js            # BIP39 identity auth (mnemonic -> keypair, signature challenge, JWT session, guest)
│   │   ├── useAuth.test.jsx      # Auth hook tests
│   │   ├── useBreakpoint.js      # Responsive breakpoint detection
│   │   ├── useDevices.js         # Device enumeration (cameras, mics)
│   │   ├── useKeyPackageMaintenance.js  # Periodic KeyPackage replenishment (replaces SPK rotation)
│   │   ├── useMLS.js             # MLS group operations: create, join (Welcome), encrypt/decrypt messages
│   │   ├── useRoom.js            # LiveKit room: MLS-derived frame keys, track management
│   │   ├── useRoom.voice.test.jsx# Voice room tests
│   │   ├── useSidebarResize.js   # Sidebar resize interaction
│   │   └── useToast.js           # Toast notification hook
│   │
│   ├── lib/
│   │   ├── api.js                # HTTP client for Go backend REST API
│   │   ├── api.test.js           # API client tests
│   │   ├── bandwidthEstimator.js # Upload speed test -> quality recommendation
│   │   ├── bip39Identity.js      # BIP39 mnemonic generation, Ed25519 derivation, signing
│   │   ├── bip39Identity.test.js # BIP39 identity tests
│   │   ├── deviceLinking.js      # Device certificates, QR payload encode/decode
│   │   ├── deviceLinking.test.js # Device linking tests
│   │   ├── guildMetadata.js      # AES-256-GCM encrypt/decrypt for guild/channel names (MLS-derived key)
│   │   ├── guildMetadata.test.js # Guild metadata encryption tests
│   │   ├── hushCrypto.js         # WASM wrapper: MLS credential, KeyPackage, group ops, export_secret
│   │   ├── hushCrypto.test.js    # WASM wrapper tests
│   │   ├── hush-crypto-wasm/     # hush-crypto WASM build output
│   │   ├── identityVault.js      # AES-256-GCM vault: encrypt IK seed with PIN (PBKDF2-SHA256)
│   │   ├── identityVault.test.js # Identity vault tests
│   │   ├── mlsGroup.js           # MLS group lifecycle (create, add/remove members, commit, Welcome)
│   │   ├── mlsGroup.voice.test.js# MLS voice group tests
│   │   ├── mlsStore.js           # MLS state persistence in IndexedDB (credentials, groups, epochs)
│   │   ├── mlsStore.test.js      # MLS store tests
│   │   ├── noiseGateWorklet.js   # AudioWorklet processor for mic noise gating
│   │   ├── trackManager.js       # LiveKit track publishing/subscribing, quality settings
│   │   ├── uploadKeyPackages.js  # Post-auth MLS KeyPackage generation and upload
│   │   ├── uploadKeyPackages.test.js # KeyPackage upload tests
│   │   ├── ws.js                 # WebSocket client for Go backend (JWT session, reconnect, events)
│   │   └── ws.test.js            # WebSocket client tests
│   │
│   ├── pages/
│   │   ├── Home.jsx              # Auth UI (mnemonic generation/entry, guest access)
│   │   ├── Invite.jsx            # Invite link handler
│   │   ├── MascotDemo.jsx        # Vesper mascot demo
│   │   ├── Roadmap.jsx           # Public roadmap page
│   │   ├── Room.jsx              # Legacy room view
│   │   ├── ServerLayout.jsx      # Server layout: channel list + content area
│   │   ├── ServerLayout.test.jsx # Server layout tests
│   │   ├── SystemChannel.jsx     # System channel view
│   │   ├── TextChannel.jsx       # Chat-only view (MLS-encrypted)
│   │   ├── TextChannel.test.jsx  # Text channel tests
│   │   ├── VoiceChannel.jsx      # Media + optional chat sidebar (MLS E2EE)
│   │   └── VoiceChannel.test.jsx # Voice channel tests
│   │
│   ├── components/
│   │   ├── AppBackground.jsx     # Ambient background effect
│   │   ├── ChannelList.jsx       # Text/voice channels within a server
│   │   ├── ChannelList.test.jsx  # Channel list tests
│   │   ├── Chat.jsx              # Chat panel (MLS encrypted, WebSocket transport)
│   │   ├── ConfirmModal.jsx      # Confirmation dialog
│   │   ├── Controls.jsx          # Mic, camera, screen share, quality, settings
│   │   ├── DevicePickerModal.jsx # Camera/mic device selection
│   │   ├── GuildCreateModal.jsx  # Guild creation with encrypted metadata
│   │   ├── LogoWordmark.jsx      # Logo component (Cormorant Garamond + orange dot)
│   │   ├── MemberContextMenu.jsx # Right-click member actions
│   │   ├── MemberList.jsx        # Server members with presence
│   │   ├── MemberList.test.jsx   # Member list tests
│   │   ├── MemberProfileCard.jsx # Member profile display
│   │   ├── modalStyles.js        # Shared modal CSS-in-JS
│   │   ├── ModerationModal.jsx   # Moderation controls (ban, mute, kick)
│   │   ├── QualityPickerModal.jsx# Resolution/framerate picker
│   │   ├── ScreenShareCard.jsx   # Screen share display card
│   │   ├── ServerList.jsx        # Vertical server sidebar
│   │   ├── ServerList.test.jsx   # Server list tests
│   │   ├── ServerSettingsModal.jsx# Server settings
│   │   ├── StreamView.jsx        # Video element wrapper with stats overlay
│   │   ├── SystemMessageRow.jsx  # System message display
│   │   ├── Toast.jsx             # Toast notification component
│   │   ├── UserSettingsModal.jsx # User settings
│   │   ├── Vesper.jsx            # Mascot component
│   │   └── VideoGrid.jsx         # Video grid layout
│   │
│   ├── test/
│   │   ├── cryptoMocks.js        # Crypto mock utilities
│   │   └── setup.js              # Vitest global setup (IndexedDB mock)
│   │
│   ├── utils/
│   │   └── constants.js          # QUALITY_PRESETS, DEFAULT_QUALITY, MEDIA_SOURCES
│   │
│   └── styles/
│       └── global.css            # Design system: deep dark, orange accent #d54f12
│
├── public/
│   └── wasm/                     # hush-crypto WASM build output (legacy path)
│
├── vitest.config.js              # Vitest config (jsdom, test setup)

client/admin/                     # Standalone admin dashboard (separate Vite app)
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── App.jsx                   # Admin app shell
    ├── main.jsx                  # Admin entry point
    ├── admin.css                 # Admin styles
    ├── lib/
    │   └── adminApi.js           # Admin API client (X-Admin-Key header auth)
    └── pages/
        ├── ConfigPage.jsx        # Instance configuration
        ├── GuildListPage.jsx     # Guild list (opaque: UUIDs, counts, dates only)
        ├── HealthPage.jsx        # System health
        └── UserListPage.jsx      # User list (opaque data only)

hush-crypto/                      # Rust crate wrapping OpenMLS (RFC 9420)
├── src/
│   ├── lib.rs                    # Public API re-exports
│   ├── credential.rs             # Ed25519 BasicCredential generation
│   ├── key_package.rs            # MLS KeyPackage builder (MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519)
│   ├── group.rs                  # MLS group operations: create, add/remove, commit, export_voice_frame_key, export_metadata_key
│   ├── storage.rs                # MLS state storage abstraction
│   ├── storage_bridge.rs         # WASM <-> Rust storage bridge
│   └── wasm.rs                   # wasm-bindgen bindings (MLS ops for web)
├── tests/
│   ├── mls_e2e.rs                # MLS end-to-end integration tests (credential + KeyPackage + group round-trip)
│   └── mls_group_e2e.rs          # MLS group lifecycle integration tests
├── Cargo.toml                    # Dependencies: openmls 0.8.1, openmls_rust_crypto, ed25519-dalek, etc.
└── vendor/
    └── keccak/                   # Vendored keccak RC2 for sha3 compatibility

caddy/
└── Caddyfile                     # Reverse proxy: routes to Go backend + LiveKit + static

livekit/
└── livekit.yaml                  # LiveKit server config

scripts/
├── setup.sh                      # Docker setup script
├── reset-dev.sh                  # Dev environment reset
├── init-hush-db.sql              # Database initialization SQL
├── generate-changelog.mjs        # Changelog generation
└── checkpoint-B-test.md          # Manual test checklist
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

---

## Key Design Decisions

1. **Go over Node.js**: The backend is a clean rewrite. Go gives strong concurrency (goroutines for WebSocket hub), single binary deployment, and no runtime dependency. Chi is minimal and composable.
2. **MLS (RFC 9420) over Signal Protocol**: Originally built on Signal Protocol (X3DH + Double Ratchet) via a patched `libsignal-dezire` fork. Migrated to MLS in phases M.1-M.3 (completed 2026-03-22). MLS provides native group encryption (TreeKEM), eliminating fan-out overhead for group chat. Signal required O(N) pairwise sessions per group; MLS provides O(log N) key tree operations. The ciphersuite is `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`. Implementation via OpenMLS 0.8.1 Rust crate.
3. **Custom backend over Synapse**: Using our own crypto protocol breaks Matrix compatibility. Without Matrix compatibility, Synapse adds only complexity (federation overhead, Matrix event model, Spaces API). A purpose-built Go backend is simpler, faster, and fully controlled.
4. **LiveKit stays**: LiveKit's Insertable Streams E2EE is solid. Key distribution changed from Signal-encrypted WebSocket relay to MLS `export_secret` derivation. Frame keys are now derived per-epoch from the voice MLS group's export_secret with label `hush-voice-frame-key`. No leader election or fan-out key distribution needed.
5. **BIP39 mnemonic identity**: Every user's cryptographic identity derives from a 12-word BIP39 mnemonic. The mnemonic deterministically generates the root keypair. The server stores only public keys. Authentication is cryptographic: the client proves ownership of the private key via a signature challenge. JWT is used for session tokens after authentication, not as the identity mechanism. Recovery relies solely on the 12 words; if lost with no linked devices, the account is irrecoverable.
6. **Multi-device via linked device certificates**: Each device has its own independent keypair. Private keys never leave the device. To add a new device, an existing (authenticated) device signs the new device's public key: `certificate = Sign(IK_existing_priv, IK_new_pub)`. The server maintains a list of certified public keys per account. QR linking: the new device displays a QR (containing its public key, ephemeral DH key, expiry, nonce), the existing device scans and produces the certificate.
7. **Guest access is mandatory**: Users can try Hush without a mnemonic. Guest accounts use an ephemeral keypair (no mnemonic, no recovery). The Go backend supports temporary guest accounts with limited permissions.
8. **Backend opacity (blind relay)**: The server never sees plaintext for any data, including guild names, channel names, and metadata. Guild and channel names are encrypted client-side with AES-256-GCM using a key derived from the guild's MLS metadata group `export_secret` (label `hush-guild-metadata`). The server stores only opaque BYTEA blobs. Permission levels are integers (0-3), not human-readable role strings. The admin dashboard shows only opaque data (UUIDs, counts, dates).
9. **Single Rust crypto crate**: `hush-crypto` wraps OpenMLS. Web uses WASM (via wasm-pack). Desktop (Electron) loads the same WASM build inside Chromium's renderer — identical to the browser path. Mobile will use UniFFI bindings (Swift, Kotlin). One implementation, zero cross-platform interop risk.
10. **Electron desktop is MVP**: The desktop app is an Electron shell wrapping the hush-web production build. One web codebase, two delivery mechanisms (browser and Electron). Electron-specific code is limited to: custom titlebar, system tray, auto-update (electron-updater), deep links (hush://), OS keystore (keytar), push-to-talk (globalShortcut). hush-crypto runs as WASM in the renderer — no separate build target.
11. **Repo split before desktop**: The monorepo splits into separate repos (hush-server, hush-crypto, hush-web, hush-desktop, hush-mobile, hush-directory) before the desktop phase. hush-crypto publishes as an npm package; hush-web imports it from npm; hush-desktop builds hush-web as part of its pipeline. gethush.live is a private repo (landing, docs, admin dashboard, download page).

---

## WebSocket Broadcast Events

The WS hub broadcasts server-scoped events so all connected members see real-time updates. Every API mutation that changes shared state must emit a broadcast.

| Event | Payload fields | Trigger |
|-|-|-|
| `channel_created` | `channel` (full object, encrypted_metadata blob) | Channel created |
| `channel_deleted` | `channel_id`, `server_id` | Channel deleted |
| `channel_moved` | `channel_id`, `server_id`, `parent_id`, `position` | Channel reordered |
| `server_updated` | `server_id`, `encrypted_metadata` | Server metadata changed (opaque blob) |
| `server_deleted` | `server_id` | Server deleted (broadcast before DB delete) |
| `member_joined` | `user_id`, `display_name` | User joins server |
| `member_left` | `user_id` | User leaves server |
| `member_role_changed` | `user_id`, `permission_level` | Permission level change (0=member, 1=mod, 2=admin, 3=owner) |
| `voice_state_update` | `channel_id`, `participants` | LiveKit webhook |

**Pattern**: nil-check hub, `json.Marshal` with `type` field, `h.hub.BroadcastToServer(serverID, msg)`.

**When adding new endpoints**: if the mutation affects what other users see, add a broadcast event.

---

## End-to-End Encryption (E2EE)

### MLS Protocol for Chat

**Protocol**: Chat messages are encrypted using MLS (RFC 9420, Messaging Layer Security) via the OpenMLS Rust crate. Each channel has its own MLS group. The ciphersuite is `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`.

**Credential and KeyPackage Lifecycle**:
1. On registration, user receives a BIP39 12-word mnemonic (shown once, irrecoverable if lost). The mnemonic deterministically derives the root identity key pair (Ed25519). The client generates an MLS BasicCredential and a batch of MLS KeyPackages.
2. Credential and KeyPackages uploaded to Go backend (`POST /api/mls/key-packages`). Server stores public material only.
3. To add a user to a channel: fetch their KeyPackage, create an MLS Add proposal, commit. The resulting Welcome message is delivered to the new member.
4. Subsequent messages use `MlsGroup::create_message()` for encryption and `process_message()` for decryption. Forward secrecy advances per epoch.

**Group Operations**:
- **Create**: Channel creator creates an MLS group, stores group info on server.
- **Add member**: Fetch member's KeyPackage, propose Add, commit. Welcome sent to new member.
- **Remove member**: Propose Remove, commit. Remaining members advance to new epoch; removed member cannot decrypt future messages.
- **Message send**: `MlsGroup::create_message(plaintext)` produces MLS ciphertext, sent via WebSocket.
- **Message receive**: `process_message(ciphertext)` decrypts using current epoch keys.

**Forward Secrecy**: MLS provides forward secrecy through epoch advancement. Each commit creates a new epoch with fresh key material. Compromising current state does not reveal messages from prior epochs.

**MLS State Storage**: MLS state (credentials, group state, epoch secrets) persisted in IndexedDB via `mlsStore.js`.

**KeyPackage Replenishment**: `useKeyPackageMaintenance.js` periodically checks remaining KeyPackages on the server and uploads fresh ones when the count drops below threshold. This replaces the Signal-era SPK rotation and OPK replenishment.

**Implementation Files**:
- `client/src/hooks/useMLS.js`: MLS group operations (create, join, encrypt, decrypt)
- `client/src/lib/mlsStore.js`: IndexedDB persistence for MLS state
- `client/src/lib/mlsGroup.js`: MLS group lifecycle (create, add/remove, commit, Welcome)
- `client/src/lib/hushCrypto.js`: WASM wrapper (MLS credential, KeyPackage, group ops, export_secret)
- `client/src/lib/uploadKeyPackages.js`: Post-auth KeyPackage generation and upload
- `client/src/hooks/useKeyPackageMaintenance.js`: Periodic KeyPackage replenishment
- `hush-crypto/`: Rust crate (OpenMLS: credential, KeyPackage, group, WASM bindings)
- `server/internal/api/mls.go`: MLS KeyPackage and credential endpoints
- `server/internal/db/mls.go`: MLS credential and KeyPackage queries
- `server/internal/db/mls_groups.go`: MLS group info queries

### LiveKit E2EE for Media

**Protocol**: WebRTC media streams (voice, video, screen share) are encrypted using LiveKit's Insertable Streams with AES-256-GCM. The SFU forwards encrypted frames without access to plaintext.

**Key Derivation**: Frame keys are derived from the voice MLS group's `export_secret`:
1. When a user joins a voice channel, a voice-type MLS group is created or the user is added to the existing one.
2. Frame key derived via `MlsGroup::export_secret()` with label `hush-voice-frame-key` and the current epoch.
3. The derived key is applied to LiveKit's `ExternalE2EEKeyProvider`.
4. LiveKit E2EE worker encrypts/decrypts media frames using the derived key.

**Key Rotation**: Epoch-based. When a member joins or leaves the voice channel, the MLS group membership changes, advancing the epoch. All remaining members derive the new frame key from the new epoch's export_secret. No leader election or fan-out key distribution needed.

**Implementation Files**:
- `client/src/hooks/useRoom.js`: LiveKit Room with `ExternalE2EEKeyProvider`, MLS-derived frame keys
- `client/src/lib/mlsGroup.js`: Voice group lifecycle (create voice group, add/remove voice members)
- `hush-crypto/src/group.rs`: `export_voice_frame_key` function
- `server/internal/db/mls_groups.go`: Voice group info storage

**No Silent Degradation**: If E2EE setup fails (worker load failure, key derivation failure), the client does NOT connect to LiveKit. Media without encryption is never permitted.

### Guild Metadata Encryption

**Protocol**: Guild names, channel names, and other metadata are encrypted client-side before being sent to the server. The server stores only opaque BYTEA blobs and never sees plaintext.

**Key Derivation**: Metadata encryption key derived from the guild's metadata-type MLS group `export_secret` with label `hush-guild-metadata`. Each guild has a dedicated metadata MLS group for this purpose.

**MLS Group Types**:
| Type | Purpose | Scope |
|-|-|-|
| `text` | Channel message encryption | Per channel |
| `voice` | Voice frame key derivation | Per voice channel |
| `metadata` | Guild/channel name encryption | Per guild |

**Implementation Files**:
- `client/src/lib/guildMetadata.js`: AES-256-GCM encrypt/decrypt for metadata
- `hush-crypto/src/group.rs`: `export_metadata_key` function
- `server/internal/db/mls_groups.go`: Metadata group info storage (server_id reference, XOR constraint with channel_id)

---

## Preserve List (DO NOT delete/break these)

- `client/src/styles/global.css`: design system
- `client/src/lib/noiseGateWorklet.js`: reuse in LiveKit audio pipeline
- `client/src/lib/bandwidthEstimator.js`: quality recommendation
- `client/src/utils/constants.js`: quality presets (adapt to LiveKit encoding params)
- `client/src/hooks/useBreakpoint.js`: responsive utils
- `client/src/hooks/useDevices.js`: device enumeration
- `client/src/components/StreamView.jsx`: video wrapper
- `client/src/components/Controls.jsx`: media controls
- `client/src/components/AppBackground.jsx`: ambient background
- `client/src/components/LogoWordmark.jsx`: brand wordmark
- `client/src/assets/logo-wordmark.svg`: SVG wordmark asset
- `design-system.md`: UI design language
- `livekit/livekit.yaml`: LiveKit server config

## Remove List (completed)

All Matrix/Synapse components removed (pre-refactor):
- `server/src/`: entire old Node.js server (replaced by Go backend)
- `synapse/`: Synapse config and data
- `client/src/hooks/useMatrixAuth.js`, `client/src/lib/matrixClient.js`: Matrix client code
- `docker-compose.yml`: Synapse service, old Node.js `hush` service
- All `matrix-js-sdk` imports removed from client

All Signal Protocol components removed (M.1-M.3 migration):
- `client/src/hooks/useSignal.js`: Signal session management (replaced by `useMLS.js`)
- `client/src/lib/signalStore.js`: Signal IndexedDB state (replaced by `mlsStore.js`)
- `client/src/lib/e2eeKeyManager.js`: Leader-based key distribution (replaced by MLS export_secret)
- `client/src/lib/uploadKeysAfterAuth.js`: Signal pre-key upload (replaced by `uploadKeyPackages.js`)
- `server/internal/api/keys.go`: Signal pre-key endpoints (replaced by `mls.go`)
- `server/internal/db/keys.go`: Signal key queries (replaced by `db/mls.go`)
- `hush-crypto/src/identity.rs`, `prekey.rs`, `x3dh_wrap.rs`, `session.rs`: Signal crypto (replaced by `credential.rs`, `key_package.rs`, `group.rs`)
- `hush-crypto/tests/e2e_signal_flow.rs`: Signal integration tests (replaced by `mls_e2e.rs`, `mls_group_e2e.rs`)
- All `signal_*` database tables dropped in migration 000014
