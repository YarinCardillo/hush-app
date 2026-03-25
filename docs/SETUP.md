# Hush Setup Guide

Complete setup, architecture, environment variables, and developer workflow reference.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Quick Start -Development](#quick-start--development)
3. [Quick Start -Self-Hosting (Docker)](#quick-start--self-hosting-docker)
4. [Environment Variables Reference](#environment-variables-reference)
5. [What to Restart When You Change X](#what-to-restart-when-you-change-x)
6. [Detailed Architecture Diagrams](#detailed-architecture-diagrams)
7. [Database](#database)
8. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```mermaid
graph LR
  subgraph Client
    Browser[React 18 + Vite]
  end

  subgraph Backend
    Go[Go API :8080]
    PG[(PostgreSQL)]
    LK[LiveKit SFU]
  end

  Browser -- "/api/*,  /ws" --> Go
  Go -- SQL --> PG
  Browser -- "WebRTC media" --> LK
  Go -- "token generation" --> LK
```

Hush has three core components:

| Component | Technology | Role |
|-|-|-|
| **Client** | React 18, Vite, hush-crypto (WASM) | UI, E2EE encryption/decryption |
| **Go API** | Go, Chi, pgx, gorilla/websocket | Auth, servers, channels, keys, presence, LiveKit tokens |
| **PostgreSQL** | PostgreSQL 16 | Users, servers, channels, messages (ciphertext), MLS credentials, KeyPackages |
| **LiveKit** | LiveKit SFU (self-hosted) | WebRTC media relay (voice, video, screen) |
| **Caddy** | Caddy 2 (Docker only) | Reverse proxy, TLS, CORS, security headers |

---

## Quick Start -- Development

### Prerequisites

- Docker and Docker Compose (for backend services)
- Node.js 22+ (for frontend HMR)
- (Optional) Go 1.25+ if you need to modify and test the Go API outside Docker

### 1. Start all backend services

```bash
cp .env.example .env          # default dev values work as-is
docker-compose up -d
```

This starts Postgres, Redis, LiveKit, Go API, and Caddy. The Go API auto-runs migrations on startup.

### 2. Start the Vite dev server

```bash
cd client
npm install
npm run dev
```

Vite runs on port **5173** and proxies all backend routes to Caddy on `:8081`:

| Path | Target | Purpose |
|-|-|-|
| `/api/*` | `localhost:8081` | Go API (via Caddy) |
| `/ws` | `localhost:8081` | WebSocket (via Caddy) |
| `/livekit/*` | `localhost:8081` | LiveKit signaling (via Caddy) |

This means all Docker services must be running (including Caddy on `:8081`) for local frontend development.

Open `http://localhost:5173` in a Chromium-based browser.

### 3. (Optional) Run Go API outside Docker

If you're actively modifying Go code and want faster iteration without rebuilding the Docker image:

```bash
docker-compose up -d postgres redis livekit    # data + media services only
cd server
export DATABASE_URL="postgres://hush:hush@localhost:5432/hush?sslmode=disable"
export JWT_SECRET="dev-jwt-secret-change-in-production"
export LIVEKIT_API_KEY=devkey
export LIVEKIT_API_SECRET=devsecret
export LIVEKIT_URL=ws://localhost:7880
go run ./cmd/hush
```

Note: in this mode Caddy is not running, so the Vite proxy (which targets `:8081`) will not reach the Go API. Either also start Caddy, or temporarily change the Vite proxy target in `client/vite.config.js` to `http://localhost:8080`.

---

## Quick Start -- Self-Hosting (Docker)

### Prerequisites

- Docker and Docker Compose
- A domain name (or `localhost` for testing)
- Ports 80/443 open (for Caddy TLS), 7880-7881 and 50020-50100/udp (for LiveKit)

### 1. Clone and configure

```bash
git clone https://github.com/YarinCardillo/hush-app
cd hush-app
./scripts/setup.sh
```

`setup.sh` generates `.env` with random secrets. For localhost it uses `devkey`/`devsecret` for LiveKit. For a real domain it generates random LiveKit keys.

### 2. Start everything

```bash
docker-compose up -d
```

This starts 5 services:

| Service | Port | Purpose |
|-|-|-|
| `postgres` | 5432 (internal) | Database |
| `hush-api` | 8080 (internal) | Go backend |
| `livekit` | 7880, 7881, 50020-50100/udp | WebRTC SFU |
| `redis` | 6379 (internal) | Cache (LiveKit dependency) |
| `caddy` | **8081** (dev) / **80+443** (prod) | Reverse proxy |

Open `http://localhost:8081`.

### 3. Production

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Production differences:
- Caddy uses `Caddyfile.prod` with HTTPS and HSTS
- LiveKit and Redis are self-hosted (same as base compose, included by default)
- Set `CORS_ORIGIN` in `.env` to your domain (e.g. `https://gethush.live`)

### 4. Verify

```bash
curl http://localhost:8080/api/health     # Go API
docker-compose logs -f hush-api           # Watch Go API logs
```

---

## Environment Variables Reference

### Go API (`server/.env` or container env)

| Variable | Required | Default | Dev Value | Production Value | Description |
|-|-|-|-|-|-|
| `PORT` | No | `8080` | `8080` | `8080` | HTTP listen port |
| `DATABASE_URL` | **Yes** | -- | `postgres://hush:hush@localhost:5432/hush?sslmode=disable` | `postgres://hush:<strong-pw>@postgres:5432/hush?sslmode=disable` | PostgreSQL connection string |
| `JWT_SECRET` | **Yes** | -- | Any string | `openssl rand -hex 32` | Signing key for JWT tokens |
| `JWT_EXPIRY_HOURS` | No | `168` (7d) | `168` | `168` | Token lifetime in hours |
| `CORS_ORIGIN` | No | `*` | `*` | `https://your-domain.com` | Allowed CORS origin |
| `LIVEKIT_API_KEY` | For voice | -- | `devkey` | From self-hosted LiveKit config | LiveKit API key |
| `LIVEKIT_API_SECRET` | For voice | -- | `devsecret` | From self-hosted LiveKit config | LiveKit API secret |
| `LIVEKIT_URL` | For voice | -- | `ws://localhost:7880` | `wss://livekit.your-domain.com` | LiveKit server URL |

### Docker Compose (root `.env`)

| Variable | Required | Default | Dev Value | Production Value | Description |
|-|-|-|-|-|-|
| `POSTGRES_USER` | No | `hush` | `hush` | `hush` | Postgres user |
| `POSTGRES_PASSWORD` | **Yes** | `hush` | `hush` | `openssl rand -hex 16` | Postgres password |
| `POSTGRES_DB` | No | `hush` | `hush` | `hush` | Postgres database name |
| `CORS_ORIGIN` | No | `*` | `*` | `https://your-domain.com` | Shared by Caddy + Go API |

### Generating production secrets

```bash
# JWT secret
openssl rand -hex 32

# Postgres password
openssl rand -hex 16

# LiveKit (self-hosted; must match keys in livekit.yaml)
openssl rand -hex 16   # LIVEKIT_API_KEY
openssl rand -hex 32   # LIVEKIT_API_SECRET
```

---

## What to Restart When You Change X

### Quick Reference

| What you changed | Action needed |
|-|-|
| **Go code** (`server/internal/`, `server/cmd/`) | `Ctrl+C` + `go run ./cmd/hush` (or Docker: `docker-compose up -d --build hush-api`) |
| **Go migrations** (`server/migrations/`) | Restart Go API (auto-applies on startup). For destructive changes: `migrate -path migrations -database $DATABASE_URL down` first |
| **React components** (`client/src/`) | Nothing. Vite HMR auto-reloads. If state is stale, hard-refresh (`Cmd+Shift+R`) |
| **Vite config** (`client/vite.config.js`) | `Ctrl+C` + `npm run dev` |
| **CSS variables** (`client/src/styles/`) | Nothing. Vite HMR picks them up |
| **WASM crypto** (`hush-crypto/`) | Rebuild WASM (`wasm-pack build`), then restart Vite |
| **Environment variables** (`.env`) | Restart the service that reads them (Go API, Vite, or `docker-compose up -d`) |
| **Docker Compose config** | `docker-compose up -d` (recreates changed services) |
| **Caddy config** (`caddy/Caddyfile`) | `docker-compose restart caddy` |
| **LiveKit config** (`livekit/livekit.yaml`) | `docker-compose restart livekit` |
| **PostgreSQL schema** (manual DDL) | No restart needed. But prefer using migrations |
| **`package.json`** (dependencies) | `npm install` in the relevant directory. Restart Vite if client |

### Detailed Scenarios

#### "I changed a Go handler"

```bash
# Local dev: restart the Go process
cd server
# Ctrl+C the running process, then:
go run ./cmd/hush

# Docker: rebuild and restart only the Go service
docker-compose up -d --build hush-api
```

No client restart needed. The Vite proxy forwards `/api/*` to Caddy, which routes to the Go API.

#### "I changed a React component"

Nothing. Vite hot-reloads automatically. If you see stale state (e.g. after changing context providers), do a hard refresh.

#### "I added a new database migration"

```bash
# Local dev: just restart the Go API -it runs migrate.Up() on startup
cd server && go run ./cmd/hush

# Docker:
docker-compose restart hush-api
```

#### "I changed an environment variable"

```bash
# Local dev: re-export and restart the affected process
export JWT_SECRET="new-value"
cd server && go run ./cmd/hush

# Docker: edit .env, then:
docker-compose up -d  # recreates containers with new env
```

#### "I need to wipe the database and start fresh"

```bash
# Docker volume:
docker-compose down -v  # removes all volumes (Postgres data, Redis, etc.)
docker-compose up -d    # fresh start, migrations re-applied

# Local Postgres:
dropdb hush && createdb -O hush hush
cd server && go run ./cmd/hush  # re-applies migrations
```

#### "I changed the Caddy routing"

```bash
docker-compose restart caddy
# Caddy reloads config on restart. No downtime for other services.
```

---

## Detailed Architecture Diagrams

### Level 1 -High-Level System

```mermaid
graph TB
  subgraph "User Device"
    Browser["Browser (Chromium)"]
    WASM["hush-crypto<br/>(WASM)"]
    LKClient["livekit-client"]
  end

  subgraph "Server Infrastructure"
    Caddy["Caddy<br/>Reverse Proxy + TLS"]
    GoAPI["Go API<br/>:8080"]
    PG[("PostgreSQL<br/>:5432")]
    LiveKit["LiveKit SFU<br/>:7880"]
  end

  Browser -->|"HTTPS /api/*"| Caddy
  Browser -->|"WSS /ws"| Caddy
  Browser -->|"WebRTC"| LiveKit
  Caddy -->|"/api/*, /ws"| GoAPI
  GoAPI -->|SQL| PG
  GoAPI -->|"token API"| LiveKit
  WASM -.->|"MLS (RFC 9420)<br/>encrypt/decrypt"| Browser
  LKClient -.->|"frame encryption<br/>AES-256-GCM"| Browser
```

### Level 2 -Request Flow Detail

```mermaid
graph LR
  subgraph "Vite Dev Server :5173"
    React[React App]
  end

  subgraph "Caddy :8081 (Docker) or Vite Proxy (Dev)"
    Proxy[Reverse Proxy]
  end

  subgraph "Go API :8080"
    Auth["/api/auth<br/>register (BIP39), verify"]
    Servers["/api/servers<br/>CRUD, join, leave"]
    Channels["/api/channels<br/>messages"]
    Keys["/api/keys<br/>MLS KeyPackages"]
    LKTokens["/api/livekit<br/>room tokens"]
    WS["/ws<br/>WebSocket Hub"]
    Health["/api/health"]
  end

  subgraph "PostgreSQL"
    Users[(users)]
    ServersDB[(servers, channels)]
    Messages[(messages<br/>ciphertext)]
    MLSKeys[(mls_credentials<br/>mls_key_packages)]
  end

  React -->|"HTTP/WS"| Proxy
  Proxy --> Auth
  Proxy --> Servers
  Proxy --> Channels
  Proxy --> Keys
  Proxy --> LKTokens
  Proxy --> WS
  Proxy --> Health

  Auth --> Users
  Servers --> ServersDB
  Channels --> Messages
  Keys --> MLSKeys
  LKTokens -.->|"generates JWT"| LiveKit["LiveKit"]
```

### Level 3 -E2EE Data Flow

```mermaid
sequenceDiagram
  participant A as Alice (Browser)
  participant WASM as hush-crypto (WASM)
  participant API as Go API
  participant DB as PostgreSQL
  participant B as Bob (Browser)

  Note over A,B: Chat Message (MLS)
  A->>WASM: MlsGroup::create_message(plaintext)
  WASM-->>A: MLS ApplicationMessage (ciphertext)
  A->>API: POST /api/channels/:id/messages {ciphertext}
  API->>DB: Store ciphertext (server never sees plaintext)
  API-->>B: WS event: channel.message
  B->>API: GET /api/channels/:id/messages
  API-->>B: {ciphertext}
  B->>WASM: MlsGroup::process_message(ciphertext)
  WASM-->>B: plaintext

  Note over A,B: Voice/Video (LiveKit E2EE)
  A->>API: POST /api/livekit/token
  API-->>A: LiveKit JWT
  A->>WASM: Derive frame key from MLS export_secret (AES-256-GCM)
  A->>LiveKit: WebRTC media (encrypted frames)
  LiveKit->>B: Forward encrypted frames (SFU cannot decrypt)
  B->>WASM: Derive frame key from MLS export_secret
  B->>WASM: Decrypt frames with AES-256-GCM
```

### Level 4 -WebSocket Presence Flow

```mermaid
sequenceDiagram
  participant C as Client
  participant WS as WebSocket Hub
  participant API as Go API

  C->>WS: Connect (JWT in query)
  WS->>WS: Validate JWT, register client
  WS->>C: presence.update {user_ids: [...]}

  Note over C,WS: Periodic broadcast
  loop Every 30s
    WS->>C: presence.update {user_ids: [...connected...]}
  end

  C->>WS: Disconnect
  WS->>WS: Remove from connected set
  WS-->>Others: presence.update {user_ids: [...without C...]}
```

### Level 5 -Docker Network Topology

```mermaid
graph TB
  subgraph "hush-network (bridge)"
    subgraph "Data Layer"
      PG["postgres:5432<br/>Volumes: postgres_data"]
      Redis["redis:6379<br/>Volumes: redis_data"]
    end

    subgraph "Application Layer"
      API["hush-api:8080<br/>(Go)"]
    end

    subgraph "Media Layer"
      LK["livekit:7880,7881<br/>UDP 50020-50100"]
    end

    subgraph "Edge Layer"
      Caddy["caddy:80<br/>Exposed: 8081 (dev)<br/>Volumes: caddy_data"]
    end
  end

  Internet["Internet / Browser"] -->|":8081"| Caddy
  Internet -->|":7880-7881, 50020-50100/udp"| LK
  Caddy -->|"/api/*, /ws"| API
  API --> PG
```

---

## Database

### Schema Overview

The Go API auto-applies migrations on startup from `server/migrations/`.

```
server/migrations/
  000001_init_schema.up.sql       # Core tables
  000002_messages_recipient_id    # DM support (recipient_id column)
  000003_voice_mode_low_latency   # Voice mode rename
  000004_add_category_type        # Category channel type
```

### Core Tables

| Table | Purpose |
|-|-|
| `users` | username, public_key (root IK), display_name |
| `devices` | device_id, user_id, device_public_key, certificate (signed by certifying device), label, last_seen |
| `sessions` | JWT token hashes, expiry |
| `servers` | Server name, owner, icon |
| `channels` | Type (text/voice/category), voice_mode, position, parent |
| `channel_config` | Per-channel settings: retention, max media size |
| `server_members` | User-server membership with role (member/mod/admin) |
| `messages` | ciphertext (BYTEA), sender, channel, timestamp |
| `mls_credentials` | Per-device MLS credential (user_id, device_id, credential_bytes, signing_public_key) |
| `mls_key_packages` | MLS KeyPackages (user_id, device_id, key_package_bytes, consumed flag) |
| ~~`devices`~~ | *(moved to Core Tables above with certified key fields)* |
| `invite_codes` | Server invites with expiry, max uses |

### Connecting Directly

```bash
# Docker:
docker exec -it hush-postgres psql -U hush -d hush

# Local:
psql -U hush -d hush
```

---

## Troubleshooting

### Go API won't start

```
migrate new failed
```
Check `DATABASE_URL`. The Go server needs a reachable PostgreSQL with the `hush` database.

### CORS errors in browser

- **Dev (Vite):** Vite proxies `/api` to `localhost:8080`, so CORS is not involved. If you hit the Go API directly, set `CORS_ORIGIN=*`.
- **Docker:** Check that `CORS_ORIGIN` in `.env` matches your browser's origin. Caddy and the Go API both read this variable.

### WebSocket disconnects

- Vite proxy does not handle WebSocket upgrades for `/ws` by default. The proxy config in `vite.config.js` sends `/api` traffic to the Go API but `/ws` needs to be added explicitly if not present.
- In Docker, Caddy handles `/ws` → `hush-api:8080` with proper upgrade headers.

### LiveKit "room not found"

LiveKit has `auto_create: true` in `livekit.yaml`. If you get room errors, check that `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` match between the Go API and the LiveKit server config.

### COOP header

`Cross-Origin-Opener-Policy: same-origin` is set by Caddy and the Vite dev server. This is required for window isolation. COEP (`Cross-Origin-Embedder-Policy`) is intentionally NOT set — LiveKit E2EE does not require `SharedArrayBuffer`, and COEP breaks browser extensions and cross-origin resources.

### "I changed Go code but the API still returns old responses"

The Go binary must be restarted. Unlike Vite, Go does not hot-reload. Kill the process and `go run ./cmd/hush` again. In Docker: `docker-compose up -d --build hush-api`.

---

## Development vs Production Checklist

| Concern | Development | Production |
|-|-|-|
| JWT_SECRET | Any string | `openssl rand -hex 32` |
| CORS_ORIGIN | `*` | `https://your-domain.com` |
| DATABASE_URL | `hush:hush@localhost` | Strong password, `sslmode=require` |
| LiveKit | Self-hosted with `devkey/devsecret` | Self-hosted with random keys (must match livekit.yaml) |
| TLS | None (HTTP) | Caddy auto-TLS or your own cert |
| Postgres password | `hush` | `openssl rand -hex 16` |
| COOP header | Vite dev server | Caddy (Caddyfile.prod) |
| Ports exposed | 5173 (Vite), 8080 (Go) | 80, 443 (Caddy only) |

---

## Known Issues

### iCloud Private Relay breaks voice channels on iOS Safari

**Symptom:** Voice channels show "Connecting..." indefinitely, then fail with `ServerUnreachable` after 15 seconds. Console shows `could not establish signal connection: Abort handler called`.

**Cause:** Apple's iCloud Private Relay (enabled by default on iOS 15+) routes traffic through MASQUE/QUIC relay nodes that inconsistently block WebSocket upgrades. The LiveKit signaling WebSocket (`wss://host/livekit/rtc/v1`) never receives a 101 Switching Protocols response — some relay nodes forward the upgrade, others silently drop it.

**Diagnosis:** Check nginx access logs for the client IP. If the IP is in the `172.225.x.x` or `172.226.x.x` range, the user is behind Private Relay.

**Workaround:** Disable iCloud Private Relay: Settings > Apple Account > iCloud > Private Relay > turn off. Alternatively, the user can add the instance domain to Safari's Private Relay exceptions.

**Long-term fix:** Configure LiveKit with TURN/TCP fallback so signaling can work through HTTP proxies. This requires a TURN server (e.g., coturn) configured alongside LiveKit.
