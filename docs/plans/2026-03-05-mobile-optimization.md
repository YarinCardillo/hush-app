# Mobile UI Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Hush frontend usable on mobile (< 640px) by implementing Discord-style drawer navigation — hiding the guild strip + channel list into a left slide-out drawer and making chat/voice content fill the screen.

**Architecture:** On mobile, ServerLayout renders ServerList + ChannelList inside a fixed-position left drawer panel instead of in the normal flex flow. A hamburger button in the content header toggles the drawer. Channel selection auto-closes the drawer. The existing `.sidebar-panel-right` pattern for the members overlay is reused for the left side (mirrored). Desktop layout is completely unchanged — all changes are gated behind `isMobile`.

**Tech Stack:** React (useState/useCallback), CSS transitions (translateX), existing `useBreakpoint()` hook

---

### Task 1: Add left-drawer CSS classes to global.css

**Files:**
- Modify: `client/src/styles/global.css:710-790`

**Step 1: Add `.sidebar-panel-left` CSS**

Add these classes directly after the `.sidebar-panel-right` block (after line 755):

```css
/* ── Left drawer panel (mobile channel navigation) ─────── */

.sidebar-panel-left {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: calc(56px + 260px);  /* guild strip + channel list */
  max-width: 85vw;
  z-index: 50;
  background: var(--hush-surface);
  display: flex;
  flex-direction: row;
  overflow: hidden;
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
  transform: translateX(-100%);
  transition: transform 400ms var(--ease-out);
}

.sidebar-panel-left.sidebar-panel-open {
  transform: translateX(0);
}

.sidebar-panel-left:not(.sidebar-panel-open) {
  pointer-events: none;
}
```

**Step 2: Verify CSS compiles**

Run: `cd /home/yarin/hush-app/client && npx vite build --mode development 2>&1 | head -5`
Expected: No CSS errors

**Step 3: Commit**

```bash
git add client/src/styles/global.css
git commit -m "feat(mobile): add left drawer panel CSS classes"
```

---

### Task 2: Add mobile drawer state and hamburger to ServerLayout

**Files:**
- Modify: `client/src/pages/ServerLayout.jsx:105-770`

This is the core change. On mobile, ServerList + ChannelList move from normal flow into a left drawer overlay.

**Step 1: Add drawer state**

In ServerLayout, after `const isMobile = breakpoint === 'mobile';` (line 143), add:

```javascript
const [showDrawer, setShowDrawer] = useState(false);
const closeDrawer = useCallback(() => setShowDrawer(false), []);
const toggleDrawer = useCallback(() => setShowDrawer(p => !p), []);
```

**Step 2: Auto-close drawer on channel navigation**

Add a useEffect that closes the drawer whenever the channelId changes (user selected a channel):

```javascript
// Close mobile drawer when navigating to a channel
useEffect(() => {
  if (isMobile) setShowDrawer(false);
}, [channelId, isMobile]);
```

**Step 3: Close drawer on guild switch**

In the existing `handleGuildSelect` function, add `setShowDrawer(false)` at the end (after the navigate call).

**Step 4: Modify the render — mobile conditional**

Replace the render block (lines 572-766) with mobile-conditional layout. The key change:

**Desktop (unchanged):** ServerList and ChannelList render in-flow as before.

**Mobile:** ServerList and ChannelList render inside the left drawer panel:

```jsx
{/* ── Left navigation: in-flow on desktop, drawer on mobile ── */}
{!isMobile && (
  <>
    <ServerList
      getToken={getToken}
      guilds={guilds}
      activeGuild={activeGuild}
      onGuildSelect={handleGuildSelect}
      onGuildCreated={handleGuildCreated}
      instanceData={instanceData}
      userRole={myRole}
    />
    <div style={{ width: sidebarWidth, flexShrink: 0, display: 'flex', overflow: 'hidden' }}>
      <ChannelList
        getToken={getToken}
        serverId={serverId}
        guildName={activeGuild?.name}
        instanceData={instanceData}
        channels={channels}
        myRole={myRole}
        activeChannelId={channelId}
        onChannelSelect={handleChannelSelect}
        onChannelsUpdated={handleChannelsUpdated}
        voiceParticipants={voiceParticipants}
        showToast={showToast}
        members={members}
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

{isMobile && (
  <>
    <div
      className={`sidebar-overlay ${showDrawer ? 'sidebar-overlay-open' : ''}`}
      onClick={closeDrawer}
      aria-hidden={!showDrawer}
    />
    <div className={`sidebar-panel-left ${showDrawer ? 'sidebar-panel-open' : ''}`}>
      <ServerList
        getToken={getToken}
        guilds={guilds}
        activeGuild={activeGuild}
        onGuildSelect={handleGuildSelect}
        onGuildCreated={handleGuildCreated}
        instanceData={instanceData}
        userRole={myRole}
        compact
      />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ChannelList
          getToken={getToken}
          serverId={serverId}
          guildName={activeGuild?.name}
          instanceData={instanceData}
          channels={channels}
          myRole={myRole}
          activeChannelId={channelId}
          onChannelSelect={handleChannelSelect}
          onChannelsUpdated={handleChannelsUpdated}
          voiceParticipants={voiceParticipants}
          showToast={showToast}
          members={members}
        />
      </div>
    </div>
  </>
)}
```

**Step 5: Pass `onToggleDrawer` to TextChannel and placeholder header**

Pass `onToggleDrawer={isMobile ? toggleDrawer : undefined}` as a prop to TextChannel and to the no-channel placeholder header.

For the placeholder "select a channel" state, when isMobile is true, add a mobile header with hamburger:

```jsx
{!currentChannel && isMobile && (
  <header style={layoutStyles.channelAreaHeader}>
    <button type="button" onClick={toggleDrawer} style={layoutStyles.hamburgerBtn}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    </button>
    <button type="button" style={layoutStyles.membersToggle} onClick={() => togglePanel('members')} aria-pressed={showMembers}>
      Members
    </button>
  </header>
)}
```

**Step 6: Add `hamburgerBtn` to `layoutStyles`**

```javascript
hamburgerBtn: {
  width: 44,
  height: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'none',
  border: 'none',
  color: 'var(--hush-text-secondary)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
},
```

**Step 7: Verify in browser**

Open https://hushdev.duckdns.org in a 390x844 viewport. Expected:
- Full-width content area visible
- Hamburger icon in top-left
- Tapping hamburger slides channel drawer in from left
- Selecting a channel auto-closes drawer

**Step 8: Commit**

```bash
git add client/src/pages/ServerLayout.jsx
git commit -m "feat(mobile): drawer navigation for guild/channel list on mobile"
```

---

### Task 3: Add hamburger button to TextChannel header on mobile

**Files:**
- Modify: `client/src/pages/TextChannel.jsx:62-111`

**Step 1: Accept new prop**

Add `onToggleDrawer` to TextChannel's destructured props (line 62):

```javascript
export default function TextChannel({
  channel,
  serverId,
  getToken,
  wsClient,
  recipientUserIds = [],
  members = [],
  showMembers = false,
  onToggleMembers,
  onToggleDrawer,  // NEW — mobile hamburger
  sidebarSlot = null,
}) {
```

**Step 2: Add hamburger to header**

Modify the `<header>` JSX (lines 81-93) to include the hamburger button before the channel name when `onToggleDrawer` is provided:

```jsx
<header style={styles.header}>
  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
    {onToggleDrawer && (
      <button
        type="button"
        onClick={onToggleDrawer}
        style={{
          width: 44, height: 44,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none',
          color: 'var(--hush-text-secondary)', cursor: 'pointer',
          padding: 0, flexShrink: 0,
        }}
        aria-label="Toggle channels"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
    )}
    <span style={styles.channelName}>#{channel.name}</span>
  </div>
  {onToggleMembers && (
    <button type="button" style={styles.membersToggle} onClick={onToggleMembers} aria-pressed={showMembers}>
      Members
    </button>
  )}
</header>
```

**Step 3: Verify in browser**

Navigate to a text channel on mobile (390x844). Expected:
- Hamburger icon visible before `#general`
- Tapping hamburger opens the left drawer
- Members button still visible on right

**Step 4: Commit**

```bash
git add client/src/pages/TextChannel.jsx
git commit -m "feat(mobile): hamburger button in TextChannel header"
```

---

### Task 4: Compact mode for ServerList in mobile drawer

**Files:**
- Modify: `client/src/components/ServerList.jsx:1-230`

**Step 1: Accept `compact` prop**

Add `compact = false` to ServerList's destructured props (line 153):

```javascript
export default function ServerList({
  getToken,
  guilds = [],
  activeGuild = null,
  onGuildSelect,
  onGuildCreated,
  instanceData,
  userRole = 'member',
  compact = false,
}) {
```

**Step 2: Use narrower width when compact**

Change the strip style in the JSX (line 174). Replace the static `style={styles.strip}` with dynamic:

```jsx
<div style={{
  ...styles.strip,
  ...(compact ? { width: 56, minWidth: 56 } : {}),
}}>
```

**Step 3: Verify**

Open drawer on mobile. Guild strip should be 56px instead of 72px, giving more room to the channel list.

**Step 4: Commit**

```bash
git add client/src/components/ServerList.jsx
git commit -m "feat(mobile): compact mode for ServerList in drawer"
```

---

### Task 5: Fix Home.jsx tagline truncation on mobile

**Files:**
- Modify: `client/src/pages/Home.jsx:238-243`

**Step 1: Fix subtitle style**

The logoSub style (line 238-243) has no explicit wrapping. On small viewports the tagline "share your screen. keep your privacy." truncates. Change:

```javascript
logoSub: {
  marginTop: '0px',
  color: 'var(--hush-text-secondary)',
  fontSize: '0.9rem',
  fontWeight: 400,
  textAlign: 'center',
  lineHeight: 1.4,
},
```

Also scale the logo font size down on very small screens by wrapping the `fontSize: '8rem'` in the logoTitle style. Add responsive sizing:

```javascript
logoTitle: {
  fontFamily: "'Cormorant Garamond', Georgia, serif",
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 'clamp(4rem, 15vw, 8rem)',
  letterSpacing: '0.06em',
  color: 'var(--hush-text)',
  textTransform: 'lowercase',
},
```

**Step 2: Verify**

Open https://hushdev.duckdns.org/login at 390x844. Tagline should wrap gracefully, logo should scale.

**Step 3: Commit**

```bash
git add client/src/pages/Home.jsx
git commit -m "fix(mobile): responsive logo sizing and tagline wrapping on Home"
```

---

### Task 6: Visual verification at 390x844

**Files:** None (testing only)

**Step 1: Test channel drawer**

At 390x844 viewport:
1. Open app, logged in — content area should fill screen
2. Tap hamburger — drawer slides in from left with guild strip + channels
3. Tap a text channel — drawer closes, chat fills screen
4. Tap hamburger again — drawer re-opens
5. Select a voice channel — drawer closes, VoiceChannel renders full-width

**Step 2: Test members panel**

1. In a text channel, tap "Members" — right overlay slides in
2. Tap dimming overlay — members panel closes
3. Members panel should NOT conflict with left drawer (z-index separated)

**Step 3: Test guild switching**

1. Open drawer, tap different guild icon
2. Channel list should refresh, drawer should close

**Step 4: Test landing page**

1. Navigate to /login — logo scales, tagline wraps
2. Sign-in form fills width correctly

**Step 5: Test desktop not broken**

1. Resize to 1280x800
2. ServerList + ChannelList should render in-flow (not in drawer)
3. Resize handle should be visible and functional
4. Members sidebar should be in-flow (not overlay)

**Step 6: Final commit (if any fixes needed)**

```bash
git add -u
git commit -m "fix(mobile): visual polish from 390x844 viewport testing"
```
