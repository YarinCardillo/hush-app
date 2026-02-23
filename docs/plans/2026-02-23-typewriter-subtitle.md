# Typewriter Subtitle Animation — Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the static "privacy." word in the home subtitle with a cycling typewriter animation that types each word character by character with a blinking cursor, inside a fixed-width container that prevents any layout shift.

**Architecture:** A `TypewriterSlot` component (defined inline in `Home.jsx`) replaces the last word in `SUBTITLE_WORDS`. It uses a ghost measurement span to determine `minWidth`, a `useEffect`/`setTimeout` imperative engine for the typing loop, and a CSS keyframe blink on the cursor. Framer Motion handles only the entry fade-in (participates in the existing stagger).

**Tech Stack:** React 18, Framer Motion (`motion/react`), CSS keyframes (via `<style>` tag or `global.css`), inline styles, CSS custom properties.

---

### Word List

```js
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
```

Longest word (with period): `"guilty pleasures."` (17 chars) — used for ghost measurement.

---

### Timing Constants

```js
const TYPE_SPEED_MS   = 65;   // ms per character typed
const DELETE_SPEED_MS = 40;   // ms per character deleted
const PAUSE_AFTER_MS  = 1400; // pause after full word before deleting
const PAUSE_BEFORE_MS = 200;  // pause after full deletion before next word
```

---

### Component Design: TypewriterSlot

```jsx
function TypewriterSlot() {
  // Ghost ref for width measurement
  const ghostRef = useRef(null);
  const [slotWidth, setSlotWidth] = useState(null);

  // Animation state
  const [wordIndex, setWordIndex] = useState(0);
  const [displayed, setDisplayed] = useState('');
  const [phase, setPhase] = useState('typing'); // 'typing' | 'pausing' | 'deleting' | 'waiting'

  // Measure ghost width after fonts load
  useEffect(() => {
    document.fonts.ready.then(() => {
      if (ghostRef.current) {
        setSlotWidth(ghostRef.current.getBoundingClientRect().width);
      }
    });
  }, []);

  // Typewriter engine
  useEffect(() => {
    const word = TYPEWRITER_WORDS[wordIndex];
    const fullText = word + '.';

    if (phase === 'typing') {
      if (displayed.length < fullText.length) {
        const t = setTimeout(() => {
          setDisplayed(fullText.slice(0, displayed.length + 1));
        }, TYPE_SPEED_MS);
        return () => clearTimeout(t);
      } else {
        setPhase('pausing');
      }
    }

    if (phase === 'pausing') {
      const t = setTimeout(() => setPhase('deleting'), PAUSE_AFTER_MS);
      return () => clearTimeout(t);
    }

    if (phase === 'deleting') {
      if (displayed.length > 0) {
        const t = setTimeout(() => {
          setDisplayed(displayed.slice(0, -1));
        }, DELETE_SPEED_MS);
        return () => clearTimeout(t);
      } else {
        setPhase('waiting');
      }
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
      {/* Ghost: measures the longest word width */}
      <span
        ref={ghostRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        guilty pleasures.
      </span>

      {/* Fixed-width slot */}
      <span
        style={{
          display: 'inline-block',
          minWidth: slotWidth != null ? `${slotWidth}px` : undefined,
          whiteSpace: 'nowrap',
        }}
      >
        {displayed}
        {/* Blinking cursor */}
        <span className="typewriter-cursor" aria-hidden="true" />
      </span>
    </motion.span>
  );
}
```

---

### Cursor CSS

Add to `client/src/styles/global.css`:

```css
/* Typewriter cursor — amber accent, natural blink */
.typewriter-cursor {
  display: inline-block;
  width: 1.5px;
  height: 0.9em;
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

---

### Changes to Home.jsx

1. Add `TYPEWRITER_WORDS` constant and timing constants (top of file, near `SUBTITLE_WORDS`)
2. Change `SUBTITLE_WORDS` from 6 to 5 words (remove `'privacy.'`)
3. Define `TypewriterSlot` component above `Home` (it uses `wordVariants` which is module-scoped)
4. In the subtitle `.map()`, after rendering the 5 static words, append `<TypewriterSlot key="typewriter" />`

---

### Subtitle JSX (after change)

```jsx
const SUBTITLE_WORDS = ['share', 'your', 'screen.', 'keep', 'your'];

// ... inside the motion.div logoSub:
{SUBTITLE_WORDS.map((word, i) => (
  <motion.span key={i} style={{ display: 'inline-block', marginRight: '0.25em' }} variants={wordVariants}>
    {word}
  </motion.span>
))}
<TypewriterSlot />
```

---

### No Layout Shift Guarantee

- The `<TypewriterSlot>` `motion.span` has `display: inline-block` — it occupies space in the line even before `slotWidth` is measured.
- Once `slotWidth` is set (post `fonts.ready`), `minWidth` locks the container. The ghost element guarantees the width matches the longest word at the actual rendered font size.
- `whiteSpace: nowrap` prevents wrapping of multi-word phrases.
- The cursor is `inline-block` inside the slot, not outside — it never shifts the line.

---

### Files Modified

- `client/src/pages/Home.jsx` — constants, TypewriterSlot component, subtitle JSX
- `client/src/styles/global.css` — `.typewriter-cursor` and `@keyframes cursor-blink`
