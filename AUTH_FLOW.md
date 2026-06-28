# AUTH_FLOW.md

# CareConnect Authentication & MFA Flow

**Version:** 1.0

**Last Updated:** 28 June 2026

---

# Overview

CareConnect uses a two-stage authentication system designed for enterprise healthcare applications.

Authentication consists of:

1. Password Authentication
2. Multi-Factor Authentication (MFA) when required

Only after both stages succeed does the server issue an Access Token and Refresh Token.

---

# Authentication Architecture

```text
Browser
    │
    ▼
React Application
    │
    ▼
Axios API Layer
    │
    ▼
Express Server
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

* Login
* Session Restoration
* Route Protection
* MFA Setup
* OTP Verification
* Logout

Main Components

```text
AuthContext

LoginPage

MFASetupPage

ProtectedRoute
```

---

## Backend

Responsible for

* Login
* Register
* Refresh Token
* Logout
* Logout All
* MFA Setup
* MFA Validation
* Disable MFA

Main Components

```text
authController

mfaController

authMiddleware

mfaPendingMiddleware
```

---

# Complete Login Flow

```text
User

↓

Enter Email + Password

↓

POST /api/auth/login

↓

Validate Email

↓

Validate Password

↓

Account Active?

↓

Load Organization

↓

Evaluate Organization MFA Policy

↓

Evaluate User MFA Status
```

Three possible outcomes are produced.

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

Generate Access Token

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

Frontend redirects to

```text
/mfa
```

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

Store Secret

↓

Generate Tokens

↓

Dashboard
```

---

# MFA Setup Flow

Step 1

```text
POST /api/auth/login
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

---

Step 3

User scans QR

Google Authenticator

↓

Generates OTP

↓

User enters code

---

Step 4

```text
POST /api/auth/mfa/setup/verify
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
* Verifies OTP
* Encrypts Secret
* Saves Secret
* Enables MFA
* Deletes Redis Session

Returns

```json
{
    "accessToken":"...",
    "user":{}
}
```

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
POST /api/auth/login
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

OTP Screen

↓

User enters OTP

↓

POST /api/auth/mfa/validate

↓

Backend decrypts secret

↓

Verify TOTP

↓

Issue Access Token

↓

Issue Refresh Cookie

↓

Return User

↓

Dashboard

---

# Why mfaPending Exists

The server intentionally does NOT issue an Access Token after password verification.

Instead it creates

```text
mfaPending JWT
```

Purpose

* Short-lived
* Cannot access APIs
* Identifies authenticated user
* Only used during MFA

This prevents partially authenticated sessions.

---

# Redis Setup Session

Redis temporarily stores

```text
setupId

userId

secret

createdAt
```

Advantages

* Secret never reaches MongoDB until verification succeeds.
* Automatically expires.
* Prevents incomplete MFA setups.

---

# Secret Storage

Before saving

```text
Google Secret

↓

AES-256-GCM Encryption

↓

MongoDB
```

Database never stores plaintext TOTP secrets.

---

# Token Strategy

## Access Token

Contains

```text
userId

role

organizationId
```

Purpose

Authentication

Storage

Memory (AuthContext / API layer)

---

## Refresh Token

Purpose

Create new Access Tokens

Storage

HTTP-only Secure Cookie

Never stored in localStorage.

---

# Session Restoration

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

Restore User

↓

Render Application

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
* Redirects to Login

---

# Logout All

```text
POST /logout-all
```

Server

* Deletes all Refresh Tokens

Frontend

* Clears Local Session

---

# AuthContext Responsibilities

AuthContext is the single source of truth.

Responsible for

* login()
* completeLogin()
* logout()
* logoutAll()
* updateUser()
* session restoration
* authentication state

Never bypass AuthContext when authenticating users.

---

# Security Decisions

Access Token

* Never issued before MFA

Refresh Token

* HTTP-only Cookie

MFA Secret

* AES-256-GCM Encrypted

Passwords

* bcrypt Hashed

Setup Secret

* Stored only in Redis until verification

Audit Logs

* Authentication events recorded

Organization Isolation

* Every request scoped by organization

---

# Error Flow

Invalid Password

↓

401 Unauthorized

Invalid OTP

↓

400 Bad Request

Expired Setup

↓

Generate New QR

Expired Refresh Token

↓

Login Again

---

# Current Status

Completed

* JWT Authentication
* Refresh Tokens
* Session Restoration
* RBAC
* Protected Routes
* MFA Setup
* QR Generation
* Secret Encryption
* OTP Verification
* Automatic Login After MFA
* Disable MFA
* Organization Required MFA

---

# Planned Improvements

* Recovery Codes
* Trusted Devices
* Login History
* Device Management
* Session Dashboard
* Email Alerts
* Admin MFA Reset
* QR Countdown Timer
* QR Regeneration
* Better UX
* Playwright Authentication Tests

---

# Authentication Principle

The authentication system follows a strict rule:

> **No user receives an Access Token until every required authentication factor has been successfully verified.**

This principle should never be violated when extending or refactoring the authentication system.
