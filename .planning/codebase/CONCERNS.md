# Codebase Concerns

**Analysis Date:** 2026-03-03

## Tech Debt

### Signal Protocol Key Rotation Not Automated

**Issue:** SPK (signed pre-key) rotation and OPK (one-time pre-key) replenishment infrastructure is in place but not yet automated.

**Files:**
- `client/src/lib/signalStore.js` (lines 285-286)
- `server/internal/api/keys.go` (pre-key endpoints)
- `signal-theory-context.md` (SPK Rotation section)

**Impact:** Keys will gradually expire without server-side enforcement or client-side automatic refresh. Clients with depleted OTP pools will fall back to insecure fallback mechanisms or fail to establish new sessions.

**Fix approach:**
1. Implement server-side scheduled job (cron task) to clean up expired SPKs and trigger client refresh
2. Add client-side background task (Service Worker or periodic React effect) to detect OTP depletion and re-upload
3. Add HTTP 410 Gone response from pre-key endpoint when bundle is stale, triggering client re-registration
4. Phase B.7 covers this automation

### Message Cache Eviction Not Implemented

**Issue:** Decrypted message cache in IndexedDB (B.5 feature) lacks automatic eviction and invalidation logic.

**Files:**
- `client/src/lib/signalStore.js` (lines 285-286, TODO comments)

**Impact:** IndexedDB storage grows unbounded over time. Old cached messages don't clear on identity key changes (re-registration), leaving stale plaintext in client storage.

**Fix approach:**
1. Implement cache entry TTL (e.g., delete entries older than 30 days)
2. Add invalidation hook in sign-out and re-registration flows
3. Optionally implement LRU eviction when cache exceeds size limit

### Guest Room Countdown Not Re-implemented

**Issue:** Guest room timeout (automatic disconnect after N minutes) was removed during refactor to Go backend but not yet reimplemented.

**Files:**
- `client/src/pages/Room.jsx` (line 507, TODO comment)

**Impact:** Guests with default permissions have unlimited session duration, violating Phase E single-server architecture model (guests should have limited access duration).

**Fix approach:**
1. Add `guest_expires_at` column to `sessions` table or implement guest session TTL
2. Add countdown UI in Room component
3. Gracefully disconnect and show message when guest session expires

---

## Known Bugs

### No Silent E2EE Degradation Check

**Issue:** If LiveKit E2EE worker fails to load or key exchange fails, media will connect WITHOUT encryption instead of failing loudly.

**Files:**
- `client/src/hooks/useRoom.js` (line 46: `mediaE2EEUnavailable` flag)
- `client/src/lib/e2eeKeyManager.js` (key distribution logic)

**Symptoms:**
- User connects to voice channel, thinks media is encrypted, but it's in plaintext
- No UI indication that encryption setup failed

**Trigger:** Worker load fails, key exchange timeout, or Signal session corruption

**Workaround:** Currently none. Code has flag but UI doesn't block connection.

**Fix approach:** Change `useRoom` hook to throw error if E2EE worker fails to initialize. Never fall back to plaintext. Phase E should enforce this with explicit UI.

### WebSocket Message Relay Lacks Validation on Large Payloads

**Issue:** While `media.key` messages are capped at 4096 bytes, other message types (chat, typing, etc.) are capped at 512 KB server-side but there's no per-message-type validation.

**Files:**
- `server/internal/ws/client.go` (lines 12-17: constants, `maxMessageSize = 512 * 1024`)
- `server/internal/ws/handlers.go` (message routing)

**Impact:** Malformed or extremely large messages can cause memory spikes on server or client. No protection against slowloris-style attacks via large message payloads.

**Trigger:** Client sends message with `payload` field > max allowed

**Workaround:** None; relies on client honesty

**Fix approach:** Add per-handler payload validation. Reject messages with oversized fields before processing. Add rate limiting per client.

---

## Security Considerations

### JWT Token Not Rotated

**Issue:** JWT tokens are issued once at login/registration and never refreshed. If a token leaks, it's valid until expiration (default configurable, often 24 hours).

**Files:**
- `server/internal/auth/jwt.go` (JWT sign/verify)
- `server/internal/api/auth.go` (login/register endpoints)

**Risk:** Long-lived tokens increase window of compromise. No way to proactively revoke a leaked token without blacklist.

**Current mitigation:** Tokens are short-lived by default (check JWT_EXPIRY env var). Session ID in `sessions` table can be revoked independently.

**Recommendations:**
1. Implement refresh token pattern: short-lived access tokens (15 min) + long-lived refresh tokens
2. Add token blacklist or revocation check in `RequireAuth` middleware
3. Rotate tokens on sensitive operations (password change, logout)

### LocalStorage Device ID Not Secure

**Issue:** Device ID is stored in plain `localStorage` (not sensitive, but mixed with other auth state).

**Files:**
- `client/src/hooks/useAuth.js` (DEVICE_ID_KEY in localStorage)

**Risk:** Very low (device ID is public). Minor concern is localStorage persistence across device compromises.

**Current mitigation:** Device ID is non-cryptographic UUID (not a secret).

**Recommendations:**
1. Consider moving device ID to ephemeral state (regenerate on app start) for true device isolation
2. Or bind device ID to browser fingerprint + use sessionStorage (cleared on browser close)

### No CSRF Protection on HTTP Endpoints

**Issue:** POST/PUT/DELETE endpoints don't validate CSRF tokens. Relies only on JWT in Authorization header.

**Files:**
- `server/internal/api/auth.go` (POST /api/auth/register, login)
- `server/internal/api/servers.go` (POST/PUT/DELETE server endpoints)
- `server/internal/api/channels.go` (DELETE channel)

**Risk:** Low (JWT in header is safer than cookies), but still an attack vector if frontend is compromised.

**Current mitigation:** JWT in Authorization header (not cookies), so CSRF is partially mitigated.

**Recommendations:**
1. Add optional CSRF token validation for state-changing endpoints
2. Or enforce SameSite=Strict on any cookies (if added in future)

---

## Performance Bottlenecks

### Large Hook Files Approaching Complexity Limit

**Issue:** Core hooks are near or exceeding the 300-400 line practical limit for maintainability.

**Files:**
- `client/src/hooks/useRoom.js` (711 lines) — **CRITICAL**
- `client/src/lib/trackManager.js` (430 lines)
- `client/src/lib/e2eeKeyManager.js` (235 lines)

**Cause:** LiveKit room lifecycle + track management + E2EE key distribution all in one hook

**Impact:**
- Hard to test individual concerns
- Risk of subtle state management bugs
- Difficult to add new features without side effects

**Improvement path:**
1. Extract `trackManager` logic into separate class/module (already exists, but not fully separated)
2. Move E2EE key distribution to independent manager class
3. Split `useRoom` into smaller custom hooks: `useRoomConnection`, `useTrackManagement`, `useE2EESetup`
4. See Phase D+ refactoring tasks

### No Query Result Pagination or Limits on Message Fetch

**Issue:** Message history endpoint allows unbounded queries. While `channelMessagesLimitMax` is 50, clients could request all messages in a large channel.

**Files:**
- `server/internal/api/channels.go` (lines 58-70, getMessages handler)
- `server/internal/db/messages.go` (query logic)

**Risk:** Large channels (1000+ messages) could cause slow queries or memory exhaustion if client requests without cursor pagination.

**Current mitigation:** Hard limit of 50 messages per request. Client-side pagination works around this.

**Improvement path:**
1. Add database index on `(channel_id, timestamp DESC)` (likely already indexed)
2. Implement cursor-based pagination for large history fetches
3. Add metrics to monitor slowest message queries

### E2EE Key Manager Retry Logic Without Backoff

**Issue:** Media key distribution retries don't implement exponential backoff. Could hammer network if recipient is unreachable.

**Files:**
- `client/src/lib/e2eeKeyManager.js` (retrySend function)

**Risk:** Low (only within a single browser session), but poor network etiquette if used at scale.

**Improvement path:**
1. Add exponential backoff (100ms, 200ms, 400ms, etc.)
2. Add max retry count (default 5)
3. Log when max retries exceeded

---

## Fragile Areas

### WebSocket Hub Presence State Not Crash-Safe

**Issue:** Hub's in-memory presence map (`hub.clients`, `hub.channels`) is lost if server restarts. No persistence to Redis or database.

**Files:**
- `server/internal/ws/hub.go` (Hub struct with maps)

**Why fragile:**
- Clients will think participants are still in room after server restart
- Chat state will be inconsistent with presence
- Requires client-side reconnection to resync

**Safe modification:**
1. Always assume hub state is ephemeral
2. Clients should validate presence independently (request fresh participant list on room join)
3. Add Redis for distributed presence if scaling beyond single node

**Test coverage:** Hub tests exist but don't cover graceful shutdown scenarios

### Signal Session State Corruption Risk if Device ID Changes

**Issue:** IndexedDB store is keyed on `hush-signal-${userId}-${deviceId}`. If device ID changes (browser cache clear, re-registration), old keys are orphaned.

**Files:**
- `client/src/lib/signalStore.js` (DB_NAME_PREFIX logic)
- `client/src/lib/uploadKeysAfterAuth.js` (post-auth key generation)

**Why fragile:**
- User can't decrypt old messages with new device ID (expected, by design)
- But if device ID generation is non-deterministic and user rotates browsers, they lose access
- No migration path if device ID format changes

**Safe modification:**
1. Document device ID stability requirement in code comments
2. Make device ID deterministic (e.g., derived from browser fingerprint + salt) rather than random UUID
3. Or add migration tool to copy keys from old device ID to new one

**Test coverage:** Signal store tests exist but don't cover device ID changes

### Server Schema Assumes Single Database Instance

**Issue:** Database schema (especially `servers`, `server_members` tables) assumes one backend = one community. Phase E+ will flatten this, but current code will break if scaled to multi-tenant.

**Files:**
- `server/internal/migrations/000001_init_schema.up.sql`
- `server/internal/db/servers.go` (server CRUD)

**Why fragile:**
- If Phase E+ isn't completed, attempting to multi-tenant this codebase will cause hard-to-debug permission issues
- Foreign key constraints are tight but don't prevent cross-tenant leaks if queries are wrong

**Safe modification:**
1. Add comments in schema: "Single-tenant design; server-scoped queries only"
2. Complete Phase E+ to align schema with single-server architecture
3. If multi-tenant ever needed, rename `servers` → `communities` and add `backend_id` column

**Test coverage:** Integration tests exist but don't cover multi-backend scenarios

---

## Scaling Limits

### WebSocket Hub Memory Grows With Connected Clients

**Issue:** Hub maintains maps of all connected clients in memory. No connection pooling or memory shedding.

**Files:**
- `server/internal/ws/hub.go` (Hub.clients, Hub.channels maps)

**Current capacity:** Tested up to ~100 concurrent connections in development. Real limit depends on message queue sizes.

**Limit:** At ~1000+ concurrent connections, each storing 1 channel subscription + send queue, memory usage could exceed 1 GB.

**Scaling path:**
1. Add metrics to monitor hub size (goroutine count, map sizes)
2. Implement Redis Pub/Sub for distributed hubs (multiple servers)
3. Or shard channels across multiple hub instances

### PostgreSQL Connection Pool Not Configurable

**Issue:** Connection pool size is hardcoded or uses pgxpool defaults. No tuning for load testing.

**Files:**
- `server/internal/db/db.go` (Open function uses pgxpool.New)

**Current capacity:** pgxpool defaults to ~10 max connections. Fine for development, tight for production under load.

**Scaling path:**
1. Make connection pool size configurable via env var (e.g., DB_POOL_SIZE)
2. Add monitoring for connection wait times
3. Set reasonable production defaults (e.g., 20-50 depending on expected load)

### IndexedDB Message Cache Unbounded Size

**Issue:** Message cache in client IndexedDB has no size limit. Will grow indefinitely.

**Files:**
- `client/src/lib/signalStore.js` (STORE_MESSAGES operations)

**Current capacity:** Typical browser quota is 50-100 MB per origin. With message cache growing, could hit quota.

**Limit:** After ~1000 large cached messages, browser may throw QuotaExceededError

**Scaling path:**
1. Implement cache eviction (see Tech Debt section above)
2. Limit cache to last 7 days of messages
3. Add error handling for QuotaExceededError in cache operations

---

## Dependencies at Risk

### hush-crypto WASM Build Complexity

**Risk:** WASM compilation is manual (`wasm-pack build`) and must be committed to git. If build fails, deployment is blocked.

**Impact:** Can't deploy frontend without WASM artifact. Increases CI/CD fragility.

**Migration plan:**
1. Add WASM build to CI pipeline (GitHub Actions)
2. Generate WASM during build, don't commit binary
3. Or use pre-built CDN distribution of WASM (e.g., jsDelivr)

### libsignal Dependency Version Lock

**Risk:** `hush-crypto` wraps libsignal (Rust crate). If libsignal breaks API, requires manual update and re-WASM compilation.

**Impact:** Security updates could be blocked if WASM compilation fails. No automated dependency updates.

**Migration plan:**
1. Add libsignal to Dependabot (if using GitHub)
2. Test WASM build in CI on every dependency update
3. Keep libsignal within minor version constraint (e.g., `0.x.*` only, not `0.23` → `0.24`)

### livekit-client Package Version Not Pinned

**Risk:** package.json likely has `^` or `~` version on livekit-client. Breaking changes could silently break audio/video.

**Impact:** Auto-upgraded to incompatible version, causing media failures in production.

**Mitigation:** Check `package.json` for exact version pin recommendations.

---

## Missing Critical Features

### No Message Retention Policy Enforcement

**Issue:** Schema has `channel_config.retention_days` column but it's not implemented.

**Files:**
- `server/internal/migrations/000001_init_schema.up.sql` (channel_config table)
- `server/internal/db/messages.go` (no deletion logic)

**Problem:** Messages are stored forever. No automatic cleanup of old messages per channel policy.

**Blocks:** GDPR compliance (right to forget old data), storage cost control

**Fix approach:**
1. Implement scheduled job to delete messages older than retention policy
2. Add configuration endpoint to set retention per channel
3. Add soft-delete (mark deleted_at) for audit trails if needed

### No Rate Limiting on API Endpoints

**Issue:** No rate limiting on auth endpoints, message send, or pre-key fetches.

**Files:**
- `server/internal/api/auth.go` (no rate limit)
- `server/internal/ws/handlers.go` (message handler, no per-user limits)

**Risk:** Brute force attacks on login, spam attacks via WebSocket messages, pre-key enumeration attacks.

**Blocks:** Production deployment without DDoS protection

**Fix approach:**
1. Add middleware for rate limiting (e.g., go-rate-limit package)
2. Limit registration attempts per IP: 5 per hour
3. Limit login attempts per user: 10 per 5 minutes
4. Limit message send per user: 100 per minute
5. Limit pre-key requests per IP: 1000 per hour

### No Audit Logging for Sensitive Operations

**Issue:** No logs for critical events: login, key upload, channel creation, member joins/leaves.

**Files:**
- Server API handlers (auth.go, servers.go, etc.) — inconsistent logging

**Risk:** Can't investigate security incidents or debug permission issues.

**Blocks:** Phase F (moderation) and compliance audit requirements

**Fix approach:**
1. Create `internal/audit/audit.go` package for structured logging
2. Log: user login (with IP), key uploads (user ID), channel deletions (who, when), member changes
3. Store audit logs in database or dedicated audit sink (e.g., Syslog)

---

## Test Coverage Gaps

### WebSocket Broadcast Events Not Fully Tested

**Issue:** WebSocket hub has broadcast methods (`BroadcastToServer`, etc.) but not all state mutation endpoints are tested to verify broadcasts are sent.

**Files:**
- `server/internal/ws/hub_test.go` — tests hub but not integration with API handlers
- `server/internal/api/servers_test.go` — tests handlers but doesn't verify broadcasts

**What's not tested:**
- POST /api/servers/:id/channels creates a channel AND broadcasts `channel_created`
- DELETE /api/channels/:id broadcasts `channel_deleted` before DB delete
- PUT /api/servers/:id broadcasts `server_updated` with correct payload

**Risk:** Broadcasts could be silently missing. Connected clients wouldn't see real-time updates.

**Priority:** High (Part of Phase E server/channel API)

**Fix approach:**
1. Add integration tests that spawn hub + handler + client, verify broadcasts received
2. Or mock hub in handler tests and assert `BroadcastToServer` called with correct arguments

### Signal Protocol Cross-Platform Interop Not Tested

**Issue:** hush-crypto has Rust tests (`hush-crypto/tests/e2e_signal_flow.rs`) but no cross-browser tests verifying WASM output can decrypt messages from desktop client.

**Files:**
- `hush-crypto/tests/e2e_signal_flow.rs` — local Rust tests only
- No integration tests between web WASM and desktop (future Tauri) implementations

**What's not tested:**
- Web client can decrypt message from desktop client using same WASM build
- Safari vs Chrome vs Firefox produce same ciphertext format
- Mobile (future) can decrypt web-encrypted messages

**Risk:** Platform isolation bug (one platform can't decrypt another's messages). Won't be caught until launch.

**Priority:** Medium (Blocked on desktop/mobile client implementation)

**Fix approach:**
1. Add cross-platform test vectors (test messages encrypted on each platform)
2. Add CI test that runs Rust tests + web tests side-by-side
3. Phase G (Desktop) and H (Mobile) should include interop tests

### Error Recovery Paths Not Tested

**Issue:** Code has error handlers but recovery paths aren't tested systematically.

**Files:**
- Sparse (e.g., `useRoom.js` error state but no test for recovery)

**What's not tested:**
- WebSocket reconnection after network failure
- Message retry on send failure
- Key exchange retry on first attempt timeout
- E2EE worker load failure handling

**Risk:** Recovery could be silent failure (user unaware chat didn't send) or crash (unhandled error state).

**Priority:** Medium (Important for reliability but not blocking MVP)

**Fix approach:**
1. Add network fault injection tests (simulate disconnects, timeouts)
2. Test error state transitions: error → retry → success
3. Ensure UI shows clear error messages + manual retry button

---

*Concerns audit: 2026-03-03*
