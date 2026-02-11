# Hush

**Stream without limits. Privacy by default.**

High-quality screen sharing with no artificial resolution caps. Open source, self-hostable, privacy-first. Built where others lock 1080p behind a paywall.

---

## What is this?

Hush is a web-based screen sharing tool that lets you stream your screen to friends at full quality — 1080p, 1440p, 4K, whatever your connection can handle. No account required. No tracking. No bullshit.

**Features:**
- Screen sharing at any resolution/framerate your connection supports
- Webcam and microphone support
- Switch windows/screens on the fly without disconnecting
- Automatic quality recommendation based on your upload speed
- Password-protected rooms
- Self-hostable with a single `docker-compose up`
- Transparent server capacity — you always know what's available

**Privacy model:**
- DTLS/SRTP encryption on all WebRTC traffic (automatic, built into browser)
- SFU server never decodes media — only forwards encrypted packets
- Self-host it and trust no one but yourself
- No tracking, zero analytics, zero ads

---

## How it works — Free vs Supporter vs Self-host

Hush is and will always be **free and open source**. The hosted instance at gethush.live has resource limits because servers cost money. Here's how it breaks down:

| | Free | Supporter (3-5€/mo) | Self-host |
|---|---|---|---|
| Account required | No | Yes | No |
| Rooms | Temporary (die when empty) | Persistent | Your choice |
| Max participants | 4 | 10 | Unlimited |
| Screen shares | 1 per room | 3 per room | Unlimited |
| Max quality | 1080p | No limit (4K+) | No limit |
| Cost | Free | 3-5€/month | Free (you pay hosting) |

**Important:** When the free pool is full, it means the allocated server resources for free rooms are genuinely exhausted. Supporter rooms use a separate, dedicated resource pool — not the same capacity. This isn't a fake paywall; it's real resource allocation. The code is open source — [verify it yourself](server/src/rooms/resourcePool.js).

### Resource transparency

Every Hush instance exposes a public `/api/status` endpoint showing real-time capacity:

```json
{
  "pools": {
    "free": { "active": 8, "max": 30, "available": 22 },
    "supporter": { "active": 3, "max": 15, "available": 12 },
    "total": { "active": 11, "capacity": 45, "utilizationPercent": 24 }
  },
  "allocation": {
    "freePercent": 60,
    "supporterPercent": 30,
    "reservePercent": 10
  }
}
```

Self-hosters can set `FREE_POOL_PERCENT=100` to disable tiers entirely and make everything free.

---

## Quick Start

### Self-hosting (Docker)

```bash
git clone https://github.com/hush-app/hush.git
cd hush
cp .env.example .env
# Edit .env — set JWT_SECRET and ANNOUNCED_IP (your server's public IP)
docker-compose up --build
```

Open `http://your-server-ip:3001` in your browser.

### Local Development

```bash
# Install all dependencies
npm run install:all

# Start both server and client in dev mode
npm run dev
```

Server runs on `http://localhost:3001`, client on `http://localhost:5173`.

### Production Notes

- **HTTPS is required** for `getDisplayMedia()` to work in browsers. Use a reverse proxy (nginx/Caddy) with Let's Encrypt.
- **Set `ANNOUNCED_IP`** to your server's public IP in `.env`.
- **Open ports 40000-40100 UDP/TCP** in your firewall for WebRTC media.
- **TURN server**: For users behind strict NATs, you'll need a TURN server. Install [coturn](https://github.com/coturn/coturn) on the same or a separate VPS.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Client                      │
│  React + mediasoup-client + Web Crypto API   │
│                                              │
│  ┌──────────┐ ┌───────────┐ ┌────────────┐  │
│  │ Screen   │ │ Webcam    │ │ Microphone │  │
│  │ Capture  │ │ Capture   │ │ Capture    │  │
│  └────┬─────┘ └─────┬─────┘ └─────┬──────┘  │
│       │              │              │         │
│       └──────────────┼──────────────┘         │
│                      │                        │
│           ┌──────────┴──────────┐             │
│           │ WebRTC Transport    │             │
│           │ (DTLS/SRTP)         │             │
│           └──────────┬──────────┘             │
└──────────────────────┼────────────────────────┘
                       │
              Encrypted media
                       │
┌──────────────────────┼────────────────────────┐
│               Server (Node.js)                │
│                      │                        │
│  ┌───────────────────┴────────────────────┐   │
│  │          Resource Pool Manager          │   │
│  │  ┌─────────┐ ┌────────────┐ ┌───────┐  │   │
│  │  │  Free   │ │ Supporter  │ │Reserve│  │   │
│  │  │  60%    │ │   30%      │ │  10%  │  │   │
│  │  └─────────┘ └────────────┘ └───────┘  │   │
│  └────────────────────────────────────────┘   │
│                      │                        │
│           ┌──────────┴──────────┐             │
│           │ mediasoup SFU       │             │
│           │ (forward encrypted  │             │
│           │  RTP packets)       │             │
│           └──────────┬──────────┘             │
│                      │                        │
│           ┌──────────┴──────────┐             │
│           │ Socket.io Signaling │             │
│           │ + Room Management   │             │
│           │ + JWT Auth          │             │
│           └─────────────────────┘             │
└───────────────────────────────────────────────┘
```

---

## Configuration (Self-hosters)

All configuration via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `TOTAL_MAX_ROOMS` | 50 | Total concurrent rooms across all tiers |
| `FREE_POOL_PERCENT` | 60 | % of capacity allocated to free tier |
| `SUPPORTER_POOL_PERCENT` | 30 | % of capacity for supporters |
| `FREE_MAX_PARTICIPANTS` | 4 | Max people per free room |
| `SUPPORTER_MAX_PARTICIPANTS` | 10 | Max people per supporter room |
| `FREE_MAX_BITRATE` | 4500000 | Bitrate cap for free (1080p) |
| `SUPPORTER_MAX_BITRATE` | 15000000 | Bitrate cap for supporters (4K) |

**Want no tiers?** Set `FREE_POOL_PERCENT=100` and all rooms are free with no limits.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 18 + Vite |
| Media Engine | mediasoup (SFU) |
| Signaling | Socket.io |
| Auth | bcrypt + JWT |
| Encryption | DTLS/SRTP (WebRTC built-in) |
| Resource mgmt | Custom pool allocator |
| Containerization | Docker |

---

## Browser Support

| Feature | Chrome/Edge | Firefox | Safari |
|---------|:-----------:|:-------:|:------:|
| Screen sharing | Yes | Yes | Desktop only |
| System audio capture | Yes (Win/ChromeOS) | No | No |
| Webcam/Mic | Yes | Yes | Yes |

---

## Roadmap

- [ ] TURN server integration (coturn)
- [ ] Stripe/LemonSqueezy supporter payments
- [ ] Persistent rooms for supporters
- [ ] Text chat per room
- [ ] Recording (local, client-side)
- [ ] Mobile-optimized UI
- [ ] Room invitations via link
- [ ] Admin controls (kick, mute)
- [ ] Simulcast for adaptive quality per viewer
- [ ] End-to-end encryption (WebRTC Encoded Transform)

---

## Contributing

PRs welcome. Please open an issue first if you're planning a large change.

---

## License

AGPL-3.0 — If you modify and deploy this, share your changes.
