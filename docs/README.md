# Hush documentation

Index of project documentation. Root-level docs stay in the repo root; detailed and historical docs live under `docs/`. Start from [README.md](../README.md) for quick start and self-hosting.

---

## Reference

| Doc | Description |
|-----|-------------|
| [reference/MATRIX_REFERENCE.md](reference/MATRIX_REFERENCE.md) | Matrix protocol reference for Hush: Client-Server API, auth, sync, rooms, E2EE, to-device, media. Spec v1.17. |
| [room-lifecycle.md](room-lifecycle.md) | Room creation, leave flow, empty-room deletion, and limits: `MAX_GUEST_ROOMS`, `GUEST_ROOM_MAX_DURATION_MS`, `MAX_PARTICIPANTS_PER_ROOM`; `delete-if-empty` and expiry job; Synapse Admin API, [SYNAPSE_ADMIN_TOKEN setup](room-lifecycle.md#how-to-get-a-synapse-admin-token-self-hosting). |

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

## Root

| Doc | Description |
|-----|-------------|
| [README.md](../README.md) | Product overview, quick start, self-hosting, configuration, troubleshooting. |
| [SECURITY.md](../SECURITY.md) | E2EE algorithms, trust model, browser support, limitations. |

---

## Other

| Doc | Description |
|-----|-------------|
| [synapse/README.md](../synapse/README.md) | Synapse config, layout, generate-synapse-config.sh, troubleshooting. |
