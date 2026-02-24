# Changelog + Roadmap Integration: Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current roadmap-only page with an integrated changelog + roadmap timeline, and create a CHANGELOG.md for the repo.

**Architecture:** A single data file (`client/src/data/changelog.js`) serves as source of truth for milestones and releases. The `Roadmap.jsx` page is rewritten to render this data as a newest-first timeline with milestone anchors, release accordions, and a collapsed "what's next" section. A Node script generates CHANGELOG.md from the same data.

**Tech Stack:** React 18, CSS-in-JS (template string injected via `<style>`), Node.js script for CHANGELOG generation.

**Design doc:** `docs/plans/2026-02-23-changelog-roadmap-design.md`

**Key reference files:**
- Current roadmap: `client/src/pages/Roadmap.jsx`
- HTML prototype: `/Users/yarin/development/roadmap-changelog.html`
- Design system: `design-system.md`
- App router: `client/src/App.jsx:134` (`/roadmap` route)
- Version constant: `client/src/utils/constants.js:6` (`APP_VERSION`)

---

### Task 1: Create the changelog data file

**Files:**
- Create: `client/src/data/changelog.js`

**Step 1: Create the data directory**

```bash
mkdir -p client/src/data
```

**Step 2: Write the changelog data file**

Create `client/src/data/changelog.js` with the complete milestone and release data derived from the git history. This is the single source of truth for both the React component and CHANGELOG.md.

```js
/**
 * Changelog data: single source of truth.
 *
 * Milestones: visual anchors on the timeline.
 * Releases: accordion entries, each belonging to a milestone.
 *
 * Milestone statuses: done | active | planned | future
 * Release tags: release | fix | security | breaking
 *
 * Releases are ordered newest-first.
 * Milestones are ordered A-G (chronological). The component reverses for display.
 */

export const milestones = [
  {
    id: 'A',
    title: 'Foundation',
    status: 'done',
    summary: 'Core prototype: auth, persistent chat, voice and video rooms.',
  },
  {
    id: 'B',
    title: 'End-to-End Encryption',
    status: 'done',
    summary: 'E2EE on everything: chat messages, voice, video, and screen sharing.',
  },
  {
    id: 'C',
    title: 'Signal Protocol + Go Backend',
    status: 'active',
    summary: 'Replacing the crypto and backend with battle-tested Signal Protocol and a purpose-built Go server.',
  },
  {
    id: 'D',
    title: 'Servers & Channels',
    status: 'planned',
    summary: 'Discord-like community structure. Servers, text and voice channels, invites, and moderation.',
  },
  {
    id: 'E',
    title: 'Production & Launch',
    status: 'planned',
    summary: 'Self-hosting in under 10 minutes. Managed hosting for communities. Public launch.',
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
    summary: 'Losing a device no longer means losing chat history.',
  },
];

export const releases = [
  {
    version: '0.6.2-alpha',
    date: '2026-02-23',
    milestone: 'C',
    title: 'polish & mobile',
    current: true,
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
```

**Step 3: Verify the file imports cleanly**

```bash
cd client && node -e "import('./src/data/changelog.js').then(m => { console.log(m.milestones.length, 'milestones'); console.log(m.releases.length, 'releases'); })"
```

Expected: `7 milestones` and `5 releases` printed.

**Step 4: Commit**

```bash
git add client/src/data/changelog.js
git commit -m "feat: add changelog data file, single source of truth for roadmap + changelog"
```

---

### Task 2: Rewrite Roadmap.jsx

**Files:**
- Modify: `client/src/pages/Roadmap.jsx` (full rewrite)

**Step 1: Write the new Roadmap component**

Rewrite `client/src/pages/Roadmap.jsx` to consume the changelog data and render the integrated timeline. The component structure:

1. Import `milestones` and `releases` from `../data/changelog.js`
2. Compute `shippedMilestones` (active/done, reversed for newest-first) and `upcomingMilestones` (planned/future, reversed so nearest planned is last = bottom of the upcoming section, furthest future is first = top)
3. For each shipped milestone, filter its releases from the releases array
4. Render: page header, legend, "what's next" accordion, timeline with milestones + releases, footer

Key implementation details:

**Accordion state:** `useState` with a `Set` of open release versions. Toggle adds/removes from set. The "what's next" section uses a separate `useState(false)` boolean.

**Status config:**

```js
const STATUS = {
  done:    { label: 'shipped',     color: 'var(--hush-live)',        bg: 'var(--hush-live-glow)' },
  active:  { label: 'in progress', color: 'var(--hush-amber)',       bg: 'var(--hush-amber-ghost)' },
  planned: { label: 'planned',     color: 'var(--hush-text-muted)',  bg: 'var(--hush-elevated)' },
  future:  { label: 'future',      color: 'var(--hush-text-ghost)',  bg: 'var(--hush-elevated)' },
};
```

**Tag config:**

```js
const TAG_STYLE = {
  release:  { color: 'var(--hush-amber)',  bg: 'var(--hush-amber-ghost)' },
  fix:      { color: 'var(--hush-live)',    bg: 'var(--hush-live-glow)' },
  security: { color: 'var(--hush-danger)',  bg: 'var(--hush-danger-ghost)' },
  breaking: { color: 'var(--hush-danger)',  bg: 'var(--hush-danger-ghost)' },
};
```

**CSS:** Inject via `<style>{styles}</style>` (same pattern as current). The CSS is adapted from the HTML prototype (`/Users/yarin/development/roadmap-changelog.html`) with these design-system enforcements:
- All hex colors replaced with CSS variable references
- `border-radius: 0` everywhere (no rounded corners)
- `border: 1px solid transparent` on cards (no visible borders)
- Font sizes use `rem` from the design system scale
- Animations: only `hush-pulse` for the current release dot, `fade-up` for entry animation
- The timeline vertical line uses `var(--hush-border)` color

**Responsive:** At `max-width: 520px`, reduce padding and font sizes. The timeline left-padding shrinks from 36px to 28px.

**Overflow management:** Keep the same `useEffect` that sets `overflow: auto` and `height: auto` on html/body/root (lines 457-484 of current file).

The full CSS and JSX should be written in one step. Reference the HTML prototype for the exact class names and layout structure, but adapt all styling to use CSS variables per the design system.

**Step 2: Verify it renders**

```bash
cd client && npm run dev
```

Open `http://localhost:5173/roadmap` in a browser. Verify:
- Page loads without console errors
- "what's next" accordion is collapsed, shows milestone count
- Clicking it reveals future milestones in reverse order (G at top, D at bottom)
- Latest release (v0.6.2-alpha) is visible immediately with "current" pill and amber pulsing dot
- Clicking a release row expands its change groups
- Milestone headers are non-expandable visual anchors
- Timeline line and dots render correctly on the left
- Scroll down reveals older releases and milestones
- Footer shows "raw changelog" link

**Step 3: Commit**

```bash
git add client/src/pages/Roadmap.jsx
git commit -m "feat: rewrite roadmap page with integrated changelog timeline"
```

---

### Task 3: Generate CHANGELOG.md

**Files:**
- Create: `scripts/generate-changelog.js`
- Create: `CHANGELOG.md` (generated output)

**Step 1: Write the generator script**

Create `scripts/generate-changelog.js`:

```js
#!/usr/bin/env node

/**
 * Generates CHANGELOG.md from client/src/data/changelog.js.
 * Run: node scripts/generate-changelog.js
 */

import { milestones, releases } from '../client/src/data/changelog.js';

const lines = [
  '# Changelog',
  '',
  'All notable changes to hush are documented here.',
  '',
  'Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)',
  '',
];

for (const release of releases) {
  const milestone = milestones.find((m) => m.id === release.milestone);
  const milestoneLabel = milestone ? `: ${milestone.title}` : '';
  const currentTag = release.current ? ' (current)' : '';

  lines.push(`## [${release.version}] - ${release.date}${milestoneLabel}${currentTag}`);
  lines.push('');

  for (const group of release.groups) {
    const heading = group.label.charAt(0).toUpperCase() + group.label.slice(1);
    lines.push(`### ${heading}`);
    lines.push('');
    for (const item of group.items) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }
}

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'CHANGELOG.md');
writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(`Written to ${outPath}`);
```

**Step 2: Run the script**

```bash
node scripts/generate-changelog.js
```

Expected: `Written to /Users/yarin/development/hush-app/CHANGELOG.md`

**Step 3: Verify the output**

Read `CHANGELOG.md` and confirm it has all 5 releases with proper formatting.

**Step 4: Commit**

```bash
git add scripts/generate-changelog.js CHANGELOG.md
git commit -m "feat: add CHANGELOG.md and generation script from changelog data"
```

---

### Task 4: Visual review and polish

**Files:**
- Modify: `client/src/pages/Roadmap.jsx` (adjustments)
- Modify: `client/src/data/changelog.js` (text tweaks if needed)

**Step 1: Browser review**

Open `http://localhost:5173/roadmap` and check against the HTML prototype (`/Users/yarin/development/roadmap-changelog.html`):

- [ ] Timeline line alignment matches prototype
- [ ] Milestone dot sizes and colors match design system
- [ ] Release accordion toggle animation is smooth
- [ ] "current" pill and amber dot pulse look correct
- [ ] Change group labels have the separator line after them
- [ ] Change items use em-dash prefix
- [ ] Code blocks inside change items use JetBrains Mono
- [ ] Page is readable on mobile (test with responsive mode at 375px width)
- [ ] "what's next" accordion expand/collapse works cleanly
- [ ] Back link ("Hush") returns to home page
- [ ] No horizontal overflow on any viewport size

**Step 2: Fix any issues found**

Apply CSS or data tweaks as needed.

**Step 3: Commit**

```bash
git add client/src/pages/Roadmap.jsx client/src/data/changelog.js
git commit -m "fix: polish changelog-roadmap layout and styling"
```

---

### Task 5: Update footer link in Roadmap

**Files:**
- Modify: `client/src/pages/Roadmap.jsx` (footer section)

**Step 1: Update the footer**

The footer should have:
- Left: "hush is open source and self-hostable."
- Right: "github" link to `https://github.com/YarinCardillo/hush-app` and "raw changelog" link to `https://github.com/YarinCardillo/hush-app/blob/main/CHANGELOG.md`

Verify the links point to the correct URLs.

**Step 2: Commit**

```bash
git add client/src/pages/Roadmap.jsx
git commit -m "fix: update roadmap footer links to GitHub and raw changelog"
```

---

## Summary

| Task | Creates/Modifies | Purpose |
|-|-|-|
| 1 | `client/src/data/changelog.js` | Single source of truth |
| 2 | `client/src/pages/Roadmap.jsx` | Full page rewrite |
| 3 | `scripts/generate-changelog.js`, `CHANGELOG.md` | Generated changelog for repo |
| 4 | Roadmap.jsx, changelog.js | Visual polish pass |
| 5 | Roadmap.jsx footer | Correct footer links |

Total: 3 new files, 1 rewritten file, 1 generated file.
