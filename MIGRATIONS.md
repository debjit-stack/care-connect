# MIGRATIONS.md

# CareConnect Database Migration Guide

**Project:** CareConnect Healthcare SaaS

**Repository Database Baseline:** Schema Version 004

**Application Phase:** Phase 1 Complete

---

# READ THIS FIRST

This document describes the **actual migration history** of the project.

The migration file numbers **do not represent the final execution order**.

Future developers and AI agents (Codex, Claude, ChatGPT, etc.) should read this document before creating new migrations or modifying the database.

**The current database baseline for all future development is Schema Version 004.**

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

Current Database (Schema Version 004)
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

Backfilled only missing fields:

* lockUntil
* deletedAt
* passwordChangedAt
* mfaEnabled
* mfaSecret

Properties:

* idempotent
* production safe
* non-destructive
* preserves existing values

Migration 004 completed the authentication schema.

---

# Current Database Baseline

The repository now assumes **Schema Version 004**.

Every User document contains:

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

The current repository already uses **Schema Version 004**.

---

# Instructions for Future Developers / AI Agents

If you are starting Phase 2 or later:

1. Assume the database is already on **Schema Version 004**.
2. Do **NOT** rerun Migration 001.
3. Do **NOT** rerun Migration 002.
4. Do **NOT** rerun Migration 003 on an existing database.
5. Start all new database work from Schema Version 004.
6. Create new migrations beginning with the next available version number.
7. Never modify historical migration files.
8. Preserve backward compatibility with existing production data.

---

# Phase 2 Compatibility

The following Phase 1 foundations are already available:

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

Phase 2 work (MFA, Notifications, Analytics, Onboarding, Patient Profile, etc.) should build on this baseline without attempting to recreate or reapply earlier migrations.

---

# Current Schema Version

**Schema Version:** 004

**This is the only supported starting point for Phase 2 development.**
