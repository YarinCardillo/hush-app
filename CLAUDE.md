Leggi design-system.md prima di toccare la UI
## Hush Refactor
When working on the hush-app project, ALWAYS read ARCHITECTURE.md before modifying any file.
This is a refactor of an existing codebase — do not create files from scratch when the existing file should be modified.
Use every skill you think would help for the task, especially dispatching multiple agents.

## Branching Strategy (MANDATORY)
**This is not optional. Every agent must follow this before writing any code.**

The refactor lives on `core-rewrite`. Each phase gets its own sub-branch:
1. Create `core-rewrite/phase-X-description` from `core-rewrite`
2. Do all work on the sub-branch
3. Merge back into `core-rewrite` when the phase is complete and reviewed
4. `main` stays untouched until the refactor ships

**Before your first commit, verify:**
- You are NOT on `core-rewrite` directly (unless merging a completed phase)
- Your branch name matches `core-rewrite/phase-*`
- If the branch doesn't exist yet, create it from `core-rewrite`

Committing directly to `core-rewrite` or `main` is forbidden.

## Signal Protocol & Cryptography
Before modifying any file in `hush-crypto/`, `client/src/lib/signalStore.js`, `client/src/lib/hushCrypto.js`, `client/src/hooks/useSignal.js`, `client/src/lib/uploadKeysAfterAuth.js`, `server/internal/api/keys.go`, or `server/internal/db/keys.go`, ALWAYS read `signal-theory-context.md` first. It contains condensed Signal Protocol theory (X3DH, Double Ratchet, PQXDH, Sesame, key lifecycle invariants) extracted from the full specs in `.signal-specs/`.
