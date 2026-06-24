/**
 * Migration: 003-multi-tenancy
 * ─────────────────────────────
 * Adds organisationId to every existing document across all collections.
 *
 * Strategy:
 *   1. Create a "default" Organisation document representing the existing
 *      single-hospital deployment.
 *   2. Stamp every User, Doctor, Appointment, HealthPackage, PackageBooking,
 *      and AuditLog document with that org's _id.
 *   3. Drop the old global unique index on users.email and replace it with
 *      a compound (email + organisationId) unique index.
 *   4. Update the Appointment unique slot index to include organisationId.
 *   5. Create organisationId indexes on all collections.
 *
 * BEFORE RUNNING:
 *   Set DEFAULT_ORG_SLUG in your environment or edit the constant below.
 *   This slug becomes the subdomain for the existing hospital.
 *
 * SAFE TO RUN:
 *   Uses $exists checks so re-running is idempotent.
 *   All updateMany calls use { organisationId: { $exists: false } } guards.
 *
 * Run with: node server/migrations/003-multi-tenancy.js
 */

import { ObjectId } from 'bson'; // available via mongodb driver

const DEFAULT_ORG_NAME  = process.env.DEFAULT_ORG_NAME  || 'My Hospital';
const DEFAULT_ORG_SLUG  = process.env.DEFAULT_ORG_SLUG  || 'my-hospital';
const DEFAULT_ORG_EMAIL = process.env.DEFAULT_ORG_EMAIL || 'admin@myhospital.com';

export const up = async (db) => {
    console.log('[Migration 003] Starting multi-tenancy migration...');

    // ── Step 1: Create or find the default Organisation ───────────────────────
    const orgsCollection = db.collection('organisations');

    let org = await orgsCollection.findOne({ slug: DEFAULT_ORG_SLUG });

    if (!org) {
        const result = await orgsCollection.insertOne({
            name:          DEFAULT_ORG_NAME,
            slug:          DEFAULT_ORG_SLUG,
            contactEmail:  DEFAULT_ORG_EMAIL,
            plan:          'pro',         // existing deployment gets pro plan
            billingStatus: 'active',
            trialEndsAt:   null,
            isActive:      true,
            deletedAt:     null,
            settings: {
                primaryColor: '#3B82F6',
                timezone:     'Asia/Kolkata',
                locale:       'en-IN',
                currency:     'INR',
            },
            features: {
                onlineBooking:  true,
                healthPackages: true,
                patientPortal:  true,
                analytics:      false,
                mfaRequired:    false,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        org = { _id: result.insertedId };
        console.log(`[Migration 003] Created default org: ${DEFAULT_ORG_SLUG} (${org._id})`);
    } else {
        console.log(`[Migration 003] Using existing org: ${DEFAULT_ORG_SLUG} (${org._id})`);
    }

    const orgId = org._id;

    // ── Step 2: Stamp all collections ─────────────────────────────────────────
    const collections = [
        'users',
        'doctors',
        'appointments',
        'healthpackages',
        'packagebookings',
        'auditlogs',
    ];

    for (const name of collections) {
        const col    = db.collection(name);
        const result = await col.updateMany(
            { organisationId: { $exists: false } },
            { $set: { organisationId: orgId } }
        );
        console.log(`[Migration 003] ${name}: stamped ${result.modifiedCount} documents`);
    }

    // ── Step 3: Drop old global unique index on users.email ───────────────────
    try {
        await db.collection('users').dropIndex('email_1');
        console.log('[Migration 003] Dropped old global email index');
    } catch {
        console.log('[Migration 003] Global email index not found — already removed');
    }

    // ── Step 4: Create compound email + org unique index ──────────────────────
    await db.collection('users').createIndex(
        { email: 1, organisationId: 1 },
        { unique: true, name: 'email_organisationId_unique' }
    );
    console.log('[Migration 003] Created compound email+orgId unique index on users');

    // ── Step 5: Rebuild Appointment unique slot index with orgId ───────────────
    try {
        await db.collection('appointments').dropIndex('unique_active_appointment_slot');
        console.log('[Migration 003] Dropped old appointment slot index');
    } catch {
        console.log('[Migration 003] Old appointment slot index not found');
    }

    await db.collection('appointments').createIndex(
        { doctor: 1, appointmentDate: 1, appointmentTime: 1, organisationId: 1 },
        {
            unique: true,
            partialFilterExpression: { status: { $ne: 'Cancelled' } },
            name: 'unique_active_appointment_slot',
        }
    );
    console.log('[Migration 003] Created org-scoped appointment slot index');

    // ── Step 6: Create organisationId indexes on all collections ──────────────
    const indexTargets = [
        { col: 'users',          keys: { organisationId: 1, role: 1 } },
        { col: 'doctors',        keys: { organisationId: 1 } },
        { col: 'appointments',   keys: { organisationId: 1, appointmentDate: -1 } },
        { col: 'healthpackages', keys: { organisationId: 1 } },
        { col: 'packagebookings',keys: { organisationId: 1 } },
        { col: 'auditlogs',      keys: { organisationId: 1, createdAt: -1 } },
    ];

    for (const { col, keys } of indexTargets) {
        await db.collection(col).createIndex(keys);
        console.log(`[Migration 003] Index created on ${col}:`, keys);
    }

    // ── Step 7: Create organisations collection indexes ────────────────────────
    await db.collection('organisations').createIndex({ slug: 1 }, { unique: true });
    await db.collection('organisations').createIndex({ isActive: 1 });
    await db.collection('organisations').createIndex({ deletedAt: 1 });
    console.log('[Migration 003] Organisation indexes created');

    console.log('[Migration 003] ✓ Complete. Default org ID:', orgId.toString());
    console.log('[Migration 003] Set X-Organisation-Slug:', DEFAULT_ORG_SLUG, 'in all API requests.');
};

export const down = async (db) => {
    // Remove organisationId from all documents
    const collections = [
        'users', 'doctors', 'appointments',
        'healthpackages', 'packagebookings', 'auditlogs',
    ];

    for (const name of collections) {
        await db.collection(name).updateMany(
            {},
            { $unset: { organisationId: '' } }
        );
        console.log(`[Migration 003] Rolled back: ${name}`);
    }

    // Restore global email unique index
    try {
        await db.collection('users').dropIndex('email_organisationId_unique');
    } catch {}
    await db.collection('users').createIndex({ email: 1 }, { unique: true });

    // Drop organisations collection
    await db.collection('organisations').drop().catch(() => {});

    console.log('[Migration 003] Rolled back multi-tenancy');
};
