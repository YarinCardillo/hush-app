# Typewriter Subtitle Animation: Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the static "privacy." word in the home page subtitle with a cycling typewriter animation inside a ghost-measured fixed-width slot, with a blinking amber cursor, zero layout shift.

**Architecture:** Two-file change. `global.css` gets the cursor keyframe. `Home.jsx` gets the word list constants, a `TypewriterSlot` component (defined at module scope, above `Home`), and the subtitle JSX update (drop `'privacy.'` from `SUBTITLE_WORDS`, append `<TypewriterSlot />`). The typing engine is pure `useEffect`/`setTimeout` (no Framer Motion for typing). Width is measured via a ghost `<span>` ref after `document.fonts.ready`.

**Tech Stack:** React 18, Framer Motion (`motion/react` (entry fade-in only)), inline styles, CSS custom properties, CSS keyframes.

---

### Task 1: Add cursor CSS to global.css

**Files:**
- Modify: `client/src/styles/global.css`

**Step 1: Locate the end of global.css**

Open `client/src/styles/global.css`. Scroll to the bottom. The file ends after scrollbar styles.

**Step 2: Append the cursor keyframe and class**

At the very end of the file, add:

```css
/* ── Typewriter cursor ────────────────────── */
.typewriter-cursor {
  display: inline-block;
  width: 1.5px;
  height: 0.85em;
  background: var(--hush-amber);
  margin-left: 1px;
  vertical-align: text-bottom;
  animation: cursor-blink 1.1s step-end infinite;
}

@keyframes cursor-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}
```

**Step 3: Verify no syntax errors**

Run: `cd /opt/hush-app/client && npm run build`
Expected: build completes, no CSS errors.

**Step 4: Commit**

```bash
cd /opt/hush-app
git add client/src/styles/global.css
git commit -m "feat: add typewriter cursor CSS keyframe"
```

---

### Task 2: Add constants and TypewriterSlot to Home.jsx

**Files:**
- Modify: `client/src/pages/Home.jsx`

**Context:** `Home.jsx` is at `client/src/pages/Home.jsx`. It already imports `{ useState, useEffect, useRef, useCallback }` from React and `{ motion }` from `motion/react`. The module-level constant `SUBTITLE_WORDS` is defined near the top. `wordVariants` is also module-scope, so `TypewriterSlot` can use it directly.

**Step 1: Add word list and timing constants after SUBTITLE_WORDS**

Find the line:
```js
const SUBTITLE_WORDS = ['share', 'your', 'screen.', 'keep', 'your', 'privacy.'];
```

Replace it with:

```js
const SUBTITLE_WORDS = ['share', 'your', 'screen.', 'keep', 'your'];

const TYPEWRITER_WORDS = [
  'privacy',
  'secrets',
  'identity',
  'data',
  'silence',
  'manifesto',
  'screen time',
  'browser history',
  'DMs',
  'playlists',
  'burner phone',
  'read receipts',
  'inner monologue',
  'situationship',
  'villain arc',
  'guilty pleasures',
];

const TYPE_SPEED_MS   = 65;
const DELETE_SPEED_MS = 40;
const PAUSE_AFTER_MS  = 1400;
const PAUSE_BEFORE_MS = 200;
```

**Step 2: Add TypewriterSlot component**

Find `wordVariants` (defined just above `const styles = {`). After the `wordVariants` block and before `const styles = {`, insert the `TypewriterSlot` component:

```jsx
function TypewriterSlot() {
  const ghostRef = useRef(null);
  const [slotWidth, setSlotWidth] = useState(null);
  const [wordIndex, setWordIndex] = useState(0);
  const [displayed, setDisplayed] = useState('');
  const [phase, setPhase] = useState('typing');

  useEffect(() => {
    document.fonts.ready.then(() => {
      if (ghostRef.current) {
        setSlotWidth(ghostRef.current.getBoundingClientRect().width);
      }
    });
  }, []);

  useEffect(() => {
    const word = TYPEWRITER_WORDS[wordIndex];
    const fullText = word + '.';

    if (phase === 'typing') {
      if (displayed.length < fullText.length) {
        const t = setTimeout(
          () => setDisplayed(fullText.slice(0, displayed.length + 1)),
          TYPE_SPEED_MS,
        );
        return () => clearTimeout(t);
      }
      setPhase('pausing');
      return;
    }

    if (phase === 'pausing') {
      const t = setTimeout(() => setPhase('deleting'), PAUSE_AFTER_MS);
      return () => clearTimeout(t);
    }

    if (phase === 'deleting') {
      if (displayed.length > 0) {
        const t = setTimeout(
          () => setDisplayed((d) => d.slice(0, -1)),
          DELETE_SPEED_MS,
        );
        return () => clearTimeout(t);
      }
      setPhase('waiting');
      return;
    }

    if (phase === 'waiting') {
      const t = setTimeout(() => {
        setWordIndex((i) => (i + 1) % TYPEWRITER_WORDS.length);
        setPhase('typing');
      }, PAUSE_BEFORE_MS);
      return () => clearTimeout(t);
    }
  }, [phase, displayed, wordIndex]);

  return (
    <motion.span
      style={{ display: 'inline-block', marginRight: '0.25em', position: 'relative' }}
      variants={wordVariants}
    >
      {/* Ghost span: measures longest word width after font load */}
      <span
        ref={ghostRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          top: 0,
          left: 0,
        }}
      >
        guilty pleasures.
      </span>

      {/* Fixed-width animated slot */}
      <span
        style={{
          display: 'inline-block',
          minWidth: slotWidth != null ? `${slotWidth}px` : undefined,
          whiteSpace: 'nowrap',
        }}
      >
        {displayed}
        <span className="typewriter-cursor" aria-hidden="true" />
      </span>
    </motion.span>
  );
}
```

**Step 3: Update subtitle JSX to use TypewriterSlot**

In the JSX, find the subtitle `motion.div` block. It maps over `SUBTITLE_WORDS`. After the closing `})}` of the map, add `<TypewriterSlot key="typewriter" />`:

Find:
```jsx
            {SUBTITLE_WORDS.map((word, i) => (
              <motion.span
                key={i}
                style={{ display: 'inline-block', marginRight: '0.25em' }}
                variants={wordVariants}
              >
                {word}
              </motion.span>
            ))}
```

Replace with:
```jsx
            {SUBTITLE_WORDS.map((word, i) => (
              <motion.span
                key={i}
                style={{ display: 'inline-block', marginRight: '0.25em' }}
                variants={wordVariants}
              >
                {word}
              </motion.span>
            ))}
            <TypewriterSlot />
```

**Step 4: Build to verify**

```bash
cd /opt/hush-app/client && npm run build
```

Expected: build completes with no errors or warnings about undefined variables.

**Step 5: Commit**

```bash
cd /opt/hush-app
git add client/src/pages/Home.jsx
git commit -m "feat: typewriter animation on home subtitle word slot"
```

---

### Task 3: Deploy

**Step 1: Deploy production containers**

```bash
cd /opt/hush-app && docker compose -f docker-compose.yml up --build -d
```

Expected: containers rebuild and start. `hush-app-hush-1` and `hush-caddy` restart.

**Step 2: Push**

```bash
cd /opt/hush-app && git push
```

---

### Visual Verification Checklist

After deploy, open the home page and verify:

- [ ] Subtitle reads "share your screen. keep your" + animated word + "."
- [ ] Words cycle: privacy → secrets → identity → … → guilty pleasures → privacy (loop)
- [ ] Cursor (thin vertical amber bar) is always visible, blinks at ~1.1s
- [ ] No horizontal movement or layout shift during typing/deleting
- [ ] Multi-word phrases ("screen time", "guilty pleasures") stay on one line
- [ ] Animation starts immediately on page load (no extra delay beyond stagger)
- [ ] Works in light mode (cursor is still `--hush-amber`, which is unchanged)
