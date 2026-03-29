![Build](https://img.shields.io/badge/build-passing-brightgreen)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue)
![Version](https://img.shields.io/badge/version-v1.0--rc-orange)

# Hush

End-to-end encrypted communication platform. Every message, every call, every screen share is encrypted by default. The server is a blind relay.

---

## Quick Start (Self-Hosting)

**Prerequisites:**
- Linux server (Ubuntu 22.04+ recommended, 1 GB RAM minimum)
- [Docker](https://docs.docker.com/engine/install/) and docker-compose installed
- Ports 80, 443, 7880-7881/tcp and 50020-50100/udp open

### With a domain (recommended)

A domain gives you a real TLS certificate from Let's Encrypt — no browser warnings, and no friction when users from other instances connect to yours.

**1. Point a domain at your server** (A record in your DNS provider):

```
chat.example.com  ->  YOUR_SERVER_IP
```

> **Don't have a domain?** Free subdomains from [DuckDNS](https://www.duckdns.org) or [Afraid.org](https://freedns.afraid.org) work perfectly. Create one, point it at your server IP, and use it below.

**2. Run setup:**

```bash
git clone https://github.com/YarinCardillo/hush-app
cd hush-app
./scripts/setup.sh --domain chat.example.com --email you@example.com
```

**3. Open `https://chat.example.com`.** No warnings, no extra steps. Register and you're live.

### With just an IP (development / LAN only)

IP mode uses a self-signed certificate. It works for local testing and single-instance use, but **cross-instance features are disabled** — other Hush instances cannot connect to yours because browsers block cross-origin WebSocket connections to self-signed certificates. This is a browser security constraint, not a Hush limitation.

```bash
git clone https://github.com/YarinCardillo/hush-app
cd hush-app
./scripts/setup.sh --ip 203.0.113.42
```

After setup, visit `https://YOUR_SERVER_IP`, accept the browser certificate warning, and register.

> **For production use, get a domain.** Free subdomains from [DuckDNS](https://www.duckdns.org), [FreeDNS](https://freedns.afraid.org), or [No-IP](https://www.noip.com) work perfectly. Point it at your server and re-run with `--domain` — Caddy gets a real Let's Encrypt certificate automatically. Every self-hosted project (Matrix, Nextcloud, Gitea, Vaultwarden) requires this for the same reason.

### Flags

| Flag | Purpose |
|-|-|
| `--domain <host>` | Public hostname (Let's Encrypt TLS) |
| `--ip <address>` | Server IP (self-signed TLS, no domain needed) |
| `--email <email>` | Let's Encrypt renewal (required with `--domain`) |
| `--force` | Re-run on an already-configured instance (overwrites config, preserves data) |

### What `setup.sh` does

1. Checks for Docker and docker-compose
2. Generates all secrets: JWT signing key, admin API key, PostgreSQL password, LiveKit credentials, key transparency seed
3. Writes `.env` and Caddy config from `--domain` or `--ip`
4. Builds the Go API and client images, pulls Postgres/Redis/LiveKit
5. Runs database migrations and starts the stack
6. Health-checks the running instance and prints your live URL

### Updating

```bash
./scripts/update.sh
```

This backs up the database, pulls the latest code, rebuilds images, and restarts.

For detailed configuration, see [ARCHITECTURE.md](ARCHITECTURE.md#infrastructure).

---

## Features

- **MLS E2EE (RFC 9420):** Every text channel is an independent MLS group. Chat messages are encrypted client-side via OpenMLS compiled to WASM. The server stores only ciphertext.
- **BIP39 cryptographic identity:** A 12-word mnemonic phrase is your account. No email, no password, no central recovery. The server stores only your Ed25519 public key.
- **Multi-device:** Each device has its own keypair. New devices are authorized by an existing device via QR-code certificate signing. Private keys never leave the device.
- **Voice and video with encrypted frames:** LiveKit SFU forwards encrypted frames. Frame keys are derived from the voice channel's MLS `export_secret()` — never transmitted to the server.
- **Guild-based moderation:** Servers (guilds) with text and voice channels. Role-based permissions (member, moderator, admin, owner). Permission levels are opaque integers to the server.
- **Encrypted metadata:** Guild names and channel names are encrypted client-side with a key derived from the guild's metadata MLS group. The server stores only opaque blobs.
- **Key transparency (T.1):** Signed Merkle tree of key operations. Clients verify inclusion proofs at login and on key changes.
- **Guest access:** Try without creating an account. Ephemeral keypair, short-lived session.
- **Admin dashboard:** Standalone app authenticating via API key. Sees only UUIDs and metrics — never plaintext names or content.

---

## Architecture Overview

Hush is a Go backend, React frontend, and a Rust OpenMLS crate compiled to WASM. All encryption happens in the client. The server is a stateless relay for ciphertext.

```
Client (React + WASM)
       |
     Caddy (TLS termination, reverse proxy)
       |
    Go API (auth, routing, WebSocket hub)
     / | \
PgSQL Redis LiveKit (WebRTC SFU)
```

For the full architecture including data flow, directory structure, and crypto design, see [ARCHITECTURE.md](ARCHITECTURE.md).

**Tech stack:**

| Layer | Technology |
|-|-|
| Frontend | React 18, Vite |
| E2EE (chat) | MLS RFC 9420 via OpenMLS 0.8.1 (Rust → WASM) |
| E2EE (media) | AES-256-GCM via LiveKit Insertable Streams |
| Backend | Go, Chi router |
| Database | PostgreSQL |
| Cache | Redis |
| Media SFU | LiveKit |
| Proxy / TLS | Caddy (automatic HTTPS) |
| Containers | Docker, docker-compose |

---

## Browser Support

| Browser | Chat E2EE | Media E2EE |
|-|-|-|
| Chromium (Chrome, Edge, Brave, Arc) | Full | Full |
| Firefox | Full | Partial |
| Safari | Full | Limited |

Full media E2EE requires Insertable Streams. See [SECURITY.md](SECURITY.md#browser-support) for details.

---

## Contributing

### Dev environment

Prerequisites: [Node.js 22+](https://nodejs.org/), [Rust](https://rustup.rs/), [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/).

```bash
docker-compose up -d                 # starts PostgreSQL, Redis, LiveKit
cd client
npm install
npm run dev                          # builds WASM automatically on first run, starts Vite on :5173
```

Vite proxies `/api`, `/ws`, and `/livekit` to the Go backend via Caddy on `:8081`.

To rebuild the WASM crate manually:

```bash
cd client && npm run build:wasm:force
```

### Running tests

```bash
# Server (Go)
cd server && go test ./...

# Client (Vitest)
cd client && npx vitest run

# Specific suite
cd client && npx vitest run src/lib/mlsGroup
```

### Branching strategy

- `main` — stable, always deployable
- Feature branches: `feature/description` or `fix/description`
- Open an issue before starting large changes
- PRs require passing tests on both server and client

---

## Security

Hush is designed so that a compromised server cannot read your messages, guild names, or media. See [SECURITY.md](SECURITY.md) for:

- MLS threat model (what the protocol protects and its limits)
- Key Transparency guarantees
- Server blind relay model (what the server stores vs. never sees)
- Cryptographic primitives inventory
- Known limitations
- Responsible disclosure

**Responsible disclosure:** `security@gethush.live`

---

## Documentation

| Document | Purpose |
|-|-|
| [SECURITY.md](SECURITY.md) | Threat model, cryptographic primitives, responsible disclosure |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, data flow, directory structure |
| [CHANGELOG.md](CHANGELOG.md) | Release history and architectural evolution |

---

## License

[AGPL-3.0](LICENSE). If you modify and deploy Hush, you must share your changes under the same license.
