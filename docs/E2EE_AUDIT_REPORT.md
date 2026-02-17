# Hush E2EE Audit Report

Date: 2026-02-17
Auditor: Claude Code
Branch: claude/audit-e2ee-diagnostic-Wbrj6

---

## Executive Summary

Hush's E2EE implementation is **fundamentally broken across all three layers**. Chat E2EE is sabotaged by application code that actively rejects encrypted rooms (treating Synapse's auto-encryption as a "stale room" error and retrying with a new alias until encryption is absent). Media E2EE via LiveKit's built-in `ExternalE2EEKeyProvider` is architecturally sound but suffers from a **fatal key distribution design flaw**: every joining participant generates their own random key and races with the creator's key delivered via plaintext Matrix to-device messages, causing key mismatch, a broadcast feedback loop, and — most critically — the homeserver sees every E2EE key in cleartext, completely defeating end-to-end encryption. Signaling E2EE is not applicable (LiveKit handles signaling over its own TLS channel).

**Severity: CRITICAL.** No E2EE layer provides actual end-to-end encryption in practice.

---

## Important Note: Architecture Mismatch with Task Description

The task description references mediasoup, Socket.io, `socketHandlers.js`, `useMediasoup.js`, `crypto.subtle`, and `createEncodedStreams`. **None of these exist in the current codebase.** The project has migrated to:

- **LiveKit** (SFU) — replaces mediasoup entirely
- **LiveKit's built-in E2EE** (`ExternalE2EEKeyProvider` + `e2ee-worker`) — replaces manual Encoded Transform / Web Crypto
- **Matrix (Synapse + matrix-js-sdk v40.3.0-rc.0)** — auth, rooms, chat, key distribution
- **No Socket.io** — removed entirely; no `socketHandlers.js` exists

This audit covers the actual codebase as found.

---

## E2EE Code Surface Map

### Client-Side

| File | Function/Block | What It Does | E2EE Layer | Dependencies |
|------|---------------|-------------|------------|-------------|
| `client/src/hooks/useMatrixAuth.js:86` | `loginAsGuest()` → `initRustCrypto()` | Initializes Matrix Rust crypto after guest registration | Chat E2EE | matrix-js-sdk, @matrix-org/matrix-sdk-crypto-wasm |
| `client/src/hooks/useMatrixAuth.js:160` | `login()` → `initRustCrypto()` | Initializes Matrix Rust crypto after login | Chat E2EE | matrix-js-sdk |
| `client/src/hooks/useMatrixAuth.js:225` | `register()` → `initRustCrypto()` | Initializes Matrix Rust crypto after registration | Chat E2EE | matrix-js-sdk |
| `client/src/lib/matrixClient.js:16-35` | `createMatrixClient()` | Creates matrix-js-sdk client (no explicit crypto store config) | Chat E2EE | matrix-js-sdk |
| `client/src/pages/Home.jsx:302-307` | `client.createRoom()` | Creates Matrix room with `preset: 'public_chat'`, no `initial_state` encryption event | Chat E2EE | matrix-js-sdk |
| `client/src/pages/Home.jsx:334-338` | Encryption state check | **Detects `m.room.encryption` and REJECTS room as "stale"** | Chat E2EE (SABOTAGE) | matrix-js-sdk |
| `client/src/components/Chat.jsx:238` | `client.sendMessage()` | Sends message (would auto-encrypt if room has E2EE enabled) | Chat E2EE | matrix-js-sdk |
| `client/src/components/Chat.jsx:171` | Timeline event filter | Filters for `EventType.RoomMessage` — correct for decrypted events | Chat E2EE | matrix-js-sdk |
| `client/src/hooks/useRoom.js:9` | Import `ExternalE2EEKeyProvider` | LiveKit E2EE key provider class | Media E2EE | livekit-client |
| `client/src/hooks/useRoom.js:15` | Import `E2EEWorker` | LiveKit E2EE web worker (Vite worker import) | Media E2EE | livekit-client |
| `client/src/hooks/useRoom.js:239-261` | Key generation/retrieval | Checks sessionStorage for existing key; if absent, generates random 32-byte key | Media E2EE | Web Crypto (`crypto.getRandomValues`) |
| `client/src/hooks/useRoom.js:267-268` | `new ExternalE2EEKeyProvider()` | Creates LiveKit E2EE key provider | Media E2EE | livekit-client |
| `client/src/hooks/useRoom.js:271` | `keyProvider.setKey(keyBytes)` | Sets encryption/decryption key on LiveKit provider | Media E2EE | livekit-client |
| `client/src/hooks/useRoom.js:274` | `new E2EEWorker()` | Creates web worker for frame-level encryption | Media E2EE | livekit-client |
| `client/src/hooks/useRoom.js:300-305` | Room E2EE options | Passes `{ keyProvider, worker }` to LiveKit `Room` constructor | Media E2EE | livekit-client |
| `client/src/hooks/useRoom.js:112-137` | `sendE2EEKey()` | Sends E2EE key as **plaintext** Matrix to-device message (`io.hush.livekit.e2ee_key`) | Media E2EE Key Distribution | matrix-js-sdk |
| `client/src/hooks/useRoom.js:139-176` | `handleToDeviceEvent()` | Receives E2EE key from Matrix to-device message, applies to key provider | Media E2EE Key Distribution | matrix-js-sdk, livekit-client |
| `client/src/hooks/useRoom.js:325-334` | `ParticipantConnected` handler | Room creator sends E2EE key to new participants | Media E2EE Key Distribution | matrix-js-sdk |
| `client/src/pages/Room.jsx:273-284` | E2EE key broadcast effect | Sends E2EE key to ALL participants whenever participant list changes | Media E2EE Key Distribution | useRoom hook |
| `client/vite.config.js:52-53` | Dev server COOP/COEP headers | Sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (dev only) | Media E2EE | Vite |
| `client/vite.config.js:45-48` | Worker config | Configures Vite workers with WASM + top-level-await plugins | Media E2EE | Vite |

### Server-Side

| File | Function/Block | What It Does | E2EE Layer | Dependencies |
|------|---------------|-------------|------------|-------------|
| `server/src/livekit/tokenService.js:12-35` | `generateToken()` | Generates LiveKit JWT — no E2EE-specific grants | Media E2EE (indirect) | livekit-server-sdk |
| `server/src/index.js:159-184` | `/api/livekit/token` endpoint | Issues LiveKit tokens — no E2EE awareness | Media E2EE (indirect) | express |
| `synapse/homeserver.yaml.template:56` | `encryption_enabled_by_default_for_room_type: all` | Auto-enables E2EE for ALL rooms on homeserver | Chat E2EE | Synapse |
| `livekit/livekit.yaml` | LiveKit server config | No E2EE-specific configuration (key management is client-side) | Media E2EE | LiveKit |
| `caddy/Caddyfile` | Reverse proxy config | **Missing COOP/COEP headers** required for SharedArrayBuffer in production | Media E2EE | Caddy |

### Files with ZERO E2EE relevance (confirmed clean)

- `server/src/config.js` — Contains stale mediasoup config references but no active mediasoup code
- `server/src/rooms/roomManager.js` — Room management, no crypto
- `server/src/auth/auth.js` — JWT auth, no E2EE
- `client/src/App.jsx` — Routing only
- `client/src/components/StreamView.jsx` — Video rendering only
- `client/src/components/Controls.jsx` — UI controls only

---

## Layer-by-Layer Analysis

### Chat E2EE (Matrix Olm/Megolm)

- **Status: BROKEN — actively sabotaged by application code**

- **Evidence:**

  1. **Crypto initialization is correct.** `initRustCrypto()` is called after authentication in all three auth flows (`useMatrixAuth.js:86,160,225`). The Rust crypto module manages its own IndexedDB store internally (correct for matrix-js-sdk v40+).

  2. **Synapse is configured to auto-encrypt all rooms.** The homeserver template at `synapse/homeserver.yaml.template:56` sets:
     ```yaml
     encryption_enabled_by_default_for_room_type: all
     ```
     This means Synapse automatically adds the `m.room.encryption` state event (with algorithm `m.megolm.v1.aes-sha2`) to every newly created room, including public ones.

  3. **The application actively rejects encrypted rooms.** In `client/src/pages/Home.jsx:334-338`:
     ```javascript
     // Check if room has encryption enabled (indicates stale encrypted room)
     const encryptionState = roomInClient.currentState.getStateEvents('m.room.encryption', '');
     if (encryptionState) {
       console.warn('[home] Room has encryption enabled (stale room detected), retrying with unique alias');
       throw new Error('ROOM_ENCRYPTED');
     }
     ```
     This error is caught by the collision handler at line 347-348:
     ```javascript
     const isCollision = err.errcode === 'M_ROOM_IN_USE' ||
                          err.message === 'ROOM_ENCRYPTED' ||
                          (err.data && err.data.errcode === 'M_ROOM_IN_USE');
     ```
     On collision, it generates a random suffix (line 353) and retries room creation. But the new room will ALSO be auto-encrypted by Synapse, causing another retry. This loops until `maxRetries` (3) is exhausted, then **throws an error that prevents room creation entirely**.

  4. **If Synapse encryption_enabled_by_default is OFF:** Rooms are created without `m.room.encryption`, and messages sent via `client.sendMessage()` in `Chat.jsx:238` are transmitted as plaintext `m.room.message` events. Chat has zero encryption.

  5. **If Synapse encryption_enabled_by_default is ALL:** Room creation enters a fatal retry loop and fails entirely.

  6. **Room creation uses `preset: 'public_chat'` with NO `initial_state` encryption config.** At `Home.jsx:302-307`:
     ```javascript
     createResponse = await client.createRoom({
       name: actualRoomName,
       room_alias_name: actualRoomName,
       visibility: 'public',
       preset: 'public_chat',
     });
     ```
     The `public_chat` preset sets `join_rules: public` and `history_visibility: shared`. No `initial_state` array with `m.room.encryption` is provided. The app relies entirely on Synapse's server-side auto-encryption config, but then fights against it.

- **Issues:**
  1. **[CRITICAL]** `Home.jsx:334-338` treats encrypted rooms as "stale" and rejects them, creating a fatal loop with Synapse's `encryption_enabled_by_default_for_room_type: all` config
  2. **[CRITICAL]** No `m.room.encryption` state event in `initial_state` during room creation — encryption depends entirely on server-side config that the client then rejects
  3. **[HIGH]** Room created with `preset: 'public_chat'` — even if encryption were working, public rooms have weaker security semantics (anyone can join and receive Megolm keys)
  4. **[MEDIUM]** No verification of other devices — all devices are trusted blindly (no cross-signing setup)
  5. **[LOW]** `Chat.jsx` has diagnostic logging (`console.log`) that exposes crypto state in browser console

### Signaling E2EE

- **Status: NOT APPLICABLE (architecture change)**

- **Evidence:** The project uses LiveKit as the SFU. LiveKit signaling uses its own WebSocket protocol protected by TLS (`wss://`). There is no separate Socket.io signaling layer. The `socketHandlers.js` and `e2eKeyExchange` event referenced in the task description do not exist.

  The only signaling-adjacent concern is the E2EE key distribution via Matrix to-device messages, which is covered under Media E2EE below.

- **Issues:**
  1. **[MEDIUM]** Caddy reverse proxy (`caddy/Caddyfile`) does not terminate TLS for the LiveKit WebSocket route — in production, the `livekit` handle block at line 39 proxies to `livekit:7880` without TLS. The LiveKit config (`livekit.yaml`) has no TLS configured. In production behind Caddy with auto-HTTPS enabled, this would be handled. In the current dev config (`auto_https off`), signaling is unencrypted.

### Media E2EE (LiveKit Built-in E2EE)

- **Status: BROKEN — key distribution is fatally flawed**

- **Evidence:**

  The implementation correctly uses LiveKit's built-in E2EE framework. LiveKit handles the Encoded Transform / Web Crypto pipeline internally via its `e2ee-worker`. The application does NOT need manual `crypto.subtle` calls or `TransformStream` setup — this is all handled by the LiveKit SDK. The integration points are:

  **What works correctly:**
  - `ExternalE2EEKeyProvider` is properly instantiated (`useRoom.js:267`)
  - Key is set on the provider before room connection (`useRoom.js:271`)
  - `E2EEWorker` is properly loaded as a Vite web worker (`useRoom.js:274`)
  - Room is created with E2EE options (`useRoom.js:300-305`)
  - Random 32-byte key generated with cryptographically secure `crypto.getRandomValues()` (`useRoom.js:251-252`)
  - COOP/COEP headers configured for dev server (`vite.config.js:52-53`) — required for `SharedArrayBuffer`

  **What is fatally broken:**

  1. **[CRITICAL] E2EE key is transmitted in plaintext through the Matrix homeserver.** The `sendE2EEKey` function at `useRoom.js:119-136`:
     ```javascript
     const keyBase64 = btoa(String.fromCharCode(...keyBytes));
     await matrixClient.sendToDevice('io.hush.livekit.e2ee_key', {
       [participantUserId]: {
         '*': {
           key: keyBase64,
           roomId: roomName,
         },
       },
     });
     ```
     This sends the raw 32-byte AES key as a base64 string in a custom to-device event type `io.hush.livekit.e2ee_key`. Matrix to-device messages of custom types are **NOT Olm-encrypted** — they are transmitted as plaintext JSON through the homeserver. The Synapse server can read every E2EE key. **This completely defeats end-to-end encryption.** The homeserver (or anyone who compromises it) has full access to all media encryption keys.

  2. **[CRITICAL] Key generation race condition — both peers generate different keys.** When a user joins a room, the `connectRoom` function at `useRoom.js:239-261`:
     ```javascript
     const storedKey = sessionStorage.getItem('hush_livekit_e2ee_key');
     if (storedKey) {
       // Decode stored base64 key
       // ...
     } else {
       // Generate new random 32-byte key for room creator
       keyBytes = new Uint8Array(32);
       crypto.getRandomValues(keyBytes);
       // ...
       isRoomCreator = true;
     }
     ```
     A joining participant has no stored key (fresh session), so they generate their OWN random key and incorrectly set `isRoomCreator = true`. The actual room creator also has a different key. Both peers connect to LiveKit encrypting with different keys. The to-device key exchange may eventually align them, but there is a window of garbled/undecryptable media.

  3. **[CRITICAL] Bidirectional key broadcast creates a feedback loop.** The `Room.jsx` effect at lines 273-284:
     ```javascript
     useEffect(() => {
       if (!e2eeKey || participants.length === 0) return;
       participants.forEach((participant) => {
         sendE2EEKey(participant.id, e2eeKey, roomName);
       });
     }, [participants.length, e2eeKey, sendE2EEKey]);
     ```
     This sends the local participant's key to ALL other participants whenever the participant list or key changes. Combined with the `handleToDeviceEvent` handler that updates the local `e2eeKey` state upon receiving a key, this creates a cycle:
     - Creator sends KEY_A to joiner
     - Joiner receives KEY_A, updates `e2eeKey` state → triggers Room.jsx effect → sends KEY_A back to creator
     - If timing is bad: joiner's initial KEY_B arrives at creator BEFORE creator's KEY_A reaches joiner → creator switches to KEY_B → joiner then receives KEY_A → switches to KEY_A → keys are swapped, media is broken

  4. **[HIGH] No key rotation on participant leave.** When a participant disconnects, their key material is not rotated. The departed participant retains the encryption key and could decrypt media streams if they somehow continue to receive them (e.g., via a compromised SFU or network tap).

  5. **[HIGH] COOP/COEP headers missing in production.** The Caddy reverse proxy (`caddy/Caddyfile`) does not set `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy` headers. LiveKit's E2EE worker uses `SharedArrayBuffer`, which requires these headers. Without them, the E2EE worker will fail silently in production. The headers are only configured for the Vite dev server (`vite.config.js:52-53`).

  6. **[MEDIUM] sessionStorage key persistence issues.** The E2EE key is stored in `sessionStorage` (`useRoom.js:256`). This means:
     - Key persists across page refreshes within the same tab (correct)
     - Key does NOT persist across browser tabs — opening a second tab generates a new key
     - Key does NOT persist across browser close/reopen — generates a new key
     This can cause inconsistent key state when users have multiple tabs open.

- **Root cause hypothesis:** The primary failure is the **plaintext key distribution through the Matrix homeserver**, combined with the **race condition where all peers generate their own keys**. Even if the key exchange messages arrive, both sides may be encrypting with different keys during the race window. The key broadcast effect in Room.jsx then creates conflicting key update messages. The fundamental design flaw is using a custom unencrypted to-device event type instead of Olm-encrypted to-device messages.

---

## Matrix Crypto Health

### 1. matrix-js-sdk Version
**Version: `^40.3.0-rc.0`** (client/package.json:14)

This is a **release candidate** of v40. Using an RC in production is risky — it may contain known bugs fixed in the final release. matrix-js-sdk v40+ uses the Rust crypto implementation via `@matrix-org/matrix-sdk-crypto-wasm`, which is the correct modern approach. However:
- The `vite-plugin-wasm` and `vite-plugin-top-level-await` plugins are correctly configured to handle the WASM module
- The WASM module is correctly excluded from pre-bundling in `vite.config.js:37`

### 2. Crypto Store Persistence
**Rust crypto manages its own IndexedDB store internally.** In matrix-js-sdk v40+, calling `initRustCrypto()` creates a persistent IndexedDB-backed crypto store. No explicit `MemoryCryptoStore` is used. This is **correct** — keys survive page refreshes.

However, `createMatrixClient()` in `matrixClient.js:27-32` does not pass any `store` option to `sdk.createClient()`. The matrix-js-sdk default is `MemoryStore` for the general sync store (not the crypto store). This means:
- **Crypto keys persist** (IndexedDB via Rust crypto) ✓
- **Room state and sync data do NOT persist** (MemoryStore) — on page refresh, the client must re-sync from scratch

### 3. Device Key Upload
**Handled automatically by `initRustCrypto()`.** When Rust crypto initializes, it automatically generates device keys (Ed25519 + Curve25519) and uploads them to the homeserver via `/_matrix/client/v3/keys/upload`. No manual upload call is needed with Rust crypto.

### 4. Room Encryption State
**Broken — see Chat E2EE analysis above.** The application:
- Does NOT include `m.room.encryption` in `initial_state` during `createRoom()`
- Relies on Synapse's `encryption_enabled_by_default_for_room_type: all`
- Then **rejects rooms that have encryption enabled** (treats as "stale")

### 5. /sync Processing
`startClient({ initialSyncLimit: 20 })` is called correctly in `useMatrixAuth.js:111`. The `loginAsGuest()` flow waits for sync to reach `PREPARED` or `SYNCING` state before resolving. The Rust crypto module automatically processes encryption-related sync events (to-device messages, room key events) during sync.

The `toDeviceEvent` listener is registered in `useRoom.js:211`, but it only handles the custom `io.hush.livekit.e2ee_key` event type — not standard Matrix key events like `m.room_key`.

### 6. UISI (Unable to Decrypt) Error Handling
**No UISI handling implemented.** The `Chat.jsx` component filters for `EventType.RoomMessage` events and displays `event.getContent().body`. If a message cannot be decrypted:
- matrix-js-sdk would keep the event type as `m.room.encrypted` (not `m.room.message`)
- The Chat component's filter at line 171 (`e.getType() === EventType.RoomMessage`) would silently skip undecryptable messages
- No error is shown to the user; messages simply don't appear
- No retry logic for failed decryption

### 7. Cross-Signing
**Not configured.** No cross-signing bootstrap code exists. All devices are implicitly trusted. This means:
- Key verification between users is not possible
- A compromised device cannot be distinguished from a legitimate one
- In practice, this is acceptable for an early-stage product but must be addressed before claiming real E2EE security

### 8. Device Verification
**All devices trusted blindly.** No verification UI or logic exists. Combined with the lack of cross-signing, this means any device claiming to be a user's device is trusted without question.

---

## Prioritized Fix Plan

### Critical (E2EE fundamentally broken without these)

1. **Remove the "stale encrypted room" rejection logic** — `Home.jsx:334-338` must be deleted. Instead, the code should EXPECT and WELCOME the `m.room.encryption` state event. If Synapse auto-enables encryption, the client should proceed normally. — **Estimated complexity: S**

2. **Add `m.room.encryption` to `initial_state` in `createRoom()`** — `Home.jsx:302-307` should include:
   ```javascript
   initial_state: [{
     type: 'm.room.encryption',
     state_key: '',
     content: { algorithm: 'm.megolm.v1.aes-sha2' }
   }]
   ```
   This ensures encryption is enabled regardless of server config. Also consider changing preset from `public_chat` to `trusted_private_chat` for true E2EE rooms. — **Estimated complexity: S**

3. **Replace plaintext to-device key exchange with Olm-encrypted to-device messages** — The current `sendToDevice('io.hush.livekit.e2ee_key', ...)` sends the LiveKit E2EE key in cleartext. Instead, use matrix-js-sdk's `encryptAndSendToDevices()` API (or send the key as an Olm-encrypted `m.room_key`-style to-device event). This ensures the homeserver cannot see the key material. — **Estimated complexity: L**

4. **Fix the key generation race condition** — Only the room CREATOR should generate the E2EE key. Joiners must NOT generate their own key. Instead, joiners should:
   - Connect to LiveKit WITHOUT E2EE initially
   - Wait to receive the key via Matrix to-device message
   - Then enable E2EE with the received key
   - Or: use a deterministic key derivation from a shared secret (room password) so all participants derive the same key without key exchange. — **Estimated complexity: M**

5. **Remove the bidirectional key broadcast in `Room.jsx:273-284`** — Only the room creator should distribute keys. Joiners should never broadcast keys. The current effect sends keys from ALL participants to ALL other participants, creating race conditions and feedback loops. — **Estimated complexity: S**

### High (E2EE works but insecure without these)

1. **Add COOP/COEP headers to Caddy production config** — `caddy/Caddyfile` must include for the main site:
   ```
   header Cross-Origin-Opener-Policy "same-origin"
   header Cross-Origin-Embedder-Policy "require-corp"
   ```
   Without these, `SharedArrayBuffer` is unavailable and LiveKit's E2EE worker will fail in production. — **Estimated complexity: S**

2. **Implement key rotation on participant leave** — When a participant disconnects, generate a new random key and distribute it to all remaining participants. This prevents the departed participant from decrypting future media. — **Estimated complexity: M**

3. **Use `trusted_private_chat` or `private_chat` preset instead of `public_chat`** — Public rooms allow anyone to join without invitation. For E2EE to be meaningful, room access should be restricted. Consider invite-only rooms with password-based invitation flow. — **Estimated complexity: M**

4. **Handle UISI errors in Chat.jsx** — Add a listener for `m.room.encrypted` events that failed decryption. Show a user-visible warning (e.g., "Unable to decrypt message"). Implement retry logic for key request. — **Estimated complexity: M**

### Medium (Improvements to robustness/UX)

1. **Upgrade matrix-js-sdk from RC to stable release** — `^40.3.0-rc.0` is a release candidate. Pin to the latest stable v40.x release. — **Estimated complexity: S**

2. **Add a persistent sync store** — Replace the default `MemoryStore` with `IndexedDBStore` for the general Matrix sync store. This prevents full re-sync on page refresh and improves perceived performance. — **Estimated complexity: S**

3. **Add E2EE status indicator in UI** — Show users whether their room has E2EE enabled (for both chat and media). Display a lock icon or similar. Currently there is no visual feedback about encryption state. — **Estimated complexity: S**

4. **Implement cross-signing bootstrap** — Set up master, self-signing, and user-signing keys. This enables device verification and key trust. — **Estimated complexity: L**

5. **Remove `isRoomCreator` sessionStorage ambiguity** — The `isRoomCreator` flag is determined by whether a key exists in sessionStorage, NOT by whether the user actually created the room. Store the creator flag explicitly (e.g., from the room creation API response). — **Estimated complexity: S**

### Low (Nice to have)

1. **Add E2EE diagnostic/health check endpoint** — A debug panel that shows: crypto initialized, room encryption state, Megolm session status, device key upload status, E2EE worker status. — **Estimated complexity: M**

2. **Remove stale mediasoup config from `server/src/config.js`** — Lines 43-113 contain mediasoup configuration that is no longer used. Dead code creates confusion. — **Estimated complexity: S**

3. **Remove diagnostic `console.log` statements** — Multiple files have verbose crypto diagnostic logging that could leak sensitive state info in production. — **Estimated complexity: S**

4. **Consider SFrame instead of LiveKit's default E2EE** — LiveKit supports SFrame-based E2EE which has better standardization. Evaluate whether this provides advantages for Hush's use case. — **Estimated complexity: L**

---

## Recommended Fix Order

```
1. [S] Remove "stale encrypted room" rejection (Home.jsx:334-338)
   └── No dependencies. Unblocks everything else.

2. [S] Add m.room.encryption to initial_state in createRoom()
   └── Depends on: #1 (otherwise creates infinite retry loop)

3. [S] Add COOP/COEP headers to Caddy config
   └── No dependencies. Unblocks media E2EE in production.

4. [S] Remove bidirectional key broadcast (Room.jsx:273-284)
   └── No dependencies. Removes key conflict source.

5. [M] Fix key generation race — only creator generates key
   └── Depends on: #4 (key broadcast removal)

6. [L] Replace plaintext to-device with Olm-encrypted key exchange
   └── Depends on: #1, #2 (rooms must have encryption enabled)
   └── This is the most complex fix. Consider password-derived keys
       as an interim solution (see Architecture Recommendation).

7. [M] Implement key rotation on participant leave
   └── Depends on: #5, #6 (key distribution must work first)

8. [M] Change room preset to trusted_private_chat
   └── Depends on: #1, #2

9. [M] Handle UISI errors in Chat.jsx
   └── Depends on: #1, #2 (rooms must have encryption for UISI to occur)

10. [S] Upgrade matrix-js-sdk to stable release
    └── No dependencies. Can be done anytime.
```

---

## Architecture Recommendation

### Current Approach: Matrix to-device key exchange (blind plaintext relay)

**Pros:**
- Simple implementation
- Uses existing Matrix infrastructure
- Keys can be distributed to offline devices (to-device messages are queued)

**Cons:**
- **Homeserver sees all keys** — the custom event type `io.hush.livekit.e2ee_key` is not Olm-encrypted, so the server has full access to E2EE key material. This makes "E2EE" meaningless.
- Race conditions between key generation and key receipt
- No key verification or authentication
- Bidirectional broadcast creates conflicts

### Option A: Fix current approach — Olm-encrypted to-device messages

Use matrix-js-sdk's `encryptAndSendToDevices()` or manually create Olm sessions with target devices and send the LiveKit E2EE key inside an Olm-encrypted to-device payload.

**Pros:**
- Homeserver cannot see key material (Olm encryption)
- Leverages Matrix's existing key management infrastructure
- Supports offline key delivery
- Aligns with how Matrix E2EE key sharing works (`m.room_key` events)

**Cons:**
- Requires Olm sessions to be established with every device in the room before keys can be sent
- Olm session establishment requires `/keys/claim` one-time key exchange, adding latency
- More complex error handling (what if Olm session fails? what if device keys aren't uploaded yet?)
- Key distribution latency: Matrix sync polling introduces delay

**Estimated complexity: L (large)**

### Option B: Password-derived key (interim solution)

Derive the LiveKit E2EE key from the room password using PBKDF2 or HKDF. All participants who know the password derive the same key deterministically. No key exchange needed.

```javascript
const encoder = new TextEncoder();
const keyMaterial = await crypto.subtle.importKey(
  'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
);
const keyBytes = new Uint8Array(await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt: encoder.encode(roomName), iterations: 100000, hash: 'SHA-256' },
  keyMaterial, 256
));
```

**Pros:**
- Zero key exchange needed — eliminates all race conditions
- Zero server involvement — true E2EE by construction
- Simple implementation
- Immediate — works today without Matrix crypto
- Users already enter a password to join

**Cons:**
- Key strength is bounded by password entropy (users choose weak passwords)
- No forward secrecy — if password is compromised, all past media is decryptable
- No key rotation unless password changes
- Cannot revoke access for a specific participant without changing the room password
- PBKDF2 with sufficient iterations mitigates brute-force but doesn't eliminate it

**Estimated complexity: S (small)**

### Option C: SAS-verified Olm + LiveKit E2EE (gold standard)

Full Matrix-integrated E2EE: establish Olm sessions with verified devices, share LiveKit E2EE keys via Olm-encrypted to-device messages, support cross-signing, key rotation, and SAS emoji verification.

**Pros:**
- Cryptographically sound
- Device verification prevents MITM
- Aligns with Element Call's approach
- Forward secrecy via Olm ratchet

**Cons:**
- Very complex implementation
- Requires full cross-signing bootstrap
- User friction (verification ceremony)
- Significant development effort

**Estimated complexity: XL**

### Recommendation

**Implement Option B (password-derived key) immediately** as a tactical fix that provides real E2EE with zero server trust. Then pursue **Option A (Olm-encrypted to-device)** as the strategic solution. Option C is the long-term goal but should not block shipping functional E2EE.

The password-derived key approach can be implemented in a single file change (`useRoom.js`), eliminates all key exchange complexity, and provides genuine end-to-end encryption where the server never sees the key material. It has weaknesses (password entropy, no forward secrecy), but it is infinitely better than the current state where the server sees every key in plaintext.

---

## References

- [Matrix Client-Server API: E2EE](https://spec.matrix.org/v1.8/client-server-api/#end-to-end-encryption) — Olm/Megolm specification
- [Matrix Client-Server API: To-Device Messages](https://spec.matrix.org/v1.8/client-server-api/#send-to-device-messaging) — How to-device events work
- [LiveKit E2EE Documentation](https://docs.livekit.io/realtime/client/security/e2ee/) — LiveKit's built-in E2EE with `ExternalE2EEKeyProvider`
- [LiveKit E2EE Source (livekit-client)](https://github.com/livekit/client-sdk-js/tree/main/src/e2ee) — Reference implementation of LiveKit E2EE worker and key management
- [Element Call Source Code](https://github.com/element-hq/element-call) — Reference implementation of Matrix + LiveKit with E2EE using `MatrixRTCSession` for key distribution
- [WebRTC Encoded Transform Spec](https://w3c.github.io/webrtc-encoded-transform/) — W3C spec for frame-level media encryption (used internally by LiveKit SDK)
- [matrix-js-sdk Crypto Documentation](https://matrix-org.github.io/matrix-js-sdk/stable/classes/MatrixClient.html#initRustCrypto) — Rust crypto initialization in v40+
- [Synapse Configuration: encryption_enabled_by_default](https://element-hq.github.io/synapse/latest/usage/configuration/config_documentation.html#encryption_enabled_by_default_for_room_type) — Server-side room encryption config
- [SharedArrayBuffer and COOP/COEP](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements) — Browser security requirements for E2EE workers
