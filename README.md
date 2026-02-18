# Hush

**Stream without limits. Privacy by default.**

High-quality screen sharing with end-to-end encryption. Open source, self-hostable. Matrix for auth and chat, LiveKit for media — both E2EE.

---

## What is this?

Hush is a web app for screen sharing, voice, and video with full end-to-end encryption. Create or join a room, share your screen or webcam; chat and media are encrypted so the server never sees content.

**Features:**
- Screen sharing, webcam, and microphone
- E2EE chat (Matrix, Megolm)
- E2EE media (LiveKit frame encryption)
- Create room / join room — no account required (guest auth)
- Password-protected rooms
- Self-hostable: `./scripts/setup.sh` then `docker-compose up -d`

**Privacy:**
- Chat and media are E2EE; keys never leave client control (except Olm/Megolm exchange via Matrix).
- Server issues LiveKit tokens after validating Matrix identity; it does not read room traffic.
- See [SECURITY.md](SECURITY.md) for algorithms, trust model, and browser support.

---

## Quick start

### Self-hosting (Docker)

```bash
git clone https://github.com/YarinCardillo/hush-app
cd hush-app
./scripts/setup.sh   # generates .env, optional Synapse config
docker-compose up -d
```

Open `http://localhost` (Caddy serves the app and proxies Matrix/LiveKit). For local dev with hot reload, run `npm run install:all`, then `docker-compose up -d` for backend and `npm run dev` for the client; use the URL Vite prints (e.g. http://localhost:5173).

### One-time setup

- `./scripts/setup.sh` checks for `docker`, `docker-compose`, `openssl`, creates `.env` from `.env.example` with random secrets, and can run `scripts/generate-synapse-config.sh`.
- Or copy `.env.example` to `.env` and set at least `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and (for production) `MATRIX_SERVER_NAME`, Synapse secrets, Postgres password.

---

## Architecture

- **Client:** React 18, Vite. Matrix (matrix-js-sdk) for auth and chat; LiveKit (livekit-client) for voice/video/screen. E2EE for both (Rust crypto via SDK, LiveKit E2EE worker).
- **Server (Node):** Serves static client, proxies to Synapse and LiveKit, exposes a LiveKit token endpoint (validates Matrix token, returns JWT).
- **Synapse:** Matrix homeserver (auth, room state, E2EE chat).
- **LiveKit:** SFU for WebRTC; media encrypted with client-held keys.
- **Caddy:** Reverse proxy (Matrix, LiveKit, app) and TLS in production.

Self-hosted deploys run Synapse, Postgres, LiveKit, Redis, Caddy, and the Hush server in Docker. For a hosted/production deploy (e.g. gethush.live), LiveKit can be replaced with LiveKit Cloud; use `docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d` and set LiveKit env vars from the cloud dashboard.

---

## Configuration

Main environment variables (see [.env.example](.env.example)):

| Variable | Description |
|----------|-------------|
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit API credentials (dev: match docker-compose; prod: from LiveKit Cloud) |
| `LIVEKIT_URL` | LiveKit WebSocket URL (dev: `ws://localhost:7880`; prod: `wss://<project>.livekit.cloud`) |
| `MATRIX_HOMESERVER_URL`, `MATRIX_SERVER_NAME` | Matrix homeserver URL and server name |
| `POSTGRES_*` | Postgres DB for Synapse |
| `PORT` | Node server port (default 3001) |

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite, matrix-js-sdk, livekit-client |
| Auth & chat | Matrix (Synapse), E2EE via Megolm |
| Media | LiveKit (SFU), E2EE via Insertable Streams |
| Server | Node (static + proxy + LiveKit token endpoint) |
| Proxy | Caddy |
| Containers | Docker, docker-compose |

---

## Browser support

| Browser | Chat E2EE | Media E2EE |
|---------|-----------|------------|
| Chromium (Chrome, Edge, Brave, Arc) | Full | Full |
| Firefox | Full | Partial |
| Safari | Full | Limited |

Full media E2EE requires Insertable Streams and the LiveKit E2EE worker. See [SECURITY.md](SECURITY.md).

---

## Documentation

- **[docs/README.md](docs/README.md)** — Index (testing, audits, reference).
- **[SECURITY.md](SECURITY.md)** — E2EE, trust model, limitations.

---

## Contributing

PRs welcome. Open an issue first for large changes.

---

## License

AGPL-3.0 — If you modify and deploy, share your changes.
