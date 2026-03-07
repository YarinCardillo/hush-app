---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: completed
stopped_at: Completed K.4-02-PLAN.md
last_updated: "2026-03-06T10:35:39Z"
last_activity: 2026-03-06 — K.4-02 complete. EmitSystemMessage wired into all 7 moderation/membership handlers + background cleanup goroutine. 7 new tests, all pass.
progress:
  total_phases: 7
  completed_phases: 6
  total_plans: 21
  completed_plans: 20
  percent: 95
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-03)

**Core value:** Every message, every call, every screen share is end-to-end encrypted by default. The server is a blind relay.
**Current focus:** Phase K.4 — System Messages (plan 02 of 03 complete)

## Current Position

Phase: K.4 of active phases (System Messages)
Plan: 2 of 3 (K.4-02 complete)
Status: K.4-02 complete, ready for K.4-03
Last activity: 2026-03-06 — K.4-02 complete. EmitSystemMessage wired into all 7 moderation/membership handlers + background cleanup goroutine. 7 new tests, all pass.

Progress: [█████████░] 95% (20 of 21 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 0 (active phases)
- Average duration: unknown
- Total execution time: unknown

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-|-|-|-|
| A-E (complete) | - | - | - |

**Recent Trend:** N/A — active phase tracking begins at E+
| Phase E+ P01 | 20 | 2 tasks | 9 files |
| Phase E+ P02 | 15 | 2 tasks | 8 files |
| Phase E+ P03 | 12 | 2 tasks | 8 files |
| Phase E+ P04 | 45 | 2 tasks | 9 files |
| Phase 0F P02 | 15 | 2 tasks | 8 files |
| Phase 0F P01 | 15 | 2 tasks | 8 files |
| Phase 0F P03 | 10 | 2 tasks | 6 files |
| Phase 0F P05 | 10 | 2 tasks | 3 files |
| Phase E+2 P03 | 35 | 2 tasks | 9 files |
| Phase E+2-04 P04 | 11 | 2 tasks | 12 files |
| Phase E+2-04 P04 | 120 | 3 tasks | 12 files |
| Phase E+2-multi-tenant-restoration P05 | 8 | 2 tasks | 6 files |
| Phase E+2.5-critical-integration-fixes P01 | 183 | 2 tasks | 8 files |
| Phase E+2.5-critical-integration-fixes P02 | 25 | 2 tasks | 10 files |
| Phase 0F P02 | 5 | 2 tasks | 10 files |
| Phase 0F P01 | 5 | 2 tasks | 6 files |
| Phase 0F P03 | 10 | 2 tasks | 4 files |
| Phase 0F P04 | 2 | 2 tasks | 0 files |
| Phase G P01 | 5 | 2 tasks | 9 files |
| Phase G P02 | 3 | 1 task | 2 files |
| Phase K.1 P01 | 4 | 2 tasks | 6 files |
| Phase K.4 P01 | 6 | 2 tasks | 12 files |
| Phase K.4 P02 | 8 | 2 tasks | 7 files |

## Accumulated Context

### Decisions

From PROJECT.md Key Decisions table — decisions relevant to active phases:

- **Multi-tenant model:** 1 backend hosts N guilds (reversed from single-tenant E+). servers/server_members restored in E+2.
- **Moderation = actor identity, never content:** Backend never sees plaintext. All moderation operates on user_id, role, session state only.
- **BIP39 cryptographic identity (decided 2026-03-07):** Identity is a keypair derived from a BIP39 12-word mnemonic. Server stores only public keys — no email, no password, no blob. Multi-device via QR-based device certification. Recovery is mnemonic-only; neither devices nor words = irrecoverable. JWT remains as session token after challenge-response auth. Guest access uses ephemeral keypairs (no mnemonic). Current email/password auth is placeholder to be replaced in Phase J (now on MVP path after B.7, before I).
- **SPK grace period:** 7 days. Old SPK private key retained in signal_spk_history. Eager deletion breaks in-transit sessions.
- [Phase E+]: SetInstanceOwner uses UPDATE WHERE owner_id IS NULL for atomic first-register race safety
- [Phase E+]: GlobalBroadcaster interface replaces ServerBroadcaster; hub fans out to all connected clients
- [Phase E+]: First-user bootstrap in register handler via SetInstanceOwner (atomic WHERE owner_id IS NULL)
- [Phase E+]: Frontend routes flat: /channels/:channelId replaces /server/:serverId/channel/:channelId
- [Phase E+]: VoiceChannel LiveKit room name changed to channel-{id} (no server scoping)
- [Phase E+]: Shared test helpers (makeAuth, postServerJSON, etc.) live in mock_store_test.go; no servers_test.go
- [Phase E+]: messageStoreMock in ws/handlers_test.go must stay in sync with db.Store (no server methods)
- [Phase 0F P01]: IPRateLimiter uses golang.org/x/time/rate token bucket — no external dependencies
- [Phase 0F P01]: WS rate limit on message.send only; control messages (auth, subscribe, typing) are never rate-limited
- [Phase 0F P01]: WSOriginFromCORSOrigin exported for reuse when building CSP connect-src
- [Phase 0F]: Active ban/mute query: lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now())
- [Phase 0F]: DeleteSessionsByUserID added to Store interface in Plan 02 for kick/ban token invalidation
- [Phase 0F]: GlobalBroadcaster extended with BroadcastToUser and DisconnectUser — Hub had both methods; interface was lagging
- [Phase 0F]: Mute check at Handle() dispatch level blocks message.send, typing.start, typing.stop — isMuted() fails open on DB error for availability
- [Phase 0F]: deleteMessage audit log uses 'message deleted' reason for self-deletions (no user reason required for own message)
- [Phase 0F]: Context menu uses ROLE_RANK map: actor rank must strictly exceed target rank to see actions
- [Phase 0F]: showToast and onMemberUpdate owned by ServerLayout, passed as props to MemberList instances
- [Phase 0F]: testAuthMiddlewareFor helper injects userID into context to avoid running full RequireAuth stack in rate limiter unit tests
- [Phase E+2]: Forward migration 000007 adds servers/server_members on top of E+ single-tenant schema; all new FK columns nullable for existing row safety
- [Phase E+2]: IsChannelMember uses server_members JOIN instead of flat users check — guild membership required for channel access
- [Phase E+2]: GuildBillingStats exposes exactly 5 fields (id, member_count, storage_bytes, owner_id, created_at) — privacy boundary prevents guild content leakage to instance operator
- [Phase E+2]: ServerRoutes mounts channels/invites/moderation sub-routers inline under /{serverId} to avoid chi route conflicts
- [Phase E+2]: Guild ban in claimInvite is guild-scoped via GetActiveBan(serverID, userID) — user can still use other guilds (IROLE-04)
- [Phase E+2]: isMuted in ws/handlers.go uses resolveServerIDFromPayload to get serverID from channel lookup before GetActiveMute
- [Phase E+2]: Guild context injection via withGuildContext wrapper for isolated handler tests without full chi router stack
- [Phase E+2]: TestBan_GuildScoped uses full ServerRoutes to resolve chi URL params so ban serverID reflects real guild routing (IROLE-04 verified)
- [Phase E+2-04]: HomeRoute redirects authenticated users to first guild; no-guild state shows /guilds route with ServerLayout
- [Phase E+2-04]: Guild icon colors derived deterministically from guild ID hash against 10-color palette
- [Phase E+2-04]: ChannelList collapsed state key uses collapsed_${serverId} per-guild to prevent cross-guild state leakage
- [Phase E+2-04]: User-facing labels say 'server' not 'guild' — product language is server, internal code uses guild
- [Phase E+2-04]: WS send() no-ops silently when socket not yet open; open-event listener retries subscribe on connect
- [Phase E+2-05]: changeUserRole calls /api/servers/:serverId/members/:userId/role (not /moderation/role) — route mounted on ServerRoutes directly
- [Phase E+2-05]: All client API mutations for guild resources pass serverId as second param after token
- [Phase E+2.5-critical-integration-fixes]: getChannelMessages takes serverId as 2nd parameter; path is now /api/servers/:serverId/channels/:channelId/messages
- [Phase E+2.5-critical-integration-fixes]: DisconnectUser called inside if h.hub != nil guard after BroadcastToServer in kickMember and banMember
- [Phase E+2.5-critical-integration-fixes]: Kick/ban shows toast with server name then navigates to next guild or /guilds — no logout() call
- [Phase E+2.5-critical-integration-fixes]: BanMuteListModal fetches bans and mutes in parallel on open; gear icon in ChannelList header visible to admin/owner only; showToast passed from ServerLayout as optional prop
- [Phase 0F]: Mute check at LiveKit token endpoint fails open on DB error — availability over restriction, consistent with WS isMuted() pattern
- [Phase 0F]: VoiceChannel auto-leaves on mute error (error.includes('muted')) — avoids stuck error screen requiring manual Leave click
- [Phase 0F-01]: Migration 000008 uses CREATE/DROP INDEX IF NOT EXISTS for idempotency; partial indices (WHERE lifted_at IS NULL) cover active-only ban/mute queries; AuditLogFilter passed as *pointer so nil means no filter; dynamic WHERE clause built by appending args with incremented paramIdx
- [Phase 0F-03]: User search in AuditLogModal uses parallel actor_id + target_id requests merged client-side for OR semantics
- [Phase 0F-03]: members prop added to ChannelList and passed from ServerLayout for username resolution in AuditLogModal
- [Phase 0F]: No code changes required in 0F-04: all 17 requirements (MOD-01 through MOD-09, SEC-01 through SEC-08) satisfied by code shipped in 0F-01/02/03 and E+2 phases; go test ./... exits 0
- [Phase G]: Instance ban cascade order: revoke sessions first, then disconnect WS, then insert ban record, then remove from guilds -- prevents race condition where user joins guild during cascade
- [Phase G]: Instance audit log viewable by owner only (tightest access, consistent with billing endpoint pattern)
- [Phase G]: Admin cannot ban another admin -- only owner can ban admin-level users
- [Phase G]: Config change audit log captures old/new values per changed field in metadata JSONB
- [Phase G]: Silent guild removal on instance ban -- guild members see member_left events, no indication it was instance-level (blind relay preserved)
- [Phase G P02]: Admin tabs kept inside UserSettingsModal.jsx as internal components (no new files) -- consistent with existing AccountTab/AppearanceTab/AudioVideoTab pattern
- [Phase G P02]: ROLE_RANK map used in frontend to enforce ban button only shows when actor rank strictly exceeds target rank
- [Phase G P02]: Mobile tab bar uses horizontal scroll (overflowX: auto) to accommodate all 6 tabs
- [Phase K.1]: sync.RWMutex for InstanceCache (simplest correct concurrency pattern per user decision)
- [Phase K.1]: Handshake route mounted outside auth block alongside /api/health -- truly public endpoint
- [Phase K.1]: Cache seeded on startup with graceful fallback for missing instance_config row
- [Phase K.1]: Cache refresh in updateConfig happens before WS broadcast to ensure consistency
- [Phase K.4]: EmitSystemMessage is fire-and-forget (logs errors, does not return them) -- consistent with audit log pattern
- [Phase K.4]: System channel position is -1 to sort before all user-created channels
- [Phase K.4]: System channel creation failure in createServer is logged but does not fail guild creation
- [Phase K.4 P02]: EmitSystemMessage placed after InsertAuditLog in all handlers for consistent ordering
- [Phase K.4 P02]: Ban/mute metadata reused from audit log (contains expires_in) -- no duplication
- [Phase K.4 P02]: Cleanup goroutine has no shutdown signal -- process exit terminates it, 30s context timeout prevents leaked connections

### Pending Todos

None yet.

### Blockers/Concerns

- ~~**E+ open question:** invite_codes table~~ — resolved by E+2; invite_codes restored with server_id FK.
- **Phase J migration:** Replacing email/password auth with BIP39 identity requires schema migration (drop email/password_hash from users, add device_keys table with per-account certified public key list). Plan during B.7 or early J.
- **B.7 schema review needed:** signal_identity_keys stores one SPK per device; needs extension for version history. Read signal-theory-context.md before implementation.
- **I.3 LiveKit NAT bug:** GitHub issue #4095 (use_external_ip ignored when turn_servers configured). Verify against current docker-compose.yml LiveKit version before writing setup.sh.

## Session Continuity

Last session: 2026-03-06T10:35:39Z
Stopped at: Completed K.4-02-PLAN.md
Resume file: None
Branch: phase-K.4-system-messages
Notes: K.4-02 complete. EmitSystemMessage wired into kick, ban, unban, mute, unmute, claimInvite, changeRole. Background cleanup goroutine in main.go. 7 new emission tests. All tests pass, build clean.
