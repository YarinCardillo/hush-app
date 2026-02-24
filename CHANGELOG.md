# Changelog

All notable changes to hush are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [0.6.2-alpha] - 2026-02-23: Signal Protocol + Go Backend (current)

### Features

- Symmetric tile grid with hero layout on mobile and desktop
- Typewriter subtitle animation on home page
- Video quality auto-management based on bandwidth estimation
- End-to-end encrypted badge on home page
- Unwatch card with hero layout and unread badges

### Fixes

- iOS Safari auto-zoom on input focus
- Security headers and CORS origin restriction
- Video container letterbox contrast in light mode
- Logo dot position after late font swap
- Mono audio capture for microphone
- False "secure channel failed" toast from expired token
- Local webcam feed now mirrored horizontally
- Orphan room cleanup for abandoned rooms
- iOS Safari stale dim artifacts after sidebar close

## [0.6.1-alpha] - 2026-02-19: Signal Protocol + Go Backend

### Features

- Auth UX overhaul: guest cleanup, SSO support, invite-only toggle
- Link-only room model with copy-link sharing
- Chat and controls UI refresh
- Dynamic favicon syncing with system theme
- Design system pass across all components

### Fixes

- E2EE critical fixes: AES-256 key length, key retry logic, chat send retry
- Connection epoch guard to prevent StrictMode double-mount race
- Track cleanup and disconnect handling in room components
- Roadmap page styling and interaction refinements

## [0.6.0-alpha] - 2026-02-14: End-to-End Encryption

### Features

- Migrated to Matrix Synapse for auth and room management
- LiveKit SFU replacing mediasoup for media transport
- E2EE via Olm/Megolm with LiveKit Insertable Streams
- Key distribution and leader election for media encryption
- Docker Compose deployment with Caddy reverse proxy

### Security

- Comprehensive E2EE audit with fixes for password-derived keys and UISI handling
- Per-account crypto store prefix to avoid IndexedDB conflicts

## [0.5.1] - 2026-02-12: Foundation

### Features

- Ephemeral text chat within rooms
- Chat message limits and rate limiting
- Screen share card loading state with spinner

### Fixes

- Persisted chat messages for room lifetime
- Removed experimental E2EE infrastructure (unstable in mediasoup)

## [0.5.0] - 2026-02-11: Foundation

### Features

- WebRTC rooms via mediasoup SFU, up to 4 participants
- Quality presets: best (1080p) and lite (720p)
- Noise gate AudioWorklet for mic processing
- iOS Safari compatibility fixes for remote streams
- Logo wordmark with animated orange dot
- Click-to-watch for remote screen shares
- Fullscreen support and mobile layout
- Server status indicator on home page
