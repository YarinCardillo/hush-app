# Changelog + Roadmap Integration — Design

Date: 2026-02-23

## Problem

hush has no changelog. The roadmap page shows milestones with task lists but no version history. Users can't see what changed between releases. We also lack a CHANGELOG.md in the repo.

## Solution

Integrate changelog entries (release accordions) into the roadmap page, replacing the current milestone-only view with a combined timeline. Create a single data file that feeds both the React component and a generated CHANGELOG.md.

## Decisions

| Decision | Choice |
|-|-|
| Scroll direction | Newest first (latest changes at top) |
| Future milestones | Collapsed "what's next" accordion at the very top |
| Data source | Single JS file: `client/src/data/changelog.js` |
| Version grouping | v0.5.0, v0.5.1, v0.6.0-alpha, v0.6.1-alpha, v0.6.2-alpha |
| Milestone role | Visual section anchors (non-expandable headers) |
| Release role | Accordion rows with change groups inside |
| CHANGELOG.md | Generated from the data file via script |

## Page structure (top to bottom)

```
Header: wordmark | "roadmap & changelog"
Page title + subtitle + legend

[what's next]  <-- collapsed accordion
  G: Key Backup & Multi-Device   [future]
  F: Desktop & Mobile            [future]
  E: Production & Launch         [planned]
  D: Servers & Channels          [planned]

Milestone C: Signal Protocol + Go Backend  [in progress]
  v0.6.2-alpha  (current)  polish & mobile
  v0.6.1-alpha             stabilization
  v0.6.0-alpha             matrix + livekit migration

Milestone B: End-to-End Encryption  [shipped]
  v0.5.1                   chat & stability

Milestone A: Foundation  [shipped]
  v0.5.0                   initial prototype

Footer: "raw changelog" link -> CHANGELOG.md on GitHub
```

## Data model

`client/src/data/changelog.js` exports two arrays:

```js
export const milestones = [
  { id: 'A', title: 'Foundation', status: 'done',
    summary: 'Core prototype: auth, persistent chat, voice and video rooms.' },
  // ... B through G
];

export const releases = [
  { version: '0.6.2-alpha', date: '2026-02-23', milestone: 'C',
    title: 'polish & mobile', current: true, tags: ['release'],
    groups: [
      { label: 'features', items: ['...'] },
      { label: 'fixes', items: ['...'] },
    ]},
  // ... ordered newest first
];
```

Milestone statuses: `done`, `active`, `planned`, `future`.
Release tags: `release`, `fix`, `security`, `breaking`.

## Component architecture

Roadmap.jsx is rewritten to consume `changelog.js`. No new component files — everything is inline (YAGNI). Structure:

- Page wrapper with overflow management (same as current)
- "What's next" accordion (planned/future milestones, collapsed by default)
- Timeline loop: for each active/done milestone (newest first), render:
  - Milestone header card (non-expandable anchor)
  - Release accordion rows belonging to that milestone
- Footer with raw changelog link

Accordion state managed via `useState` set (multiple releases can be open).

## Styling

Based on the HTML prototype, enforcing design-system.md rules:

- All colors via CSS custom properties
- Sharp corners (radius: 0) everywhere
- Transparent borders on cards
- Sora for UI text, JetBrains Mono for versions/dates/technical data
- Amber accent on "current" release dot (pulsing animation)
- Timeline vertical line on the left with dots per milestone/release
- Dimmed opacity (0.55) for planned/future milestones
- Responsive: single column, works on mobile

## CHANGELOG.md

A Node script (`scripts/generate-changelog.js`) reads the data file and outputs standard Keep a Changelog format to `CHANGELOG.md` at repo root. Run manually after updating the data file.

## Version mapping (from git history)

| Version | Date | Milestone | Theme |
|-|-|-|-|
| v0.5.0 | Feb 11 | A | Initial prototype |
| v0.5.1 | Feb 12 | B | Chat & stability |
| v0.6.0-alpha | Feb 14-17 | B | Matrix + LiveKit migration |
| v0.6.1-alpha | Feb 18-19 | C | Stabilization |
| v0.6.2-alpha | Feb 20-23 | C | Polish & mobile (current) |
