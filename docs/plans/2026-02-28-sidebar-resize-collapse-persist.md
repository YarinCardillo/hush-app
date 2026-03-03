# Sidebar Resize + Category Collapse Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the channel list sidebar resizable via drag handle (min 180px, max 400px, persisted to localStorage), and persist each category's collapsed/expanded state per server across sessions.

**Architecture:** A new `useSidebarResize` hook encapsulates drag + localStorage logic; `ServerLayout` owns the width and renders the resize handle. Category collapsed state is lifted from `CategorySection` local state up to `ChannelList`, which owns the map and syncs it to localStorage keyed by `serverId`.

**Tech Stack:** React hooks, localStorage, DOM mouse events (no new dependencies)

---

## Context

- `ChannelList.jsx:35-44` — `styles.panel` has `width: '260px'` and `minWidth: '260px'` hardcoded
- `ServerLayout.jsx:233-253` — renders `<ChannelList>` without any width override
- `ChannelList.jsx:485-486` — `CategorySection` has `const [collapsed, setCollapsed] = useState(false)` (local, not persisted)
- `ChannelList.jsx:1132-1143` — `groups.map(...)` renders each `CategorySection`; uncategorized group has `key === null` (no visible header, skip persistence for it)
- Frontend Vitest is not yet set up — skip test steps, implement directly

---

## Task 1: Create `useSidebarResize` hook

**Files:**
- Create: `client/src/hooks/useSidebarResize.js`

**Step 1: Create the hook**

```js
import { useState, useEffect, useCallback, useRef } from 'react';

const STORAGE_KEY = 'hush:sidebar-width';
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 180;
const MAX_WIDTH = 400;

export function useSidebarResize() {
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? parseInt(stored, 10) : NaN;
    return Number.isNaN(parsed) ? DEFAULT_WIDTH : Math.min(Math.max(parsed, MIN_WIDTH), MAX_WIDTH);
  });

  const dragState = useRef(null); // { startX, startWidth }

  const onMouseMove = useCallback((e) => {
    if (!dragState.current) return;
    const delta = e.clientX - dragState.current.startX;
    const next = Math.min(Math.max(dragState.current.startWidth + delta, MIN_WIDTH), MAX_WIDTH);
    setWidth(next);
  }, []);

  const onMouseUp = useCallback(() => {
    if (!dragState.current) return;
    dragState.current = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    setWidth((w) => {
      localStorage.setItem(STORAGE_KEY, String(w));
      return w;
    });
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [onMouseMove]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: width };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [width, onMouseMove, onMouseUp]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [onMouseMove, onMouseUp]);

  return { width, handleMouseDown };
}
```

**Step 2: Verify the file exists**

```bash
ls client/src/hooks/useSidebarResize.js
```

**Step 3: Commit**

```bash
git add client/src/hooks/useSidebarResize.js
git commit -m "feat: add useSidebarResize hook with localStorage persistence"
```

---

## Task 2: Wire resize handle into `ServerLayout`

**Files:**
- Modify: `client/src/pages/ServerLayout.jsx`

**Step 1: Import the hook**

At the top of `ServerLayout.jsx`, add to the existing React import block:

```js
import { useSidebarResize } from '../hooks/useSidebarResize';
```

**Step 2: Use the hook inside the component**

Inside `ServerLayout()`, after the existing `useState`/`useRef` declarations:

```js
const { width: sidebarWidth, handleMouseDown: handleSidebarResize } = useSidebarResize();
```

**Step 3: Add the resize handle style to `layoutStyles`**

Add this entry to the `layoutStyles` object (around line 15):

```js
resizeHandle: {
  width: '4px',
  flexShrink: 0,
  cursor: 'col-resize',
  background: 'transparent',
  transition: 'background var(--duration-fast) var(--ease-out)',
  zIndex: 10,
},
```

**Step 4: Wrap `ChannelList` and add the handle**

Replace the current `{serverId && <ChannelList ... />}` block (lines ~240-253) with:

```jsx
{serverId && (
  <>
    <div style={{ width: sidebarWidth, flexShrink: 0, display: 'flex', overflow: 'hidden' }}>
      <ChannelList
        getToken={getToken}
        serverId={serverId}
        serverName={serverData?.server?.name}
        channels={serverData?.channels}
        myRole={serverData?.myRole}
        activeChannelId={channelId}
        onChannelSelect={handleChannelSelect}
        onChannelsUpdated={handleChannelsUpdated}
        voiceParticipantCounts={null}
      />
    </div>
    <div
      style={layoutStyles.resizeHandle}
      onMouseDown={handleSidebarResize}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hush-border)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize channel list"
    />
  </>
)}
```

**Step 5: Remove the hardcoded width from `ChannelList` styles**

In `ChannelList.jsx:35-44`, change `styles.panel`:

```js
// Before:
panel: {
  width: '260px',
  minWidth: '260px',
  ...
}

// After:
panel: {
  width: '100%',
  minWidth: 0,
  ...
}
```

The parent wrapper div in `ServerLayout` now controls the width entirely.

**Step 6: Verify visually**

Run `npm run dev` (or the project's dev command) and confirm:
- The sidebar is draggable by grabbing the 4px edge between channel list and main area
- Width is clamped at 180px (min) and 400px (max)
- After refresh, width is restored from localStorage

**Step 7: Commit**

```bash
git add client/src/pages/ServerLayout.jsx client/src/components/ChannelList.jsx
git commit -m "feat: resizable channel list sidebar with localStorage persistence"
```

---

## Task 3: Persist category collapsed state in `ChannelList`

**Files:**
- Modify: `client/src/components/ChannelList.jsx`

### Part A: Lift collapsed state to `ChannelList`

**Step 1: Add the `useCollapsedCategories` helper at the top of the file (after imports)**

```js
function loadCollapsedMap(serverId) {
  try {
    const raw = localStorage.getItem(`hush:categories-collapsed:${serverId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCollapsedMap(serverId, map) {
  try {
    localStorage.setItem(`hush:categories-collapsed:${serverId}`, JSON.stringify(map));
  } catch {
    // localStorage not available — silently ignore
  }
}
```

**Step 2: Add collapsed state to `ChannelList` component**

Inside `export default function ChannelList({ ... })`, after the existing `useState` block (~line 787):

```js
const [collapsedMap, setCollapsedMap] = useState(() => loadCollapsedMap(serverId));

// Re-initialize when switching servers
useEffect(() => {
  setCollapsedMap(loadCollapsedMap(serverId));
}, [serverId]);

const handleToggleCollapsed = useCallback((categoryKey) => {
  setCollapsedMap((prev) => {
    const next = { ...prev, [categoryKey]: !prev[categoryKey] };
    saveCollapsedMap(serverId, next);
    return next;
  });
}, [serverId]);
```

**Step 3: Pass `collapsed` and `onToggle` to `CategorySection` in the render**

Find the `groups.map((group) => ...)` block (~line 1132) and update:

```jsx
{groups.map((group) => (
  <CategorySection
    key={group.key ?? 'uncategorized'}
    group={group}
    collapsed={group.key !== null ? (collapsedMap[group.key] ?? false) : undefined}
    onToggleCollapsed={group.key !== null ? () => handleToggleCollapsed(group.key) : undefined}
    activeChannelId={activeChannelId}
    onChannelSelect={onChannelSelect}
    voiceParticipantCounts={voiceParticipantCounts}
    isAdmin={isAdmin}
    onDeleteCategory={(id, name) => setConfirmDelete({ id, name, isCategory: true })}
    onDeleteChannel={(ch) => setConfirmDelete({ id: ch.id, name: ch.name, isCategory: false })}
  />
))}
```

### Part B: Update `CategorySection` to use props

**Step 4: Update `CategorySection` signature**

Change line 485:

```js
// Before:
function CategorySection({ group, activeChannelId, onChannelSelect, voiceParticipantCounts, isAdmin, onDeleteCategory, onDeleteChannel }) {
  const [collapsed, setCollapsed] = useState(false);

// After:
function CategorySection({ group, collapsed = false, onToggleCollapsed, activeChannelId, onChannelSelect, voiceParticipantCounts, isAdmin, onDeleteCategory, onDeleteChannel }) {
```

Remove the `const [collapsed, setCollapsed] = useState(false);` line entirely.

**Step 5: Replace `setCollapsed((c) => !c)` with `onToggleCollapsed`**

Find line 576:
```jsx
onClick={() => setCollapsed((c) => !c)}
```
Replace with:
```jsx
onClick={() => onToggleCollapsed?.()}
```

**Step 6: Verify**

- Run the dev server
- Collapse a category, refresh the page → it should remain collapsed
- Switch to another server → collapsed state is per-server
- Expand it → refresh → expanded state is restored

**Step 7: Commit**

```bash
git add client/src/components/ChannelList.jsx
git commit -m "feat: persist category collapsed state per server in localStorage"
```

---

## Checklist

- [ ] `useSidebarResize.js` created and exported correctly
- [ ] Sidebar drag handle visible between channel list and main content
- [ ] Width clamped to [180, 400] px
- [ ] Width persists across page refresh
- [ ] Hover on handle shows `var(--hush-border)` highlight
- [ ] Category collapse state persists per server across refresh
- [ ] Switching servers loads that server's own collapsed state
- [ ] No regressions: DnD still works, category delete still works
