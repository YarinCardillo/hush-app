# Vesper Rename — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename HushOrb to Vesper across the entire codebase, refresh MascotDemo with a "Meet Vesper!" welcome page, and document future threshold-moment work as TODO.

**Architecture:** Pure rename + copy refresh. No logic changes, no new state, no new dependencies. The component file gets renamed, all imports updated, CSS comments updated, and the MascotDemo page gets new welcome copy. A TODO doc captures future threshold-moment work.

**Tech Stack:** React, CSS custom properties, existing Vesper (HushOrb) animation system.

---

### Task 1: Rename component file HushOrb.jsx → Vesper.jsx

**Files:**
- Rename: `client/src/components/HushOrb.jsx` → `client/src/components/Vesper.jsx`

**Step 1: Create Vesper.jsx with renamed export**

Copy `client/src/components/HushOrb.jsx` to `client/src/components/Vesper.jsx`. Change only:
- Line 67: `export default function HushOrb(` → `export default function Vesper(`
- Line 62: JSDoc comment update: `Ambient orb mascot` → `Vesper — ambient presence for voice channels and empty states.`

Everything else stays identical — all animation logic, eye states, phase system, CSS property names (`--ob-*`, `data-orb-phase`) are unchanged.

```jsx
// Line 62-67 in new Vesper.jsx:
/**
 * Vesper — ambient presence for voice channels and empty states.
 * Phase is controlled externally by VoiceChannel based on room state.
 *
 * @param {'idle'|'waiting'|'activating'} phase - Current room state.
 */
export default function Vesper({ phase = 'idle', label }) {
```

**Step 2: Delete old HushOrb.jsx**

```bash
git rm client/src/components/HushOrb.jsx
```

**Step 3: Commit**

```bash
git add client/src/components/Vesper.jsx
git commit -m "refactor: rename HushOrb → Vesper (component file)"
```

---

### Task 2: Update all imports

**Files:**
- Modify: `client/src/pages/ServerLayout.jsx:16`
- Modify: `client/src/pages/MascotDemo.jsx:2`

**Step 1: Update ServerLayout.jsx import**

Line 16 change:
```jsx
// Before:
import HushOrb from '../components/HushOrb';
// After:
import Vesper from '../components/Vesper';
```

Also update the JSX usage at line 823:
```jsx
// Before:
<HushOrb
  phase={orbPhase}
  label={isViewingVoice ? undefined : 'select a channel'}
/>
// After:
<Vesper
  phase={orbPhase}
  label={isViewingVoice ? undefined : 'select a channel'}
/>
```

**Step 2: Update MascotDemo.jsx import**

Line 2 change:
```jsx
// Before:
import HushOrb from '../components/HushOrb';
// After:
import Vesper from '../components/Vesper';
```

Also update all `<HushOrb` usages at lines 71 and 102:
```jsx
// Before:
<HushOrb phase={phase} />
// and:
<HushOrb phase={activePhase ?? 'idle'} />

// After:
<Vesper phase={phase} />
// and:
<Vesper phase={activePhase ?? 'idle'} />
```

**Step 3: Update VideoGrid.jsx comment**

Line 220 in `client/src/components/VideoGrid.jsx`:
```jsx
// Before:
// HushOrb is rendered by ServerLayout as a persistent element.
// After:
// Vesper is rendered by ServerLayout as a persistent element.
```

**Step 4: Commit**

```bash
git add client/src/pages/ServerLayout.jsx client/src/pages/MascotDemo.jsx client/src/components/VideoGrid.jsx
git commit -m "refactor: update all HushOrb imports and refs to Vesper"
```

---

### Task 3: Update CSS comments

**Files:**
- Modify: `client/src/styles/global.css:46,172`

**Step 1: Update comment on line 46**

```css
/* Before: */
/* -- HushOrb mascot — waiting state (dark theme defaults) -- */
/* After: */
/* -- Vesper — waiting state (dark theme defaults) -- */
```

**Step 2: Update comment on line 172**

```css
/* Before: */
/* -- HushOrb phase tokens — registered so CSS can interpolate gradients between phases -- */
/* After: */
/* -- Vesper phase tokens — registered so CSS can interpolate gradients between phases -- */
```

**Important:** Do NOT rename CSS custom properties (`--ob-*`) or data attributes (`data-orb-phase`). These are internal implementation details and renaming them would be churn with no value.

**Step 3: Commit**

```bash
git add client/src/styles/global.css
git commit -m "refactor: update CSS comments HushOrb → Vesper"
```

---

### Task 4: Update changelog reference

**Files:**
- Modify: `client/src/data/changelog.js:89`

**Step 1: Update text**

```js
// Before:
'HushOrb ambient mascot in voice channels and empty states',
// After:
'Vesper ambient presence in voice channels and empty states',
```

**Step 2: Commit**

```bash
git add client/src/data/changelog.js
git commit -m "refactor: changelog HushOrb → Vesper"
```

---

### Task 5: Refresh MascotDemo page with "Meet Vesper!" welcome

**Files:**
- Modify: `client/src/pages/MascotDemo.jsx` (full rewrite)

**Step 1: Rewrite MascotDemo.jsx**

Replace the entire file with the updated version. Key changes:
- Title: "Meet Vesper" (weight 300, larger)
- Subtitle: short poetic line — "the quiet presence that makes a server feel alive"
- Keep the three phase cards and interactive section
- Update all text references from "HushOrb" to "Vesper"
- Follow design system: Sora font, hush color tokens, no borders, sharp corners

```jsx
import { useState } from 'react';
import Vesper from '../components/Vesper';

const phases = ['idle', 'waiting', 'activating'];

const styles = {
  root: {
    minHeight: '100vh',
    background: 'var(--hush-black, #0a0a0a)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '80px 24px 48px',
    fontFamily: 'var(--font-sans, system-ui)',
  },
  title: {
    color: 'var(--hush-text, #e0e0e0)',
    fontSize: '2rem',
    fontWeight: 300,
    letterSpacing: '-0.02em',
    marginBottom: 12,
  },
  subtitle: {
    color: 'var(--hush-text-muted, #555568)',
    fontSize: '0.85rem',
    fontFamily: 'var(--font-sans, system-ui)',
    fontWeight: 400,
    marginBottom: 64,
    textAlign: 'center',
    maxWidth: 360,
    lineHeight: 1.5,
  },
  grid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 48,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    padding: '32px 24px',
    border: '1px solid transparent',
    background: 'var(--hush-surface, #111)',
    minWidth: 240,
  },
  phaseLabel: {
    fontSize: '0.75rem',
    fontFamily: 'var(--font-mono, monospace)',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--hush-text-secondary, #888)',
    padding: '4px 12px',
    background: 'var(--hush-elevated, #1a1a1a)',
  },
};

export default function MascotDemo() {
  const [activePhase, setActivePhase] = useState(null);

  return (
    <div style={styles.root}>
      <h1 style={styles.title}>Meet Vesper</h1>
      <p style={styles.subtitle}>
        the quiet presence that makes a server feel alive.
        not a bot. not a feature. just here.
      </p>

      <div style={styles.grid}>
        {phases.map((phase) => (
          <div key={phase} style={styles.card}>
            <span style={styles.phaseLabel}>{phase}</span>
            <Vesper phase={phase} />
          </div>
        ))}
      </div>

      <div style={{ marginTop: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <p style={{ color: 'var(--hush-text-muted, #666)', fontSize: '0.8rem', fontFamily: 'var(--font-mono, monospace)' }}>
          interactive: click to cycle phases
        </p>
        <button
          type="button"
          onClick={() => {
            const idx = activePhase === null ? 0 : (phases.indexOf(activePhase) + 1) % phases.length;
            setActivePhase(phases[idx]);
          }}
          style={{
            padding: '8px 20px',
            fontSize: '0.8rem',
            fontFamily: 'var(--font-mono, monospace)',
            background: 'var(--hush-elevated, #1a1a1a)',
            border: '1px solid transparent',
            color: 'var(--hush-text, #e0e0e0)',
            cursor: 'pointer',
            letterSpacing: '0.06em',
          }}
        >
          {activePhase ?? 'start'} &rarr; {phases[(phases.indexOf(activePhase ?? 'activating') + 1) % phases.length]}
        </button>
        <div style={{ ...styles.card, marginTop: 8 }}>
          <span style={styles.phaseLabel}>interactive: {activePhase ?? 'idle'}</span>
          <Vesper phase={activePhase ?? 'idle'} />
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/pages/MascotDemo.jsx
git commit -m "feat: refresh MascotDemo as 'Meet Vesper' welcome page"
```

---

### Task 6: Document future threshold moments as TODO

**Files:**
- Create: `docs/plans/vesper-threshold-moments-TODO.md`

**Step 1: Write TODO doc**

```markdown
# Vesper — Threshold Moments (TODO)

Future work to give Vesper presence at significant server transitions.

## Philosophy

Vesper non ha funzionalita — ha presenza. It appears at moments of transition,
then disappears. Not a bot, not a feature — a gesture.

## Planned Threshold Triggers

### 1. Server Creation
When a user creates a new server, Vesper appears briefly as a welcome moment.
Exit: fade after ~5s OR on first user interaction (whichever comes first).

### 2. New Channel Arrival
When a user navigates to a channel for the first time, Vesper does a micro-moment.
Exit: same fade logic.

### 3. First Server Visit
First time a user enters a server they joined. Needs "seen" state tracking (localStorage).
Exit: same fade logic.

### 4. New Member Onboarding
When a new user joins a server, Vesper does a silent welcome gesture visible to that user.
Needs server-side member_joined event + client-side "is this me?" check.

## Per-Server Customization (Later)
Each server's admin can pick a custom accent color and name for their Vesper.
Deferred — ships with default orange identity for now.

## Exit Behavior
All threshold appearances use: auto-fade after ~5s OR fade on first user interaction,
whichever comes first. CSS opacity transition + unmount after animation.
```

**Step 2: Commit**

```bash
git add docs/plans/vesper-threshold-moments-TODO.md
git commit -m "docs: add Vesper threshold moments TODO for future work"
```

---

### Task 7: Final verification

**Step 1: Search for any remaining "HushOrb" references**

```bash
grep -r "HushOrb" client/src/ --include="*.jsx" --include="*.js" --include="*.css"
```

Expected: no results (only `docs/plans/` may still reference it in old design docs — that's fine).

**Step 2: Verify the app builds**

```bash
cd client && npm run build
```

Expected: clean build, no import errors.

**Step 3: Verify /mascot-demo route loads**

Open browser at `http://localhost:5173/mascot-demo` and confirm:
- Title says "Meet Vesper"
- Subtitle reads "the quiet presence that makes a server feel alive..."
- All three phase orbs render correctly
- Interactive button cycles phases
