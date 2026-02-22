# Security

This document describes Hush's end-to-end encryption (E2EE) implementation, trust model, HTTP security posture, and known limitations.

**External audit:** A third-party scan (SafeToShip) was run against gethush.live; findings are addressed in this doc and in the Caddy/Env configuration. See [Production checklist](#production-checklist) and [HTTP security headers](#http-security-headers).

## Encryption algorithms

| Layer | Algorithm | Purpose |
|-|-|-|
| Key agreement | X3DH (Extended Triple Diffie-Hellman) | Initial session establishment between two devices |
| Chat messages | Double Ratchet (Signal Protocol) | Per-message encryption with forward secrecy |
| Group chat key distribution | Pairwise Signal sessions | Symmetric key distributed via encrypted 1:1 channels |
| Media frames | AES-256-GCM via Insertable Streams | Frame-level encryption for voice, video, and screen share |

## Chat encryption

**Protocol**: Signal Protocol via `libsignal-protocol-typescript` (web) and `hush-crypto` Rust crate (desktop/mobile).

**Session establishment**:
1. On registration, client generates: identity key pair, signed pre-key, batch of one-time pre-keys
2. Keys uploaded to Go backend pre-key server (`POST /api/keys/upload`)
3. To message a new contact: fetch their pre-key bundle (`GET /api/keys/:userId`), perform X3DH handshake
4. Subsequent messages use Double Ratchet — each message has a unique key, compromising one does not reveal others

**Group messaging**:
- Small groups (< 50 members): fan-out encryption — each message individually encrypted per recipient via their Signal session
- Large channels: shared symmetric key rotated on membership change, distributed via pairwise Signal sessions

**Forward secrecy**: The Double Ratchet provides forward secrecy at the message level. Compromising a device's current state does not reveal previously decrypted messages (assuming local storage is secure).

**Storage**: Signal Protocol state (identity keys, session states, pre-keys) persisted in IndexedDB, prefixed per user: `hush-signal-${userId}-${deviceId}`.

## Media encryption

**Protocol**: WebRTC media streams (voice, video, screen share) are encrypted using LiveKit's Insertable Streams with AES-256-GCM. The SFU forwards encrypted frames without access to plaintext.

**Key generation**: The room leader generates a random 256-bit key using `crypto.getRandomValues(new Uint8Array(32))`.

**Key distribution**: Frame keys are distributed via Signal Protocol sessions over WebSocket:
1. Leader generates AES-256-GCM key
2. Key encrypted via Signal session to each participant, sent as `media.key` WebSocket message
3. Participants decrypt the frame key using their Signal session and apply it to `ExternalE2EEKeyProvider`
4. LiveKit E2EE worker encrypts/decrypts media frames using the shared key

**Key rotation (rekeying)**: When a participant leaves, the leader generates a new key and distributes it to all remaining participants. This provides forward secrecy for media — a departed participant cannot decrypt future frames.

**Leader election**: Deterministic — the participant with the lowest user ID. On leader disconnect, next lowest takes over, generates a new key, and distributes.

**No silent degradation**: If the E2EE worker fails to load or key exchange fails after 3 retry attempts (exponential backoff: 1s, 2s, 4s), the client does NOT connect to LiveKit. Media without encryption is never permitted.

## Trust model

- **Trust on first use (TOFU)**: Devices are trusted when first seen. There is no in-app device verification yet (no Safety Numbers comparison, no QR scan). Users must rely on out-of-band verification to confirm a device.
- **Pre-key server trust**: The Go backend stores public pre-keys. A compromised server could serve malicious pre-keys (MITM). This is mitigated in a future milestone by Safety Numbers verification (Signal's identity key fingerprint comparison).

## Server behavior

The server never sees plaintext for chat or media:
- **Chat**: Messages stored as ciphertext blobs in PostgreSQL. The server routes them by channel ID without decryption.
- **Media**: LiveKit SFU forwards encrypted frames. Frame keys are never sent to the server — they travel via Signal-encrypted WebSocket messages between clients.
- **LiveKit tokens**: The Go backend validates the user's JWT and issues a LiveKit access token. It does not check room-level permissions beyond membership (enforced at the application layer).

## Browser support

| Browser | Chat E2EE (Signal Protocol) | Media E2EE (LiveKit) |
|-|-|-|
| Chromium (Chrome, Edge, Brave, Arc) | Full | Full (Insertable Streams) |
| Firefox | Full | Partial (Insertable Streams support varies) |
| Safari | Full | Limited (Insertable Streams / E2EE worker limitations) |

Full media E2EE requires Insertable Streams and the LiveKit E2EE worker. If the worker fails to load, the app blocks media entirely and shows "Media encryption unavailable."

## Known limitations

- **No device verification UI** — Planned for a future milestone. Users cannot verify identity keys in-app. MITM by a compromised pre-key server is theoretically possible until Safety Numbers are implemented.
- **No key backup** — Losing browser data (clearing IndexedDB) means losing the ability to decrypt past chat history and losing Signal session state. Planned: encrypted key backup with user passphrase.
- **No multi-device** — Signal Protocol sessions are per-device. A user logged in on two devices has two separate sets of sessions. Planned: multi-device sync via encrypted key transfer.
- **No cross-signing** — Verification does not propagate across devices.
- **Guest accounts** — Share the same TOFU trust model as registered accounts. Guest sessions are temporary; keys are lost when the session ends.
- **WebCrypto nonce management** — AES-GCM frame encryption uses a counter-based nonce. Nonce reuse with the same key would break confidentiality. The implementation must ensure counters never repeat (even across page reloads within the same key lifecycle).

## HTTP security headers

Security headers can be set either at the **Caddy reverse proxy** (origin) or at **Cloudflare** (edge), if the site is behind Cloudflare. Prefer one place to avoid duplication.

### Option A: Caddy (origin)

The app’s Caddy config sets the following headers on all site responses. This is the **default**: even when using Cloudflare, Caddy sends these so scanners and clients always see them (Cloudflare may also set them; duplicate is harmless).

| Header | Purpose | Where |
|-|-|-|
| `X-Content-Type-Options: nosniff` | Disable MIME sniffing | Caddy (all site responses) |
| `X-Frame-Options: DENY` | Mitigate clickjacking | Caddy |
| `Cross-Origin-Opener-Policy: same-origin` | Required for LiveKit E2EE worker (`SharedArrayBuffer`) | Caddy |
| `Cross-Origin-Embedder-Policy: require-corp` | Required for LiveKit E2EE worker | Caddy |
| `Strict-Transport-Security` | HSTS (HTTPS only) | Caddy **production** only — see `caddy/Caddyfile.prod` |

- **Local dev** (`caddy/Caddyfile`): `http://localhost` with the above headers; no HSTS (HTTP only).
- **Production** (`caddy/Caddyfile.prod`): HTTPS site block with HSTS. Use when deploying without Cloudflare or when you want headers at origin.

### Option B: Cloudflare (edge)

If the site is **behind Cloudflare**, you can configure the same headers at the edge. Then you can rely on Caddy only for routing; headers are added by Cloudflare before the response reaches the browser.

| Item | Where in Cloudflare |
|-|-|
| **X-Content-Type-Options**, **X-Frame-Options**, **COOP**, **COEP** | **Rules** → **Transform Rules** → **Modify response header**: add each header. **Exclude the LiveKit path** so the WebSocket upgrade is not modified: expression `(http.host eq "gethush.live" and not starts_with(http.request.uri.path, "/livekit"))`. Otherwise the room connection can drop right after join. |
| **HSTS** | **SSL/TLS** → **Edge Certificates** → **HTTP Strict Transport Security (HSTS)** → Enable, set max-age (e.g. 12 months), enable “Include subdomains” and “No-Sniff” if offered; add to preload list if desired. |

- **CORS:** Cloudflare does not provide a simple UI to set a fixed `Access-Control-Allow-Origin` per path. To restrict CORS at the edge you’d use a **Worker** that checks the request `Origin` against an allowlist and sets the response header. Otherwise, keep CORS at the origin (Caddy + Express with `CORS_ORIGIN`).
- **SPF:** If DNS is on Cloudflare, add the SPF TXT record under **DNS** → **Records** for your domain (not “in Cloudflare” as proxy — it’s DNS).

Using Cloudflare for headers: Caddy already sends X-Content-Type-Options, X-Frame-Options, COOP, and COEP at origin, so the scanner and clients always receive them. You can keep or remove the same headers from Cloudflare Transform Rules (same value in both is fine). Ensure COOP/COEP remain sent for the app’s hostname so the LiveKit E2EE worker and `SharedArrayBuffer` keep working.

## Input validation

API request body fields are validated server-side. Rules are implemented in `server/src/validation.js` and enforced in `server/src/index.js`.

| Field | Endpoint | Rule |
|-|-|-|
| `roomName` | `POST /api/livekit/token`, `POST /api/rooms/created` | Non-empty string, pattern `[a-zA-Z0-9._=-]+`, max 256 chars. Matches client room/join alias local part. |
| `participantName` | `POST /api/livekit/token` | Optional; trimmed; max 128 chars; no control characters. Default `Participant` if empty. |
| `roomId` | `POST /api/rooms/delete-if-empty`, `POST /api/rooms/created` | Matrix room ID format `!opaque:server`, max 255 chars. |
| `createdAt` | `POST /api/rooms/created` | Number (ms); must be within the last 24 hours and not in the future. |

Chat message content is handled by the client (trimmed) and by Matrix/Synapse; the future Go backend will define message length and sanitization policy (no HTML/script injection).

## CORS

- **Development:** Default `CORS_ORIGIN` is `*` (or `http://localhost:5173` for the Node server) so the Matrix client and API can be used from any origin.
- **Production:** Set `CORS_ORIGIN` to the exact frontend origin (e.g. `https://gethush.live`) in your environment. Both the Hush server and Caddy (for `/_matrix/*`) use this value. See `.env.example` and `docker-compose.prod.yml`.

## Production checklist

Before going live (e.g. gethush.live), complete the following. None are in-repo; they are deployment and DNS steps.

| Item | Action |
|-|-|
| **CORS** | Set `CORS_ORIGIN` to your frontend origin (e.g. `https://gethush.live`) in the hosting env. Do not use `*` in production. (Optional: enforce at edge with a Cloudflare Worker.) |
| **HSTS** | Either use `caddy/Caddyfile.prod` so Caddy sends `Strict-Transport-Security`, or enable HSTS in **Cloudflare** → SSL/TLS → Edge Certificates → HSTS. |
| **Security headers** | Either set at origin (Caddy; see [HTTP security headers](#http-security-headers)) or at edge: **Cloudflare** → Rules → Transform Rules → Modify response header (X-Content-Type-Options, X-Frame-Options, COOP, COEP). |
| **SPF (DNS)** | Add a TXT SPF record for the domain you send email from. If DNS is on Cloudflare: **DNS** → Records → add TXT (e.g. `v=spf1 include:_spf.example.com -all`). |
| **Secrets** | Do not use default or example secrets. Set strong `LIVEKIT_API_SECRET`, `SYNAPSE_ADMIN_TOKEN`, and (when applicable) `JWT_SECRET` from the hosting platform. |
| **COOP/COEP** | Required for LiveKit E2EE worker (`SharedArrayBuffer`). Either in Caddy (Caddyfile.prod) or in Cloudflare Transform Rules. Ensure they are sent for your app hostname. |
| **Dependencies** | Run `npm audit` in root, `client/`, and `server/` before production. Address high/critical; document or fix moderate/low. See [Dependencies](#dependencies). |

## Dependencies

- **npm:** Run `npm audit` (and optionally `npm audit fix`) in the repo root, `client/`, and `server/`. Before production, resolve or document high/critical vulnerabilities; moderate/low should be fixed when a non-breaking fix is available. Dev-only tools (e.g. Vite dev server) may have advisories that do not affect production builds; document exceptions.
- **Rust (if present):** If the repo includes Rust crates (e.g. `hush-crypto`), run `cargo audit` and apply the same policy (high/critical before production).
- **Secrets:** Do not use `.env.example` or default values (e.g. `devsecret`, `changeme`, `synapse_password`) in production. Set all secrets from the hosting platform or a secure secret store. See [Production checklist](#production-checklist).

## Rate limiting (recommended before production)

Sensitive endpoints are not rate-limited by default. Before production go-live, consider adding rate limiting (e.g. `express-rate-limit` or equivalent at the reverse proxy) for:

- `POST /api/livekit/token` — limit per IP (and optionally per authenticated user) to prevent token abuse.
- `POST /api/rooms/created` and `GET /api/rooms/can-create` — limit per IP to prevent room-creation abuse.

Policy: e.g. a few hundred requests per minute per IP for token, and a lower cap for room creation. Document the chosen limits in this section or in deployment runbooks.

## Content-Security-Policy (optional)

A `Content-Security-Policy` (CSP) header can reduce XSS impact. It is not required by SafeToShip but is recommended as a follow-up. If you add CSP:

1. Start with `Content-Security-Policy-Report-Only` and a report URI to avoid breaking the app.
2. Allow script sources for the app, Vite HMR (if used in dev), LiveKit, and any E2EE worker origins.
3. Switch to enforcing CSP once the policy is validated.

Caddy can set CSP in the same site block as the other security headers. Document the final directive in this section.
