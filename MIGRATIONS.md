# MIGRATIONS.md

# CareConnect Database Migration Guide

**Project:** CareConnect Healthcare SaaS

**Current Database Schema Version:** 004

**Current Development Phase:** Phase 1 Complete

---

# IMPORTANT

This document describes the actual database migration history.

The migration files are **not** a chronological representation of the final database state.

Future contributors (human or AI) **must read this document before creating any new database migration.**

---

# Original Migration Plan

Phase 1 originally planned only three migrations.

```
001-auth-overhaul.js
002-appointment-uniqueness.js
003-multi-tenancy.js
```

The intended execution order was

```
001
 ↓
002
 ↓
003
```

---

# What Actually Happened

During development, Migration **001** and **002** were attempted but were **not successfully completed**.

Rather than blocking development, implementation continued.

Many database changes were introduced directly while building application features.

Later, Migration **003** became the architectural priority because the application was upgraded from a single-hospital system to a multi-tenant SaaS platform.

Therefore the project history became:

```
001 ❌ Not successfully applied

002 ❌ Not successfully applied

↓

003 ✅ Successfully applied

↓

Database review

↓

004 ✅ Created to safely complete remaining authentication schema

↓

Current database
```

---

# Migration 001

File:

```
server/migrations/001-auth-overhaul.js
```

Status:

**Not successfully applied**

Originally intended to add:

* loginAttempts
* lockUntil
* passwordChangedAt
* deletedAt
* mfaEnabled
* mfaSecret
* AuditLog support

Some of these fields were later introduced naturally during development.

Others remained missing for legacy users.

---

# Migration 002

File:

```
server/migrations/002-appointment-uniqueness.js
```

Status:

**Not successfully applied**

Originally intended to:

* create appointment uniqueness indexes
* update HealthPackage schema
* prepare soft delete support

Later development and Migration 003 replaced most of this work.

---

# Migration 003

File:

```
server/migrations/003-multi-tenancy.js
```

Status:

**Successfully applied**

This is the first successful migration that defines the current architecture.

Completed:

* created default organisation
* migrated existing data
* added organisationId
* rebuilt unique indexes
* updated tenant-aware collections

Collections migrated:

* users
* doctors
* appointments
* healthpackages
* packagebookings
* auditlogs

Migration 003 is considered the foundation of the current database.

---

# Why Migration 004 Exists

After Migration 003 completed, the database was reviewed.

The review showed:

* Migration 001 had not completed successfully.
* Migration 002 had not completed successfully.
* The application itself already contained most of the intended functionality.

Re-running old migrations would have been risky because the schema had evolved significantly.

Instead, a new migration was created.

---

# Migration 004

File:

```
server/migrations/004-backfill-auth-fields.js
```

Status:

**Successfully applied**

Purpose:

Safely backfill only missing authentication fields.

Added when missing:

* lockUntil
* deletedAt
* passwordChangedAt
* mfaEnabled
* mfaSecret

Characteristics:

* idempotent
* non-destructive
* production safe
* does not recreate indexes
* does not overwrite existing values

Migration 004 completed the authentication schema.

---

# Current Database State

All User documents now contain:

* loginAttempts
* lockUntil
* passwordChangedAt
* deletedAt
* mfaEnabled
* mfaSecret
* organisationId

Doctor documents contain:

* organisationId

Appointment documents contain:

* organisationId

HealthPackage documents contain:

* deletedAt
* organisationId

AuditLog documents contain:

* organisationId

Organisation collection exists.

The database schema is considered complete for Phase 1.

---

# Guidance For Future Developers / AI Agents

If you are reviewing this repository:

1. **Do NOT attempt to rerun Migration 001.**
2. **Do NOT attempt to rerun Migration 002.**
3. Assume Migration 003 is the architectural baseline.
4. Assume Migration 004 completed the authentication schema.
5. All future migrations must start from **Schema Version 004**.

If new database changes are required:

* Create a new migration.
* Never edit old migration files.
* Never renumber migrations.
* Never assume legacy migrations were executed.
* Always preserve existing production data.

---

# Phase 2 Starting Point

When beginning Phase 2, assume the following:

* Authentication schema is complete.
* Multi-tenancy is enabled.
* RBAC is implemented.
* Audit logging is available.
* Soft delete is implemented.
* Appointment lifecycle is implemented.
* Health package management is implemented.

Phase 2 migrations should focus only on new functionality (billing, analytics, notifications, reporting, etc.) and **must not recreate or modify the Phase 1 migrations.**
