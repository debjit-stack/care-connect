/**
 * Migration: 001-auth-overhaul
 *
 * Adds new Phase 1 auth fields to all existing User documents.
 * Safe to run on a live database — uses $setOnInsert-style defaulting
 * so existing values are never overwritten.
 *
 * Run with: node migrations/001-auth-overhaul.js
 * Or via migrate-mongo: npx migrate-mongo up
 */

export const up = async (db) => {
    const users = db.collection('users');

    // Add new fields with defaults to all documents that don't have them yet
    await users.updateMany(
        { loginAttempts: { $exists: false } },
        {
            $set: {
                loginAttempts:     0,
                lockUntil:         null,
                passwordChangedAt: null,
                deletedAt:         null,
                mfaEnabled:        false,
                mfaSecret:         null,
            },
        }
    );

    console.log('[Migration 001] Users collection updated — auth fields added');

    // Create AuditLogs collection with TTL index if it doesn't exist
    const collections = await db.listCollections({ name: 'auditlogs' }).toArray();
    if (collections.length === 0) {
        await db.createCollection('auditlogs');
        await db.collection('auditlogs').createIndex(
            { createdAt: 1 },
            { expireAfterSeconds: 7 * 365 * 24 * 60 * 60 } // 7 years
        );
        await db.collection('auditlogs').createIndex({ actorId: 1, createdAt: -1 });
        await db.collection('auditlogs').createIndex({ action: 1,  createdAt: -1 });
        console.log('[Migration 001] AuditLogs collection + indexes created');
    }
};

export const down = async (db) => {
    // Reverse: remove the new fields (does not restore old data)
    await db.collection('users').updateMany(
        {},
        {
            $unset: {
                loginAttempts:     '',
                lockUntil:         '',
                passwordChangedAt: '',
                deletedAt:         '',
                mfaEnabled:        '',
                mfaSecret:         '',
            },
        }
    );
    await db.collection('auditlogs').drop().catch(() => {});
    console.log('[Migration 001] Rolled back');
};
