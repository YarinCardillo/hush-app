---
phase: K.6-cross-phase-integration-wiring
plan: "01"
subsystem: api, ui
tags: [websocket, broadcast, system-messages, go, react]

requires:
  - phase: K.4-system-messages
    provides: EmitSystemMessage, SystemMessageRow component, system channel
  - phase: K.1-instance-cache
    provides: InstanceCache, handshake endpoint, updateConfig handler

provides:
  - "Enriched instance_updated WS broadcast with name, icon_url, registration_mode fields"
  - "server_created event styling in SystemMessageRow (orange border, correct label)"
  - "template_partial_failure event styling in SystemMessageRow (amber border, warning text)"

affects:
  - ServerLayout.jsx (consumes instance_updated data fields)
  - SystemChannel (renders server_created and template_partial_failure events)

tech-stack:
  added: []
  patterns:
    - "Fetch updated config outside the cache block so it is available to both cache refresh and WS broadcast"
    - "broadcastAllCapture test helper captures BroadcastToAll calls without modifying the shared mockHub"

key-files:
  created: []
  modified:
    - server/internal/api/instance.go
    - server/internal/api/instance_test.go
    - client/src/components/SystemMessageRow.jsx

key-decisions:
  - "newCfg fetched unconditionally after UpdateInstanceConfig so both cache and broadcast use the same post-update value"
  - "When config re-fetch fails after update, broadcast sends type-only payload rather than stale or missing data"
  - "server_created uses #d54f12 Hush orange (positive/creative event); template_partial_failure uses #f59e0b amber (warning, matches member_muted)"

requirements-completed: [MTNT-06, INST-04]

duration: 12min
completed: 2026-03-16
---

# Phase K.6 Plan 01: Cross-Phase Integration Wiring Summary

**Enriched instance_updated WS broadcast carries name/icon_url/registration_mode so live config changes propagate without reload; server_created and template_partial_failure system events now render with correct colors and text in SystemMessageRow.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-16T14:05:00Z
- **Completed:** 2026-03-16T14:17:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- instance_updated broadcast now includes `name`, `icon_url`, and `registration_mode` — ServerLayout handler can apply live config updates without a page reload
- server_created system event renders with Hush orange (#d54f12) border and "created the server" text
- template_partial_failure system event renders with amber (#f59e0b) border and "some default channels could not be created" text
- TestUpdateConfig_BroadcastPayload added to instance_test.go using a broadcastAllCapture helper that records BroadcastToAll calls

## Task Commits

1. **Task 1: Enrich instance_updated WS broadcast payload** - `270fb08` (feat)
2. **Task 2: Add server_created and template_partial_failure to SystemMessageRow** - `1bc842b` (feat)

## Files Created/Modified

- `server/internal/api/instance.go` - Moved newCfg fetch outside cache block; broadcast payload now includes three config fields
- `server/internal/api/instance_test.go` - Added TestUpdateConfig_BroadcastPayload with broadcastAllCapture type
- `client/src/components/SystemMessageRow.jsx` - Added server_created and template_partial_failure to EVENT_CONFIG and buildMessageText

## Decisions Made

- newCfg is fetched unconditionally after `UpdateInstanceConfig` (was previously inside `if h.cache != nil`). This makes it available to both the cache refresh and the broadcast without a second DB round-trip.
- When the post-update config fetch fails, the broadcast still fires with a type-only payload (`{"type":"instance_updated"}`) rather than being silently dropped. Clients receive the event and can fall back to re-fetching if needed.
- server_created uses #d54f12 (Hush orange) — positive/creative event. template_partial_failure uses #f59e0b (amber) — matches member_muted warning color and signals a non-fatal setup issue.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The `newCfg` variable in the original code was scoped inside `if h.cache != nil { ... }`, making it inaccessible to the broadcast block below. The fix was to hoist the `GetInstanceConfig` call to function scope and conditionally apply both the cache update and the broadcast payload — a straightforward scope correction required to implement the plan as specified.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- instance_updated now carries all fields ServerLayout needs for live updates
- System channel displays server_created and template_partial_failure events with correct styling
- K.6-02 (getHandshake/leaveGuild API additions) was already committed in this branch

---
*Phase: K.6-cross-phase-integration-wiring*
*Completed: 2026-03-16*
