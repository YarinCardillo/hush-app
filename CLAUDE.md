Leggi design-system.md prima di toccare la UI
## Hush Refactor
When working on the hush-app project, ALWAYS read ARCHITECTURE.md before modifying any file.
This is a refactor of an existing codebase — do not create files from scratch when the existing file should be modified.
Use every skill you think would help for the task, especially dispatching multiple agents.
## Signal Protocol & Cryptography
Before modifying any file in `hush-crypto/`, `client/src/lib/signalStore.js`, `client/src/lib/hushCrypto.js`, `client/src/hooks/useSignal.js`, `client/src/lib/uploadKeysAfterAuth.js`, `server/internal/api/keys.go`, or `server/internal/db/keys.go`, ALWAYS read `signal-theory-context.md` first. It contains condensed Signal Protocol theory (X3DH, Double Ratchet, PQXDH, Sesame, key lifecycle invariants) extracted from the full specs in `.signal-specs/`.
