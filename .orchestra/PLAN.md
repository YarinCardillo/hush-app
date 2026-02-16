# Orchestra Plan — Hush v2 Migration (Cinny Fork)

This file mirrors the project's root PLAN.md for orchestra's task tracking.
The master plan is in `/PLAN.md`. This file is read by the architect agent.

## Current Focus: Milestone 1 — Foundation & Branding

Hush v2 is a fork of Cinny with LiveKit media streaming added. This milestone establishes the foundation by applying Hush branding and design system to Cinny's codebase.

**Background:**
- Forked from Cinny v4.10.2 (working E2EE chat)
- Need to add LiveKit for media streaming
- Must preserve Hush's dark amber aesthetic
- Reference hush-app v1 at `/Users/yarin/development/hush-app` for LiveKit patterns

---

## Task Breakdown

### Milestone 1: Foundation & Branding

#### Phase 1.1: Apply Hush Design System

| Task ID | Title | Status |
|---------|-------|--------|
| 1.1.1 | Map Hush colors to Cinny theme tokens | pending |
| 1.1.2 | Update Vanilla Extract theme files | pending |
| 1.1.3 | Replace Inter font with Sora | pending |
| 1.1.4 | Test theme in dev mode | pending |

#### Phase 1.2: Update Branding

| Task ID | Title | Status |
|---------|-------|--------|
| 1.2.1 | Replace Cinny logo with Hush logo | pending |
| 1.2.2 | Update app name throughout UI | pending |
| 1.2.3 | Update index.html metadata | pending |
| 1.2.4 | Update favicon and PWA icons | pending |

#### Phase 1.3: Build & Deploy Setup

| Task ID | Title | Status |
|---------|-------|--------|
| 1.3.1 | Verify build works with new branding | pending |
| 1.3.2 | Create docker-compose.yml (future) | pending |
| 1.3.3 | Document dev setup in README | pending |

---

### Milestone 2: LiveKit Integration

#### Phase 2.1: Add Dependencies

| Task ID | Title | Status |
|---------|-------|--------|
| 2.1.1 | Install livekit-client package | pending |
| 2.1.2 | Install @livekit/components-react | pending |
| 2.1.3 | Verify TypeScript types work | pending |

#### Phase 2.2: Port LiveKit Hooks

| Task ID | Title | Status |
|---------|-------|--------|
| 2.2.1 | Convert useRoom.js to TypeScript | pending |
| 2.2.2 | Port audioProcessing.js to TS | pending |
| 2.2.3 | Port noiseGateWorklet.js | pending |
| 2.2.4 | Create LiveKit types file | pending |

#### Phase 2.3: Integrate with Cinny

| Task ID | Title | Status |
|---------|-------|--------|
| 2.3.1 | Find Cinny's voice channel component | pending |
| 2.3.2 | Wire LiveKit Room to Matrix room | pending |
| 2.3.3 | Add E2EE key distribution | pending |
| 2.3.4 | Test basic audio/video works | pending |

---

### Milestone 3: Media Features

#### Phase 3.1: Screen Sharing

| Task ID | Title | Status |
|---------|-------|--------|
| 3.1.1 | Port screen share logic from v1 | pending |
| 3.1.2 | Add click-to-watch functionality | pending |
| 3.1.3 | Test screen share E2EE | pending |

#### Phase 3.2: Quality Controls

| Task ID | Title | Status |
|---------|-------|--------|
| 3.2.1 | Port quality presets from v1 | pending |
| 3.2.2 | Create quality picker UI | pending |
| 3.2.3 | Add device picker modal | pending |

#### Phase 3.3: Audio Processing

| Task ID | Title | Status |
|---------|-------|--------|
| 3.3.1 | Integrate noise gate worklet | pending |
| 3.3.2 | Add noise gate toggle UI | pending |
| 3.3.3 | Test audio processing works | pending |

---

### Milestone 4: Polish & Documentation

#### Phase 4.1: Testing

| Task ID | Title | Status |
|---------|-------|--------|
| 4.1.1 | Test E2EE chat (Matrix) | pending |
| 4.1.2 | Test E2EE media (LiveKit) | pending |
| 4.1.3 | Test cross-browser compatibility | pending |

#### Phase 4.2: Documentation

| Task ID | Title | Status |
|---------|-------|--------|
| 4.2.1 | Update README with setup guide | pending |
| 4.2.2 | Document LiveKit integration | pending |
| 4.2.3 | Create SECURITY.md | pending |

---

## Progress Tracking

- [ ] Milestone 1: Foundation & Branding
- [ ] Milestone 2: LiveKit Integration
- [ ] Milestone 3: Media Features
- [ ] Milestone 4: Polish & Documentation

---

## Notes for Architect

### Important Differences from v1

1. **TypeScript**: All code must be TypeScript (Cinny uses TS)
2. **Vanilla Extract**: Styling uses CSS-in-TS, not plain CSS
3. **Jotai**: State management uses Jotai atoms, not plain hooks
4. **Matrix SDK v38**: Older than v1's v40, but it works

### Reference Locations

- **Hush v1**: `/Users/yarin/development/hush-app`
  - LiveKit integration: `client/src/hooks/useRoom.js`
  - Audio processing: `client/src/lib/audioProcessing.js`
  - Noise gate: `client/src/lib/noiseGateWorklet.js`
  - Design system: `client/src/styles/global.css`
  - Quality presets: `client/src/utils/constants.js`

- **Design System Colors** (from v1 global.css):
  ```
  --hush-black:        #08080c
  --hush-surface:      #101018
  --hush-elevated:     #181824
  --hush-amber:        #d4a053
  --hush-amber-bright: #e8b866
  --hush-text:         #e4e4ec
  ```

### Commit Guidelines

**IMPORTANT:** Commit and push after completing each phase (not each task).

#### When to Commit

| Event | Action |
|-------|--------|
| Phase completed (e.g., 1.1 done) | Commit + Push |
| Major feature working | Commit + Push |
| Before starting risky changes | Commit (safety checkpoint) |
| End of work session | Commit + Push |

#### Commit Format

Use conventional commits:

```
feat: <description>     # New feature
fix: <description>      # Bug fix
refactor: <description> # Code restructuring
docs: <description>     # Documentation
style: <description>    # Design/styling changes
```

#### Example Commits

```bash
# After Phase 1.1 (design system)
git add src/colors.css.ts src/config.css.ts
git commit -m "style: apply Hush dark amber theme to Cinny"
git push origin main

# After Phase 2.2 (LiveKit hooks)
git add src/livekit/
git commit -m "feat: port LiveKit hooks from hush-app v1"
git push origin main
```

---

## Dependencies

- React 18.2.0 (already in Cinny)
- TypeScript 4.9.4 (already in Cinny)
- matrix-js-sdk 38.2.0 (already in Cinny)
- livekit-client (to be added)
- @livekit/components-react (to be added)
- Vanilla Extract (already in Cinny)
- Jotai (already in Cinny)
