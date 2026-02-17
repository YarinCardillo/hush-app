# Audit A–B2 Implementation Summary

This document summarizes the changes made to address **Critical** and **High priority** findings in [AUDIT_REPORT_A_B2.md](./AUDIT_REPORT_A_B2.md). The work was implemented per the "Fix Audit Report A–B2 Issues" plan.

---

## Phase 1: Critical fixes

### 1.1 Auth state persistence across refresh

**Audit finding:** Token and client identity lived only in React state; full page refresh lost Matrix auth; Room/Chat had no Matrix client.

**Done:**

- **`client/src/lib/authStorage.js`** (new) — Get/set/clear credentials in sessionStorage under key `hush_matrix_credentials` (JSON: `userId`, `deviceId`, `accessToken`, `baseUrl`).
- **`client/src/hooks/useMatrixAuth.js`** — Persist credentials after successful login/register/loginAsGuest; clear on logout; added `rehydrationAttempted` and a `useEffect` that rehydrates from storage (create client → initRustCrypto → startClient → set state; on failure clear storage).
- **`client/src/contexts/AuthContext.jsx`** (new) — AuthProvider + useAuth wrapping the app.
- **`client/src/App.jsx`** — App wrapped in AuthProvider; Home and Room use useAuth().
- **`client/src/pages/Room.jsx`** — Redirect to Home when `rehydrationAttempted && !isAuthenticated`; require `hush_matrixRoomId` and `hush_roomName` in sessionStorage; loading state until rehydration attempted.

**Outcome:** Refresh on `/room/...` keeps Matrix session; Chat and Room have a valid client; logout clears storage and client.

---

### 1.2 Token service: require and validate Matrix token

**Audit finding:** Token endpoint did not validate Matrix identity; anyone could request a LiveKit JWT with arbitrary `participantIdentity`.

**Done:**

- **`server/src/livekit/tokenService.js`** — Added `validateMatrixToken()` (GET whoami with Bearer token); `generateToken(matrixAccessToken, roomName, participantName)` now validates token and uses whoami `user_id` as LiveKit identity.
- **`server/src/index.js`** — Token route reads `Authorization: Bearer <token>`, passes token to token service; 401 on missing/invalid token; no roomManager in this path.

**Outcome:** Requests without a valid Matrix token get 401; valid token yields LiveKit JWT with identity from whoami.

---

### 1.3 Server B3 cleanup (thin server)

**Audit finding:** Server still had room create/join, roomManager, resourcePool, auth JWT; index.js large and not thin.

**Done:**

- **`server/src/index.js`** — Removed routes: `POST /api/rooms/create`, `POST /api/rooms/join`, `GET /api/status`, `GET /api/rooms`. Kept `GET /api/health`, `POST /api/livekit/token`, static client build, SPA catch-all. Removed all imports/usages of roomManager, resourcePool, auth.
- **Deleted:** `server/src/rooms/roomManager.js`, `server/src/rooms/resourcePool.js`, `server/src/auth/auth.js`.
- **`server/package.json`** — Removed bcrypt, jsonwebtoken, uuid.

**Outcome:** Server is thin (static + token service only); no in-memory room state.

---

### 1.4 Home: Matrix-only create/join

**Audit finding:** Home called server `/api/rooms/create` and `/api/rooms/join`; relied on server pool/status.

**Done:**

- **`client/src/pages/Home.jsx`** — Removed fetch to server room create/join. After Matrix createRoom or joinRoom only sessionStorage is set: `hush_matrixRoomId`, `hush_roomName`, `hush_displayName`, `hush_roomPassword`. Navigate to `/room/${effectiveRoomName}`. Removed pool/status UI and server status fetch.

**Outcome:** Create/join flow is Matrix-only; no 4xx from removed endpoints; Room still gets room name and context from sessionStorage.

---

### 1.5 Room: send Matrix token when requesting LiveKit token

**Audit finding:** Token request did not send Matrix access token; server could not validate identity.

**Done:**

- **`client/src/hooks/useRoom.js`** — In `connectRoom`, `fetch('/api/livekit/token', ...)` now sends header `Authorization: Bearer ${accessToken}` (from Matrix client); body: `roomName`, `participantName` only (no `participantIdentity`).
- **`client/src/pages/Room.jsx`** — No reliance on `hush_token` from sessionStorage; connected state gated on Matrix client; redirect to Home when no Matrix client and no credentials in storage.

**Outcome:** LiveKit token request includes Matrix Bearer token; server returns 401 if token missing or invalid; Room works after refresh with auth persistence.

---

### 1.6 Crypto init failure: block app and show full-screen error

**Audit finding:** initRustCrypto failure allowed continued use; no clear block or error.

**Done:**

- **`client/src/hooks/useMatrixAuth.js`** — In all three auth flows (loginAsGuest, login, register): initRustCrypto wrapped in try/catch; on failure set `cryptoError`, do not call startClient or persist credentials; `isAuthenticated` stays false. Exposed `cryptoError` and `clearCryptoError`.
- **`client/src/pages/Home.jsx`** — When `cryptoError` is set, render full-screen block with message (e.g. "Encryption unavailable…") and "Retry"; no normal form or room access.

**Outcome:** WASM/crypto init failure shows clear error screen and blocks room access; no silent unencrypted use.

---

### 1.7 LiveKit E2EE: random key + Matrix to-device distribution

**Audit finding:** LiveKit E2EE used password-derived key only; no Matrix to-device key distribution per PLAN B2.3.2.

**Done:**

- **`client/src/hooks/useRoom.js`** — `connectRoom(roomName, displayName, roomPassword, matrixRoomId)`. To-device listener for `io.hush.e2ee_key`: on matching `roomId` apply `key` and `keyIndex` to keyProvider (joiners and rekey). Creator: after connect, if first in room (`room.remoteParticipants.size === 0`) generate 16-byte random key, `setKey(key, 0)`. On `ParticipantConnected`, creator sends key via Matrix `encryptAndSendToDevice('io.hush.e2ee_key', ...)` (Olm-encrypted) to joiner’s devices (from crypto.getUserDeviceInfo). Joiner: same keyProvider/worker; placeholder key so Room connects; real key applied when to-device arrives. Refs: `matrixRoomIdRef`, `currentKeyIndexRef`, `toDeviceUnsubscribeRef`; cleanup on disconnect.
- **`client/src/pages/Room.jsx`** — Passes `matrixRoomId` from sessionStorage into `connectRoom`.

**Outcome:** Creator generates random key; joiners receive it via to-device and apply it; two-participant call has E2EE; no reliance on password-derived key for this path.

---

## Phase 2: High priority fixes

### 2.1 Rekeying: leader election and distribute new key via to-device

**Audit finding:** Rekeying was local only; no single leader; new joiners did not get current key per PLAN B2.3.3.

**Done:**

- **`client/src/hooks/useRoom.js`** — On `ParticipantDisconnected`: remaining participants = local + remote identities, sorted; leader = first (smallest Matrix user ID). Only leader generates new key (`crypto.getRandomValues(16)`), increments `currentKeyIndexRef`, `keyProvider.setKey(newKey, newKeyIndex)`, sends to all other remaining participants via `encryptAndSendToDevice('io.hush.e2ee_key', ...)`. Others receive new key via existing to-device listener. New joiners get current key from creator/leader on `ParticipantConnected`.

**Outcome:** One participant leaves → only leader generates and sends new key; others receive and update; new joiner gets current key.

---

### 2.2 E2EE worker failure: disable media UI

**Audit finding:** E2EE worker failure allowed unencrypted media; audit required disabling media buttons.

**Done:**

- **`client/src/hooks/useRoom.js`** — Added `mediaE2EEUnavailable`; set true in E2EE init catch; cleared at start of connectRoom; returned from hook.
- **`client/src/components/Controls.jsx`** — New prop `mediaE2EEUnavailable` (used as `mediaDisabled`/`mediaTitle`). When true: screen share, mic, and webcam buttons disabled with tooltip "Media encryption unavailable" and reduced opacity/cursor.

**Outcome:** E2EE init failure results in disabled media controls and clear message; no silent unencrypted media.

---

### 2.3 m.room.guest_access in room creation

**Audit finding:** createRoom did not include `m.room.guest_access`; guests could not join by alias as required.

**Done:**

- **`client/src/pages/Home.jsx`** — In createRoom `initial_state`, added `{ type: 'm.room.guest_access', state_key: '', content: { guest_access: 'can_join' } }`.

**Outcome:** Newly created rooms have guest_access can_join.

---

### 2.4 SECURITY.md

**Audit finding:** PLAN B2.5.2 required SECURITY.md with algorithms, key distribution, rekeying, TOFU, implementation, browser support, limitations.

**Done:**

- **`SECURITY.md`** (project root) — Sections: Encryption algorithms (Olm, Megolm, LiveKit AES-GCM); Key distribution (chat + media, to-device `io.hush.e2ee_key`); Key rotation (rekeying); Trust model (TOFU); Crypto implementation (vodozemac, LiveKit); Browser support table; Known limitations (no device verification, no key backup/SSSS, no cross-signing, token service behaviour); Server behaviour (token service).

**Outcome:** SECURITY.md exists and covers required topics.

---

### 2.5 Token service "room" behaviour (document)

**Audit finding:** Token service behaviour after B3 (no server room list) was undefined.

**Done:**

- **`server/src/livekit/tokenService.js`** — File-level comment: server does not validate Matrix room membership; access control is Matrix + room name as shared secret; see SECURITY.md.
- **`SECURITY.md`** — "Server behaviour (token service)" and "Known limitations" describe that the server validates only Matrix token (whoami); no room membership check; room name is shared secret.

**Outcome:** Behaviour documented and consistent with implementation.

---

## Files touched (summary)

| Area | Files |
|------|--------|
| Auth persistence | `client/src/lib/authStorage.js` (new), `client/src/contexts/AuthContext.jsx` (new), `client/src/hooks/useMatrixAuth.js`, `client/src/App.jsx`, `client/src/pages/Home.jsx`, `client/src/pages/Room.jsx` |
| Token service | `server/src/livekit/tokenService.js`, `server/src/index.js` |
| Server cleanup | `server/src/index.js`, `server/package.json`; deleted `server/src/rooms/roomManager.js`, `server/src/rooms/resourcePool.js`, `server/src/auth/auth.js` |
| Room / E2EE | `client/src/hooks/useRoom.js`, `client/src/pages/Room.jsx`, `client/src/pages/Home.jsx` |
| Crypto error / media disable | `client/src/hooks/useMatrixAuth.js`, `client/src/pages/Home.jsx`, `client/src/hooks/useRoom.js`, `client/src/components/Controls.jsx` |
| Documentation | `SECURITY.md` (new), `server/src/livekit/tokenService.js` (comments) |

---

## Not done (optional / Phase 3)

- **docs/e2ee-test-checklist.md** — Plan Phase 3: copy/move `scripts/e2ee-testing-checklist.md` to `docs/e2ee-test-checklist.md`; not implemented.
- **client/src/lib/audioProcessing.js** — Extract noise-gate from useRoom; optional; not done.
- **Chat:** Use `event.isDecryptionFailure()` where available; optional; not done.
- **LiveKit port range** — Align to 50000–60000 UDP if needed for scale; optional.

---

*Summary produced from implementation work against the "Fix Audit Report A–B2 Issues" plan. For the original findings, see [AUDIT_REPORT_A_B2.md](./AUDIT_REPORT_A_B2.md).*
