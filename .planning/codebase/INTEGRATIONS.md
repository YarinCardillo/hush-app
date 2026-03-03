# External Integrations

**Analysis Date:** 2026-03-03

## APIs & External Services

**LiveKit (Real-time Communication):**
- Service: LiveKit cloud or self-hosted server
- What it's used for: WebRTC video/audio sessions with end-to-end encryption
- SDK/Client: `livekit-client` 2.17.1 (JavaScript), `github.com/livekit/protocol` (Go)
- Configuration: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`
- Endpoints:
  - POST `/api/livekit/token` - Generate room access token with JWT (requires auth)
  - POST `/api/livekit/webhook` - Receive room/participant events (token validation via `LIVEKIT_API_SECRET`)
- Token Format: JWT signed with `LIVEKIT_API_SECRET` containing room name, participant identity
- Files: `server/internal/api/livekit.go`, `client/src/hooks/useRoom.js`

## Data Storage

**Database:**
- Type: PostgreSQL 16
- Connection: `DATABASE_URL` environment variable (standard DSN format)
- Client: `jackc/pgx/v5` (async Go driver with connection pooling)
- ORM: None (raw SQL with prepared statements)
- Schema: Managed by `golang-migrate/migrate/v4` (file-based migrations in `server/migrations/`)
- Initialization: Docker init script at `scripts/init-hush-db.sql`
- Health check: `/api/health` endpoint verifies DB connectivity via `pool.Ping()`
- Files: `server/internal/db/db.go`, `server/internal/db/*.go` (users, messages, keys, servers, etc.)

**File Storage:**
- Local filesystem only (no S3, GCS, etc.)
- Client: IndexedDB for browser-side key caching
- Server: No file upload endpoints implemented

**Caching:**
- Redis 7-alpine in docker-compose.yml but NOT currently integrated into API
- Status: Defined but unused (available for future sessions/caching layer)

## Authentication & Identity

**JWT-based (Custom):**
- Provider: Custom (generated and validated by server)
- Algorithm: HMAC-SHA256
- Secret: `JWT_SECRET` environment variable
- Token format: Standard JWT with `sub` (user ID), `iat`, `exp` claims
- Expiry: Configurable via `JWT_EXPIRY_HOURS` (default 7 days)
- Validation: `RequireAuth` middleware in `server/internal/api/api.go`
- Files: `server/internal/auth/jwt.go`, `server/internal/api/api.go`

**Password Hashing:**
- Algorithm: bcrypt (via `golang.org/x/crypto/bcrypt`)
- Cost factor: Not exposed in code (uses crypto package defaults)
- Files: `server/internal/auth/password.go`

**Client Session:**
- Storage: localStorage for JWT token (standard pattern)
- Mechanism: Bearer token in Authorization header: `Authorization: Bearer <token>`
- Pre-key Upload: After login, client uploads Signal Protocol pre-keys via POST `/api/keys/upload`

## Monitoring & Observability

**Error Tracking:**
- Not integrated (no Sentry, Rollbar, etc.)

**Logs:**
- Server: Structured JSON logging via `log/slog` to stdout
- Log level: Configurable (default INFO)
- Handler: `slog.NewJSONHandler` for machine-readable output
- Client: Console logging only (no centralized aggregation)

**Health Checks:**
- GET `/api/health` - Returns `{"status":"ok"}` or `{"status":"unavailable","error":"db"}`
- Docker Compose: PostgreSQL and Redis configured with health checks
- Readiness: API depends on database health check before accepting traffic

## CI/CD & Deployment

**Hosting:**
- Docker Compose (self-hosted)
- Architecture: Multi-container with Caddy reverse proxy
- Container images:
  - `golang:1.25-alpine` (build stage for API)
  - `alpine:3.19` (API runtime, CGO_ENABLED=0)
  - `rust:1.86-slim` (WASM build stage)
  - `node:22-alpine` (client build stage)
  - `caddy:2-alpine` (frontend + reverse proxy)
  - `postgres:16-alpine` (database)
  - `redis:7-alpine` (caching, unused)
  - `livekit/livekit-server:latest` (media server)

**CI Pipeline:**
- Not detected (no GitHub Actions, GitLab CI, etc.)
- Local development: `npm run dev` (concurrent Go + Vite)

**Build Process:**
Client (3-stage Docker):
1. Rust wasm-pack: `hush-crypto/` → `/wasm-out/hush_crypto.wasm`
2. Node.js npm: client build with WASM → `dist/`
3. Caddy: serve SPA from `dist/`

Server (2-stage Docker):
1. Go: build binary with migrations
2. Alpine: run static binary

## Environment Configuration

**Required Environment Variables (Production):**
- `DATABASE_URL` - PostgreSQL connection (e.g., `postgres://user:pass@host:5432/hush`)
- `JWT_SECRET` - Min 32 characters recommended (HMAC-SHA256 key)
- `LIVEKIT_API_KEY` - LiveKit admin API credential
- `LIVEKIT_API_SECRET` - LiveKit admin secret
- `LIVEKIT_URL` - WebSocket endpoint (e.g., `wss://livekit.example.com`)

**Optional Environment Variables:**
- `PORT` - HTTP listen port (default 8080)
- `CORS_ORIGIN` - CORS allowed origin (default "*", restrict in prod)
- `JWT_EXPIRY_HOURS` - Token lifetime (default 168 hours)

**Secrets Location:**
- Runtime: Environment variables (12-factor app)
- Development: `.env` file (gitignored, local-only)
- Docker: `docker-compose.yml` reads from `.env` or explicit env vars

**No Secrets in Code:**
- Confirmed: No hardcoded API keys, connection strings, or secrets found in source

## Webhooks & Callbacks

**Incoming (from LiveKit):**
- Endpoint: POST `/api/livekit/webhook`
- Events: Room/participant lifecycle (join, leave, finish)
- Authentication: Request validation via HMAC-SHA256 (LiveKit API secret)
- Handler: `api.LiveKitWebhookHandler()` in `server/internal/api/livekit.go`
- Broadcast: Events forwarded to connected WebSocket clients via `hub.BroadcastToServer()`

**Outgoing (from Hush):**
- WebSocket broadcasts: Server sends real-time updates to clients via `/ws` endpoint
- Event types: `channel_created`, `channel_deleted`, `server_updated`, `member_joined`, `member_left`, `voice_state_update`, etc.
- Payload format: JSON with `type` field (event name)
- Consumers: Browser clients listening on persistent WebSocket connection

**Signal Protocol Exchanges (P2P):**
- Pre-key retrieval: GET `/api/keys/bundle/:userId` - Client fetches bundle for message recipient
- Pre-key upload: POST `/api/keys/upload` - Client stores keys after registration
- Message transmission: Via WebSocket or HTTP (no direct P2P; server-mediated)
- Encryption: Done client-side using hush-crypto (WASM), keys stored server-side in PostgreSQL

---

*Integration audit: 2026-03-03*
