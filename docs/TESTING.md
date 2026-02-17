# Testing the Hush App (Matrix + LiveKit)

This guide explains how to run and test the Hush app locally: infrastructure (Docker), dev client, and manual checks.

---

## 1. One-time setup

### 1.1 Environment

```bash
cd /Users/yarin/development/hush-app

cp .env.example .env
```

Edit `.env` and set:

- **LIVEKIT_API_KEY** — Required for the token service. Use a random string (e.g. 32+ chars) for local dev.
- **LIVEKIT_API_SECRET** — Same; must match what LiveKit server expects.

Example for local dev only:

```env
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
```

The rest (e.g. `MATRIX_SERVER_NAME`, `MATRIX_HOMESERVER_URL`, Postgres) can stay as in `.env.example` when using Docker.

### 1.2 Synapse config (first time only)

If `synapse/data/homeserver.yaml` does not exist:

```bash
./scripts/generate-synapse-config.sh
```

This creates signing keys and `synapse/data/homeserver.yaml` from the template.

### 1.3 Dependencies

```bash
npm run install:all
```

This installs root, server, and client dependencies.

---

## 2. Running the app

### 2.1 Start the full stack (Terminal 1)

```bash
docker-compose up --build
```

This starts:

- **Postgres** — Synapse database
- **Synapse** — Matrix homeserver (port 8008 internally)
- **Redis** — Used by LiveKit
- **LiveKit** — Media SFU (7880, 7881, 50000–50100/udp)
- **Hush** — Node server (static client + `/api/livekit/token`) on port 3001
- **Caddy** — Reverse proxy on port 80

Leave this terminal running.

### 2.2 Start the dev client (Terminal 2)

```bash
npm run dev:client
```

The Vite dev server runs at the port it prints (typically **http://localhost:5173**; if that port is in use, Vite uses 5174 or the next free port). It proxies:

- `/api` → http://localhost:80 (Caddy → Hush server)
- `/_matrix` → http://localhost:80 (Caddy → Synapse)
- `/livekit` → http://localhost:80 (Caddy → LiveKit)

So the client (on whatever port Vite chose) talks to all services through Caddy on port 80.

### 2.3 Open the app

In your browser, open:

**http://localhost:5173**

You should see the Hush home screen (login / register / continue as guest).

---

## 3. Quick verification commands

Run these with the stack up (Caddy on 80). Adjust if you expose Synapse or Hush on other ports.

### 3.1 Synapse (Matrix)

```bash
curl -s http://localhost/_matrix/client/versions | jq .
```

You should see a JSON list of supported Matrix API versions.

### 3.2 Token endpoint (no auth)

Without a Matrix token, the token endpoint must return 401:

```bash
curl -s -X POST http://localhost/api/livekit/token \
  -H "Content-Type: application/json" \
  -d '{"roomName":"test","participantName":"test"}'
```

Expected: 401 Unauthorized (Matrix access token required).

### 3.3 Health (if implemented)

```bash
curl -s http://localhost/api/health
```

If the server exposes this route, you should get a success response.

---

## 4. Manual testing flow

Use two browser windows (e.g. normal + incognito) to simulate two users.

### 4.1 Auth and room

1. **Browser 1:** Open the client URL (e.g. http://localhost:5173) → use the create/join form (guest auth is used when you submit).
2. **Browser 2:** Same URL → “Continue as Guest” (or another account).
3. **Browser 1:** Create a room (name + optional password) → Create. You should be taken to the room page.
4. **Browser 2:** Join the same room (by room name/alias and password if set) → Join.

### 4.2 In the room

- **Chat:** Send messages; they go over Matrix (E2EE if Rust crypto is used).
- **Mic / camera:** Toggle in the controls; media goes through LiveKit.
- **Screen share:** Start/stop screen share; E2EE if the E2EE worker and key exchange are working.
- **Leave:** Use Leave; in a two-user call, the remaining user becomes leader and rekeying should run (new key via Matrix to-device).

### 4.3 E2EE checklist

For a full E2EE manual checklist (crypto init, key distribution, rekeying, etc.), see:

[e2ee-test-checklist.md](e2ee-test-checklist.md)

---

## 5. Troubleshooting

| Problem | What to check |
|--------|----------------|
| “Encryption unavailable” / crypto error on login | Browser supports WebAssembly; try Chromium. No IndexedDB in private mode on some browsers. |
| 401 on LiveKit token | You must be logged in (guest or registered). Token request sends Matrix Bearer token; if session didn’t rehydrate after refresh, log in again. |
| Room doesn’t connect / “could not establish pc connection” | LiveKit container is up; Caddy routes `/livekit` to LiveKit; `.env` has correct `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` (same as in LiveKit container). |
| Matrix errors (e.g. 403 on join) | Synapse config (e.g. `allow_guest_access`, `enable_registration`); room alias and server name match (`MATRIX_SERVER_NAME`). |
| Client (Vite port) can’t reach API/Matrix/LiveKit | Caddy must be running on port 80; Vite proxy targets `http://localhost:80`. |

---

## 6. Summary

| Step | Command | Notes |
|------|---------|--------|
| Env | Copy `.env.example` → `.env`, set `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` | Required for token API |
| Synapse (first time) | `./scripts/generate-synapse-config.sh` | If `synapse/data/homeserver.yaml` missing |
| Dependencies | `npm run install:all` | Once (or after adding deps) |
| Stack | `docker-compose up --build` | Terminal 1; leave running |
| Dev client | `npm run dev:client` | Terminal 2 |
| Open app | URL Vite prints (e.g. http://localhost:5173) | Use this for development and testing |

For production-like testing with the built client only, run `docker-compose up --build` and open **http://localhost** (no `npm run dev:client`).
