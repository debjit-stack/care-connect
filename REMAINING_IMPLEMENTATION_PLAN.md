# CareConnect — Remaining Implementation Plan

**Status:** Draft for review — no implementation started
**Based on:** `IMPLEMENTATION_STATUS.md`, `AUTH_FLOW.md`, `MIGRATIONS.md`, and direct codebase inspection
**Workflow reminder:** Each phase below is scoped for a separate analyze → approve → implement cycle. Nothing here should be built until you sign off on the specific phase.

---

## How this plan is organized

- **Part A — Close out the documented backlog.** Everything already listed as "planned" in `IMPLEMENTATION_STATUS.md`, broken into buildable phases with concrete tasks, file-level touch points, and sequencing rationale.
- **Part B — Advancement opportunities.** Things not in the current backlog at all, but that genuinely strengthen the product given what's already built (multi-tenant SaaS + healthcare + MFA). Flagged as optional, with a rough value/effort read on each so you can pick and choose.

Each item includes a rough size (S / M / L) and its main dependencies, so we can sequence sensibly rather than jumping around.

---

# PART A — Closing the documented backlog

## Phase A1 — MFA UX polish (finishes Phase 2.1, currently ~90%)

**Size:** S · **Depends on:** nothing, purely frontend

| Task | Where | Notes |
|---|---|---|
| Strip `mfaPending`/`required` query params from the URL after successful MFA completion | `MFASetupPage.jsx`, `LoginPage.jsx`, `SuperAdminLoginPage.jsx` | Use `navigate(..., { replace: true })` (already used elsewhere) plus `window.history.replaceState` to scrub the query string itself, not just the route — currently the token sits in the URL bar/history even after redirect. |
| Prevent back-navigation into a completed auth flow | `ProtectedRoute.jsx`, `MFASetupPage.jsx` | Add a `history.replaceState` on successful login before navigating, so pressing "back" from the dashboard can't return to a stale MFA/OTP screen holding an already-consumed pending token. |
| Redirect transition polish | `LoginPage.jsx`, `MFASetupPage.jsx` | Small CSS/animation layer — low priority, cosmetic only. |
| Cross-browser QR rendering verification | `MFASetupPage.jsx` | Manual QA pass (Safari/Firefox/mobile), not code — flag as a test task, not dev task. |

**Why first:** small, self-contained, no schema/backend changes, closes out a phase that's already 90% done.

---

## Phase A2 — Sensitive-action MFA re-verification

**Size:** M · **Depends on:** none, but touches auth middleware shared by several controllers

This is the highest-value item in Phase 3 from a security standpoint — right now, once a session has a valid access token, disabling MFA, changing password/email, or org-level security settings require no fresh proof of identity beyond the JWT itself.

**Plan:**
1. Add a new short-lived **step-up token** pattern, mirroring the existing `mfaPending`/`resetPending` token design in `tokens.js` (distinct secret, ~5 min expiry, single-purpose).
2. New endpoint: `POST /api/auth/step-up/verify` — accepts either a TOTP code or current password (reuse `verifyToken`/`matchPassword`), returns a `stepUpToken`.
3. New middleware `requireStepUp` (mirrors `requireMfaPending` pattern) — checks for `X-Step-Up-Token` header, verifies it, and requires the token's `sub` to match `req.user._id`.
4. Apply `requireStepUp` to:
   - `PUT /api/auth/change-password`
   - `POST /api/auth/mfa/disable`
   - `PUT /api/admin/security` (org-wide MFA policy toggle)
   - `PUT /api/organisations/:id` when `features`/`settings.smtp` fields are being changed (super_admin / org-admin actions on sensitive org config)
5. Frontend: a reusable `<StepUpModal>` (password or TOTP input) triggered before dispatching one of the above requests, caching the resulting token in memory for the 5-minute window so the user isn't re-prompted on every click within that window.

**Order matters here:** build the token/middleware plumbing first (backend-only, testable via curl/Postman), then wire up each protected endpoint, then build the frontend modal last.

---

## Phase A3 — Session & device management

**Size:** M–L · **Depends on:** Redis refresh-token storage (already exists, needs restructuring)

Currently `revokeAllRefreshTokens` scans `refresh:{userId}:*` — the data is already there, it's just not surfaced.

**Plan:**
1. Store minimal session metadata alongside each refresh token in Redis: `{ createdAt, userAgent, ip, lastSeenAt }`, set at `generateRefreshToken` time. Update `lastSeenAt` on each successful `/auth/refresh` call.
2. New endpoint `GET /api/auth/sessions` — lists the calling user's active sessions (device/browser summary parsed from `userAgent`, IP, last-active time, "this device" flag).
3. New endpoint `DELETE /api/auth/sessions/:jti` — revokes one session by its refresh-token `jti`, without logging out every device (`logout-all` already does the blunt version).
4. Frontend: a "Security" or "Active Sessions" panel under patient/staff profile settings, listing sessions with a revoke button.
5. Basic login-history table: reuse existing `AuditLog` entries (`AUTH_LOGIN_SUCCESS`/`FAILED`) filtered by `actorId`, paginated — no new collection needed, just a new read endpoint (`GET /api/auth/login-history`) and a UI list.

**Sequencing note:** login history is nearly free (data already exists in `AuditLog`) — could be pulled out as a quick win (A3a) separate from the heavier per-session revocation work (A3b) if you want a faster partial win.

---

## Phase A4 — Trusted devices ("remember this browser")

**Size:** M · **Depends on:** Phase A2 (step-up) conceptually, not technically blocking

**Plan:**
1. On successful MFA verification, if user checks "trust this device for 30 days," issue a signed, httpOnly `device_trust` cookie (new JWT secret, 30-day expiry, payload `{ userId, deviceId }`), and store `deviceId → { userId, createdAt, expiresAt, userAgent }` in Redis for revocation lookups.
2. In `authenticateAndRespond`'s MFA branch, check for a valid `device_trust` cookie matching the user before issuing an MFA challenge — skip straight to `issueLoginResponse` if present and valid.
3. Add a "Trusted Devices" section to the same Security panel as Phase A3, listing trusted devices with individual revoke.
4. Security email notification when a new device is trusted (template already exists in `mailer.js`'s pattern — just add `deviceTrusted` template).

**Caution:** this is the one item in Part A most worth discussing before building — trusted-device bypass is a real convenience/security tradeoff for a healthcare app, and your org's compliance posture (HIPAA-adjacent, per the "healthcare SaaS" framing) may prefer to skip this or gate it behind an org-level feature flag (`features.trustedDevicesAllowed`, defaulting `false`) rather than ship it universally on.

---

## Phase A5 — Configurable/admin-adjustable account lockout

**Size:** S · **Depends on:** none

Currently hardcoded: `MAX_LOGIN_ATTEMPTS = 5`, `LOCK_DURATION_MS = 15 * 60 * 1000` in `User.js`; OTP lockout similarly fixed in `totp.js`.

**Plan:**
1. Add `security.loginLockoutThreshold` and `security.loginLockoutDurationMinutes` to `Organisation.features` (or a new `security` sub-object) with sane defaults matching current behavior.
2. Thread the org's values through `recordFailedLogin`/`isLocked` (currently instance methods with hardcoded constants — need to accept the org's config or read it from a resolved-at-call-time context).
3. Admin-triggered lockout-counter reset independent of a full MFA reset: new endpoint `POST /api/admin/users/:id/unlock` — clears `loginAttempts`/`lockUntil` without touching `mfaEnabled`/`recoveryCodes` (currently only a full MFA reset exists via `resetUserMfa`, which is a bigger hammer than "this user is just locked out").
4. Surface both in `SecurityPanel.jsx`.

---

## Phase A6 — Remaining security notifications

**Size:** S · **Depends on:** Phases A3/A4 (data sources)

From the doc's own checklist:
- [ ] Recovery code regeneration notification — trivial, `regenerateCodes` controller already exists, just add a `sendMail` call (mirrors the pattern already used in `resetUserMfa`).
- [ ] Trusted device notification — covered under A4.
- [ ] Suspicious login notification — needs a definition of "suspicious" first (new IP + new user-agent combination not seen in the last N logins, e.g.). Reuse `AuditLog` history for the comparison; fire on `AUTH_LOGIN_SUCCESS` if no prior successful login matches IP or UA for that user in the last 90 days.

---

## Phase A7 — Automated testing (the big one)

**Size:** L · **Depends on:** ideally after A1–A6 land, so tests aren't immediately invalidated by in-flight security work

This is the largest gap relative to project maturity — 95% feature-complete with ~10% test coverage is the actual risk area, more than any missing feature.

**Recommended sequencing (unit → integration → E2E, in that order, each phase gated on the last):**

**A7.1 — Unit tests (S–M, backend)**
- `utils/tokens.js` — token generation/verification round-trips, expiry behavior, tamper rejection
- `utils/totp.js` — TOTP verify, recovery code hash/verify, OTP lockout counter logic
- `utils/resolveOrg.js` — all four discriminated result branches
- `plugins/tenantPlugin.js` — the `pre` hooks' filtering behavior (mockable via an in-memory Mongoose model)
- `validators/*.js` — Zod schema edge cases per validator file
- Suggested tooling: Vitest or Jest, since the project has no test runner configured yet — Vitest is a lighter add given Vite is already the frontend build tool, but for a `type: module` Express backend either works fine.

**A7.2 — Integration tests (M, backend)**
- Auth flow: register → login → refresh → logout, against a real (test-container or `mongodb-memory-server`) Mongo + a real/mocked Redis
- MFA flow: setup → verify-setup → login-with-MFA → recover-with-code
- Tenant isolation: create two orgs, same-email users in each, assert queries never cross-leak (this is the single highest-value integration test given how much of the codebase's audit trail is about exactly this)
- Booking flow: race-condition test for the unique appointment-slot index (concurrent booking attempts on the same slot)

**A7.3 — E2E (Playwright) (L, full-stack)**
- Cover the checklist's own list: patient/doctor/receptionist/admin/super-admin login, hospital onboarding, MFA setup/login/recovery, logout, session restoration
- Run against a seeded test database in CI, not production

**A7.4 — Formal security/pen-test pass**
- JWT tampering, cookie attacks, CSRF, XSS, IDOR, privilege escalation, injection, multi-tenant isolation — largely a checklist/manual exercise once A7.1–A7.3 exist as a safety net, not something to automate from scratch. Recommend after the above, using the existing checklist in `IMPLEMENTATION_STATUS.md` as the test plan itself.

---

## Phase A8 — Production readiness

**Size:** M · **Depends on:** nothing functionally, but best done once A7.1/A7.2 exist so CI has something to run

| Task | Notes |
|---|---|
| Dockerfile (server + client) | Multi-stage builds; server needs Node 18+ per `package.json` engines fields observed in dependencies. |
| docker-compose.yml | App + MongoDB + Redis for local/staging parity. |
| CI/CD pipeline | GitHub Actions: lint → unit tests → integration tests → build → (deploy to Render/Netlify on main). |
| Structured logging | Replace scattered `console.log`/`console.error` with a real logger (pino or winston) — needed before "monitoring" means anything. Correlate with request IDs for traceability across the multi-tenant middleware chain. |
| Health check depth | `/health` currently returns a static `{status: 'ok'}` — extend to check Mongo and Redis connectivity, return 503 if either is down (important for a Render deployment behind a load balancer / health-checked restart policy). |
| Backup strategy + DR doc | MongoDB Atlas automated backups (config, not code) + a short runbook doc for restore procedure and RTO/RPO expectations. |
| Performance/load testing | k6 or Artillery script against the booking endpoint (the most contention-prone path, given the unique-slot index) and the dashboard aggregation endpoints (heaviest Mongo aggregations in the app). |

---

# PART B — Advancement opportunities (not in current backlog)

These aren't gaps against your own documented plan — they're things worth considering given what CareConnect has become (multi-tenant healthcare SaaS with a mature auth layer). Flagged with a rough value/effort read; none of these should be assumed in scope unless you say so.

| Idea | Value | Effort | Why it fits |
|---|---|---|---|
| **Appointment reminder notifications** (email/SMS, T-24h and T-1h before an appointment) | High | M | You already have `Notification` + `sendMail` infrastructure and a `node-cron`-friendly Express app; this is the single most commonly requested feature in any booking system and directly reduces no-shows. Needs a scheduled job runner (`node-cron` or a Render cron job hitting a new internal endpoint). |
| **Doctor ratings/feedback post-consultation** | Medium | M | Natural extension of the existing `Appointment` → `Completed` lifecycle; a patient-submitted 1–5 rating + optional comment, tied to `doctor` for aggregation into the existing `DoctorLeaderboard` chart. |
| **Waitlist for fully-booked slots** | Medium | M | When `getDoctorAvailability` returns no open slots, offer "join waitlist" — notify the patient if a slot opens via cancellation (you already emit `Notification` on cancellation, this just adds a matcher). |
| **Org-level billing/subscription (Stripe)** | High (if monetizing) | L | `Organisation.plan`/`billingStatus`/`trialEndsAt` already model this conceptually but nothing enforces or bills against it — currently a super_admin manually sets `plan`. A real Stripe integration (checkout, webhooks updating `billingStatus`, `isAccessible` already gates access on it) would make the SaaS model actually operable rather than manually administered. |
| **Data export / patient data portability (GDPR/DPDP-style)** | Medium–High (compliance) | M | A "download my data" endpoint for patients (JSON/PDF of their own appointments, prescriptions, profile) — increasingly expected for healthcare data platforms and relatively cheap to build given the data's already normalized per-patient. |
| **Audit log export/search UI for org admins** | Medium | S–M | `AuditLog` already exists and is tenant-scoped with a 7-year retention TTL — right now there's no UI to actually read it. A simple filterable table (by actor, action, date range) in the Admin dashboard turns existing data into an actual compliance feature. |
| **Feature-flag self-service UI (beyond org creation)** | Low–Medium | S | `Organisation.features` already exists; a small toggle panel in `updateOrganisation` for super_admin to flip `onlineBooking`/`healthPackages`/`analytics`/etc. per org without a direct DB edit — closes a real operational gap for platform support. |
| **Telemedicine / video consultation link** | High (differentiator) | L | Appointment `type: 'Online'` already exists but has no actual video component — integrating a third-party (Daily.co, Twilio Video, or even a scheduled Jitsi room link) would meaningfully differentiate "Online" from "Offline" beyond just a label. Larger scope — worth a dedicated planning pass if pursued. |
| **Full-text/fuzzy doctor & patient search** | Low–Medium | S | Current `searchPatients` uses regex; fine at current scale, but a `$text` index or Atlas Search would improve relevance/performance as org size grows. Low urgency unless a specific org reports slow search. |
| **i18n / multi-language support** | Medium (market-dependent) | M | `Organisation.settings.locale` already exists as a field but is unused for actual translation — real value only if targeting non-English-first hospitals; otherwise skip. |
| **Accessibility audit (WCAG)** | Medium (compliance-adjacent) | S–M | Healthcare-adjacent apps increasingly need this for institutional procurement; a pass with axe-core in CI plus manual keyboard/screen-reader testing on the booking and MFA flows (the most complex interaction surfaces) would be the highest-value accessibility target. |
| **PWA / offline-tolerant patient app** | Low | M | Nice-to-have for patients checking appointment details with poor connectivity; not core to the SaaS/B2B admin side. Lower priority than everything else in this table. |

---

# Suggested overall sequencing

If I were prioritizing purely on risk-reduction-per-effort for a system at this maturity level:

1. **A7.1–A7.2 (unit + integration tests)** — the actual biggest gap between "95% complete" and "production trustworthy." Recommend starting here or interleaving with A1.
2. **A1 (MFA UX polish)** — cheap, finishes an almost-done phase, no risk.
3. **A2 (step-up auth for sensitive actions)** — closes a real security gap for a healthcare-adjacent product before it's a live liability.
4. **A6 (remaining notifications)** — cheap, rides on A2/A3 infrastructure.
5. **A5 (configurable lockout)** — cheap, no dependencies.
6. **A3 (sessions/device visibility)** and **A8 (production readiness)** — can run in parallel once A7.1 exists to protect against regressions.
7. **A4 (trusted devices)** — hold for an explicit compliance/UX decision before building (see caution note above).
8. **A7.3–A7.4 (E2E, pen-test)** and **Part B items** — after the above, prioritized by business goals (e.g., if monetization is the near-term goal, billing jumps ahead of telemedicine).

---

**Next step:** tell me which phase (or Part B item) to start with, and I'll do the codebase-specific audit for that phase before writing anything — per the usual workflow, no code changes until that audit is reviewed and approved.
