# Mobile UI Optimization Design

## Problem

On mobile (390px viewport), the desktop 3-column layout (ServerList 72px + ChannelList 260px + content) leaves only ~58px for the content area. Chat is invisible, members overflow off-screen, and the app is unusable.

## Solution: Discord-style Drawer Navigation

On mobile (`< 640px`), hide the server strip and channel list from the normal document flow. Show a single-column layout with full-width content and drawer navigation.

### Mobile Layout

```
┌──────────────────────────┐
│ [☰]  #general       [👥]│  ← 48px header
├──────────────────────────┤
│                          │
│    Chat / Voice          │
│    (full width)          │
│                          │
├──────────────────────────┤
│  Message input           │
└──────────────────────────┘
```

### Left Drawer (hamburger tap or swipe-right)

```
┌─────┬──────────────┬────┐
│Guild│  Channel     │    │
│Strip│  List        │dim │
│56px │  ~260px      │ovly│
│     │              │    │
│  TG │ # general    │    │
│     │ 🎤 Voice     │    │
│  +  │              │    │
│  ⚙  │              │    │
└─────┴──────────────┴────┘
```

### Right Drawer (members icon tap)

Already implemented via `.sidebar-panel-right` CSS class. No changes needed.

## Changes

### ServerLayout.jsx
- Add `showChannelDrawer` state (boolean)
- On mobile: wrap ServerList + ChannelList in a left drawer overlay instead of rendering them in-flow
- Add hamburger button to mobile header
- Close drawer when channel is selected (navigate closes drawer)
- Hide resize handle on mobile

### global.css
- Add `.sidebar-panel-left` class (mirror of `.sidebar-panel-right` but from left edge)
- Add `.sidebar-overlay-left` for left drawer dimming
- Add `.mobile-header` for the mobile-only top bar with hamburger + channel name + members toggle

### TextChannel.jsx
- Accept `onToggleDrawer` prop for hamburger button in header
- On mobile: replace channel name header with mobile header (hamburger + name + members button)

### ServerList.jsx
- When inside mobile drawer, use narrower width (56px instead of 72px)

### Home.jsx
- Fix tagline truncation on small viewports (allow wrapping)

## Design Constraints
- Follows design-system.md breakpoints: mobile <640px
- Touch targets: 52px buttons on mobile
- Uses existing CSS overlay/panel animation patterns (400ms cubic-bezier)
- No new state management — just a boolean toggle in ServerLayout
- Desktop layout completely unchanged
- VoiceChannel mobile already works (no changes needed)

## Implementation Order
1. CSS classes for left drawer
2. ServerLayout mobile drawer logic
3. TextChannel mobile header
4. ServerList width adjustment
5. Home.jsx tagline fix
6. Test all views at 390x844
