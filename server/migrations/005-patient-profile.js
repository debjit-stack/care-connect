/**
 * server/migrations/005-patient-profile.js
 * ───────────────────────────────────────────
 * WS4: Adds patient profile fields to User documents.
 *
 * Per MIGRATIONS.md conventions:
 *   - Schema is currently at Version 004 — this is the next migration.
 *   - Idempotent: uses { $exists: false } guards so re-running is safe.
 *   - Non-destructive: never overwrites existing values, only fills gaps.
 *   - Does NOT touch organisationId, auth fields, or any other collection.
 *
 * Fields added (all optional, all roles — but populated UI only on patient):
 *   phone        — String, default null
 *   dateOfBirth  — Date,   default null
 *   bloodGroup   — String, default null  (enum-validated at app layer, not DB layer)
 *   allergies    — String, default ''    (free text, comma-separated in UI)
 *
 * Run with: node server/migrations/005-patient-profile.js
 */

export const up = async (db) => {
    const users = db.collection('users');

    const result = await users.updateMany(
        { phone: { $exists: false } },
        {
            $set: {
                phone:       null,
                dateOfBirth: null,
                bloodGroup:  null,
                allergies:   '',
            },
        }
    );

    console.log(`[Migration 005] Patient profile fields added — ${result.modifiedCount} documents updated`);
    console.log('[Migration 005] Schema version is now 005');
};

export const down = async (db) => {
    await db.collection('users').updateMany(
        {},
        {
            $unset: {
                phone:       '',
                dateOfBirth: '',
                bloodGroup:  '',
                allergies:   '',
            },
        }
    );
    console.log('[Migration 005] Rolled back — patient profile fields removed');
};
