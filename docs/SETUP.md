# Hush Setup Guide

Complete setup, architecture, environment variables, and developer workflow reference.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Quick Start — Development](#quick-start--development)
3. [Quick Start — Self-Hosting (Docker)](#quick-start--self-hosting-docker)
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
| **PostgreSQL** | PostgreSQL 16 | Users, servers, channels, messages (ciphertext), Signal keys |
| **LiveKit** | LiveKit SFU (self-hosted or Cloud) | WebRTC media relay (voice, video, screen) |
| **Caddy** | Caddy 2 (Docker only) | Reverse proxy, TLS, CORS, security headers |

---

## Quick Start -- Development

### Prerequisites

- Go 1.22+
- Node.js 20+
- PostgreSQL 16 (Docker or local)
- (Optional) LiveKit server for voice/video

### 1. Start PostgreSQL

Easiest via Docker (runs only Postgres, not the full stack):

```bash
docker run -d --name hush-pg \
  -e POSTGRES_USER=hush \
  -e POSTGRES_PASSWORD=hush \
  -e POSTGRES_DB=hush \
  -p 5432:5432 \
  postgres:16-alpine
```

Or use an existing PostgreSQL instance. Create the database manually:

```sql
CREATE USER hush WITH PASSWORD 'hush';
CREATE DATABASE hush OWNER hush;
```

### 2. Start the Go API

```bash
cd server
cp .env.example .env          # edit JWT_SECRET if you want
export DATABASE_URL="postgres://hush:hush@localhost:5432/hush?sslmode=disable"
export JWT_SECRET="dev-secret-change-me"
go run ./cmd/hush
```

The Go server:
- Runs on port **8080**
- Auto-runs migrations from `server/migrations/` on startup
- Serves `/api/*` and `/ws`

### 3. Start the Vite dev server

```bash
cd client
npm install
npm run dev
```

Vite runs on port **5173** and proxies:

| Path | Target | Purpose |
|-|-|-|
| `/api/*` | `localhost:8080` | Go API |
| `/livekit/*` | `localhost:8081` | LiveKit via Caddy |

Open `http://localhost:5173` in a Chromium-based browser.

### 4. (Optional) Start LiveKit for voice/video

```bash
docker run -d --name hush-livekit \
  -p 7880:7880 -p 7881:7881 \
  -v $(pwd)/livekit/livekit.yaml:/etc/livekit.yaml:ro \
  livekit/livekit-server:latest --config /etc/livekit.yaml
```

Set in Go API environment:

```bash
export LIVEKIT_API_KEY=devkey
export LIVEKIT_API_SECRET=devsecret
export LIVEKIT_URL=ws://localhost:7880
```

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

This starts 7 services:

| Service | Port | Purpose |
|-|-|-|
| `postgres` | 5432 (internal) | Database (Synapse + Hush) |
| `synapse` | 8008 (internal) | Matrix homeserver (legacy) |
| `hush-api` | 8080 (internal) | Go backend |
| `hush` | 3001 (internal) | Node.js frontend server |
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
- LiveKit and Redis are disabled (use LiveKit Cloud instead)
- Set `CORS_ORIGIN` in `.env` to your domain (e.g. `https://gethush.live`)

### 4. Verify

```bash
curl http://localhost:8080/api/health     # Go API
curl http://localhost:8081/_matrix/client/versions  # Synapse (via Caddy)
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
| `LIVEKIT_API_KEY` | For voice | -- | `devkey` | From LiveKit Cloud dashboard | LiveKit API key |
| `LIVEKIT_API_SECRET` | For voice | -- | `devsecret` | From LiveKit Cloud dashboard | LiveKit API secret |
| `LIVEKIT_URL` | For voice | -- | `ws://localhost:7880` | `wss://<project>.livekit.cloud` | LiveKit server URL |

### Vite Client (`client/.env`)

| Variable | Required | Default | Dev Value | Production Value | Description |
|-|-|-|-|-|-|
| `VITE_MATRIX_HOMESERVER_URL` | No | `window.location.origin + /_matrix` | `http://localhost/_matrix` | Not needed (auto-detected) | Matrix homeserver URL (legacy) |

### Docker Compose (root `.env`)

| Variable | Required | Default | Dev Value | Production Value | Description |
|-|-|-|-|-|-|
| `POSTGRES_USER` | No | `synapse` | `synapse` | `synapse` | Postgres user |
| `POSTGRES_PASSWORD` | **Yes** | `synapse_password` | `synapse_password` | `openssl rand -hex 16` | Postgres password |
| `POSTGRES_DB` | No | `synapse` | `synapse` | `synapse` | Postgres database name |
| `MATRIX_SERVER_NAME` | No | `localhost` | `localhost` | `your-domain.com` | Matrix server name |
| `SYNAPSE_REGISTRATION_SHARED_SECRET` | No | `changeme` | `changeme` | `openssl rand -hex 32` | Synapse registration secret |
| `SYNAPSE_MACAROON_SECRET_KEY` | No | `changeme` | `changeme` | `openssl rand -hex 32` | Synapse macaroon key |
| `SYNAPSE_ADMIN_TOKEN` | No | -- | -- | Admin user access token | For room cleanup |
| `CORS_ORIGIN` | No | `*` | `*` | `https://your-domain.com` | Shared by Caddy + Go API |
| `MAX_GUEST_ROOMS` | No | `30` | `30` | `30` | Max concurrent guest rooms |
| `MAX_PARTICIPANTS_PER_ROOM` | No | `10` | `10` | `10` | Max users per room |

### Generating production secrets

```bash
# JWT secret
openssl rand -hex 32

# Postgres password
openssl rand -hex 16

# Synapse secrets
openssl rand -hex 32   # SYNAPSE_REGISTRATION_SHARED_SECRET
openssl rand -hex 32   # SYNAPSE_MACAROON_SECRET_KEY

# LiveKit (self-hosted only; for LiveKit Cloud, get from dashboard)
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

No client restart needed. The Vite proxy forwards `/api/*` to the Go server.

#### "I changed a React component"

Nothing. Vite hot-reloads automatically. If you see stale state (e.g. after changing context providers), do a hard refresh.

#### "I added a new database migration"

```bash
# Local dev: just restart the Go API — it runs migrate.Up() on startup
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

### Level 1 — High-Level System

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
  WASM -.->|"Signal Protocol<br/>encrypt/decrypt"| Browser
  LKClient -.->|"frame encryption<br/>AES-256-GCM"| Browser
```

### Level 2 — Request Flow Detail

```mermaid
graph LR
  subgraph "Vite Dev Server :5173"
    React[React App]
  end

  subgraph "Caddy :8081 (Docker) or Vite Proxy (Dev)"
    Proxy[Reverse Proxy]
  end

  subgraph "Go API :8080"
    Auth["/api/auth<br/>register, login"]
    Servers["/api/servers<br/>CRUD, join, leave"]
    Channels["/api/channels<br/>messages"]
    Keys["/api/keys<br/>Signal pre-keys"]
    LKTokens["/api/livekit<br/>room tokens"]
    WS["/ws<br/>WebSocket Hub"]
    Health["/api/health"]
  end

  subgraph "PostgreSQL"
    Users[(users)]
    ServersDB[(servers, channels)]
    Messages[(messages<br/>ciphertext)]
    SignalKeys[(signal_identity_keys<br/>signal_one_time_pre_keys)]
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
  Keys --> SignalKeys
  LKTokens -.->|"generates JWT"| LiveKit["LiveKit"]
```

### Level 3 — E2EE Data Flow

```mermaid
sequenceDiagram
  participant A as Alice (Browser)
  participant WASM as hush-crypto (WASM)
  participant API as Go API
  participant DB as PostgreSQL
  participant B as Bob (Browser)

  Note over A,B: Chat Message (Signal Protocol)
  A->>API: GET /api/keys/:userId/bundle
  API->>DB: Fetch Bob's pre-key bundle
  DB-->>API: identity_key, signed_pre_key, one_time_pre_key
  API-->>A: Pre-key bundle
  A->>WASM: X3DH key agreement + Double Ratchet encrypt
  WASM-->>A: ciphertext
  A->>API: POST /api/channels/:id/messages {ciphertext}
  API->>DB: Store ciphertext (server never sees plaintext)
  API-->>B: WS event: channel.message
  B->>API: GET /api/channels/:id/messages
  API-->>B: {ciphertext}
  B->>WASM: Double Ratchet decrypt
  WASM-->>B: plaintext

  Note over A,B: Voice/Video (LiveKit E2EE)
  A->>API: POST /api/livekit/token
  API-->>A: LiveKit JWT
  A->>WASM: Generate frame key (AES-256-GCM)
  A->>WASM: Encrypt frame key with Signal session
  A->>API: Distribute encrypted frame key via Signal
  A->>LiveKit: WebRTC media (encrypted frames)
  LiveKit->>B: Forward encrypted frames (SFU cannot decrypt)
  B->>WASM: Decrypt frame key via Signal session
  B->>WASM: Decrypt frames with AES-256-GCM
```

### Level 4 — WebSocket Presence Flow

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

### Level 5 — Docker Network Topology

```mermaid
graph TB
  subgraph "hush-network (bridge)"
    subgraph "Data Layer"
      PG["postgres:5432<br/>Volumes: postgres_data"]
      Redis["redis:6379<br/>Volumes: redis_data"]
    end

    subgraph "Application Layer"
      API["hush-api:8080<br/>(Go)"]
      Hush["hush:3001<br/>(Node.js)"]
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
  Caddy -->|"/*"| Hush
  Caddy -->|"/_matrix/*"| Synapse["synapse:8008"]
  API --> PG
  Hush --> Synapse
  Synapse --> PG
```

---

## Database

### Schema Overview

The Go API auto-applies migrations on startup from `server/migrations/`.

```
server/migrations/
  000001_init_schema.up.sql       # Core tables
  000002_messages_recipient_id    # DM support
  000003_voice_mode_low_latency   # Voice mode rename
```

### Core Tables

| Table | Purpose |
|-|-|
| `users` | username, password_hash, display_name |
| `sessions` | JWT token hashes, expiry |
| `servers` | Server name, owner, icon |
| `channels` | Type (text/voice), voice_mode, position, parent |
| `server_members` | User-server membership with role (member/mod/admin) |
| `messages` | ciphertext (BYTEA), sender, channel, timestamp |
| `signal_identity_keys` | Per-device identity key, signed pre-key, registration ID |
| `signal_one_time_pre_keys` | Ephemeral pre-keys with used flag |
| `devices` | User devices (device_id, label, last_seen) |
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

### COOP/COEP errors (SharedArrayBuffer)

E2EE requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. These are set by:
- **Vite dev server** (in `vite.config.js` server headers)
- **Caddy** (in Caddyfile for `/*` and `/_matrix/*` routes)

If loading third-party resources fails, they need `crossorigin` attributes or CORS headers.

### "I changed Go code but the API still returns old responses"

The Go binary must be restarted. Unlike Vite, Go does not hot-reload. Kill the process and `go run ./cmd/hush` again. In Docker: `docker-compose up -d --build hush-api`.

---

## Development vs Production Checklist

| Concern | Development | Production |
|-|-|-|
| JWT_SECRET | Any string | `openssl rand -hex 32` |
| CORS_ORIGIN | `*` | `https://your-domain.com` |
| DATABASE_URL | `hush:hush@localhost` | Strong password, `sslmode=require` |
| LiveKit | Self-hosted with `devkey/devsecret` | LiveKit Cloud or self-hosted with random keys |
| TLS | None (HTTP) | Caddy auto-TLS or your own cert |
| Postgres password | `hush` or `synapse_password` | `openssl rand -hex 16` |
| Synapse secrets | `changeme` | `openssl rand -hex 32` |
| COOP/COEP headers | Vite dev server | Caddy (Caddyfile.prod) |
| Ports exposed | 5173 (Vite), 8080 (Go) | 80, 443 (Caddy only) |
