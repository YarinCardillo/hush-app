# Hush Design System

A design language for private, high-fidelity screen sharing.

---

## Identity

> "What happens in the room, stays in the room."

Hush is a vault with a window. The product exists to share screens with absolute privacy — E2E encrypted, no accounts required, self-hostable. The design must communicate **trust through restraint**: nothing flashy, nothing loud, nothing that feels like it's trying too hard.

Think: Signal's confidence + Linear's precision + a recording studio's calm.

### Brand Personality

- **Quiet authority** — The interface whispers, never shouts
- **Warm darkness** — Not cold or sterile; inviting but secure
- **Radical transparency** — Real capacity numbers, honest limits, no dark patterns
- **Tool, not toy** — Professional enough for work, clean enough for friends

### Signature Element: The Amber Glow

Hush's identity color is **warm amber** — a golden whisper in a dark room. It's the only color that consistently appears across the interface. Not neon, not cold — it's the color of candlelight in a soundproof room.

This breaks the blue/purple pattern of every other streaming tool (Discord, Zoom, Teams, Meet). Hush is warm where others are corporate.

---

## Color System

### CSS Custom Properties

All colors are defined as CSS custom properties in `:root`. Every component references these — never hardcode hex values.

```css
:root {
  /* ── Core Surfaces ── */
  --hush-black:        #08080c;     /* True background — near-black with blue undertone */
  --hush-surface:      #101018;     /* Cards, panels, secondary surfaces */
  --hush-elevated:     #181824;     /* Raised elements, hover states */
  --hush-hover:        #20202e;     /* Interactive hover backgrounds */

  /* ── Signature Amber ── */
  --hush-amber:        #d4a053;     /* Primary accent — warm, desaturated gold */
  --hush-amber-bright: #e8b866;     /* Hover state, emphasis */
  --hush-amber-dim:    #a07a3a;     /* Muted amber for subtle uses */
  --hush-amber-glow:   rgba(212, 160, 83, 0.15);  /* Background tint */
  --hush-amber-ghost:  rgba(212, 160, 83, 0.08);  /* Barely-there tint */

  /* ── Borders ── */
  --hush-border:       #1e1e2e;     /* Default border — barely visible */
  --hush-border-hover: #2e2e42;     /* Hover/focus border */
  --hush-border-focus: #3e3e56;     /* Active input border */

  /* ── Text Hierarchy (4 levels only) ── */
  --hush-text:         #e4e4ec;     /* Primary text — not pure white, slightly warm */
  --hush-text-secondary: #8888a0;   /* Descriptions, supporting text */
  --hush-text-muted:   #555568;     /* Metadata, timestamps, placeholders */
  --hush-text-ghost:   #3a3a4e;     /* Disabled states, very low emphasis */

  /* ── Status Colors (functional only) ── */
  --hush-live:         #34d399;     /* Live/streaming indicator — mint green */
  --hush-live-glow:    rgba(52, 211, 153, 0.25);
  --hush-danger:       #ef4444;     /* Leave room, destructive actions */
  --hush-danger-ghost: rgba(239, 68, 68, 0.10);
  --hush-encrypted:    #818cf8;     /* E2E encryption badge — soft indigo */
  --hush-encrypted-ghost: rgba(129, 140, 248, 0.10);

  /* ── Typography ── */
  --font-sans:  'Sora', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono:  'JetBrains Mono', 'SF Mono', Consolas, monospace;

  /* ── Spacing & Radius ── */
  --radius-sm:   6px;
  --radius-md:   10px;
  --radius-lg:   14px;
  --radius-xl:   20px;
  --radius-full: 9999px;

  /* ── Motion ── */
  --ease-out:    cubic-bezier(0.16, 1, 0.3, 1);   /* Smooth deceleration */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* Slight overshoot */
  --duration-fast:   120ms;
  --duration-normal: 200ms;
  --duration-slow:   350ms;
}
```

### Color Usage Rules

| Use case | Color | Never |
|----------|-------|-------|
| Primary action (Share Screen, Create Room) | `--hush-amber` | Blue, purple, green |
| Live status indicator | `--hush-live` | Amber (reserved for brand) |
| E2E encryption badge | `--hush-encrypted` | Green (that's for "live") |
| Destructive action (Leave, End) | `--hush-danger` | Red backgrounds, only red text/borders |
| Card backgrounds | `--hush-surface` | Pure black (#000) |
| Page background | `--hush-black` | Any other color |

### What Color Is NOT For

Color never indicates hierarchy. Hierarchy comes from **size, weight, and opacity only**. The amber accent is reserved for:
- Primary buttons and CTAs
- Active/selected states
- The Hush logomark
- Streaming quality indicators
- Supporter tier badge

Everything else is grayscale.

---

## Typography

### Font Stack

**Sora** is the primary typeface. It's geometric, slightly rounded, and has a quiet confidence that matches the brand. It reads as modern and technical without being cold.

```html
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

**JetBrains Mono** for all technical data: room codes, bitrate, resolution labels, encryption status.

### Weight Scale

```
300 (Light)    → Hero text, page titles, room names at large sizes
400 (Regular)  → Body text, descriptions, list items
500 (Medium)   → Buttons, badges, labels, interactive elements
600 (Semibold) → Section headers, emphasis (SPARINGLY)
```

**Rule**: Anything above 24px should be weight 300. Large light text is the signature. Bold is never used.

### Size Scale

```css
/* Technical labels */
font-size: 0.65rem;   /* 10.4px — Encryption status, resolution badge */
font-size: 0.7rem;    /* 11.2px — Timestamps, metadata, capacity bars */
font-size: 0.75rem;   /* 12px   — Badges, tags, small labels */

/* Body content */
font-size: 0.8rem;    /* 12.8px — Field labels, sidebar items */
font-size: 0.85rem;   /* 13.6px — Secondary body text */
font-size: 0.9rem;    /* 14.4px — Primary body text, input text */

/* Headings */
font-size: 1rem;      /* 16px   — Section headers, modal titles */
font-size: 1.1rem;    /* 17.6px — Page sub-headers */
font-size: 1.4rem;    /* 22.4px — Page titles */
font-size: 2rem;      /* 32px   — Hero text (Home page title) */
font-size: 2.4rem;    /* 38.4px — Landing page hero */
```

### Letter Spacing

```css
letter-spacing: -0.03em;   /* Hero/display text — tight, refined */
letter-spacing: -0.02em;   /* Page titles — slightly tight */
letter-spacing: 0;         /* Body text — default */
letter-spacing: 0.06em;    /* Uppercase labels — tracked out */
letter-spacing: 0.1em;     /* Small caps badges — wide tracking */
```

### Hierarchy Quick Reference

| Element | Size | Weight | Color | Tracking | Transform |
|---------|------|--------|-------|----------|-----------|
| Hero title ("hush") | 2.4rem | 300 | `--hush-text` | -0.03em | lowercase |
| Page title | 1.4rem | 300 | `--hush-text` | -0.02em | — |
| Room name in header | 0.95rem | 600 | `--hush-text` | — | — |
| Section label | 0.7rem | 600 | `--hush-text-muted` | 0.08em | uppercase |
| Body text | 0.9rem | 400 | `--hush-text` | — | — |
| Field label | 0.8rem | 500 | `--hush-text-secondary` | — | — |
| Badge/tag | 0.7rem | 500 | varies | 0.06em | uppercase |
| Mono data | 0.75rem | 400 | `--hush-text-secondary` | — | — |
| Timestamp | 0.7rem | 400 | `--hush-text-muted` | — | — |

### The Lowercase Brand

"hush" is always written in **lowercase** in the UI. Never "Hush", never "HUSH". The logomark is the word "hush" in Sora Light at display size. This reinforces the quiet, understated identity.

```css
.logo-title {
  font-family: var(--font-sans);
  font-size: 2.2rem;
  font-weight: 300;
  letter-spacing: -0.03em;
  color: var(--hush-text);
  text-transform: lowercase;
}

/* The amber dot — a signature visual element */
/* The "h" in "hush" or a standalone dot that glows amber */
.logo-accent {
  color: var(--hush-amber);
}
```

---

## Surfaces & Depth

### Layering Model

Hush uses a strict 4-level depth system. No drop shadows — depth comes from background lightness alone.

```
Level 0: --hush-black       → Page background, video containers
Level 1: --hush-surface     → Cards, sidebars, panels
Level 2: --hush-elevated    → Hover states, active cards, dropdowns
Level 3: --hush-hover        → Pressed states, deep hover
```

**Modals** break the system intentionally: they use `backdrop-filter: blur(12px)` over a `rgba(0,0,0,0.6)` overlay. The blur is the depth cue.

### Card Pattern

```css
.card {
  background: var(--hush-surface);
  border: 1px solid var(--hush-border);
  border-radius: var(--radius-lg);
  padding: 20px;
  transition: border-color var(--duration-normal) var(--ease-out);
}

.card:hover {
  border-color: var(--hush-border-hover);
}
```

**Rules:**
- Cards never have shadows
- Cards never have gradients
- Card backgrounds are always semi-transparent or single solid dark values
- Border is the primary visual separator, and it's always subtle

### Glass Effect (Overlays Only)

Used exclusively for: floating controls bar, video labels, toast notifications, dropdown menus.

```css
.glass {
  background: rgba(8, 8, 12, 0.75);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--hush-border);
}
```

Never use glass for cards or primary surfaces. Glass is for elements that float over video content.

---

## Component Catalog

### Buttons

Three variants only. No outlines, no ghosts, no links-that-look-like-buttons.

```css
/* ── Primary (Amber) ── */
.btn-primary {
  background: var(--hush-amber);
  color: var(--hush-black);
  font-weight: 500;
  border: none;
  border-radius: var(--radius-md);
  padding: 10px 20px;
  transition: all var(--duration-fast) var(--ease-out);
}
.btn-primary:hover {
  background: var(--hush-amber-bright);
  box-shadow: 0 0 24px var(--hush-amber-glow);
}
.btn-primary:active {
  transform: scale(0.97);
}

/* ── Secondary (Surface) ── */
.btn-secondary {
  background: var(--hush-surface);
  color: var(--hush-text);
  border: 1px solid var(--hush-border);
  border-radius: var(--radius-md);
  padding: 10px 20px;
  transition: all var(--duration-fast) var(--ease-out);
}
.btn-secondary:hover {
  background: var(--hush-elevated);
  border-color: var(--hush-border-hover);
}

/* ── Danger (Leave Room) ── */
.btn-danger {
  background: var(--hush-danger-ghost);
  color: var(--hush-danger);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  padding: 10px 20px;
  transition: all var(--duration-fast) var(--ease-out);
}
.btn-danger:hover {
  border-color: var(--hush-danger);
  background: rgba(239, 68, 68, 0.15);
}
```

**Icon Buttons** (control bar) use a square format:

```css
.btn-icon {
  width: 44px;
  height: 44px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--hush-surface);
  border: 1px solid var(--hush-border);
  color: var(--hush-text-secondary);
  transition: all var(--duration-fast) var(--ease-out);
}
.btn-icon:hover {
  color: var(--hush-text);
  border-color: var(--hush-border-hover);
  background: var(--hush-elevated);
}

/* Active state (mic on, webcam on) */
.btn-icon.active {
  background: var(--hush-amber);
  color: var(--hush-black);
  border-color: var(--hush-amber);
}
```

### Inputs

```css
.input {
  width: 100%;
  padding: 11px 14px;
  background: var(--hush-black);
  border: 1px solid var(--hush-border);
  border-radius: var(--radius-md);
  color: var(--hush-text);
  font-family: var(--font-sans);
  font-size: 0.9rem;
  outline: none;
  transition: border-color var(--duration-normal) var(--ease-out);
}
.input:focus {
  border-color: var(--hush-amber-dim);
  box-shadow: 0 0 0 3px var(--hush-amber-ghost);
}
.input::placeholder {
  color: var(--hush-text-ghost);
}
```

**Rule**: Focus rings are always amber-tinted, never browser default blue.

### Badges & Status Indicators

```css
/* ── Live Badge ── */
.badge-live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: rgba(52, 211, 153, 0.1);
  color: var(--hush-live);
  border: 1px solid rgba(52, 211, 153, 0.2);
}

/* ── Live Dot (pulsing) ── */
.live-dot {
  width: 7px;
  height: 7px;
  background: var(--hush-live);
  border-radius: 50%;
  box-shadow: 0 0 8px var(--hush-live-glow);
  animation: hush-pulse 2.5s ease-in-out infinite;
}
@keyframes hush-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}

/* ── E2E Encryption Badge ── */
.badge-e2e {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-size: 0.7rem;
  font-weight: 500;
  font-family: var(--font-mono);
  background: var(--hush-encrypted-ghost);
  color: var(--hush-encrypted);
  border: 1px solid rgba(129, 140, 248, 0.15);
}

/* ── Quality Tag (in controls bar) ── */
.tag-quality {
  font-size: 0.65rem;
  font-family: var(--font-mono);
  font-weight: 500;
  padding: 2px 7px;
  border-radius: 4px;
  background: var(--hush-amber-ghost);
  color: var(--hush-amber);
  letter-spacing: 0.02em;
}

/* ── Supporter Badge ── */
.badge-supporter {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: 0.65rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: var(--hush-amber-ghost);
  color: var(--hush-amber);
  border: 1px solid rgba(212, 160, 83, 0.2);
}
```

### Video Containers

The most important component — this is what users look at 90% of the time.

```css
.video-container {
  position: relative;
  background: #000;
  border-radius: var(--radius-md);
  overflow: hidden;
  /* NO border on video containers — they should feel like windows, not cards */
}

.video-container video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

/* Floating label (glass effect) */
.video-label {
  position: absolute;
  bottom: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  background: rgba(8, 8, 12, 0.7);
  backdrop-filter: blur(12px);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--hush-text);
}

/* "You" badge on local stream */
.video-badge-local {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 2px 8px;
  background: var(--hush-amber-glow);
  backdrop-filter: blur(8px);
  border-radius: var(--radius-sm);
  font-size: 0.6rem;
  font-weight: 600;
  color: var(--hush-amber);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
```

**Rule**: Video containers have NO borders. They are holes to the outside world — the border would break the illusion. Only the outer page and surrounding cards have borders.

### Modals

```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  z-index: 100;
}

.modal {
  background: var(--hush-surface);
  border: 1px solid var(--hush-border);
  border-radius: var(--radius-xl);
  padding: 28px;
  max-width: 440px;
  width: 100%;
  /* Animation: scale up from center */
  animation: modal-enter var(--duration-slow) var(--ease-spring);
}

@keyframes modal-enter {
  from {
    opacity: 0;
    transform: scale(0.92) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
```

### Empty States

```css
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 40px;
  gap: 16px;
}

.empty-state-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  background: var(--hush-surface);
  border: 1px solid var(--hush-border);
  color: var(--hush-text-ghost);
}

.empty-state-title {
  font-size: 1rem;
  font-weight: 500;
  color: var(--hush-text-secondary);
}

.empty-state-description {
  font-size: 0.85rem;
  color: var(--hush-text-muted);
  max-width: 280px;
}
```

### Capacity Bar (Transparency Feature)

A signature Hush component — shows real server capacity, honest and visible.

```css
.capacity-bar {
  padding: 12px 14px;
  background: var(--hush-surface);
  border-radius: var(--radius-md);
  border: 1px solid var(--hush-border);
}

.capacity-track {
  width: 100%;
  height: 3px;
  background: var(--hush-black);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 8px;
}

.capacity-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--hush-live);
  transition: width 400ms var(--ease-out);
}

/* Turns amber when >80% capacity */
.capacity-fill.high {
  background: var(--hush-amber);
}
```

---

## Layout System

### Page Structure

```
┌──────────────────────────────────────────────┐
│  Header Bar (h: 48px, surface bg, border-b)  │
├──────────────────────────────────┬────────────┤
│                                  │  Sidebar   │
│          Streams Grid            │  (260px,   │
│          (flex: 1)               │  optional) │
│                                  │            │
├──────────────────────────────────┴────────────┤
│  Controls Bar (h: 64px, glass bg, border-t)   │
└──────────────────────────────────────────────┘
```

### Spacing Values

Use these consistently. Don't invent spacing values.

```
4px   → Tight gaps (between badge icon and text)
6px   → Inline element gaps
8px   → Small component gaps, grid gaps
12px  → Medium gaps (form fields, sidebar items)
16px  → Standard section padding
20px  → Card internal padding
24px  → Large section padding
32px  → Page-level sections
40px  → Hero spacing, major separations
```

### Grid Layout (Streams)

```css
/* Dynamic grid based on stream count */
.streams-grid {
  flex: 1;
  display: grid;
  gap: 6px;
  padding: 6px;
  overflow: hidden;
}

/* 1 stream:  full viewport */
/* 2 streams: side by side */
/* 3-4:       2x2 grid */
/* 5-6:       3x2 grid */
```

The grid gap is intentionally small (6px) — streams should feel like a continuous viewing experience, not separated cards.

---

## Animation & Motion

### Philosophy: Invisible Until Needed

Animations in Hush are **functional, not decorative**. They communicate state changes and guide attention. If removing an animation doesn't hurt comprehension, remove it.

### Approved Animations

```css
/* 1. State transitions (buttons, hovers, inputs) */
transition: all var(--duration-fast) var(--ease-out);

/* 2. Element entry (modals, panels, toasts) */
@keyframes fade-up {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* 3. Live pulse (streaming indicator only) */
@keyframes hush-pulse { /* defined above */ }

/* 4. Toast slide-in */
@keyframes slide-in-right {
  from { opacity: 0; transform: translateX(16px); }
  to   { opacity: 1; transform: translateX(0); }
}
```

### Forbidden Animations

- Page transitions with blur effects (too heavy for a real-time streaming tool)
- Staggered list item reveals (adds latency to information delivery)
- 3D card rotations or glare effects (inappropriate for a utility tool)
- Text typing/generation effects (this isn't a chatbot)
- Border beam effects (Hush is not a SaaS dashboard)
- Parallax scrolling (there's nothing to scroll)
- Bouncing or elastic animations (undermines trust)

### Duration Guidelines

```
Micro-interactions (hover, press): 120ms
State changes (toggle, select):    200ms
Panel open/close:                   250ms
Modal enter/exit:                   350ms
Toast notification:                 200ms in, 150ms out
```

---

## Iconography

### Icon System

Use **Lucide** icons (or inline SVGs matching Lucide's style). Stroke-based, 24x24 viewBox, strokeWidth: 2.

### Sizing

```
16x16  → Control bar secondary actions, inline metadata
18x18  → Control bar primary actions (Share Screen, Mic, Webcam)
20x20  → Header actions, sidebar icons
48x48  → Empty state illustrations (strokeWidth: 1.5)
```

### Color Behavior

- Default: `var(--hush-text-muted)`
- Hover: `var(--hush-text)`
- Active: `var(--hush-amber)` or white (on amber background)
- Disabled: `var(--hush-text-ghost)`

**Icons never have fill** unless they represent an "on" state (e.g., mic active = filled mic icon vs mic muted = outlined with slash).

---

## Voice & Content

### UI Copy Rules

1. **Lowercase brand**: Always "hush", never "Hush" or "HUSH" in UI
2. **Terse labels**: "Leave" not "Leave Room". "Mic" not "Microphone". "Share" not "Share Screen" (when space is tight)
3. **No exclamation marks**: Ever. Not even in success states.
4. **Honest errors**: "Room is full (3/4 slots used)" not "Something went wrong"
5. **No marketing in the app**: The product sells itself through use. No "Upgrade now" popups, no "Did you know?" tooltips

### Specific Copy Examples

```
Hero subtitle:      "share your screen. keep your privacy."
Create button:      "create room"
Join button:        "join"
Empty streams:      "no active streams — click share to start"
Capacity full:      "free pool is full — try again or self-host"
E2E badge:          "e2e encrypted"
Supporter badge:    "supporter"
Leave button:       "leave"
Quality selector:   "best" / "lite"
Connection status:  "connected" / "reconnecting..."
Error state:        "couldn't connect — check your network"
```

---

## Scrollbar

```css
::-webkit-scrollbar {
  width: 5px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--hush-border-hover);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--hush-border-focus);
}
```

Thin, invisible until hovered. The scrollbar should not compete with content.

---

## Responsive Behavior

Hush is primarily a desktop tool (screen sharing requires a desktop), but the home page and join flow must work on mobile.

### Breakpoints

```css
/* Mobile:  < 640px  — Single column, stacked controls */
/* Tablet:  < 1024px — No sidebar, simplified header */
/* Desktop: ≥ 1024px — Full layout with optional sidebar */
```

### Mobile Adaptations

- Controls bar becomes a bottom sheet with larger touch targets (52px buttons)
- Sidebar collapses into a drawer
- Video grid becomes single-column stack
- Header simplifies to: logo + room name + leave button

---

## Dark Mode Only

Hush is dark mode only. There is no light theme. This is intentional:

1. Screen sharing means the user is looking at OTHER people's screens (which may be light-themed). The dark chrome reduces eye strain.
2. Dark interfaces communicate security and privacy (Signal, Tor, ProtonMail).
3. It simplifies the design system — one set of colors to maintain.
4. It looks better with the amber accent.

---

## Quality Checklist

Before shipping any screen:

- [ ] Are all colors using CSS custom properties, never hardcoded hex?
- [ ] Is the amber accent used ONLY for primary actions and brand elements?
- [ ] Are large headings weight 300 (light), never bold?
- [ ] Is "hush" written in lowercase everywhere?
- [ ] Do video containers have NO borders?
- [ ] Are animations under 350ms and purely functional?
- [ ] Is text hierarchy achieved through size/opacity, not color?
- [ ] Are technical values (bitrate, resolution) in JetBrains Mono?
- [ ] Does the page work without JavaScript? (progressive enhancement)
- [ ] Is every error message honest and specific?
- [ ] Would a user trust this interface with sensitive screen content?

---

## Forbidden Patterns

| Pattern | Why it's banned |
|---------|----------------|
| Gradient backgrounds | Breaks the vault aesthetic |
| Colored text for hierarchy | Color is functional only |
| Bold weight for emphasis | Use size differential instead |
| Pure white (#fff) text | Too harsh. Use `--hush-text` (#e4e4ec) |
| Pure black (#000) backgrounds | Too flat. Use `--hush-black` (#08080c) |
| Box shadows on cards | Depth comes from background value only |
| Rounded avatars | There are no user accounts / avatars |
| Loading spinners > 1 second | Show content progressively |
| "Powered by" footers | This is the product, not a widget |
| Confetti / celebration animations | Undermines the serious privacy positioning |
| Generic placeholder text | Every string should be final copy |
| Blue anything | Not the brand color. Common mistake. |

---

## File Structure Reference

```
client/src/
├── styles/
│   └── global.css          ← All CSS variables and base styles live here
├── components/
│   ├── Controls.jsx         ← Bottom bar: Share, Mic, Webcam, Leave
│   ├── StreamView.jsx       ← Single video container with label
│   └── QualitySelector.jsx  ← Best / Lite toggle
├── pages/
│   ├── Home.jsx             ← Create / Join room form
│   └── Room.jsx             ← Main streaming view
├── lib/
│   ├── socket.js            ← Socket.io connection
│   ├── encryption.js        ← E2E via WebRTC Encoded Transform
│   └── bandwidthEstimator.js
└── utils/
    └── constants.js         ← Quality presets, tier limits
```

---

## Implementation Priority

When applying this design system to the existing codebase:

1. **Update CSS variables first** — Replace the old OpenCast palette in global.css
2. **Swap the font** — Outfit → Sora in index.html
3. **Update primary accent** — Purple (#6c5ce7) → Amber (--hush-amber) everywhere
4. **Fix video containers** — Remove borders from video elements
5. **Update badges** — E2E, Live, Quality tags to new palette
6. **Apply to Home.jsx** — The first thing users see; most impactful change
7. **Apply to Controls.jsx** — The element users interact with most
8. **Polish Room.jsx** — Header, sidebar, grid layout

---
