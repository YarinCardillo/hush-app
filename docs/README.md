# Hush documentation

Index of project documentation. Root-level docs (e.g. [README.md](../README.md), [SECURITY.md](../SECURITY.md)) stay in the repo root; detailed and historical docs live here.

---

## Reference

| Doc | Description |
|-----|-------------|
| [reference/MATRIX_REFERENCE.md](reference/MATRIX_REFERENCE.md) | Matrix protocol reference for Hush: Client-Server API, auth, sync, rooms, E2EE, to-device, media. Spec v1.17. |

---

## Development and testing

| Doc | Description |
|-----|-------------|
| [TESTING.md](TESTING.md) | How to run and test Hush locally: Docker, env, Synapse, client dev server, manual checks. |
| [e2ee-test-checklist.md](e2ee-test-checklist.md) | Manual E2EE testing checklist: Matrix (Olm/Megolm) and LiveKit E2EE, DevTools inspection, troubleshooting. |

---

## Audits

| Doc | Description |
|-----|-------------|
| [audits/AUDIT_REPORT_A_B2.md](audits/AUDIT_REPORT_A_B2.md) | Audit report for Milestones A–B2: infrastructure, auth, chat, LiveKit, E2EE, verdict and findings. |
| [audits/AUDIT_A_B2_IMPLEMENTATION_SUMMARY.md](audits/AUDIT_A_B2_IMPLEMENTATION_SUMMARY.md) | Summary of changes addressing critical/high-priority audit findings. |
| [audits/E2EE_AUDIT_REPORT.md](audits/E2EE_AUDIT_REPORT.md) | E2EE-focused audit: chat, media, key distribution, architecture. |

---

## Elsewhere

- **Root:** [README.md](../README.md) (product, quick start, self-hosting), [SECURITY.md](../SECURITY.md) (E2EE, trust model, browser support).
- **Synapse:** [synapse/README.md](../synapse/README.md) (Synapse config and layout).
- **Scripts:** [scripts/checkpoint-B-test.md](../scripts/checkpoint-B-test.md) (Milestone B checkpoint test notes).
