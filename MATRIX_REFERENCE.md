# Matrix Protocol Reference for Hush

> **Scope:** Targeted reference for building a Matrix + LiveKit screen-sharing app with E2EE.
> **Spec version:** v1.17 | **Source:** https://spec.matrix.org/v1.17/
> **What this covers:** Client-Server API (auth, sync, rooms, events, E2EE, VoIP, to-device, media)
> **What this skips:** Identity Service API, Push Gateway API, Server-Server federation internals, room version diffs, moderation, SSO details, push rules, tagging, search, spaces hierarchy, threading, annotations, server notices, policy lists

---

## 1. Architecture Overview

Matrix is a decentralized real-time communication protocol using JSON over REST/HTTPS.

**Core model:** Clients talk to their homeserver via the Client-Server API. Homeservers federate with each other via the Server-Server API. All room data is replicated across participating homeservers as a DAG (directed acyclic graph) of events.

**Identifiers:**
- User ID: `@localpart:domain`
- Room ID: `!opaque_id:domain` (internal, permanent)
- Room Alias: `#name:domain` (human-readable, mutable)
- Event ID: `$opaque_id` (unique per event)
- Device ID: opaque string, unique per user, created at login

**Key principle:** Clients ONLY talk to their own homeserver. If `@alice:hs1.com` sends a message to a room with `@bob:hs2.com`, Alice's client sends to `hs1.com`, which federates to `hs2.com`, which delivers to Bob's client.

---

## 2. Authentication & Session Management

### 2.1 Discovery

Client resolves homeserver URL via: `GET https://<server_name>/.well-known/matrix/client`
```json
{ "m.homeserver": { "base_url": "https://matrix.example.com" } }
```
Then validate with: `GET /_matrix/client/versions` → returns `{ "versions": ["v1.1", ...] }`

### 2.2 Registration

```
POST /_matrix/client/v3/register
Body: { "username": "alice", "password": "secret", "device_id": "MYDEVICE",
        "initial_device_display_name": "Hush Desktop" }
Response: { "user_id": "@alice:example.com", "access_token": "...", "device_id": "MYDEVICE" }
```

### 2.3 Login

```
GET  /_matrix/client/v3/login          → { "flows": [{ "type": "m.login.password" }, ...] }
POST /_matrix/client/v3/login
Body: { "type": "m.login.password",
        "identifier": { "type": "m.id.user", "user": "@alice:example.com" },
        "password": "secret", "device_id": "MYDEVICE", "refresh_token": true }
Response: { "access_token": "...", "refresh_token": "...", "device_id": "MYDEVICE",
            "user_id": "@alice:example.com" }
```

### 2.4 Using Access Tokens

All authenticated requests use: `Authorization: Bearer <access_token>`

When token expires → server returns `M_UNKNOWN_TOKEN` with `soft_logout: true`
→ refresh with: `POST /_matrix/client/v3/refresh` body `{ "refresh_token": "..." }`

### 2.5 Logout

```
POST /_matrix/client/v3/logout       → invalidates current token
POST /_matrix/client/v3/logout/all   → invalidates ALL tokens for user
```

---

## 3. Sync (Receiving Events)

The sync endpoint is the primary way clients receive events. It's a long-polling GET.

```
GET /_matrix/client/v3/sync?since=<next_batch>&timeout=30000&filter=<filter_id>
Authorization: Bearer <token>
```

**First call:** omit `since` → returns full initial state.
**Subsequent calls:** pass `next_batch` from previous response as `since`.

### 3.1 Sync Response Structure

```json
{
  "next_batch": "s72595_4483_1934",
  "rooms": {
    "join": {
      "!roomid:server": {
        "timeline": { "events": [...], "prev_batch": "..." },
        "state": { "events": [...] },
        "ephemeral": { "events": [...] },
        "account_data": { "events": [...] },
        "unread_notifications": { "notification_count": 2, "highlight_count": 0 }
      }
    },
    "invite": { "!roomid:server": { "invite_state": { "events": [...] } } },
    "leave": { "!roomid:server": { "timeline": { "events": [...] } } }
  },
  "presence": { "events": [...] },
  "account_data": { "events": [...] },
  "to_device": { "events": [...] },
  "device_lists": { "changed": ["@user:server"], "left": [] },
  "device_one_time_keys_count": { "curve25519": 49, "signed_curve25519": 50 }
}
```

**Critical fields for Hush:**
- `rooms.join.*.timeline.events` — new messages/events in joined rooms
- `to_device.events` — E2EE key sharing, call signaling
- `device_lists.changed` — triggers re-download of device keys
- `device_one_time_keys_count` — maintain one-time key supply

### 3.2 Filtering

```
POST /_matrix/client/v3/user/{userId}/filter
Body: { "room": { "timeline": { "limit": 20, "types": ["m.room.message", "m.room.encrypted"] },
                   "state": { "lazy_load_members": true } } }
Response: { "filter_id": "22" }
```
Then use `?filter=22` on sync calls. Lazy-loading members reduces initial sync payload significantly.

---

## 4. Rooms

### 4.1 Creating a Room

```
POST /_matrix/client/v3/createRoom
Body: {
  "name": "Hush Session",
  "preset": "private_chat",       // or "trusted_private_chat" (all members PL100)
  "invite": ["@bob:example.com"],
  "initial_state": [
    { "type": "m.room.encryption", "content": { "algorithm": "m.megolm.v1.aes-sha2" } }
  ],
  "creation_content": { "m.federate": true }
}
Response: { "room_id": "!newroom:example.com" }
```

**Presets:** `private_chat` (invite-only, creator=PL100), `trusted_private_chat` (all PL100), `public_chat` (joinable by anyone).

### 4.2 Joining / Leaving

```
POST /_matrix/client/v3/join/{roomIdOrAlias}     → { "room_id": "!..." }
POST /_matrix/client/v3/rooms/{roomId}/leave     → {}
POST /_matrix/client/v3/rooms/{roomId}/invite    → body: { "user_id": "@bob:server" }
POST /_matrix/client/v3/rooms/{roomId}/kick      → body: { "user_id": "@bob:server", "reason": "..." }
```

### 4.3 Room State

```
GET  /_matrix/client/v3/rooms/{roomId}/state                          → all state events
GET  /_matrix/client/v3/rooms/{roomId}/state/{eventType}/{stateKey}   → specific state
PUT  /_matrix/client/v3/rooms/{roomId}/state/{eventType}/{stateKey}   → set state
```

### 4.4 Power Levels

Power levels control permissions. Default: creator=100, everyone else=0.

```json
{ "type": "m.room.power_levels", "content": {
    "users": { "@alice:server": 100, "@bob:server": 50 },
    "users_default": 0,
    "events": { "m.room.name": 50, "m.room.power_levels": 100, "m.room.encryption": 100 },
    "events_default": 0,
    "state_default": 50,
    "ban": 50, "kick": 50, "redact": 50, "invite": 0
}}
```

---

## 5. Events

### 5.1 Sending Events

```
PUT /_matrix/client/v3/rooms/{roomId}/send/{eventType}/{txnId}
Body: { "msgtype": "m.text", "body": "hello" }
Response: { "event_id": "$eventid" }
```

`txnId` = client-generated unique ID (UUID v4 or timestamp+counter). Makes requests idempotent.

### 5.2 Event Format

```json
{
  "type": "m.room.message",
  "event_id": "$143273582443PhrSn:example.org",
  "sender": "@alice:example.org",
  "origin_server_ts": 1432735824653,
  "room_id": "!room:example.org",
  "content": { "msgtype": "m.text", "body": "Hello" },
  "unsigned": { "age": 1234 }
}
```

### 5.3 Key Event Types Reference

| Type | Purpose | State? |
|------|---------|--------|
| `m.room.create` | Room creation (first event) | Yes |
| `m.room.member` | Join/leave/invite/ban (state_key=user_id) | Yes |
| `m.room.message` | Text, images, files, etc. | No |
| `m.room.encrypted` | Encrypted event payload | No |
| `m.room.encryption` | Enables E2EE in room | Yes |
| `m.room.name` | Room display name | Yes |
| `m.room.topic` | Room description | Yes |
| `m.room.power_levels` | Permission configuration | Yes |
| `m.room.join_rules` | Who can join (invite/public/knock/restricted) | Yes |
| `m.room.history_visibility` | Who can see history (joined/invited/shared/world_readable) | Yes |
| `m.room.redaction` | Deletes an event | No |
| `m.room.tombstone` | Room has been upgraded/replaced | Yes |
| `m.call.invite` | VoIP call invitation | No |
| `m.call.answer` | VoIP call answer | No |
| `m.call.candidates` | ICE candidates | No |
| `m.call.hangup` | End call | No |

### 5.4 Message Types (m.room.message msgtypes)

| msgtype | Content keys |
|---------|-------------|
| `m.text` | `body` (plain text), optional `format` + `formatted_body` (HTML) |
| `m.image` | `body`, `url` (mxc://), `info` (mimetype, size, w, h, thumbnail_url) |
| `m.file` | `body`, `url`, `filename`, `info` (mimetype, size) |
| `m.audio` | `body`, `url`, `info` (mimetype, size, duration) |
| `m.video` | `body`, `url`, `info` (mimetype, size, w, h, duration, thumbnail_url) |
| `m.notice` | `body` — bot/system messages, clients should not trigger notifications |

### 5.5 Redaction

```
PUT /_matrix/client/v3/rooms/{roomId}/redact/{eventId}/{txnId}
Body: { "reason": "spam" }
```

---

## 6. End-to-End Encryption

### 6.1 Overview

Matrix E2EE uses **Olm** (1:1 Double Ratchet, for key exchange) and **Megolm** (group ratchet, for room messages).

**Flow:** When sending an encrypted message in a room:
1. Client creates a Megolm outbound session for the room
2. Shares the Megolm session key with each device in the room via Olm-encrypted to-device events
3. Encrypts message with Megolm → sends as `m.room.encrypted` event
4. Recipients decrypt using their copy of the Megolm session key

### 6.2 Key Types

| Key | Algo | Purpose |
|-----|------|---------|
| Fingerprint key | Ed25519 | Device identity + event signing |
| Identity key | Curve25519 | Establish Olm sessions |
| One-time keys | Curve25519 | Single-use Olm session setup (consumed on use) |
| Fallback key | Curve25519 | Used when one-time keys are exhausted |
| Megolm session key | AES-256 derived | Group message encrypt/decrypt |
| Megolm signing key | Ed25519 | Authenticate sender of group messages |

### 6.3 Device Key Upload

On first run, create Ed25519 + Curve25519 key pairs, then upload:

```
POST /_matrix/client/v3/keys/upload
Body: {
  "device_keys": {
    "user_id": "@alice:example.com",
    "device_id": "MYDEVICE",
    "algorithms": ["m.olm.v1.curve25519-aes-sha2", "m.megolm.v1.aes-sha2"],
    "keys": {
      "curve25519:MYDEVICE": "<identity_key>",
      "ed25519:MYDEVICE": "<fingerprint_key>"
    },
    "signatures": { "@alice:example.com": { "ed25519:MYDEVICE": "<signature>" } }
  },
  "one_time_keys": {
    "curve25519:AAAAAA": "<key>",
    "signed_curve25519:AAAAAB": { "key": "<key>", "signatures": {...} }
  },
  "fallback_keys": {
    "signed_curve25519:AAAABA": { "key": "<key>", "fallback": true, "signatures": {...} }
  }
}
```

Monitor `device_one_time_keys_count` in /sync to replenish. Target: ~half of max supported.

### 6.4 Querying Device Keys

```
POST /_matrix/client/v3/keys/query
Body: { "device_keys": { "@bob:server": [] } }   // empty array = all devices
Response: { "device_keys": { "@bob:server": { "BOBDEVICE": { ... } } } }
```

**Must verify:** Check Ed25519 signature on device keys. Check `user_id`/`device_id` match. If device was seen before, Ed25519 key MUST NOT have changed.

### 6.5 Claiming One-Time Keys (Starting Olm Session)

```
POST /_matrix/client/v3/keys/claim
Body: { "one_time_keys": { "@bob:server": { "BOBDEVICE": "signed_curve25519" } } }
Response: { "one_time_keys": { "@bob:server": { "BOBDEVICE": { "signed_curve25519:AAAAAB": {...} } } } }
```

Then create outbound Olm session using claimed key + Bob's identity key.

### 6.6 Enabling Room Encryption

Send state event:
```
PUT /_matrix/client/v3/rooms/{roomId}/state/m.room.encryption
Body: { "algorithm": "m.megolm.v1.aes-sha2", "rotation_period_ms": 604800000, "rotation_period_msgs": 100 }
```

**Once enabled, encryption can NEVER be disabled.** This prevents MITM downgrade attacks.

### 6.7 Sending Encrypted Messages

1. Check for active outbound Megolm session (create if needed, rotate if expired)
2. Build plaintext payload: `{ "type": "m.room.message", "content": {...}, "room_id": "!..." }`
3. Encrypt with `olm_group_encrypt`
4. Send:
```
PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.encrypted/{txnId}
Body: {
  "algorithm": "m.megolm.v1.aes-sha2",
  "sender_key": "<our_curve25519_key>",
  "ciphertext": "<encrypted>",
  "session_id": "<megolm_session_id>",
  "device_id": "<our_device_id>"
}
```

### 6.8 Megolm Session Lifecycle

**Create:** `olm_init_outbound_group_session` → get session_id and session_key
**Share:** Send `m.room_key` to-device events (Olm-encrypted) to every device in room
**Rotate:** When `rotation_period_ms` or `rotation_period_msgs` exceeded, create new session
**On member leave:** Invalidate current outbound session (new session for next message)
**On member join:** Share current session key with new member's devices (they can only decrypt forward)

### 6.9 Receiving Encrypted Events

For `m.megolm.v1.aes-sha2`: match `room_id` + `sender_key` + `session_id` to known Megolm session → `olm_group_decrypt`. Track `message_index` to prevent replay attacks.

For `m.olm.v1.curve25519-aes-sha2`: find own identity key in `ciphertext` object → try decrypting with known sessions → if type=0 (prekey) and no match, create inbound session → verify sender/recipient/keys in plaintext payload.

### 6.10 Device Tracking

Monitor `device_lists.changed` in /sync → re-query keys for those users → update local device list → invalidate Megolm sessions if device keys changed.

### 6.11 Cross-Signing

Users have three cross-signing key pairs (master, self-signing, user-signing). The master key is the root of trust. Self-signing key signs the user's own devices. User-signing key signs other users' master keys.

Upload via: `POST /_matrix/client/v3/keys/device_signing/upload`
Upload signatures: `POST /_matrix/client/v3/keys/signatures/upload`

### 6.12 Encrypted Attachments

In encrypted rooms, files must be encrypted client-side before upload:
1. Generate random 256-bit AES key + random IV
2. Encrypt file with AES-CTR
3. Upload encrypted blob to content repository → get `mxc://` URI
4. Send event with `file` property containing `{ "url": "mxc://...", "key": {...}, "iv": "...", "hashes": {"sha256": "..."} }` instead of plain `url`

---

## 7. Send-to-Device Messaging

Used for E2EE key exchange, call signaling, and other device-specific messages.

```
PUT /_matrix/client/v3/sendToDevice/{eventType}/{txnId}
Body: {
  "messages": {
    "@bob:server": {
      "BOBDEVICE1": { "algorithm": "m.megolm.v1.aes-sha2", "room_id": "!room", "session_id": "...", "session_key": "..." },
      "BOBDEVICE2": { ... }
    }
  }
}
```

Received via `/sync` → `to_device.events[]`. Common to-device event types:
- `m.room_key` — Megolm session key sharing
- `m.room_key_request` — requesting missing keys
- `m.forwarded_room_key` — forwarding keys
- `m.room.encrypted` — Olm-encrypted wrapper for above
- `m.key.verification.*` — device/user verification flow

---

## 8. VoIP / Call Signaling

Matrix handles call setup/teardown via room events. Media flows directly peer-to-peer (or through TURN). For Hush, this maps to LiveKit session negotiation.

### 8.1 Call Events

**`m.call.invite`** — initiates a call
```json
{ "type": "m.call.invite", "content": {
    "call_id": "<unique_call_id>",
    "party_id": "<unique_party_id>",
    "version": "1",
    "lifetime": 60000,
    "offer": { "type": "offer", "sdp": "<SDP string>" },
    "invitee": "@bob:server"
}}
```

**`m.call.answer`** — accepts
```json
{ "type": "m.call.answer", "content": {
    "call_id": "<call_id>", "party_id": "<party_id>", "version": "1",
    "answer": { "type": "answer", "sdp": "<SDP string>" }
}}
```

**`m.call.candidates`** — ICE candidates (batched)
```json
{ "type": "m.call.candidates", "content": {
    "call_id": "<call_id>", "party_id": "<party_id>", "version": "1",
    "candidates": [{ "candidate": "...", "sdpMLineIndex": 0, "sdpMid": "0" }]
}}
```

**`m.call.hangup`** — ends call
```json
{ "type": "m.call.hangup", "content": {
    "call_id": "<call_id>", "party_id": "<party_id>", "version": "1",
    "reason": "user_hangup"
}}
```

### 8.2 Call Flow Rules

- `call_id`: unique per call, generated by caller
- `party_id`: unique per device/participant in the call (for multi-device)
- **Glare:** if two users call each other simultaneously, the call from the user whose user ID is lexicographically smaller wins
- **Lifetime:** if no answer within `lifetime` ms, call expires
- Candidates should be batched (every 200ms or when ~10 accumulated)
- On room leave, all active calls in that room should be hung up
- TURN server credentials: `GET /_matrix/client/v3/voip/turnServer`

### 8.3 LiveKit Integration Note

For Hush, you likely won't use raw WebRTC SDP negotiation via Matrix call events. Instead, use Matrix rooms for:
- Session establishment (who is in the call, permissions)
- Custom state events to share LiveKit room tokens/URLs
- E2EE key exchange for encrypted screen sharing
- Presence/status of participants

Consider defining custom event types like `com.hush.livekit.session` for LiveKit-specific signaling.

---

## 9. Content Repository (Media)

### 9.1 Upload

```
POST /_matrix/media/v3/upload?filename=screenshot.png
Content-Type: image/png
Authorization: Bearer <token>
<binary data>

Response: { "content_uri": "mxc://example.com/AQwafuaFswefuhsfAFAgsw" }
```

For async upload (create URI first, upload later):
```
POST /_matrix/media/v1/create → { "content_uri": "mxc://...", "unused_expires_at": 1700000000000 }
PUT  /_matrix/media/v3/upload/{serverName}/{mediaId} → upload bytes to pre-created URI
```

### 9.2 Download

```
GET /_matrix/client/v1/media/download/{serverName}/{mediaId}
GET /_matrix/client/v1/media/download/{serverName}/{mediaId}/{fileName}
GET /_matrix/client/v1/media/thumbnail/{serverName}/{mediaId}?width=128&height=128&method=crop
```

Note: v1 media endpoints require auth (added in v1.11). Legacy v3 media endpoints are deprecated.

### 9.3 MXC URIs

Format: `mxc://<server_name>/<media_id>` — globally unique content identifier. Convert to HTTP download URL using the endpoints above.

---

## 10. Device Management

```
GET    /_matrix/client/v3/devices                → list all devices
GET    /_matrix/client/v3/devices/{deviceId}      → single device info
PUT    /_matrix/client/v3/devices/{deviceId}      → update display_name
DELETE /_matrix/client/v3/devices/{deviceId}      → delete device (requires UIA)
POST   /_matrix/client/v3/delete_devices          → bulk delete (requires UIA)
```

---

## 11. Common Patterns & Best Practices

### Error Handling
All errors return `{ "errcode": "M_...", "error": "human readable" }`. Key codes:
`M_FORBIDDEN`, `M_UNKNOWN_TOKEN`, `M_MISSING_TOKEN`, `M_NOT_FOUND`, `M_LIMIT_EXCEEDED`, `M_BAD_JSON`

Rate limiting: 429 response with `Retry-After` header.

### Transaction IDs
All PUT endpoints use `{txnId}` in path. Use UUID v4 or timestamp+counter. Scope: per device + per endpoint. Makes retries safe.

### Pagination
Room history: `GET /rooms/{roomId}/messages?from=<token>&dir=b&limit=50` — `dir=b` for backwards, `dir=f` for forwards. Response includes `start`, `end` tokens for continued pagination.

### Lazy Loading Members
Use filter with `"lazy_load_members": true` to only receive member events for users who sent events in the timeline window. Significantly reduces sync payload.

---

## 12. Recommended SDKs

| Language | SDK | Notes |
|----------|-----|-------|
| Rust | matrix-rust-sdk | Most complete, used by Element X. Has crypto built in. |
| JavaScript/TypeScript | matrix-js-sdk | Mature, used by Element Web. |
| Python | matrix-nio | Async, E2EE support. Good for bots and prototyping. |
| Kotlin | matrix-rust-sdk-kt | Kotlin bindings for rust SDK. |
| Swift | matrix-rust-sdk-swift | Swift bindings for rust SDK. |

For Hush (TypeScript/Electron): **matrix-js-sdk** is the natural fit. For Hush (Flutter): **matrix-dart-sdk (matrix)** is available on pub.dev.

**Crypto library:** vodozemac (Rust) is the recommended Olm/Megolm implementation. matrix-js-sdk uses it via wasm bindings.

---

## Quick Reference: Essential Endpoints

| Action | Method | Endpoint |
|--------|--------|----------|
| Discover homeserver | GET | `/.well-known/matrix/client` |
| Check versions | GET | `/_matrix/client/versions` |
| Register | POST | `/_matrix/client/v3/register` |
| Login | POST | `/_matrix/client/v3/login` |
| Logout | POST | `/_matrix/client/v3/logout` |
| Refresh token | POST | `/_matrix/client/v3/refresh` |
| Sync | GET | `/_matrix/client/v3/sync` |
| Create room | POST | `/_matrix/client/v3/createRoom` |
| Join room | POST | `/_matrix/client/v3/join/{roomIdOrAlias}` |
| Leave room | POST | `/_matrix/client/v3/rooms/{roomId}/leave` |
| Invite user | POST | `/_matrix/client/v3/rooms/{roomId}/invite` |
| Send message | PUT | `/_matrix/client/v3/rooms/{roomId}/send/{eventType}/{txnId}` |
| Send state event | PUT | `/_matrix/client/v3/rooms/{roomId}/state/{eventType}/{stateKey}` |
| Get room state | GET | `/_matrix/client/v3/rooms/{roomId}/state` |
| Room messages | GET | `/_matrix/client/v3/rooms/{roomId}/messages` |
| Upload keys | POST | `/_matrix/client/v3/keys/upload` |
| Query keys | POST | `/_matrix/client/v3/keys/query` |
| Claim OTK | POST | `/_matrix/client/v3/keys/claim` |
| Send to device | PUT | `/_matrix/client/v3/sendToDevice/{eventType}/{txnId}` |
| Upload media | POST | `/_matrix/media/v3/upload` |
| Download media | GET | `/_matrix/client/v1/media/download/{serverName}/{mediaId}` |
| TURN server | GET | `/_matrix/client/v3/voip/turnServer` |
| List devices | GET | `/_matrix/client/v3/devices` |
| Who am I | GET | `/_matrix/client/v3/account/whoami` |
