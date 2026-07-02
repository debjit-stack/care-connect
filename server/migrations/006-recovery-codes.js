/**
 * server/migrations/006-recovery-codes.js
 * ─────────────────────────────────────────
 * P3C: Adds recoveryCodes array to User documents.
 *
 * Per MIGRATIONS.md conventions:
 *   - Schema is at Version 005 after WS4 — this is the next migration.
 *   - Idempotent: { $exists: false } guard prevents double-running.
 *   - Non-destructive: only adds the field, never modifies existing data.
 *   - Recovery codes are generated fresh when each user enables MFA.
 *     This migration only ensures the field exists with an empty default.
 *
 * Run with: node server/run-migration-006.js
 */

export const up = async (db) => {
    const result = await db.collection('users').updateMany(
        { recoveryCodes: { $exists: false } },
        { $set: { recoveryCodes: [] } }
    );
    console.log(`[Migration 006] recoveryCodes field added — ${result.modifiedCount} documents updated`);
    console.log('[Migration 006] Schema version is now 006');
};

export const down = async (db) => {
    await db.collection('users').updateMany(
        {},
        { $unset: { recoveryCodes: '' } }
    );
    console.log('[Migration 006] Rolled back — recoveryCodes field removed');
};
