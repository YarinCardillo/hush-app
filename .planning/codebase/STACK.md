# Technology Stack

**Analysis Date:** 2026-03-03

## Languages

**Primary:**
- Go 1.25.6 - Backend API server, authentication, WebSocket orchestration
- JavaScript/JSX (ES2022) - Frontend React client with dynamic loading
- Rust 1.86 - hush-crypto Signal Protocol wrapper compiled to WASM and native
- SQL (PostgreSQL) - Schema and migrations

**Secondary:**
- TypeScript (JSDoc annotations) - Type hints in JS via comments (gradual typing)
- YAML - Docker Compose and LiveKit configuration

## Runtime

**Environment:**
- Go 1.25.6 - Server runtime
- Node.js 22 LTS - Client build and dev tools
- Rust 1.86 - Crypto library compilation
- Chrome/Chromium engine (via Tauri + CEF for desktop)

**Package Managers:**
- npm 10.x - JavaScript dependencies
- Go modules (go.mod) - Go dependencies
- Cargo - Rust dependencies for hush-crypto
- wasm-pack - Compiles Rust to WebAssembly

## Frameworks

**Backend:**
- `go-chi/chi/v5` v5.2.5 - HTTP router with middleware support
- `gorilla/websocket` v1.5.4 - WebSocket upgrades and frame handling
- `jackc/pgx/v5` v5.8.0 - PostgreSQL async driver with connection pooling
- `golang-jwt/jwt/v5` v5.3.1 - JWT generation and validation
- `golang-migrate/migrate/v4` v4.19.1 - SQL migration runner (file-based)

**Frontend:**
- React 18.3.1 - UI component framework
- React Router 6.26.2 - Client-side routing (SPA navigation)
- Vite 5.4.6 - Build tool and dev server
- livekit-client 2.17.1 - WebRTC video/audio client with E2EE support

**Crypto:**
- libsignal-dezire (custom fork) - Signal Protocol X3DH and Double Ratchet implementation
- wasm-bindgen 0.2 - WASM <-> JavaScript bridge
- x25519-dalek 2.0 - Elliptic curve cryptography (pre-key generation)

**UI Components:**
- @dnd-kit 6.3.1 - Drag-and-drop for channel/category reordering
- motion 12.34.0 - Animation library
- Caddy 2-alpine - Reverse proxy and static file server (production)

**Testing:**
- Vitest 4.0.18 - Unit/integration test runner (Vite-native)
- @testing-library/react 16.3.2 - React component testing utilities
- @testing-library/jest-dom 6.9.1 - Extended matchers (expect.toBeInTheDocument)
- @testing-library/user-event 14.6.1 - Simulate user interactions
- fake-indexeddb 6.2.5 - Mock IndexedDB in tests
- jsdom 28.1.0 - DOM environment for Node.js tests

**Build/Dev:**
- vite-plugin-react 4.3.1 - JSX transpilation
- vite-plugin-wasm 3.5.0 - WASM loading with correct MIME types
- vite-plugin-top-level-await 1.6.0 - Top-level await in modules
- @vitejs/coverage-v8 4.0.18 - V8 code coverage for Vitest

## Key Dependencies

**Critical Backend:**
- `github.com/livekit/protocol` v1.44.1 - LiveKit gRPC protobuf messages and types
- `golang.org/x/crypto` v0.48.0 - Secure random generation and password hashing

**Indirect (LiveKit/WebRTC stack):**
- `github.com/pion/webrtc/v4` - WebRTC peer connection (video/audio negotiation)
- `github.com/pion/ice/v4` - ICE candidate gathering and connectivity checks
- `github.com/google/uuid` v1.6.0 - UUID generation for rooms and participants
- `github.com/stretchr/testify` v1.11.1 - Test assertions and mocking

**Crypto:**
- `serde` and `serde_json` 1.0 - JSON serialization for pre-keys
- `getrandom` 0.2 - Cryptographically secure random number generation

## Configuration

**Environment Variables:**
Server reads from environment (no config files):
- `PORT` (default 8080) - HTTP listen port
- `DATABASE_URL` - PostgreSQL connection string (required for API endpoints)
- `JWT_SECRET` - HMAC-SHA256 key for token signing (required for auth)
- `JWT_EXPIRY_HOURS` (default 168 = 7 days) - Token lifetime
- `CORS_ORIGIN` (default "*") - Allowed origin header
- `LIVEKIT_API_KEY` - LiveKit admin token API key
- `LIVEKIT_API_SECRET` - LiveKit admin token API secret
- `LIVEKIT_URL` - LiveKit server WebSocket endpoint

Client configuration:
- Hardcoded API proxy routes in `vite.config.js` (dev only)
- Production: served via Caddy reverse proxy
- CORS handled by server (not client-enforced)

Docker Compose overrides via `.env` file:
- `POSTGRES_USER` (default "hush")
- `POSTGRES_PASSWORD` (default "hush")
- `POSTGRES_DB` (default "hush")

**Build Configuration:**
- `tsconfig.json` - Not found (JavaScript uses JSDoc instead)
- `.eslintrc` / `.prettierrc` - Not found (no linting enforced at build time)
- `package.json` scripts - Define dev/build/test entry points

## Platform Requirements

**Development:**
- Go 1.25.6
- Node.js 22 LTS with npm
- Rust 1.86 with wasm-pack
- PostgreSQL 16+ (for local testing)
- Docker and Docker Compose (optional, for isolated dev)
- Vite dev server runs on port 5173 (hardcoded)
- Go API server runs on port 8080 (configurable)

**Production:**
- Docker-based deployment (tested in docker-compose.yml)
- PostgreSQL 16 (Alpine)
- Redis 7 (for potential future caching/sessions)
- LiveKit server (official image or self-hosted)
- Caddy 2 (serves client SPA, proxies to API)
- Hush API runs in Alpine Linux container (Go binary, no cgo)

**Deployment Target:**
- Self-hosted Docker Compose stack
- Architecture: Frontend SPA → Caddy (reverse proxy) → Go API ↔ PostgreSQL, LiveKit, WebSocket Hub

---

*Stack analysis: 2026-03-03*
