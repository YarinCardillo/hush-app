# Hush

**Stream without limits. Privacy by default.**

High-quality screen sharing with end-to-end encryption. Open source, self-hostable. Signal Protocol for chat, LiveKit for media, both E2EE.

---

## What is this?

Hush is a privacy-first Discord alternative for screen sharing, voice, video, and text chat, all end-to-end encrypted. Create or join a server, add text and voice channels, invite friends. The server never sees your content.

**Features:**
- Screen sharing, webcam, and microphone
- E2EE chat (Signal Protocol: X3DH + Double Ratchet)
- E2EE media (LiveKit frame encryption, AES-256-GCM)
- Servers with text and voice channels (Discord-like)
- Guest access (no account required to try)
- Self-hostable: `./scripts/setup.sh` then `docker-compose up -d`

**Privacy:**
- Chat messages encrypted with Signal Protocol. The server stores only ciphertext.
- Media frames encrypted client-side with AES-256-GCM. The SFU forwards encrypted data.
- Frame keys distributed via Signal sessions, never sent to the server.
- See [SECURITY.md](SECURITY.md) for algorithms, trust model, and browser support.

---

## Quick start

### Self-hosting (Docker)

```bash
git clone https://github.com/YarinCardillo/hush-app
cd hush-app
./scripts/setup.sh   # generates .env with random secrets
docker-compose up -d
```

Open `https://your-domain` (Caddy handles TLS and proxies the Go backend + LiveKit).

For local dev with hot reload: `docker-compose up -d` for backend services, then `npm run dev` in the client directory.

### Configuration

Main environment variables (see [.env.example](.env.example)):

| Variable | Description |
|-|-|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing auth tokens |
| `LIVEKIT_API_KEY` | LiveKit API key (dev: `devkey`) |
| `LIVEKIT_API_SECRET` | LiveKit API secret (dev: `devsecret`) |
| `LIVEKIT_URL` | LiveKit WebSocket URL (dev: `ws://localhost:7880`; prod: `wss://<project>.livekit.cloud`) |

---

## Architecture

- **Client:** React 18, Vite. `hush-crypto` (Rust compiled to WASM) for E2EE chat and key distribution. `livekit-client` for voice/video/screen.
- **Backend (Go):** Chi router. Auth, rooms, channels, membership, WebSocket real-time, Signal Protocol pre-key server, LiveKit token endpoint.
- **Database:** PostgreSQL. Messages stored as ciphertext.
- **LiveKit:** SFU for WebRTC media. Frame-level E2EE via Insertable Streams.
- **Caddy:** Reverse proxy and TLS.
- **Desktop:** Tauri + CEF (Rust shell + bundled Chromium, native crypto via IPC).
- **Mobile:** React Native with `hush-crypto` Rust crate via UniFFI.

---

## Tech stack

| Layer | Technology |
|-|-|
| Frontend | React 18, Vite, hush-crypto (WASM), livekit-client |
| E2EE | Signal Protocol (chat), AES-256-GCM (media frames) |
| Backend | Go, Chi |
| Database | PostgreSQL |
| Media SFU | LiveKit |
| Desktop | Tauri + CEF |
| Mobile | React Native |
| Proxy | Caddy |
| Containers | Docker, docker-compose |

---

## Browser support

| Browser | Chat E2EE | Media E2EE |
|-|-|-|
| Chromium (Chrome, Edge, Brave, Arc) | Full | Full |
| Firefox | Full | Partial |
| Safari | Full | Limited |

Full media E2EE requires Insertable Streams and the LiveKit E2EE worker. See [SECURITY.md](SECURITY.md).

---

## Documentation

- **[SECURITY.md](SECURITY.md):** E2EE implementation, trust model, limitations.
- **[CHANGELOG.md](CHANGELOG.md):** Release history and notable changes.
- **[docs/](docs/README.md):** Full documentation index: testing, room lifecycle, Matrix reference, audit reports.

---

## Contributing

PRs welcome. Open an issue first for large changes.

---

## License

AGPL-3.0. If you modify and deploy, share your changes.
