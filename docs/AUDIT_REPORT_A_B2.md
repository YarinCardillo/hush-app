# Hush Audit Report — Milestones A through B2

Date: 2026-02-17  
Branch: audit/milestone-a-b2-verification  
Base: matrix-refactor

---

## Summary

| Metric | Count |
|--------|--------|
| Total checks | 98 |
| PASS | 58 |
| FAIL | 24 |
| PARTIAL | 12 |
| NOT IMPLEMENTED | 4 |
| **Overall status** | **NOT READY** |

**Verdict:** Critical issues in server cleanup (B3), token service (Matrix validation), crypto error handling (silent fallback), LiveKit E2EE key distribution (PLAN specifies Matrix to-device; implementation uses password-derived keys only), and auth persistence. Milestones A/B/B2 are not fully met. Do not proceed to Milestone C until critical and high-priority items are addressed.

---

## Section Results

### 1. Infrastructure (Milestone A1)

| Check | Status | Evidence |
|-------|--------|----------|
| docker-compose contains Synapse | PASS | `docker-compose.yml:22-44` — `synapse` service |
| docker-compose contains PostgreSQL for Synapse | PASS | `docker-compose.yml:4-20` — `postgres` service |
| docker-compose contains LiveKit Server | PASS | `docker-compose.yml:89-104` — `livekit` service |
| docker-compose contains Redis | PASS | `docker-compose.yml:74-86` — `redis` service |
| docker-compose contains reverse proxy (Caddy) | PASS | `docker-compose.yml:106-121` — `caddy` service |
| Synapse config: allow_guest_access: true | PASS | `synapse/homeserver.yaml.template:42`, `synapse/data/homeserver.yaml:41` |
| Synapse config: enable_registration: true | PASS | Template:40-41, data:39-40 |
| Synapse config: encryption_enabled_by_default_for_room_type: all | PASS | Template:56, data:55 |
| Synapse config: presence.enabled: true | PASS | Template:104-105, data:104-105 |
| LiveKit config: codecs Opus, VP8/VP9/H264 | PARTIAL | `livekit/livekit.yaml` has no explicit `rtc.codecs`; LiveKit defaults include these. Not explicitly set per PLAN. |
| LiveKit config: ports 7880, 7881, 50000-60000/UDP | PARTIAL | `livekit.yaml:5` port 7880; no 7881 in file. `docker-compose.yml:99-100` maps 7880, 7881, 50000-50100/UDP (range 50100 not 60000). |
| Reverse proxy routes /_matrix/ to Synapse | PASS | `caddy/Caddyfile:15-38` handle /_matrix/* → synapse:8008 |
| Reverse proxy routes / to Hush client | PASS | `caddy/Caddyfile:56-66` handle /* → hush:3001 |
| Reverse proxy routes LiveKit correctly | PASS | `caddy/Caddyfile:41-53` handle /livekit/* → livekit:7880 |
| Health checks in docker-compose | PASS | postgres:14-18, synapse:37-42, redis:79-84 |
| scripts/generate-synapse-config.sh exists and works | PASS | `scripts/generate-synapse-config.sh` exists; generates signing key, macaroon, form secret, substitutes template. |
| docker-compose up brings up all services | PASS | `docker-compose up -d` — all containers reported Running. |
| Synapse /versions via proxy | PASS | `curl -s http://localhost/_matrix/client/versions` returns JSON with versions. |
| Guest registration via curl | PARTIAL | `curl -X POST .../register -d '{"kind":"guest"}'` returns session + flows (m.login.dummy). Two-step flow; not a single-call guest token. |
| LiveKit responding | PASS | `curl -s -o /dev/null -w "%{http_code}" http://localhost:7880` → 200 |

---

### 2. Matrix Client Initialization (Milestone A2)

| Check | Status | Evidence |
|-------|--------|----------|
| client/src/lib/matrixClient.js exists | PASS | File present. |
| Matrix client created with createClient() and homeserver from env/config | PASS | `matrixClient.js:21-31` — baseUrl from options \|\| `import.meta.env.VITE_MATRIX_HOMESERVER_URL` \|\| `window.location.origin`. |
| Homeserver URL not hardcoded | PASS | Grep for `localhost:8008` / `http://localhost` in client/src (excluding node_modules): no matches. |
| Client singleton (one instance at a time) | PASS | `matrixClient.js:3,17-19` — single `matrixClient`; `destroyMatrixClient()` before recreate. |
| Connection errors handled gracefully | PARTIAL | `createMatrixClient` does not wrap in try/catch; callers (useMatrixAuth) catch and set error state. No explicit connection-error handler in matrixClient.js. |

**Grep evidence (homeserver):**
```
client/src/lib/matrixClient.js:  baseUrl from VITE_MATRIX_HOMESERVER_URL or window.location.origin
client/src/pages/Home.jsx:347:   VITE_MATRIX_SERVER_NAME || 'localhost' (alias only)
```

---

### 3. Authentication (Milestone A2)

| Check | Status | Evidence |
|-------|--------|----------|
| client/src/hooks/useMatrixAuth.js exists | PASS | File present. |
| Login: client.login('m.login.password', ...) or loginWithPassword | PASS | `useMatrixAuth.js:151-154` — `client.login('m.login.password', { user, password })`. |
| Register: client.register() with username/password | PASS | `useMatrixAuth.js:213-218` (register), `63-68` (loginAsGuest uses register with dummy). |
| Guest flow: registerGuest or register with kind guest | PARTIAL | No `registerGuest()`; "guest" is implemented as anonymous user via `client.register(username, password, null, { type: 'm.login.dummy' })` with random username/password. PLAN allows "register() with kind: 'guest'" — this is register with dummy, not literal guest. |
| After auth: access token stored | PARTIAL | Token stored in React state only (`setAccessToken(response.access_token)`). Not in localStorage/sessionStorage. |
| After auth: client.startClient() called | PASS | `useMatrixAuth.js:121`, `184`, `254` — startClient after crypto init. |
| Auth state persists across page refresh | FAIL | Token and client identity live only in React state. No restore from localStorage/sessionStorage. Full page refresh loses Matrix auth; Room/Chat then have no Matrix client. |
| Logout: client.logout() and clear stored token | PASS | `destroyMatrixClient()` calls `matrixClient.logout(true)` and sets matrixClient = null; useMatrixAuth clears state. |
| Login failures show user-friendly messages | PARTIAL | `setError(err)`; UI shows `error || matrixError?.message` in Home.jsx. No specific message for invalid password vs network. |
| Network errors during auth caught | PASS | try/catch in loginAsGuest, login, register; setError(err). |

**Grep evidence (token persistence):**
- `accessToken` in useMatrixAuth (state only).
- No persistence of Matrix access_token in localStorage/sessionStorage (only hush_token, hush_peerId, etc. for server JWT).

---

### 4. Room Management (Milestone A2–A3)

| Check | Status | Evidence |
|-------|--------|----------|
| Room creation calls client.createRoom() with correct options | PASS | `Home.jsx:289-298` — createRoom with name, room_alias_name, visibility, preset, initial_state. |
| Room creation includes initial_state m.room.encryption | PASS | `Home.jsx:293-296` — type `m.room.encryption`, content `{ algorithm: 'm.megolm.v1.aes-sha2' }`. |
| Room creation includes m.room.guest_access if guests need to join | NOT IMPLEMENTED | No `m.room.guest_access` in createRoom initial_state. Grep for guest_access: no matches in client. |
| Encryption algorithm m.megolm.v1.aes-sha2 | PASS | `Home.jsx:295` — `content: { algorithm: 'm.megolm.v1.aes-sha2' }`. |
| Room joining via room alias or room ID | PASS | `Home.jsx:346-350` — `#${roomName}:${serverName}`, `client.joinRoom(roomAlias)`. |
| Room aliases set on creation | PASS | `room_alias_name: actualRoomName` in createRoom. |
| Joining non-existent room shows clear error | PARTIAL | joinRoom failure propagates; message is generic (err.message). |
| Room list updates reactively | PASS | Matrix SDK sync; rooms from client.getRoom(). |

---

### 5. Chat via Matrix Timeline (Milestone A3)

| Check | Status | Evidence |
|-------|--------|----------|
| Chat.jsx uses matrix-js-sdk, not Socket.io | PASS | Imports getMatrixClient, RoomEvent, EventType; no socket. |
| Outgoing: client.sendEvent or sendMessage | PASS | `Chat.jsx:253-256` — `client.sendMessage(matrixRoomId, { msgtype: 'm.text', body: trimmed })`. |
| Incoming: RoomEvent.Timeline | PASS | `Chat.jsx:220` — `client.on(RoomEvent.Timeline, handleTimelineEvent)`. |
| Local echo | PARTIAL | SDK provides local echo; no explicit local echo in component (messages from timeline). |
| Chat history on room join (pagination) | PASS | `Chat.jsx:185-191` — room.getLiveTimeline().getEvents() for existing messages. |
| Message display: text, timestamps, sender | PASS | Chat.jsx message layout with senderName, timestamp, messageText. |
| Socket.io sendMessage/messageReceived removed from server | PASS | Grep server/src for sendMessage, messageReceived: no matches. |
| No Socket.io chat code in codebase | PASS | Grep client for socket.*message / emit.*message (excluding matrix): no matches. |

---

### 6. LiveKit Integration (Milestone B)

| Check | Status | Evidence |
|-------|--------|----------|
| livekit-client in client package.json | PASS | `client/package.json:12` — "livekit-client": "^2.17.1". |
| client/src/hooks/useRoom.js exists, replaces useMediasoup | PASS | useRoom.js present; comment "Replaces mediasoup-based useMediasoup hook". |
| useMediasoup.js DELETED | PASS | No file matching useMediasoup* in client/src/hooks. |
| client socket.js DELETED | PASS | No file matching socket* in client/src/lib. |
| mediasoup-client not in client package.json | PASS | Not in dependencies. |
| Room connection: LiveKit Room, server URL from config | PASS | `useRoom.js:393-394` — livekitUrl from VITE_LIVEKIT_URL or ws://localhost:7880; room.connect(livekitUrl, token). |
| Token from token service endpoint | PASS | `useRoom.js:176-193` — POST /api/livekit/token, body roomName, participantIdentity, participantName. |
| Local tracks: camera, mic, screen publishable | PASS | publishWebcam, publishMic, publishScreen in useRoom. |
| Remote tracks subscribed and rendered | PASS | TrackSubscribed/TrackUnsubscribed, remoteTracksRef, click-to-watch for screen. |
| Track muting (audio/video toggles) | PASS | unpublishMic, unpublishWebcam, unpublishScreen. |
| Quality presets mapped to LiveKit encoding | PASS | QUALITY_PRESETS from constants; videoEncoding maxBitrate, track constraints. |
| Noise gate: AudioWorklet before publish | PASS | `useRoom.js:458-471` — noiseGateWorklet.js, AudioWorkletNode, then publish. |
| client/src/lib/audioProcessing.js exists | FAIL | No file matching audio* in client/src/lib. Noise gate is inline in useRoom; PLAN asks for a helper wrapping the pipeline. |

**Grep evidence:** mediasoup only in comments (Home.jsx, useRoom.js). No socket.io/socket.emit in client src.

---

### 7. Server Cleanup (Milestone B3)

| Check | Status | Evidence |
|-------|--------|----------|
| server/src/media/mediasoupManager.js DELETED | PASS | No server/src/media/ directory. |
| server/src/signaling/socketHandlers.js DELETED | PASS | No server/src/signaling/ directory. |
| server/src/rooms/roomManager.js DELETED | FAIL | File exists; imported and used in index.js (getRoomList, getRoom, createRoom, addPeer, etc.). |
| server/src/rooms/resourcePool.js DELETED | FAIL | File exists; imported and used in index.js (getPublicStatus, getSystemInfo, canCreateRoom logic). |
| server/src/auth/auth.js DELETED | FAIL | File exists; `generateToken` imported in index.js for /api/rooms/create and /api/rooms/join. |
| socket.io not in server package.json | PASS | Not in server/package.json dependencies. |
| mediasoup not in server package.json | PASS | Not in dependencies. |
| bcrypt not in server package.json | FAIL | `server/package.json`: "bcrypt": "^5.1.1". |
| jsonwebtoken not in server package.json (unless for token service) | FAIL | "jsonwebtoken": "^9.0.2". Token service uses livekit-server-sdk only; JWT is for auth.js. |
| server/src/index.js thin: static + proxy + token service | FAIL | index.js is 222 lines; contains /api/rooms/create, /api/rooms/join, roomManager, resourcePool, generateToken (auth.js), /api/status, /api/rooms, /api/health, /api/livekit/token. Not thin. |
| Token service: validates Matrix token → returns LiveKit JWT | FAIL | `server/src/livekit/tokenService.js`: accepts roomName, participantIdentity, participantName from request body; no Matrix token in header; no whoami call. Issues LiveKit JWT only. |
| No in-memory room state on server | FAIL | roomManager holds rooms; token endpoint checks roomManager.getRoom(roomName). |

**wc -l server/src/index.js:** 222 (PLAN suggests < 100 for thin shell).

---

### 8. Matrix Crypto — Rust Module (Milestone B2.1)

| Check | Status | Evidence |
|-------|--------|----------|
| initRustCrypto() used, not initCrypto() | PASS | useMatrixAuth.js:97, 175, 244 — `authenticatedClient.initRustCrypto({ cryptoDatabasePrefix: prefix })`. No initCrypto. |
| initRustCrypto after client creation, before startClient() | PASS | Order: createMatrixClient with credentials → initRustCrypto → startClient (e.g. 95-122). |
| No manual IndexedDBCryptoStore | PASS | Grep IndexedDBCryptoStore, MemoryCryptoStore: no matches in client/src. |
| No MemoryCryptoStore | PASS | Same grep. |
| client.getCrypto() defined after init | PARTIAL | Not explicitly asserted in code; SDK provides it after initRustCrypto. |
| Device keys uploaded (POST keys/upload) | PARTIAL | Expected from SDK after initRustCrypto; not verified in audit by network. |
| Device ID persists across refresh | PARTIAL | Crypto store is IndexedDB (Rust); state is not rehydrated on refresh because auth state (token) is not persisted — so client is recreated and user re-auths, so device may persist for same "session" but not across refresh. |
| WASM failure: clear error, no silent fallback | FAIL | useMatrixAuth.js:98-101, 176-179, 245-248 — on crypto init failure: "Non-fatal: continue without E2EE if crypto init fails". PLAN B2.4: must block app and show full-screen error. |
| Crypto init failure blocks app usage | FAIL | Current code continues without E2EE. |

**Grep evidence:** initRustCrypto only (no initCrypto). No IndexedDBCryptoStore, MemoryCryptoStore, olm references. No @matrix-org/olm in package.json.

---

### 9. Encrypted Chat (Milestone B2.2)

| Check | Status | Evidence |
|-------|--------|----------|
| Rooms created with m.room.encryption in initial_state | PASS | Home.jsx:292-296. |
| Algorithm m.megolm.v1.aes-sha2 | PASS | Home.jsx:295. |
| Chat.jsx handles RoomEvent.Timeline (SDK decrypts) | PASS | Chat.jsx:220, eventToMessage handles RoomMessage and m.room.encrypted. |
| Decryption failures: isDecryptionFailure() or equivalent | PARTIAL | No isDecryptionFailure() call. Decryption failure inferred by eventType === 'm.room.encrypted' (eventToMessage). Same outcome. |
| Decryption failures show "Unable to decrypt" | PASS | Chat.jsx:314-316 — decryptionFailed → "Unable to decrypt message". |
| Late decryption: Event.Decrypted listener | PASS | Chat.jsx:204-219, 221 — client.on('Event.decrypted', handleEventDecrypted). |
| Late decryption updates UI | PASS | handleEventDecrypted updates message content and decryptionFailed: false. |
| Synapse encryption_enabled_by_default_for_room_type: all | PASS | synapse/data/homeserver.yaml:55. |

---

### 10. LiveKit E2EE (Milestone B2.3)

| Check | Status | Evidence |
|-------|--------|----------|
| Room created WITH e2ee options in constructor | PASS | useRoom.js:246-262 — if keyProvider && worker, roomOptions.e2ee = { keyProvider, worker }; new Room(roomOptions). |
| ExternalE2EEKeyProvider before Room | PASS | useRoom.js:214-216 — keyProvider = new ExternalE2EEKeyProvider(); then Room. |
| E2EE worker from livekit-client/e2ee-worker | PASS | useRoom.js:15 — import E2EEWorker from 'livekit-client/e2ee-worker?worker'. |
| Room creator generates AES key (getRandomValues or Web Crypto) | PARTIAL | Key is not random: it is derived via PBKDF2 from room password + room name (useRoom.js:119-140, 206). PLAN says "Room creator generates a random AES-128 frame encryption key (crypto.getRandomValues(new Uint8Array(16)))". |
| Key set on ExternalE2EEKeyProvider (setKey) | PASS | useRoom.js:217 — await keyProvider.setKey(keyBytes). |
| Key distributed via Matrix to-device | FAIL | No sendToDevice or to-device for E2EE key. Room.jsx:272 comment: "No to-device key broadcast needed — all participants derive the same key from the room password". PLAN B2.3.2 requires distribution via Matrix to-device (Olm-encrypted). |
| To-device event type (e.g. io.hush.e2ee_key) | NOT IMPLEMENTED | No to-device sending; no io.hush.e2ee_key or similar. |
| Joiners receive key via to-device and apply to keyProvider | NOT IMPLEMENTED | Joiners derive same key from password (deriveE2EEKey in connectRoom). No to-device receive path. |
| room.e2eeManager defined after connection | PARTIAL | Not asserted in code; LiveKit sets it when e2ee options provided. |
| No post-hoc setE2EEEnabled | PASS | Grep setE2EEEnabled: no matches. |

**Grep evidence:** No sendToDevice, toDeviceEvent, io.hush.*e2ee, e2ee_key in client src (only Room.jsx comment about no to-device).

---

### 11. Rekeying (Milestone B2.3.3)

| Check | Status | Evidence |
|-------|--------|----------|
| ParticipantDisconnected triggers rekeying | PASS | useRoom.js:271-317 — on ParticipantDisconnected, keyRotationCounterRef incremented, new key derived (deriveE2EEKey with counter), setKey on provider. |
| Leader election (e.g. alphabetical by Matrix user ID) | FAIL | Every participant rotates key on every leave (each runs same handler). No single leader; PLAN requires "oldest remaining participant (deterministic leader)" to generate and distribute one new key. |
| Only leader generates new key | FAIL | All remaining participants derive and set a new key locally; no single leader, no distribution. |
| New key has incremented keyIndex | PARTIAL | keyRotationCounterRef incremented; key is derived with that counter. LiveKit keyIndex not explicitly set (setKey(key) used). |
| New key distributed via Matrix to-device | FAIL | No to-device; key is password-derived so everyone recomputes. |
| Participants update keyProvider with new key | PASS | setKey(newKey) in ParticipantDisconnected handler. |
| New joiners receive CURRENT key after rekey | PARTIAL | Joiners derive key with rotation counter 0 (no roomPasswordRef yet for them when?); actually joiners call connectRoom with roomPassword and derive same key with counter 0 — so they get initial key, not post-rekey key. After rekey, counter is 1,2,... so joiner would still derive counter 0. So new joiners get wrong key after rekey. |
| Participant JOIN does not trigger rekeying | PASS | No rekey in ParticipantConnected. |

---

### 12. Crypto Error Handling (Milestone B2.4)

| Check | Status | Evidence |
|-------|--------|----------|
| initRustCrypto() failure: clear error, block app | FAIL | useMatrixAuth: "Non-fatal: continue without E2EE if crypto init fails". No full-screen block. |
| LiveKit E2EE worker failure: media disabled (buttons grayed) | FAIL | useRoom.js:224-228 — on E2EE init error, keyProvider/worker set to null and "Non-fatal: continue without E2EE". No UI disable of media. |
| To-device key exchange failure: retry (3, exponential backoff) | NOT IMPLEMENTED | No to-device key exchange. |
| Megolm failure: per-message "encryption failed" with retry | PARTIAL | Chat shows "Unable to decrypt" for undecrypted events; no explicit retry button. |
| No scenario where app silently operates unencrypted | FAIL | Crypto init failure and E2EE worker failure both allow continued unencrypted use. |
| Error messages specific and actionable | PARTIAL | Some errors set; not all paths show specific messages per PLAN. |

---

### 13. Documentation (Milestone B2.5)

| Check | Status | Evidence |
|-------|--------|----------|
| SECURITY.md in project root | FAIL | No SECURITY.md in repo root (glob 0 files). |
| Documents Olm, Megolm, LiveKit frame encryption | FAIL | SECURITY.md missing. |
| Documents key distribution (Matrix to-device) | FAIL | N/A; SECURITY.md missing. |
| Documents rekeying on participant leave | FAIL | N/A. |
| Documents trust model (TOFU) | FAIL | N/A. |
| Documents crypto (vodozemac / Rust WASM) | FAIL | N/A. |
| Browser support matrix | FAIL | N/A. |
| Known limitations (device verification, key backup, cross-signing) | FAIL | N/A. |
| docs/e2ee-test-checklist.md exists | PARTIAL | Checklist exists at `scripts/e2ee-testing-checklist.md` (not docs/). PLAN says docs/e2ee-test-checklist.md. |

---

## Critical Issues (must fix before Milestone C)

1. **Token service does not validate Matrix** — `server/src/livekit/tokenService.js` accepts roomName, participantIdentity, participantName from body and issues a LiveKit JWT. It does not accept or validate a Matrix access token (e.g. Authorization header + GET /_matrix/client/v3/account/whoami). Anyone who can hit the endpoint can get a room token. **Fix:** Require Matrix access token in header; validate via whoami; use validated user id as participant identity.

2. **Crypto init failure allows unencrypted use** — `useMatrixAuth.js:98-101` (and login/register): on `initRustCrypto()` throw, catch and continue. PLAN B2.4: app must never run unencrypted; show full-screen error and block. **Fix:** On initRustCrypto failure, set error state and do not call startClient(); show full-screen "Encryption unavailable…" and block navigation to room.

3. **LiveKit E2EE key distribution does not use Matrix to-device** — PLAN B2.3.2: room creator generates random key, sets on keyProvider, and distributes to participants via Matrix to-device (Olm-encrypted). Current implementation uses password-derived key (PBKDF2); no to-device. This diverges from PLAN and from reference (Element Call) pattern. **Fix:** Implement: creator generates key with crypto.getRandomValues; setKey(key, keyIndex); send key to each participant via client.sendToDevice('io.hush.e2ee_key', ...); joiners listen for to-device, apply key to keyProvider.

4. **Server not thin; B3 cleanup incomplete** — `server/src/index.js` (222 lines) still has roomManager, resourcePool, auth.generateToken, /api/rooms/create, /api/rooms/join. PLAN B3: delete roomManager, resourcePool, auth; server = static + proxy + token service (Matrix-validated). **Fix:** Remove room create/join endpoints and in-memory room state; validate Matrix in token service only; remove bcrypt, jsonwebtoken if unused; reduce index.js to static serving, proxy, and token endpoint.

5. **Auth state does not persist across refresh** — Matrix access token and client identity live only in React state. Full page refresh loses auth; Room/Chat then have no Matrix client. **Fix:** Persist access token (and deviceId/userId) in sessionStorage or localStorage; on load, rehydrate client from stored credentials and call startClient() so refresh keeps session.

---

## High Priority Issues (should fix soon)

1. **Rekeying: no leader election; new joiners get wrong key** — Every participant runs rekey on leave (no single leader). New joiners derive key with counter 0; after a rekey the room uses counter ≥ 1, so joiners cannot decrypt. **Fix:** Implement deterministic leader (e.g. alphabetical by Matrix user ID); only leader generates new key and distributes via to-device; joiners always receive current key (and keyIndex) via to-device.

2. **LiveKit E2EE worker failure should disable media, not hide** — useRoom.js continues without E2EE and does not disable media buttons. **Fix:** On E2EE init failure set a "mediaE2EEUnavailable" state; in UI disable (gray out) screen share / voice / camera with tooltip "Media encryption unavailable".

3. **Room creation missing m.room.guest_access** — If guests (or anonymous users) should join by alias, createRoom should include initial_state `m.room.guest_access` content `guest_access: 'can_join'`. **Fix:** Add that initial_state when guest join is required.

4. **SECURITY.md missing** — PLAN B2.5.2 requires SECURITY.md with algorithms, key distribution, rekeying, TOFU, vodozemac, browser matrix, limitations. **Fix:** Add SECURITY.md at project root with the required sections.

5. **Token service must validate room** — Currently token endpoint uses roomManager.getRoom(roomName). After B3, "room exists" is a Matrix concept. **Fix:** Either require client to pass Matrix room id and have server validate membership via Matrix API, or issue token for any roomName and rely on Matrix+LK for access control; document choice.

---

## Low Priority Issues (nice to fix)

1. **audioProcessing.js** — PLAN B2.2 asked for `client/src/lib/audioProcessing.js` wrapping the noise-gate pipeline. Noise gate is inline in useRoom. Extract to audioProcessing.js for clarity and reuse.

2. **docs/e2ee-test-checklist.md** — Checklist lives at `scripts/e2ee-testing-checklist.md`. Add or move to `docs/e2ee-test-checklist.md` per PLAN.

3. **LiveKit port range** — PLAN says 50000-60000 UDP; config uses 50000-50100. Align if needed for scale.

4. **Chat decryption failure** — Use `event.isDecryptionFailure()` when available for consistency with PLAN wording; behavior already correct.

5. **Guest registration curl** — Single-call guest token may require completing m.login.dummy flow; document or add a small script for dev.

---

## Missing Implementations

1. **Matrix-validated LiveKit token service** — PLAN B1.2: validate Matrix token via whoami, then issue LiveKit JWT. Currently no Matrix validation.
2. **Matrix to-device E2EE key distribution** — PLAN B2.3.2: creator sends key via sendToDevice; joiners receive and set on keyProvider. Currently password-derived key only; no to-device.
3. **SECURITY.md** — PLAN B2.5.2: full E2EE and trust-model documentation.
4. **docs/e2ee-test-checklist.md** — Present under scripts/ with different name/path.

---

## Spec Violations (Matrix / PLAN)

1. **B3 server shape** — PLAN: server is thin (static + proxy + token service). Current server still implements room create/join, pool, and auth JWT; not thin.
2. **B2.4 no silent unencrypted** — PLAN: "No scenario where the app silently operates unencrypted." Current: crypto init and E2EE worker failure both allow unencrypted use.
3. **B2.3.2 key distribution** — PLAN: random key + Matrix to-device (Olm). Current: password-derived key, no to-device.
4. **B2.3.3 rekeying** — PLAN: one leader, new key distributed via to-device; new joiners get current key. Current: everyone rekeys locally; new joiners derive initial key only.

---

## Security Concerns

1. **LiveKit token without Matrix validation (Critical)** — Token endpoint does not verify the requester is the Matrix user they claim. Attacker can request token for any participantIdentity and roomName. Mitigation: require and validate Matrix access token before issuing LiveKit JWT.
2. **Unencrypted operation on crypto failure (Critical)** — Allowing use without E2EE contradicts "privacy-first" and PLAN. Mitigation: block app on initRustCrypto failure; disable media on E2EE worker failure.
3. **In-memory room state and password on server (High)** — roomManager and password verification keep room state and password hashes on server. After B3, rooms are Matrix-only; token service should not depend on server-side room list or passwords for issuing tokens.
4. **Auth token only in memory (High)** — Matrix token in React state only; refresh loses session and can cause confused state (e.g. Room with server JWT but no Matrix client). Mitigation: persist and rehydrate Matrix session.

---

## Grep / Command Evidence Summary

- **Socket.io chat on server:** `grep -rn "sendMessage\|messageReceived" server/src/` → no matches.
- **Socket.io chat on client:** `grep -rn "socket.*message\|emit.*message" client/src/` (excluding matrix) → no matches.
- **mediasoup in client:** Only in comments (Home.jsx, useRoom.js).
- **useMediasoup.js / socket.js:** Not present under client/src/hooks, client/src/lib.
- **initRustCrypto:** Present in useMatrixAuth (3 call sites); no initCrypto.
- **IndexedDBCryptoStore / MemoryCryptoStore / olm:** No matches in client src.
- **setE2EEEnabled:** No matches.
- **To-device / sendToDevice / io.hush.e2ee:** No matches (except Room.jsx comment).
- **docker-compose:** All services run; Synapse versions and LiveKit port 7880 respond; guest register returns session/flows.

---

*End of audit report. No source code was modified; branch audit/milestone-a-b2-verification is read-only.*
