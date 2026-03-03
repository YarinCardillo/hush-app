# HushOrb Design System Alignment — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Recolor HushOrb to use Hush's design system tokens (#d54f12 orange, dark warm surfaces) and add it to the "select a channel" placeholder in ServerLayout.

**Architecture:** Pure visual change to HushOrb.jsx (colors + optional label prop) + one-line usage update in ServerLayout.jsx. No logic changes, no new state.

**Tech Stack:** React, inline styles, CSS custom property values as string literals (component renders inline — no global.css access).

---

### Task 1: Recolor HushOrb and add `label` prop

**Files:**
- Modify: `client/src/components/HushOrb.jsx`

**Step 1: Replace ORB_STYLES with Hush design system colors**

Replace the entire `ORB_STYLES` constant:

```js
const ORB_STYLES = {
  idle: {
    bg: 'radial-gradient(circle at 38% 35%, #26241e 0%, #1b1912 50%, #13120a 100%)',
    shadow: '0 0 12px rgba(0,0,0,0.4)',
    eyeColor: '#3a3a4e',
    glowBg: 'radial-gradient(circle, rgba(213,79,18,0) 0%, transparent 70%)',
    ringColor: 'transparent',
  },
  waiting: {
    bg: 'radial-gradient(circle at 38% 35%, #3c2018 0%, #261408 50%, #1b1912 100%)',
    shadow: '0 0 24px rgba(213,79,18,0.1)',
    eyeColor: '#8888a0',
    glowBg: 'radial-gradient(circle, rgba(213,79,18,0.04) 0%, transparent 70%)',
    ringColor: 'rgba(213,79,18,0.06)',
  },
  activating: {
    bg: 'radial-gradient(circle at 38% 35%, #e85a1a 0%, #d54f12 45%, #a33d0e 100%)',
    shadow: '0 0 40px rgba(213,79,18,0.5), 0 0 16px rgba(213,79,18,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
    eyeColor: '#13120a',
    glowBg: 'radial-gradient(circle, rgba(213,79,18,0.14) 0%, transparent 70%)',
    ringColor: 'rgba(213,79,18,0.28)',
  },
};
```

**Step 2: Add `label` prop and update label + dot colors**

Change function signature:
```js
export default function HushOrb({ phase = 'idle', label }) {
```

Update label span — use `label ?? LABELS[phase]` and replace hardcoded rgba colors:
```jsx
<span style={{
  color: phase === 'activating' ? 'rgba(213,79,18,0.7)' : 'rgba(255,255,255,0.15)',
  fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase',
  fontFamily: 'var(--font-mono, monospace)',
  transition: 'color 0.6s ease',
}}>
  {label ?? LABELS[phase]}
</span>
```

Update particle color (line ~112):
```jsx
background: '#d54f12',
```

Update dot color (line ~131):
```jsx
background: i === 0 && phase !== 'idle' ? '#d54f12' : 'rgba(255,255,255,0.08)',
```

**Step 3: Commit**
```bash
git add client/src/components/HushOrb.jsx
git commit -m "feat: align HushOrb colors to Hush design system; add label prop"
```

---

### Task 2: Use HushOrb in ServerLayout placeholder

**Files:**
- Modify: `client/src/pages/ServerLayout.jsx`

**Step 1: Import HushOrb**

Add import at top of file (near other component imports):
```js
import HushOrb from '../components/HushOrb';
```

**Step 2: Replace the text placeholder**

Current code (line ~340):
```jsx
<div style={layoutStyles.placeholder}>
  {serverId ? 'Select a channel' : 'Select a server'}
</div>
```

Replace with:
```jsx
<div style={layoutStyles.placeholder}>
  <HushOrb
    phase="idle"
    label={serverId ? 'select a channel' : 'select a server'}
  />
</div>
```

**Step 3: Commit**
```bash
git add client/src/pages/ServerLayout.jsx
git commit -m "feat: replace select-a-channel text with HushOrb idle state"
```

---

### Task 3: Push

```bash
git push origin core-rewrite
```
