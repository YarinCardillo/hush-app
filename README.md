# Hush

**Your server. Nobody else's. Privacy by default.**

High-quality screen sharing with end-to-end encryption. Open source, self-hostable. MLS (RFC 9420) for chat, voice key distribution, and metadata encryption. The server is a blind relay.

---

## What is this?

Hush is a privacy-first Discord alternative for screen sharing, voice, video, and text chat, all end-to-end encrypted. Create or join a server, add text and voice channels, invite friends. The server never sees your content.

**Features:**
- Mnemonic-based identity: a BIP39 12-word phrase is your account. No email, no password, no central recovery. The server stores only your public key.
- Multi-device support: each device has its own keypair, certified by an existing device via QR scan. Private keys never leave the device.
- Screen sharing, webcam, and microphone
- E2EE chat (MLS, RFC 9420 via OpenMLS)
- E2EE media (LiveKit frame encryption, AES-256-GCM; frame keys derived from MLS export_secret)
- Encrypted metadata: guild names, channel names encrypted with MLS-derived AES-256-GCM key. The server stores only opaque blobs.
- Servers with text and voice channels (Discord-like)
- Guest access (no account required to try — ephemeral identity)
- Self-hostable: `./scripts/setup.sh` then `docker-compose up -d`

**Privacy:**
- The server is a blind relay for ALL data. It never sees plaintext for messages, metadata, media, guild names, or channel names.
- Chat messages encrypted with MLS (RFC 9420). The server stores only ciphertext.
- Media frames encrypted client-side with AES-256-GCM. The SFU forwards encrypted data.
- Frame keys derived from MLS group secret, never sent to the server.
- Guild and channel names encrypted with MLS-derived AES-256-GCM key. The server stores opaque BYTEA blobs.
- See [SECURITY.md](SECURITY.md) for algorithms, trust model, and browser support.

---

## Quick start

### Self-hosting (Docker)

No prerequisites other than Docker. The client image builds the WASM crypto and React SPA automatically.

```bash
git clone https://github.com/YarinCardillo/hush-app
cd hush-app
./scripts/setup.sh   # generates .env with random secrets
docker-compose up -d
```

Open `https://your-domain` (Caddy handles TLS and proxies the Go backend + LiveKit).

### Local development

Prerequisites: [Node.js 22+](https://nodejs.org/), [Rust](https://rustup.rs/), [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/).

```bash
docker-compose up -d                           # starts all backend services
cd client
npm install
npm run dev                                    # builds WASM automatically on first run
```

Vite runs on `:5173` and proxies `/api`, `/ws`, `/livekit` to Caddy on `:8081`.

The `dev` and `build` scripts detect if `hush-crypto` WASM output is missing and build it via `wasm-pack`. Use `npm run build:wasm:force` to rebuild manually.

### Configuration

Main environment variables (see [.env.example](.env.example)):

| Variable | Description |
|-|-|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing auth tokens |
| `LIVEKIT_API_KEY` | LiveKit API key (dev: `devkey`) |
| `LIVEKIT_API_SECRET` | LiveKit API secret (dev: `devsecret`) |
| `LIVEKIT_URL` | LiveKit WebSocket URL (dev: `ws://localhost:7880`; prod: `wss://livekit.your-domain.com`) |

---

## Architecture

- **Client:** React 18, Vite. `hush-crypto` (Rust compiled to WASM) for E2EE chat and key distribution. `livekit-client` for voice/video/screen.
- **Backend (Go):** Chi router. Auth, rooms, channels, membership, WebSocket real-time, MLS KeyPackage storage and credential management, LiveKit token endpoint.
- **Database:** PostgreSQL. Messages stored as ciphertext.
- **LiveKit:** SFU for WebRTC media. Frame-level E2EE via Insertable Streams.
- **Caddy:** Reverse proxy and TLS.
- **Desktop (planned):** Tauri + CEF (Rust shell + bundled Chromium, native crypto via IPC).
- **Mobile (planned):** React Native with `hush-crypto` Rust crate via UniFFI.

---

## Tech stack

| Layer | Technology |
|-|-|
| Frontend | React 18, Vite, hush-crypto (WASM), livekit-client |
| E2EE | MLS / RFC 9420 (chat, voice key distribution, metadata), AES-256-GCM (media frames) |
| Backend | Go, Chi |
| Database | PostgreSQL |
| Media SFU | LiveKit |
| Desktop (planned) | Tauri + CEF |
| Mobile (planned) | React Native |
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
- **[docs/](docs/README.md):** Full documentation index: testing, room lifecycle, audit reports.

---

## Contributing

PRs welcome. Open an issue first for large changes.

---

## License

AGPL-3.0. If you modify and deploy, share your changes.
