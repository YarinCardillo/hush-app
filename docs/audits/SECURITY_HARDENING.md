# Security hardening audit (pre-production)

Date: 2026-02-21  
Scope: Pre-production security audit; SafeToShip findings + internal hardening.

---

## Summary

Audit performed to address third-party scan results (SafeToShip, target gethush.live) and to establish baseline hardening for headers, CORS, input validation, secrets, and documentation.

---

## Findings and status

### SafeToShip (external scan)

| Finding | Status | Action |
|-|-|-|
| Missing MIME protection (`X-Content-Type-Options: nosniff`) | Resolved | Set in Caddy (Caddyfile and Caddyfile.prod). |
| Missing SPF record | Documented | Not in repo; added to Production checklist in SECURITY.md (DNS TXT record at provider). |
| Missing HSTS | Resolved | Caddyfile.prod adds `Strict-Transport-Security` for HTTPS; localhost Caddyfile has no HSTS. |
| Clickjacking risk (`X-Frame-Options`) | Resolved | `X-Frame-Options: DENY` set in Caddy. |
| Weak CORS policy (`Access-Control-Allow-Origin: *`) | Resolved | Caddy and Express use `CORS_ORIGIN` env; production must set exact origin; documented in .env.example and SECURITY.md. |

### Internal (E2EE / headers)

| Item | Status | Action |
|-|-|-|
| COOP/COEP for LiveKit E2EE (SharedArrayBuffer) | Already present | Confirmed in Caddyfile; Caddyfile.prod includes same headers. |

### Input validation

| Area | Status | Action |
|-|-|-|
| `roomName`, `participantName` (LiveKit token API) | Resolved | Validation added in server; limits and pattern documented in SECURITY.md. |
| `roomId`, `roomName`, `createdAt` (rooms/created) | Resolved | Validation and limits documented and enforced in server. |

### Secrets and dependencies

| Area | Status | Action |
|-|-|-|
| Env defaults (CORS_ORIGIN, JWT_SECRET) | Documented | Production checklist and .env.example state no weak defaults in production. |
| npm audit / cargo audit | Documented | Policy and commands documented in SECURITY.md; run before production. |

### Rate limiting and CSP

| Area | Status | Action |
|-|-|-|
| Rate limiting (token, rooms, can-create) | Documented | Recommended before production; described in SECURITY.md. |
| Content-Security-Policy | Documented | Optional next step; report-only then enforce; documented in SECURITY.md. |

---

## References

- SafeToShip report: https://safetoship.app/scan/1deba9af-f60d-4574-ae9d-dc9f11a63b7d
- [SECURITY.md](../../SECURITY.md) — HTTP headers, CORS, production checklist, validation rules, rate limiting, CSP
- [E2EE_AUDIT_REPORT.md](E2EE_AUDIT_REPORT.md) — E2EE-specific audit
