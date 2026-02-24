# Signal Protocol Theory Context for Hush

Reference for reviewing and writing E2EE code in hush-crypto, signalStore, useSignal, and key management.
Condensed from the official Signal specs in `.signal-specs/`.

---

## 1. Cryptographic Primitives

### Curve25519 / X25519
- Montgomery curve used for ECDH key agreement.
- Public key = 32-byte u-coordinate.
- `DH(privA, pubB)` = X25519 function output = 32-byte shared secret.
- No need to check for invalid public keys (X25519 is safe by design).

### XEdDSA (XEd25519)
- EdDSA-compatible signatures using X25519 key pairs.
- Allows a single key pair for both DH and signing.
- `calculate_key_pair(k)`: converts Montgomery private key to twisted Edwards `(A, a)`. If sign bit `E.s == 1`, negate: `a = -k (mod q)`.
- **Randomized** signatures: requires fresh 64-byte random `Z` on every call. Nonce reuse leaks the private key: `a = (s1 - s2) / (h1 - h2)`.
- All signing operations must be constant-time.

### VXEdDSA
- Extension of XEdDSA that is a Verifiable Random Function (VRF).
- Used for signed pre-keys: produces a VRF output unique per (message, public key).
- Uses Elligator 2 to hash messages to curve points.

---

## 2. X3DH Key Agreement

### Purpose
Asynchronous authenticated key exchange. Alice establishes a shared secret with offline Bob using his published pre-key bundle.

### Key Types

| Key | Owner | Lifetime | Purpose |
|-|-|-|-|
| IK (Identity Key) | Both | Permanent | Long-term authentication |
| SPK (Signed Pre-Key) | Bob | Rotated weekly/monthly | Forward secrecy anchor |
| OPK (One-Time Pre-Key) | Bob | Single use, deleted after | Additional forward secrecy |
| EK (Ephemeral Key) | Alice | Single protocol run | Fresh randomness per session |

### Protocol Flow
1. **Bob publishes**: `IK_B`, `SPK_B`, `Sig(IK_B, Encode(SPK_B))`, set of `OPK_B`.
2. **Alice fetches bundle**, verifies signature, generates `EK_A`.
3. **DH calculations** (without OPK):
   ```
   DH1 = DH(IK_A, SPK_B)    -- mutual auth
   DH2 = DH(EK_A, IK_B)     -- mutual auth
   DH3 = DH(EK_A, SPK_B)    -- forward secrecy
   SK  = KDF(DH1 || DH2 || DH3)
   ```
   With OPK, add `DH4 = DH(EK_A, OPK_B)` for extra forward secrecy.
4. **Associated data**: `AD = Encode(IK_A) || Encode(IK_B)`.
5. **Alice sends initial message**: `IK_A`, `EK_A`, prekey IDs, AEAD ciphertext with `SK` and `AD`.
6. **Alice deletes**: ephemeral private key, all DH outputs.
7. **Bob receives**: recomputes DH/KDF, derives `SK`, decrypts. Deletes used OPK private key.

### KDF Construction
- HKDF with SHA-256 or SHA-512.
- Input key material = `0xFF * 32 || DH1 || DH2 || DH3 [|| DH4]`.
- Salt = zero-filled (hash output length).
- Info = application-specific string (e.g. `"HushProtocol"`).

### Critical Rules for Hush
- **Verify SPK signature** before proceeding. Abort on failure.
- **Delete ephemeral keys** immediately after computing SK.
- **Delete OPK private keys** after successful decryption (forward secrecy).
- **Rate-limit bundle fetches** to prevent OPK exhaustion attacks.
- Without OPK, replay is possible. Post-X3DH protocol (Double Ratchet) must immediately introduce fresh DH.
- Without OPK, SK compromise = all messages in that session. Rotate SPK frequently.

---

## 3. Double Ratchet Algorithm

### Purpose
After X3DH establishes `SK`, the Double Ratchet derives unique encryption keys for every message, providing forward secrecy and break-in recovery.

### Three Chains
- **Root chain**: mixed with DH outputs on each ratchet step. Provides break-in recovery.
- **Sending chain**: derives per-message encryption keys. Advances with each sent message.
- **Receiving chain**: mirrors sender's chain. Advances with each received message.

### State Variables
```
DHs   -- our ratchet key pair (sending)
DHr   -- their ratchet public key (received)
RK    -- 32-byte root key
CKs   -- 32-byte sending chain key
CKr   -- 32-byte receiving chain key
Ns    -- message number (sending)
Nr    -- message number (receiving)
PN    -- previous sending chain length
MKSKIPPED -- dict of skipped message keys: (ratchet_pub, msg_num) -> key
```

### Symmetric-Key Ratchet (per message)
```
CK_new, MK = KDF_CK(CK)
```
- Each message encrypted with unique `MK`.
- `MK` derived then deleted after use.
- Chain key replaced; old chain key deleted.

### DH Ratchet (on receiving new ratchet public key)
```
RK, CKr = KDF_RK(RK, DH(DHs, DHr_new))
DHs_new  = GENERATE_DH()
RK, CKs = KDF_RK(RK, DH(DHs_new, DHr_new))
```
- Ping-pong: parties alternate generating new ratchet key pairs.
- DH output mixed into root chain for break-in recovery.

### Initialization
- Alice (initiator):
  ```
  DHs = GENERATE_DH()
  DHr = bob_ratchet_public_key  (= SPK_B from X3DH)
  RK, CKs = KDF_RK(SK, DH(DHs, DHr))
  CKr = None
  ```
- Bob (responder):
  ```
  DHs = bob_ratchet_key_pair   (= SPK_B key pair)
  DHr = None
  RK = SK
  CKs = None, CKr = None
  ```

### Out-of-Order Messages
- Message header contains: ratchet public key, `PN` (prev chain length), `N` (msg number).
- Skipped message keys are stored in `MKSKIPPED` for later decryption.
- `MAX_SKIP` limits how many keys can be skipped (prevent DoS).
- Skipped keys should be deleted after a timeout or event count.

### Encrypt
```python
CKs, mk = KDF_CK(CKs)
header = HEADER(DHs, PN, Ns)
Ns += 1
return header, ENCRYPT(mk, plaintext, CONCAT(AD, header))
```

### Decrypt
```python
# 1. Check MKSKIPPED for this (header.dh, header.n)
# 2. If new ratchet key: skip keys in current chain, DH ratchet step
# 3. Skip keys to header.n, derive mk
# 4. DECRYPT(mk, ciphertext, CONCAT(AD, header))
# On auth failure: discard all state changes
```

### Recommended Algorithms
- `GENERATE_DH()`: X25519 key pair.
- `KDF_RK(rk, dh_out)`: HKDF with `rk` as salt, `dh_out` as IKM.
- `KDF_CK(ck)`: HMAC-SHA256 with `ck` as key. `0x01` -> message key, `0x02` -> next chain key.
- `ENCRYPT`: AES-256-CBC + HMAC-SHA256 (80 bytes from HKDF: 32 enc key + 32 auth key + 16 IV).

### Critical Rules for Hush
- **Never reuse a message key**. Derive, use, delete.
- **Always include AD** (identity keys) in AEAD.
- **On decryption failure, discard ALL state changes** (atomic rollback).
- **Securely delete** old chain keys, ratchet private keys, message keys.
- **Limit MKSKIPPED size** to prevent memory DoS.
- **Bob's SPK_B becomes his initial ratchet key pair** (bridges X3DH -> Double Ratchet).

---

## 4. PQXDH (Post-Quantum Extended X3DH)

### Differences from X3DH
- Adds a post-quantum KEM (ML-KEM / Kyber) to the handshake.
- Bob publishes additional keys: `PQSPK_B` (signed last-resort KEM key), `PQOPK_B` (one-time KEM keys).
- Alice encapsulates a shared secret: `(CT, SS) = PQKEM-ENC(PQPK_B)`.
- SK derivation includes KEM output: `SK = KDF(DH1 || DH2 || DH3 [|| DH4] || SS)`.

### Key Hierarchy

| Key | Type | Purpose |
|-|-|-|
| IK_A, IK_B | EC (X25519) | Identity, mutual auth |
| SPK_B | EC | Signed pre-key (rotated) |
| OPK_B | EC | One-time (optional, single use) |
| EK_A | EC | Ephemeral (per protocol run) |
| PQSPK_B | ML-KEM | Last-resort PQ pre-key (rotated) |
| PQOPK_B | ML-KEM | One-time PQ pre-key (single use) |

### Security Properties
- **Passive quantum adversary**: cannot derive SK even with quantum computer (forward secrecy from KEM).
- **Active quantum adversary**: NOT protected. EC-based auth is not quantum-safe. PQ deniable mutual auth is an open problem.
- Auth remains classical (XEdDSA on identity keys).

### Relevance to Hush
- Current Hush uses X3DH only. PQXDH is the upgrade path.
- Server key bundle schema would need: `pq_signed_prekey`, `pq_one_time_prekeys`, PQ signatures.
- Client signalStore would need to persist PQ key material.

---

## 5. Sesame (Session Management)

### Purpose
Manages multiple Double Ratchet sessions across multiple devices per user, handling async delivery, device changes, and session convergence.

### Core Concepts
- **UserRecord**: per-correspondent, contains DeviceRecords.
- **DeviceRecord**: per-device, contains one **active session** + ordered list of **inactive sessions**.
- **Active session convergence**: when a message arrives on an inactive session, that session becomes active. Both parties converge on matching sessions.

### Multi-Device Sending
For each recipient user:
1. Encrypt with active session for each of recipient's devices.
2. Also encrypt to sender's own other devices (so they get a copy).
3. Server validates device list is current; rejects if stale.
4. On rejection: mark old devices stale, create sessions for new devices, retry.

### Multi-Device Receiving
1. If initiation message + no matching session: extract identity key, create new session, make it active.
2. Try all sessions in DeviceRecord (active first, then inactive).
3. On success with inactive session: activate it.
4. On any error: discard all state changes, discard message.

### Relevance to Hush
- Hush uses `deviceId` in key bundles and session management.
- `signalStore.js` stores sessions by `(userId, deviceId)`.
- Current model: one device per user (DEFAULT_DEVICE_ID). Multi-device is a future concern.
- Session expiration (`MAXSEND`, `MAXRECV`) not yet implemented.

---

## 6. Post-Quantum Extensions (Future Reference)

### Sparse Post-Quantum Ratchet (SPQR)
- Replaces DH ratchet with SCKA (Sparse Continuous Key Agreement) protocol.
- New KDF chains created per-epoch (not per-message-exchange).
- Multiple chains can coexist: old epoch chains kept until sealed.
- `ClearOldEpochs()` deletes chains 2+ epochs behind.

### Triple Ratchet
- Runs EC Double Ratchet + SPQR in parallel.
- Each encrypt: get `ec_mk` from Double Ratchet + `pq_mk` from SPQR.
- Combined: `mk = KDF_HYBRID(ec_mk, pq_mk)`.
- Hybrid security: attacker must break BOTH EC and PQ assumptions.

### ML-KEM Braid Protocol
- SCKA protocol using ML-KEM's incremental interface.
- Splits KEM operations across multiple messages for bandwidth efficiency.
- Key exchange in chunks with erasure codes for robustness.
- Epoch-based: new shared secret emitted every ~2 round trips.

### Relevance to Hush
- Not implemented yet. Future upgrade path for post-quantum messaging.
- Would require: new WASM bindings for ML-KEM, epoch tracking in signalStore, modified message headers.

---

## 7. Security Invariants (Checklist for Code Review)

### Key Lifecycle
- [ ] Identity keys generated once, stored encrypted, never re-generated.
- [ ] Signed pre-keys rotated on schedule, old private keys deleted after grace period.
- [ ] One-time pre-keys deleted server-side after serving, client-side after use.
- [ ] Ephemeral keys deleted immediately after DH computation.
- [ ] Ratchet private keys deleted after DH ratchet step completes.
- [ ] Message keys deleted after encrypt/decrypt.

### Protocol Correctness
- [ ] SPK signature verified before X3DH proceeds.
- [ ] AD = `Encode(IK_A) || Encode(IK_B)` used in all AEAD operations.
- [ ] DH outputs fed through KDF, never used directly as encryption keys.
- [ ] Double Ratchet state changes are atomic: rollback on any failure.
- [ ] `MAX_SKIP` enforced to prevent DoS via skipped message keys.
- [ ] Message numbers (`N`, `PN`) included in headers for out-of-order handling.

### Server Trust Model
- Server never sees plaintext (opaque ciphertext only).
- Server cannot forge sessions (signature verification prevents this).
- Server can withhold OPKs (degrades forward secrecy to SPK lifetime).
- Rate-limit bundle fetches to prevent OPK exhaustion.
- Server can cause communication failure (accept as part of threat model).

### IndexedDB / Client Storage
- Private keys in IndexedDB are at risk from XSS.
- Session state contains chain keys (high value target).
- Consider: Web Crypto API non-extractable keys where possible.
- At minimum: document plaintext key storage as a known threat model limitation.

### Nonce / Randomness
- XEdDSA requires 64 bytes of fresh randomness per signature.
- Ephemeral keys must come from CSPRNG.
- Never reuse nonces in AEAD encryption.

---

## 8. Hush Implementation Notes

### Wire Format (Double Ratchet Payload)

Self-describing format produced by `hush-crypto/src/session.rs`:
```
[4 bytes: header_len LE][header_len bytes: encrypted header][remaining: ciphertext]
```
The encrypted header is AES-256-GCM (12-byte nonce + 40-byte plaintext + 16-byte tag = 68 bytes typically, but the length prefix makes this future-proof).

### PreKeySignalMessage Envelope (JS Layer)

Handled in `client/src/hooks/useSignal.js`. The server treats ciphertext as opaque bytes.

**Initial (PreKey) message** — first message in a new session:
```
[0x01][33: sender IK_A][33: sender EK_A][4: SPK ID (LE)][4: OPK ID (LE) or 0xFFFFFFFF if none][DR payload]
```
Total header: 75 bytes before the Double Ratchet payload.

**Subsequent (Regular) message** — established session:
```
[0x02][DR payload]
```

### Associated Data (AD) Construction

```
AD = Encode(IK_A) || Encode(IK_B)
```
- `Encode(IK)` = 33-byte compressed public key (0x05 prefix + 32-byte X25519 key).
- AD is 66 bytes total, computed once at session establishment and stored alongside session state.
- AD is passed to every Double Ratchet encrypt/decrypt call.

### Private Key Persistence

Client stores private keys in IndexedDB (`signalStore.js`, DB version 2):

| Store | Key | Contents |
|-|-|-|
| `identity` | `identity` | `{ publicKey, privateKey }` — identity key pair |
| `signedPreKeys` | SPK ID | `{ id, publicKey, privateKey, signature }` — needed for X3DH responder |
| `otpPrivateKeys` | OPK key ID | `{ keyId, publicKey, privateKey }` — consumed and deleted after first use |
| `sessions` | `userId:deviceId` | `{ state, ad }` — Double Ratchet state + associated data |

SPK and OPK private keys are required for the X3DH responder flow (receiving initial messages). Only public keys are uploaded to the server.

### X3DH Responder Flow

When Bob receives a PreKey message (type `0x01`):
1. Parse envelope: extract Alice's IK, EK, SPK ID, OPK ID.
2. Load Bob's SPK private key from `signedPreKeys` store.
3. If OPK ID != `0xFFFFFFFF`, load OPK private key from `otpPrivateKeys` store.
4. Call `performX3DHResponder(bobIkPrivate, spkPrivate, spkPublic, opkPrivate, aliceIk, aliceEk)`.
5. Compute AD = `Encode(aliceIk) || Encode(bobIk)`.
6. Decrypt the DR payload with the new session state and AD.
7. Store session state + AD. Delete consumed OPK.

### SPK Rotation and OPK Replenishment (TODO)

Infrastructure is in place but not yet automated:
- SPK rotation: generate new SPK periodically, upload to server, keep old SPK for a grace period.
- OPK replenishment: server sends `keys.low` WebSocket event when remaining unused OPKs < 10. Client should auto-generate and upload a new batch of 100.
