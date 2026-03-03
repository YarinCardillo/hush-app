# HushOrb — Design System Alignment

**Date:** 2026-03-01
**Status:** Approved, ready for implementation

## Problem

HushOrb uses golden/amber tones (#a06820, #fbb040, #ffd580) that don't exist in the Hush
design system. The actual brand accent is orange #d54f12 (`--hush-amber`). The orb feels
disconnected from the rest of the UI.

## Design Decisions

**Keep:** spherical shape, animated eyes, 3-phase state machine, toy/mascot character.
**Change:** all hardcoded color values → Hush design system tokens.

## State Color Spec

### idle — dormiente nel buio
- Context: connecting to LiveKit (not ready) OR "select a channel" placeholder
- Orb bg: `#26241e → #1b1912 → #13120a` (elevated → surface → black)
- Shadow: `0 0 12px rgba(0,0,0,0.4)`
- Eye color: `#3a3a4e` (--hush-text-ghost), barely visible
- Glow bg: none
- Ring: transparent

### waiting — si sveglia
- Context: connected, alone in the room
- Orb bg: `#3c2018 → #261408 → #1b1912` (very dark warm red-brown, pre-orange)
- Shadow: `0 0 24px rgba(213,79,18,0.1)`
- Eye color: `#8888a0` (--hush-text-secondary)
- Glow bg: `rgba(213,79,18,0.04)` barely visible
- Ring: `rgba(213,79,18,0.06)`

### activating — esplode nell'arancione Hush
- Context: new participant joined (1.8s flash)
- Orb bg: `#e85a1a → #d54f12 → #a33d0e` (--hush-amber-bright → amber → amber-dim)
- Shadow: `0 0 40px rgba(213,79,18,0.5), 0 0 16px rgba(213,79,18,0.3)`
- Eye color: `#13120a` (--hush-black) — dark on orange
- Glow bg: `rgba(213,79,18,0.14)`
- Ring: `rgba(213,79,18,0.28)`
- Particles: `#d54f12`

## Label Text

| Phase | Default label |
|-------|---------------|
| idle | "connecting..." |
| waiting | "waiting for others to join" |
| activating | "someone just joined" |

Add optional `label` prop to override — used by ServerLayout to show "select a channel".

## Affected Files

1. `client/src/components/HushOrb.jsx` — recolor, add `label` prop
2. `client/src/pages/ServerLayout.jsx` — replace text placeholder with `<HushOrb phase="idle" label="select a channel" />`
