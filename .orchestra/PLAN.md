# Orchestra Plan — Hush E2EE Fix (Cinny-Inspired)

This plan fixes the broken E2EE implementation by adopting patterns from Cinny's working codebase.

**Reference:** Cinny source at `/Users/yarin/development/hush-v2`

---

## Current Problems

| Issue | File | Problem |
|-------|------|---------|
| No state persistence | `matrixClient.js` | Missing IndexedDBStore |
| No crypto persistence | `matrixClient.js` | Missing IndexedDBCryptoStore |
| No secret storage | `matrixClient.js` | Missing cryptoCallbacks |
| Crypto init order | `useMatrixAuth.js` | initRustCrypto() without store setup |

---

## Reference: Cinny's Working Pattern

```javascript
// From /Users/yarin/development/hush-v2/src/client/initMatrix.ts

import { IndexedDBStore, IndexedDBCryptoStore, createClient } from 'matrix-js-sdk';

const indexedDBStore = new IndexedDBStore({
  indexedDB: global.indexedDB,
  localStorage: global.localStorage,
  dbName: 'web-sync-store',
});

const legacyCryptoStore = new IndexedDBCryptoStore(
  global.indexedDB,
  'crypto-store'
);

const mx = createClient({
  baseUrl: session.baseUrl,
  accessToken: session.accessToken,
  userId: session.userId,
  store: indexedDBStore,
  cryptoStore: legacyCryptoStore,
  deviceId: session.deviceId,
  timelineSupport: true,
  cryptoCallbacks: cryptoCallbacks,
  verificationMethods: ['m.sas.v1'],
});

await indexedDBStore.startup();
await mx.initRustCrypto();
```

---

## Milestone: Matrix E2EE Fix

### Phase 1: IndexedDB Stores

| Task ID | Title | Status | Files |
|---------|-------|--------|-------|
| 1.1 | Add IndexedDBStore for state sync | pending | `client/src/lib/matrixClient.js` |
| 1.2 | Add IndexedDBCryptoStore for crypto | pending | `client/src/lib/matrixClient.js` |
| 1.3 | Await indexedDBStore.startup() before crypto init | pending | `client/src/lib/matrixClient.js` |

**Task 1.1 Details:**
- Import `IndexedDBStore` from `matrix-js-sdk`
- Create store with `dbName: 'hush-sync-store'`
- Pass to createClient as `store` option

**Task 1.2 Details:**
- Import `IndexedDBCryptoStore` from `matrix-js-sdk`
- Create store with database name `'hush-crypto-store'`
- Pass to createClient as `cryptoStore` option

**Task 1.3 Details:**
- Call `await indexedDBStore.startup()` BEFORE `initRustCrypto()`
- This ensures IndexedDB is ready before crypto operations

---

### Phase 2: Crypto Callbacks

| Task ID | Title | Status | Files |
|---------|-------|--------|-------|
| 2.1 | Create secretStorageKeys module | pending | `client/src/lib/secretStorageKeys.js` |
| 2.2 | Add cryptoCallbacks to createClient | pending | `client/src/lib/matrixClient.js` |

**Task 2.1 Details:**
Reference: `/Users/yarin/development/hush-v2/src/client/secretStorageKeys.js`

Create module that provides:
```javascript
export const cryptoCallbacks = {
  getSecretStorageKey,
  cacheSecretStorageKey,
};
```

In-memory Map for secret storage keys, keyed by keyId.

**Task 2.2 Details:**
- Import cryptoCallbacks from secretStorageKeys.js
- Add to createClient options: `cryptoCallbacks: cryptoCallbacks`

---

### Phase 3: Auth Flow Update

| Task ID | Title | Status | Files |
|---------|-------|--------|-------|
| 3.1 | Update createMatrixClient to accept/create stores | pending | `client/src/lib/matrixClient.js` |
| 3.2 | Update loginAsGuest to use new store pattern | pending | `client/src/hooks/useMatrixAuth.js` |
| 3.3 | Update login to use new store pattern | pending | `client/src/hooks/useMatrixAuth.js` |
| 3.4 | Update register to use new store pattern | pending | `client/src/hooks/useMatrixAuth.js` |

**Task 3.1 Details:**
Refactor createMatrixClient to:
1. Create IndexedDBStore (or reuse existing)
2. Create IndexedDBCryptoStore (or reuse existing)
3. Return { client, indexedDBStore } for proper lifecycle

**Task 3.2-3.4 Details:**
Update auth flows to:
1. Get/create stores from createMatrixClient
2. Await `indexedDBStore.startup()` after creating authenticated client
3. Call `initRustCrypto()` AFTER store startup
4. Then call `startClient()`

Order: createClient → startup() → initRustCrypto() → startClient()

---

### Phase 4: Verification

| Task ID | Title | Status | Files |
|---------|-------|--------|-------|
| 4.1 | Test guest registration with crypto | pending | manual |
| 4.2 | Test encrypted room creation | pending | manual |
| 4.3 | Test message encryption/decryption | pending | manual |
| 4.4 | Test crypto persistence across refresh | pending | manual |

**Verification Checklist:**
- [ ] IndexedDB databases created: `hush-sync-store`, `hush-crypto-store`
- [ ] No crypto initialization errors in console
- [ ] `/keys/upload` request in Network tab after auth
- [ ] Room created with `m.room.encryption` state event
- [ ] Messages sent as `m.room.encrypted` (check Network tab)
- [ ] Messages decrypt on receiving client
- [ ] After page refresh: crypto state persists (no re-upload of device keys)

---

## LiveKit E2EE Status

**Current implementation is CORRECT.** Do NOT modify unless tests fail.

The LiveKit E2EE in `useRoom.js` follows the correct pattern:
1. ExternalE2EEKeyProvider created BEFORE Room
2. Worker created with Vite import syntax
3. Key set on provider BEFORE Room.connect()
4. Room created with `e2ee: { keyProvider, worker }`
5. Key distribution via Matrix to-device messages

---

## Progress Tracking

- [ ] Phase 1: IndexedDB Stores
- [ ] Phase 2: Crypto Callbacks
- [ ] Phase 3: Auth Flow Update
- [ ] Phase 4: Verification

---

## Notes for Architect

### Critical Files to Read

Before modifying, READ these Cinny files:
1. `/Users/yarin/development/hush-v2/src/client/initMatrix.ts` - Client initialization
2. `/Users/yarin/development/hush-v2/src/client/secretStorageKeys.js` - Crypto callbacks
3. `/Users/yarin/development/hush-v2/src/app/pages/client/ClientRoot.tsx` - Startup flow

### Import Statements

Cinny (TypeScript):
```typescript
import { IndexedDBStore, IndexedDBCryptoStore, createClient } from 'matrix-js-sdk';
```

Hush (JavaScript):
```javascript
import { IndexedDBStore, IndexedDBCryptoStore, createClient } from 'matrix-js-sdk';
```

### Database Names

Use unique names to avoid conflicts:
- State store: `'hush-sync-store'`
- Crypto store: `'hush-crypto-store'`

### Error Handling

Cinny pattern for graceful degradation:
```javascript
const crypto = mx.getCrypto();
if (!crypto) {
  console.warn('Crypto module not available');
  return;
}
```

### Commit Guidelines

Commit after completing each phase:
```
fix: add IndexedDB stores for Matrix crypto persistence
fix: add cryptoCallbacks for secret storage
fix: update auth flows with correct crypto initialization order
```

Co-Author: `Co-Authored-By: Claude <noreply@anthropic.com>`

---

## Dependencies

Current matrix-js-sdk version should support all required APIs:
- `IndexedDBStore`
- `IndexedDBCryptoStore`
- `initRustCrypto()`
- `cryptoCallbacks`

Check `client/package.json` for version. Cinny uses v38.2.0.
