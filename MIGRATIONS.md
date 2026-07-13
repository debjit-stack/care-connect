# MIGRATIONS.md

# CareConnect Database Migration Guide

**Project:** CareConnect Healthcare SaaS

**Repository Database Baseline:** Schema Version 006

**Application Phase:** Phase 1 Complete — Phase 2/3 (Patient Profile, MFA Recovery Codes) Applied

---

# READ THIS FIRST

This document describes the **actual migration history** of the project.

The migration file numbers **do not represent the final execution order**.

Future developers and AI agents (Codex, Claude, ChatGPT, etc.) should read this document before creating new migrations or modifying the database.

**The current database baseline for all future development is Schema Version 006.**

---

# Original Migration Plan

Phase 1 originally planned three database migrations.

```text
001-auth-overhaul.js
002-appointment-uniqueness.js
003-multi-tenancy.js
```

The intended execution order was:

```text
001
 ↓
002
 ↓
003
```

---

# What Actually Happened

During development, Migration **001** and **002** were attempted but **were not successfully completed**.

Instead of blocking development, the application continued to evolve.

As new features were implemented, parts of the database schema were introduced directly through application development.

Later, multi-tenancy became the highest architectural priority.

Therefore the project executed Migration **003** first.

After Migration 003 completed, the database was reviewed.

Rather than rerunning outdated migrations, a new migration (**004**) was created to safely complete the remaining authentication schema.

Subsequently, two further features required their own migrations on top of the 004 baseline: patient profile fields (**005**) and MFA recovery codes (**006**). Both were applied successfully and are part of the current baseline.

---

# Actual Execution Timeline

```text
Original Plan

001
002
003


Actual History

001 ❌ Not successfully completed

002 ❌ Not successfully completed

↓

003 ✅ Successfully applied

↓

Database review

↓

004 ✅ Authentication backfill

↓

005 ✅ Patient profile fields

↓

006 ✅ MFA recovery codes

↓

Current Database (Schema Version 006)
```

---

# Migration Details

## 001-auth-overhaul.js

Status:

❌ Not successfully completed.

Originally intended to introduce:

* loginAttempts
* lockUntil
* passwordChangedAt
* deletedAt
* mfaEnabled
* mfaSecret
* authentication schema improvements

Some of these fields appeared later during application development.

The remaining missing fields were completed by Migration 004.

---

## 002-appointment-uniqueness.js

Status:

❌ Not successfully completed.

Originally intended to:

* update appointment uniqueness
* update HealthPackage schema
* prepare soft-delete support

Later development and Migration 003 superseded most of this work.

---

## 003-multi-tenancy.js

Status:

✅ Successfully applied.

This migration became the architectural foundation of the application.

Completed:

* created default organisation
* added organisationId to existing collections
* migrated existing data
* rebuilt indexes
* updated audit log support

Collections updated:

* users
* doctors
* appointments
* healthpackages
* packagebookings
* auditlogs

Migration 003 defines the current multi-tenant architecture.

---

## 004-backfill-auth-fields.js

Status:

✅ Successfully applied.

Reason for creation:

Migration 001 could not be safely rerun after the schema evolved.

Migration 004 was created to safely complete the authentication schema without modifying existing production data.

Backfilled only missing fields on the `users` collection:

* lockUntil
* deletedAt
* passwordChangedAt
* mfaEnabled
* mfaSecret

Properties:

* idempotent (`$exists: false` guards on every field)
* production safe
* non-destructive
* preserves existing values
* run directly via `node migrations/004-backfill-auth-fields.js` (not via the `up`/`down` migrate-mongo convention used by 001–003)

Migration 004 completed the authentication schema.

---

## 005-patient-profile.js

Status:

✅ Successfully applied.

Reason for creation:

WS4 (patient profile management) required additional self-service profile fields on `users` that did not exist in the schema as of Migration 004.

Backfilled only missing fields on the `users` collection:

* `phone` — String, default `null`
* `dateOfBirth` — Date, default `null`
* `bloodGroup` — String, default `null` (enum-validated at the application layer, not the database layer)
* `allergies` — String, default `''` (free text, comma-separated in the UI)

Properties:

* idempotent — uses a single `{ phone: { $exists: false } }` guard, since all four fields are introduced together
* non-destructive — never overwrites existing values, only fills gaps
* does **not** touch `organisationId`, auth fields, or any other collection

Run with:

```bash
node server/run-migration-005.js
```

(loads `.env`, connects via the native `mongodb` driver, and calls this migration's exported `up(db)`.)

Migration 005 bumped the schema baseline from 004 to 005.

---

## 006-recovery-codes.js

Status:

✅ Successfully applied.

Reason for creation:

P3C (MFA recovery/backup codes) required a `recoveryCodes` array on `users` to store bcrypt-hashed one-time recovery codes, generated fresh whenever a user completes MFA setup.

Backfilled only the missing field on the `users` collection:

* `recoveryCodes` — Array, default `[]` (elements are `{ codeHash, usedAt }`, populated at MFA setup time — this migration only ensures the field exists with an empty default for any pre-existing user documents)

Properties:

* idempotent — `{ recoveryCodes: { $exists: false } }` guard
* non-destructive — only adds the field, never modifies existing data
* recovery codes themselves are never generated or backfilled by this migration; they are created per-user by `mfaController.verifySetup` when that user next enables MFA

Run with:

```bash
node server/run-migration-006.js
```

Migration 006 bumped the schema baseline from 005 to 006 and is the current baseline for the repository.

---

# Current Database Baseline

The repository now assumes **Schema Version 006**.

Every User document contains:

* loginAttempts
* lockUntil
* passwordChangedAt
* deletedAt
* mfaEnabled
* mfaSecret
* forceMfa
* lastMfaResetAt
* recoveryCodes *(Migration 006)*
* organisationId
* phone *(Migration 005)*
* dateOfBirth *(Migration 005)*
* bloodGroup *(Migration 005)*
* allergies *(Migration 005)*

Doctor documents contain:

* organisationId
* deletedAt

Appointment documents contain:

* organisationId

HealthPackage documents contain:

* deletedAt
* organisationId

AuditLog documents contain:

* organisationId

Notification documents exist as a separate collection (introduced directly through application development, not a dedicated numbered migration) and are tenant-scoped via the same `tenantPlugin` as every other collection above.

Organisation collection exists and is the foundation of multi-tenancy.

---

# Phase 2 Prerequisite

**Do NOT follow the original Phase 2 instruction that says:**

```text
Run 001
Run 002
Run 003
```

That instruction is obsolete for this repository.

The current repository already uses **Schema Version 006**.

---

# Instructions for Future Developers / AI Agents

If you are starting new feature work:

1. Assume the database is already on **Schema Version 006**.
2. Do **NOT** rerun Migration 001.
3. Do **NOT** rerun Migration 002.
4. Do **NOT** rerun Migration 003, 004, 005, or 006 on an existing database (all are idempotent by design, but rerunning is unnecessary and should not be part of normal deployment).
5. Start all new database work from Schema Version 006.
6. Create new migrations beginning with **007**.
7. Never modify historical migration files.
8. Preserve backward compatibility with existing production data.
9. Follow the established convention split: migrations 001–003 use the `migrate-mongo`-style `export const up = async (db) => {}` / `down` pair; migrations 004–006 are standalone scripts run directly with `node` (each has a matching `server/run-migration-NNN.js` runner for 005 and 006, or connects directly via mongoose for 004). New migrations should pick one convention and match the runner pattern used by 005/006 for consistency, since that's the more recent and more commonly used approach.

---

# Phase 2/3 Compatibility

The following foundations are already available for new feature work:

* JWT Authentication
* Refresh Tokens
* Redis Session Management
* RBAC
* Multi-Tenancy
* Organisation Model
* Feature Flags
* Audit Logging
* Soft Delete
* Appointment Lifecycle
* Health Packages
* Doctor Availability
* Patient History
* Authentication Schema (completed by Migration 004)
* Patient Profile fields (completed by Migration 005)
* MFA Recovery Codes (completed by Migration 006)
* In-app Notifications (introduced via application code, not a numbered migration — see `server/models/Notification.js`)

Future work (trusted devices, session-history dashboards, per-device revocation, sensitive-action MFA re-verification, etc.) should build on this baseline without attempting to recreate or reapply earlier migrations.

---

# Current Schema Version

**Schema Version:** 006

**This is the only supported starting point for new development.**
