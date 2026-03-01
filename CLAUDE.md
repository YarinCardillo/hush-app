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

## PLAN.md — Development Roadmap

`PLAN.md` is the source of truth for what has been built and what comes next. It is gitignored (local-only).

**When completing a phase or sub-step:**
- Mark it `✅ DONE` in the section header
- Update the checkpoint note with a one-line summary of what was actually shipped
- If extra work was done beyond the original spec, add a note (e.g. E.9 for UX polish)

**When starting a new phase:**
- Update `## 🎯 Current Focus` at the top to reflect the new active step
- List the next 2–3 steps so the plan is always forward-looking

**When adding new phases or sub-steps:**
- Add them in the correct letter/number slot; if they are critical bug fixes, note them as 🔴
- Keep B.5, B.6, etc. format for additions to existing phases; use new letters for standalone phases
- Always update `## 🎯 Current Focus` after adding

**Never skip this.** An outdated PLAN.md causes agents to re-do completed work or miss critical context.

## Signal Protocol & Cryptography
Before modifying any file in `hush-crypto/`, `client/src/lib/signalStore.js`, `client/src/lib/hushCrypto.js`, `client/src/hooks/useSignal.js`, `client/src/lib/uploadKeysAfterAuth.js`, `server/internal/api/keys.go`, or `server/internal/db/keys.go`, ALWAYS read `signal-theory-context.md` first. It contains condensed Signal Protocol theory (X3DH, Double Ratchet, PQXDH, Sesame, key lifecycle invariants) extracted from the full specs in `.signal-specs/`.
