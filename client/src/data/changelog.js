/**
 * Changelog data: single source of truth for the Roadmap page and CHANGELOG.md.
 *
 * Milestones are ordered A-G chronologically.
 * Releases are ordered newest-first.
 */

export const milestones = [
  {
    id: 'A',
    title: 'Foundation',
    status: 'done',
    summary:
      'Core prototype: auth, persistent chat, voice and video rooms.',
  },
  {
    id: 'B',
    title: 'End-to-End Encryption',
    status: 'done',
    summary:
      'E2EE on everything: chat messages, voice, video, and screen sharing.',
  },
  {
    id: 'C',
    title: 'Signal Protocol + Go Backend',
    status: 'done',
    summary:
      'Go backend with Signal Protocol (X3DH + Double Ratchet) via hush-crypto WASM. Matrix fully removed.',
  },
  {
    id: 'D',
    title: 'Servers & Channels',
    status: 'active',
    summary:
      'Discord-like community structure. Servers, text and voice channels, categories, invites, drag-and-drop reordering.',
  },
  {
    id: 'E',
    title: 'Production & Launch',
    status: 'planned',
    summary:
      'Moderation tools, rate limiting, security hardening. Self-hosting in under 10 minutes.',
  },
  {
    id: 'F',
    title: 'Desktop & Mobile',
    status: 'future',
    summary: 'Native apps with the same E2EE guarantees.',
  },
  {
    id: 'G',
    title: 'Key Backup & Multi-Device',
    status: 'future',
    summary:
      'Losing a device no longer means losing chat history.',
  },
];

export const releases = [
  {
    version: '0.7.0-alpha',
    date: '2026-03-03',
    milestone: 'D',
    title: 'core rewrite',
    current: true,
    tags: ['release', 'architecture'],
    groups: [
      {
        label: 'architecture',
        items: [
          'Go backend replacing Node.js/Matrix for auth, API, and WebSocket presence',
          'Signal Protocol (X3DH + Double Ratchet) via hush-crypto Rust crate compiled to WASM',
          'WebSocket message routing with per-recipient fan-out encryption',
          'LiveKit E2EE key distribution via Signal sessions instead of Matrix',
          'Encrypted message store in IndexedDB with per-session crypto keys',
          'Matrix/Synapse fully removed from codebase',
        ],
      },
      {
        label: 'features',
        items: [
          'Server and channel management with text, voice, and category types',
          'Invite link generation and join flow',
          'Drag-and-drop channel and category reordering with server-side persistence',
          'Member list with real-time WebSocket presence',
          'Server settings: rename, leave, delete with ownership transfer',
          'Resizable sidebar with persistent width',
          'Collapsible categories with persistent state per server',
          'Status indicators for voice channels and empty states',
          'Server-authoritative voice state via LiveKit webhooks',
        ],
      },
      {
        label: 'infrastructure',
        items: [
          'Client Dockerfile with multi-stage WASM build pipeline',
          'Real-time WebSocket broadcasts for all server mutations',
          'libsignal-dezire security patches (panic DoS, zeroization) with 30 interop tests',
          'Setup script and environment configuration for self-hosting',
        ],
      },
      {
        label: 'fixes',
        items: [
          'Chat shows member display names instead of truncated UUIDs',
          'WebSocket reconnection stability and React StrictMode compatibility',
          'Theme mode separated from theme variant selection',
          'Channel and category drag-and-drop position persistence',
        ],
      },
    ],
  },
  {
    version: '0.6.2-alpha',
    date: '2026-02-23',
    milestone: 'C',
    title: 'polish & mobile',
    tags: ['release'],
    groups: [
      {
        label: 'features',
        items: [
          'Symmetric tile grid with hero layout on mobile and desktop',
          'Typewriter subtitle animation on home page',
          'Video quality auto-management based on bandwidth estimation',
          'End-to-end encrypted badge on home page',
          'Unwatch card with hero layout and unread badges',
        ],
      },
      {
        label: 'fixes',
        items: [
          'iOS Safari auto-zoom on input focus',
          'Security headers and CORS origin restriction',
          'Video container letterbox contrast in light mode',
          'Logo dot position after late font swap',
          'Mono audio capture for microphone',
          'False "secure channel failed" toast from expired token',
          'Local webcam feed now mirrored horizontally',
          'Orphan room cleanup for abandoned rooms',
          'iOS Safari stale dim artifacts after sidebar close',
        ],
      },
    ],
  },
  {
    version: '0.6.1-alpha',
    date: '2026-02-19',
    milestone: 'C',
    title: 'stabilization',
    tags: ['fix'],
    groups: [
      {
        label: 'features',
        items: [
          'Auth UX overhaul: guest cleanup, SSO support, invite-only toggle',
          'Link-only room model with copy-link sharing',
          'Chat and controls UI refresh',
          'Dynamic favicon syncing with system theme',
          'Design system pass across all components',
        ],
      },
      {
        label: 'fixes',
        items: [
          'E2EE critical fixes: AES-256 key length, key retry logic, chat send retry',
          'Connection epoch guard to prevent StrictMode double-mount race',
          'Track cleanup and disconnect handling in room components',
          'Roadmap page styling and interaction refinements',
        ],
      },
    ],
  },
  {
    version: '0.6.0-alpha',
    date: '2026-02-14',
    milestone: 'B',
    title: 'matrix + livekit migration',
    tags: ['release', 'security'],
    groups: [
      {
        label: 'features',
        items: [
          'Migrated to Matrix Synapse for auth and room management',
          'LiveKit SFU replacing mediasoup for media transport',
          'E2EE via Olm/Megolm with LiveKit Insertable Streams',
          'Key distribution and leader election for media encryption',
          'Docker Compose deployment with Caddy reverse proxy',
        ],
      },
      {
        label: 'security',
        items: [
          'Comprehensive E2EE audit with fixes for password-derived keys and UISI handling',
          'Per-account crypto store prefix to avoid IndexedDB conflicts',
        ],
      },
    ],
  },
  {
    version: '0.5.1',
    date: '2026-02-12',
    milestone: 'A',
    title: 'chat & stability',
    tags: ['fix'],
    groups: [
      {
        label: 'features',
        items: [
          'Ephemeral text chat within rooms',
          'Chat message limits and rate limiting',
          'Screen share card loading state with spinner',
        ],
      },
      {
        label: 'fixes',
        items: [
          'Persisted chat messages for room lifetime',
          'Removed experimental E2EE infrastructure (unstable in mediasoup)',
        ],
      },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-02-11',
    milestone: 'A',
    title: 'initial prototype',
    tags: ['release'],
    groups: [
      {
        label: 'features',
        items: [
          'WebRTC rooms via mediasoup SFU, up to 4 participants',
          'Quality presets: best (1080p) and lite (720p)',
          'Noise gate AudioWorklet for mic processing',
          'iOS Safari compatibility fixes for remote streams',
          'Logo wordmark with animated orange dot',
          'Click-to-watch for remote screen shares',
          'Fullscreen support and mobile layout',
          'Server status indicator on home page',
        ],
      },
    ],
  },
];
