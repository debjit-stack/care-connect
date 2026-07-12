# AUTH_FLOW.md

# CareConnect Authentication, Multi-Tenancy & MFA Flow

**Version:** 2.0

**Last Updated:** 12 July 2026

**Changelog from v1.0:** adds multi-tenant organisation resolution, tenant
binding enforcement, the dedicated Platform Login flow for `super_admin`,
and corrects several sections that had drifted out of sync with the actual
codebase (OTP-based registration/forgot-password, recovery codes, and most
of the MFA UX polish checklist were already implemented but undocumented).

---

# Overview

CareConnect uses a two-stage authentication system layered on top of a
multi-tenant organisation model:

1. **Tenant resolution** — determining which organisation (if any) a
   request belongs to.
2. **Password authentication.**
3. **Multi-Factor Authentication (MFA)** when required.

Only after all required stages succeed does the server issue an Access
Token and Refresh Token.

Two structurally separate login flows exist:

- **Hospital login** (`POST /api/auth/login`) — for `admin`, `doctor`,
  `receptionist`, and `patient` roles, always scoped to one organisation.
- **Platform login** (`POST /api/auth/platform-login`) — for `super_admin`
  only, a role that belongs to no organisation (`organisationId: null`) and
  manages the platform across all of them.

These are two distinct routes, not one route with a client-supplied flag —
see "Platform Login" below for why that distinction matters.

---

# Authentication Architecture

```text
Browser
    │
    ▼
React Application
    │
    ▼
Axios API Layer  (single interceptor — see "Tenant Header Resolution")
    │
    ▼
Express Server
    │
    ▼
tenantMiddleware (resolveTenant)
    │
    ▼
Authentication Controller
    │
    ▼
Authentication Services
    │
    ▼
MongoDB + Redis
```

---

# Authentication Components

## Frontend

Responsible for

* Login (hospital and platform)
* Session Restoration
* Route Protection
* MFA Setup
* OTP Verification
* Logout
* Tenant header resolution (single source of truth — see below)

Main Components

```text
AuthContext

LoginPage

SuperAdminLoginPage

MFASetupPage

ProtectedRoute
```

---

## Backend

Responsible for

* Login (hospital)
* Platform Login (super_admin)
* Register (direct + OTP-based)
* Refresh Token
* Logout
* Logout All
* MFA Setup
* MFA Validation
* MFA Recovery (backup codes)
* Disable MFA
* Tenant resolution

Main Components

```text
authController        (loginUser, platformLoginUser, authenticateAndRespond,
                        verifyPasswordAndLockout — see "Shared Authentication Logic")

mfaController

authMiddleware         (protect — also enforces tenant binding)

mfaPendingMiddleware

tenantMiddleware       (resolveTenant — see "Tenant Resolution & Isolation")
```

---

# Tenant Resolution & Isolation

This section is new in v2.0 and documents the multi-tenant architecture
that sits underneath every authenticated request.

## Three categories of route

Every backend route falls into exactly one of three categories, enforced
by `tenantMiddleware.js`:

**PUBLIC_NO_TENANT** — no organisation concept applies at all. Login,
platform-login, refresh, register, logout, MFA pending-token routes, and
OTP registration/forgot-password flows. `resolveTenant()` does not run for
these; there is no `req.orgId`.

**PUBLIC_WITH_TENANT** — no authenticated user required, but the request
*is* scoped to a specific hospital: the public doctor listing and public
health-package catalog. `resolveTenant()` runs exactly as it does for any
protected route (resolves the `X-Organisation-Slug` header or subdomain,
sets `req.orgId`, wraps the rest of the request in `runWithTenant()`) — it
only skips the authentication requirement, not the tenant requirement.

**Protected (everything else)** — requires both `protect` (a valid access
token) and a resolved tenant.

## Tenant binding enforcement (`protect`)

For any authenticated, non-`super_admin` user, `protect` verifies that the
resolved `req.orgId` matches the user's own `organisationId` — a valid
token for one hospital cannot be used against a different hospital's
resolved tenant context, even if the token itself is otherwise valid.
`super_admin` is exempt by design (see "Platform Login").

## Access token's organisation claim

The access token payload includes `organisationId` (`null` for
`super_admin`) alongside `id` and `role`. `protect` compares this claim
against the user's *live* database record on every request — if they've
been reassigned to a different organisation since the token was issued,
the token is treated as stale and the request is rejected, forcing
re-authentication.

## Tenant header resolution (frontend, single source of truth)

`client/src/api/index.js`'s `getOrgSlug(requestUrl)` is the only function
in the codebase that decides whether the `X-Organisation-Slug` header gets
attached, and the axios interceptor is its only caller. Decision order:

1. The platform-login request itself → never send a header (this request
   precedes any known role, so it can't be role-derived — see below).
2. An explicit slug set via `setOrgSlug()` ("Manage Hospital," used by
   `super_admin` stepping into a specific organisation) always wins.
3. The authenticated user's role, if known, is `super_admin` → never fall
   back to the hospital env slug.
4. Otherwise → the hospital's `VITE_ORGANISATION_SLUG` environment
   configuration, unchanged from single-tenant deployments.

The role used in step 3 is set by `AuthContext` at the two points a user
can become authenticated — a fresh login and a silent session restore via
the refresh cookie — so it can't drift out of sync with who is actually
logged in.

---

# Complete Login Flow (hospital users)

```text
User

↓

Enter Email + Password

↓

POST /api/auth/login

↓

Reject if email belongs to a super_admin*

↓

Resolve Organisation (from X-Organisation-Slug header/subdomain)

↓

Look up user scoped to that organisation

↓

Verify Password / Lockout (shared helper — see below)

↓

Evaluate Organization MFA Policy

↓

Evaluate User MFA Status
```

*\* Rejection only happens AFTER the password is verified against that
account — see "Account-Enumeration Protection" below. A wrong password on
a `super_admin`'s email looks identical to a wrong password on any other
account.*

Three possible outcomes are produced, same as v1.0 — see Scenarios 1–3
below (unchanged).

---

# Scenario 1

No MFA Required

Conditions

* Organization does NOT require MFA
* User has not enabled MFA

Flow

```text
Password Verified

↓

Generate Access Token (includes organisationId claim)

↓

Generate Refresh Token

↓

Set HTTP-only Cookie

↓

Return User

↓

Dashboard
```

Response

```json
{
  "accessToken": "...",
  "user": {}
}
```

---

# Scenario 2

User Already Has MFA

Conditions

* User previously enabled MFA

Flow

```text
Password Verified

↓

Do NOT issue Access Token

↓

Generate MFA Pending JWT

↓

Return

{
    mfaRequired:true,
    mfaSetupRequired:false
}
```

Frontend shows the OTP screen, with an option to authenticate via a backup
recovery code instead (see "MFA Recovery" below).

---

# Scenario 3

Organization Forces MFA

Conditions

* Organization policy requires MFA
* User has never configured MFA

Flow

```text
Password Verified

↓

Generate Secret

↓

Store Secret in Redis

↓

Generate QR

↓

Return Setup Information

↓

User Scans QR

↓

Verify OTP

↓

Encrypt Secret

↓

Generate Recovery Codes (shown once)

↓

Generate Tokens

↓

Dashboard
```

---

# Platform Login (`super_admin`)

This is new in v2.0. `super_admin` is a platform-level role
(`organisationId: null`) that manages organisations rather than belonging
to one, and authenticates through a structurally separate endpoint rather
than a flag on the hospital login request.

```text
User (super_admin)

↓

POST /api/auth/platform-login

↓

Look up user scoped to role: 'super_admin' ONLY
(no hospital-user lookup exists in this endpoint at all)

↓

Verify Password / Lockout (SAME shared helper as hospital login)

↓

Evaluate MFA status (super_admin accounts can have MFA enforced,
identically to any other staff role — see Security Panel)

↓

Dashboard (/super-admin)
```

**Why a separate route instead of a request flag:** the distinction
between "hospital login" and "platform login" is enforced by which URL was
called, not by a client-supplied value the backend would otherwise have to
trust. `platformLoginUser` structurally cannot authenticate a
non-`super_admin` — there is no code path in it that looks up any other
role.

**Account-enumeration protection:** `POST /api/auth/login` checks whether
the submitted email belongs to a `super_admin` account, but does **not**
reveal that fact until the password has been verified against it. A wrong
password produces the exact same response (message, status code, lockout
behaviour) as a wrong password on any ordinary account. Only a correct
password reveals "Please use the Platform Login" — meaning only someone
who already has valid credentials for that account learns anything from
this endpoint.

## Shared Authentication Logic

`authenticateAndRespond` and `verifyPasswordAndLockout` in `authController.js`
are the single implementation of lockout checking, password verification,
failed-attempt bookkeeping, and the MFA decision tree — used by **both**
`loginUser` and `platformLoginUser`. There is exactly one place in the
codebase where a password is checked and a lockout is enforced, regardless
of which login route was called.

---

# OTP-Based Registration & Forgot Password

Patients can self-register and reset their password via one-time email
codes, in addition to the direct registration endpoint. (This has existed
in the codebase since before v1.0 of this document but was previously
undocumented here.)

**Registration:** `POST /api/auth/register/request-otp` → email OTP sent,
6-digit code, 10-minute expiry → `POST /api/auth/register/verify-otp`
creates the account and logs the patient in directly. The password is
hashed *before* being placed in the temporary Redis session — plaintext
passwords are never stored anywhere during this flow, even transiently.
Resending a code does not reset the failed-attempt lockout counter
(closing an early bypass where repeated resends could be used to reset a
brute-force budget).

**Forgot password:** `POST /api/auth/forgot-password` → same OTP pattern →
`POST /api/auth/forgot-password/verify-otp` exchanges a valid code for a
short-lived reset token → `POST /api/auth/forgot-password/reset` sets the
new password and revokes all existing sessions for that account. Every
step returns the same generic message regardless of whether the submitted
email actually exists, to avoid account enumeration.

---

# MFA Setup Flow

Step 1

```text
POST /api/auth/login   (or /api/auth/platform-login)
```

Returns

```json
{
    "mfaRequired": true,
    "mfaSetupRequired": true,
    "mfaPending": "JWT"
}
```

---

Step 2

```text
GET /api/auth/mfa/setup
```

Headers

```text
Authorization

Bearer mfaPendingJWT
```

Backend

* Creates TOTP Secret
* Creates QR Code
* Stores Secret in Redis
* Generates setupId

Returns

```json
{
    "setupId": "...",
    "qrDataUri": "...",
    "otpauthUrl": "...",
    "expiresIn":300
}
```

Frontend shows a live countdown timer, offers QR regeneration (invalidates
the previous setup session and restarts the countdown), and falls back to
a manual entry key if the QR code fails to render.

---

Step 3

User scans QR

Google Authenticator / Authy / Microsoft Authenticator

↓

Generates OTP

↓

User enters code (auto-focused, supports pasting the full code, auto-submits at 6 digits)

---

Step 4

```text
POST /api/auth/mfa/verify-setup
```

Body

```json
{
    "setupId":"...",
    "token":"123456"
}
```

Backend

* Loads Redis Session
* Verifies OTP (rate-limited — 5 attempts before lockout)
* Encrypts Secret
* Saves Secret
* Generates 8 one-time recovery codes (bcrypt-hashed for storage)
* Enables MFA
* Deletes Redis Session
* Sends an "MFA enabled" security email

Returns

```json
{
    "accessToken":"...",
    "user":{},
    "recoveryCodes": ["ABCD-1234", "..."]
}
```

Recovery codes are shown exactly once, with a copy/download option and a
`beforeunload` warning if the user tries to leave before acknowledging
they've saved them.

Frontend calls

```text
completeLogin()
```

↓

Dashboard

---

# Existing MFA Login

When MFA already exists

```text
POST /api/auth/login   (or /api/auth/platform-login)
```

Returns

```json
{
    "mfaRequired":true,
    "mfaSetupRequired":false,
    "mfaPending":"JWT"
}
```

Frontend

↓

OTP Screen (with a "use a recovery code instead" option)

↓

User enters OTP

↓

POST /api/auth/mfa/validate

↓

Backend decrypts secret, verifies TOTP (rate-limited)

↓

Issue Access Token

↓

Issue Refresh Cookie

↓

Return User

↓

Dashboard

---

# MFA Recovery (backup codes)

If a user loses access to their authenticator app, they can authenticate
with one of their 8 one-time recovery codes instead of a TOTP code:

```text
POST /api/auth/mfa/recover
```

Body: `{ code, mfaPending }`. Each code is single-use (marked as consumed
on success), rate-limited separately from TOTP attempts, and the response
tells the user how many codes remain — with a nudge to regenerate a fresh
set once only 1–2 remain. A fresh set can be generated at any time via
`POST /api/auth/mfa/regenerate-codes`, which itself requires a valid TOTP
code first (prevents a hijacked session from silently invalidating a
user's real recovery codes).

---

# Why mfaPending Exists

Unchanged from v1.0. The server intentionally does NOT issue an Access
Token after password verification — a short-lived `mfaPending` JWT
identifies the user for the MFA step only and cannot access any protected
API. This prevents partially authenticated sessions, and applies
identically whether the login came from the hospital or platform endpoint.

---

# Redis Setup Session

Unchanged from v1.0 — `setupId`, `userId`, `secret`, `createdAt`, stored
temporarily so a TOTP secret never reaches MongoDB until setup verification
succeeds, and automatically expires if setup is abandoned.

---

# Secret & Recovery Code Storage

```text
TOTP Secret          →  AES-256-GCM Encryption  →  MongoDB
Recovery Codes        →  bcrypt Hash (per code)   →  MongoDB
```

Neither plaintext TOTP secrets nor plaintext recovery codes are ever
stored. Recovery codes are shown to the user exactly once, at generation
time, and are unrecoverable after that — only regeneration (which
invalidates the old set) is possible if they're lost.

---

# Token Strategy

## Access Token

Contains

```text
userId

role

organizationId   (null for super_admin)
```

Purpose

Authentication, tenant binding (see "Tenant Resolution & Isolation")

Storage

Memory (AuthContext / API layer) — never persisted to localStorage or
sessionStorage.

---

## Refresh Token

Purpose

Create new Access Tokens

Storage

HTTP-only Secure Cookie

Never stored in localStorage.

---

# Session Restoration

```text
Application Startup

↓

Refresh Token Cookie Exists

↓

POST /refresh

↓

Issue New Access Token

↓

GET /me

↓

Restore User + Role (role is recorded for tenant header decisions —
see "Tenant Header Resolution")

↓

Render Application
```

This path is how a `super_admin` (or any user) can end up authenticated
without ever passing through a login page component — e.g. reopening the
app with a still-valid refresh cookie. The role recorded here is what
makes tenant header suppression correct even on this path, not just on a
fresh password login.

---

# Logout

```text
POST /logout
```

Server

* Invalidates Refresh Token

Frontend

* Clears Access Token
* Clears User Context
* Clears any explicit organisation slug and recorded role
* Redirects to Login

---

# Logout All

```text
POST /logout-all
```

Server

* Deletes all Refresh Tokens for the user

Frontend

* Clears Local Session (same clearing as Logout above)

---

# AuthContext Responsibilities

AuthContext is the single source of truth for authentication state.

Responsible for

* `login()` — hospital users
* `platformLogin()` — super_admin only
* `completeLogin()` — shared by both, and by MFA completion
* `logout()` / `logoutAll()`
* `updateUser()`
* Session restoration
* Recording the authenticated role for tenant header decisions

Never bypass AuthContext when authenticating users.

---

# Security Decisions

Access Token

* Never issued before MFA
* Carries an `organisationId` claim, compared against the live user record
  on every request

Refresh Token

* HTTP-only Cookie

MFA Secret

* AES-256-GCM Encrypted

Recovery Codes

* bcrypt-hashed, single-use, shown once

Passwords

* bcrypt Hashed

Setup Secret

* Stored only in Redis until verification

Audit Logs

* Authentication events recorded, including an explicit marker when a
  `super_admin` acts across organisation boundaries

Organization Isolation

* Every request scoped by organisation via `tenantMiddleware` +
  `tenantPlugin`'s implicit query filtering
* Tenant binding independently re-verified in `protect` on every
  authenticated request

Account Enumeration

* `super_admin` account existence is never revealed by `/api/auth/login`
  before a correct password is supplied

---

# Error Flow

Invalid Password

↓

401 Unauthorized (identical response shape regardless of account role)

Invalid OTP

↓

400 Bad Request (rate-limited; locks after 5 attempts)

Invalid Recovery Code

↓

401 Unauthorized (rate-limited separately from TOTP attempts)

Expired Setup

↓

Generate New QR

Expired Refresh Token

↓

Login Again

Ambiguous / Missing Organisation Context

↓

400 Bad Request — "Organisation not specified"

---

# Current Status

Completed

* JWT Authentication (with organisationId claim + live binding check)
* Refresh Tokens
* Session Restoration (role-aware)
* RBAC
* Protected Routes
* Multi-tenant organisation resolution (tenant-scoped vs tenant-independent
  routes)
* Tenant binding enforcement
* Platform Login (dedicated `super_admin` flow)
* Account-enumeration protection on login
* OTP-based patient registration and forgot-password
* MFA Setup
* QR Generation, Countdown, Regeneration
* Secret Encryption
* OTP Verification (rate-limited)
* Recovery Codes (generation, display, recovery login, regeneration)
* Automatic Login After MFA
* Disable MFA
* Organization Required MFA
* Admin-Forced MFA (including for `super_admin` accounts)
* Admin MFA Reset

---

# Planned Improvements

* Trusted Devices ("Remember this browser")
* Login History / active-session visibility per user
* Per-device session revocation (beyond "Logout All")
* Suspicious-login notifications
* Require MFA re-verification before sensitive actions (password change,
  email change, disabling MFA)
* Remove MFA query parameters from the URL after successful login
* Prevent browser back-navigation into a completed auth flow
* Smooth redirect transition animations
* Configurable (rather than fixed) lockout durations

---

# Authentication Principle

The authentication system follows a strict rule:

> **No user receives an Access Token until every required authentication factor has been successfully verified.**

This principle should never be violated when extending or refactoring the
authentication system — and now extends to the tenant-binding guarantee:
**no request is treated as belonging to an organisation until that
organisation has been explicitly resolved**, whether or not the request
requires an authenticated user.
