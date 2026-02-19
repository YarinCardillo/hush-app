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

Open `http://localhost` (Caddy serves the app and proxies Matrix/LiveKit). **When to open:** after `docker-compose up -d`, wait until Synapse is ready (first start can take 1–2 min). Run: `curl -s http://localhost:80/_matrix/client/versions` — when it returns JSON (not 502/empty), open the app. Or run `docker ps` and wait until `hush-synapse` shows **(healthy)**.

**If you changed docker-compose.yml** (e.g. added `depends_on` for Hush): recreate so the new order applies: `docker-compose down && docker-compose up -d`. Plain `docker-compose up -d` does not recreate already-running containers.

For local dev with hot reload, run `npm run install:all`, then `docker-compose up -d` for backend and `npm run dev` for the client; use the URL Vite prints (e.g. http://localhost:5173).

### One-time setup

- `./scripts/setup.sh` checks for `docker`, `docker-compose`, `openssl`, creates `.env` from `.env.example` with random secrets, and can run `scripts/generate-synapse-config.sh`.
- Or copy `.env.example` to `.env` and set at least `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and (for production) `MATRIX_SERVER_NAME`, Synapse secrets, Postgres password.

**Synapse restarts / "password authentication failed for user synapse"**  
This happens when the Postgres volume was created with a different `POSTGRES_PASSWORD` than in your current `.env` (e.g. after re-running `./scripts/setup.sh` or editing `.env`). Postgres does not re-apply the new password to existing data. Fix: remove the Postgres volume and re-create so it uses the current password:

```bash
docker-compose down && docker volume rm hush-app_postgres_data && docker-compose up -d
```

If the volume name differs, run `docker volume ls` and remove the one matching `postgres_data`.

**"Fetch failed" / "Cannot reach Matrix server" when entering a room (LiveKit token)**  
The Hush container calls Synapse for token validation. (1) Hush now starts only after Synapse is healthy (`depends_on: synapse: condition: service_healthy`). If you still see the error, run `docker ps` and confirm `hush-synapse` shows "healthy". (2) **In Docker, the Hush container must reach Synapse by service name.** In `.env`, either leave `MATRIX_HOMESERVER_URL` unset (so the default `http://synapse:8008` is used) or set `MATRIX_HOMESERVER_URL=http://synapse:8008`. If it is set to `http://localhost:8008`, the container will try to reach port 8008 on itself and get connection refused. (3) When using `npm run dev`, `/api` is served by the Hush container (via Caddy); ensure `docker-compose up -d` and that `.env` has `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`. (4) After server code changes, rebuild: `docker-compose up -d --build`. To see the error: `docker logs hush-app-hush-1 2>&1 | tail -30`.

**"Invalid API key" or "Failed to fetch" / ERR_CONNECTION_RESET when joining a room**  
The LiveKit server and the Hush token service must use the same API key/secret. `livekit/livekit.yaml` is configured with `devkey`/`devsecret`. For **local dev** set in `.env`: `LIVEKIT_API_KEY=devkey` and `LIVEKIT_API_SECRET=devsecret`, then run `docker-compose up -d` (or `docker-compose up -d --force-recreate` so the LiveKit container restarts with the updated config). If you previously ran `./scripts/setup.sh` and got random keys, either re-run setup and choose localhost (it now keeps devkey/devsecret) or manually set the two LiveKit vars above.

**"Disconnected" or "could not establish pc connection" right after creating/joining a room**  
The WebSocket (port 7880) can succeed while the WebRTC media connection fails if the host cannot reach the LiveKit RTC ports. (1) Ensure `livekit/livekit.yaml` uses `port_range_start: 50020` and `port_range_end: 50100` to match the ports published in `docker-compose.yml` (50020–50100/udp and 7881/tcp). Restart LiveKit after config changes: `docker-compose up -d --force-recreate livekit`. (2) On **Docker for Mac**, UDP forwarding to containers is often flaky; the client uses a longer peer connection timeout so ICE can fall back to TCP (7881). If it still fails, run LiveKit on the host for local dev: download the binary from [livekit/releases](https://github.com/livekit/livekit/releases), run it with your `livekit.yaml`, and point the app at `ws://localhost:7880`.

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
