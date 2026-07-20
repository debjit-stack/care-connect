/**
 * server/migrations/008-doctor-membership-link.js
 * ───────────────────────────────────────────────────
 * PHASE M4 — Doctor migration.
 *
 * Backfills Doctor.membershipId for every existing Doctor document, by
 * matching (Doctor.user, Doctor.organisationId) to the corresponding
 * Membership created in Phase M2's backfill (migration 007).
 *
 * This is additive and non-destructive: Doctor.user is left completely
 * untouched (still required, still populated) — this migration only ADDS
 * the membershipId field. Nothing is removed until Phase M7.
 *
 * Idempotent: only ever sets membershipId, never overwrites an existing
 * non-null value, so re-running is always safe.
 *
 * Prerequisite: migration 007 (Membership backfill) must have already run.
 * This migration will report — but not silently skip — any Doctor document
 * for which no matching Membership can be found; those need investigation
 * (most likely: a Doctor document whose User was already role-converted
 * away from 'doctor' before Phase M2's backfill ran, i.e. exactly the
 * orphaned-Doctor class of bug fixed earlier in this project — see
 * repair-orphaned-doctors.js, which should be run BEFORE this migration if
 * it hasn't been already).
 *
 * Run with: node server/run-migration-008.js
 */

export const up = async (db) => {
    const doctors     = db.collection('doctors');
    const memberships = db.collection('memberships');

    console.log('[Migration 008] Starting Doctor → Membership backfill...');

    const cursor = doctors.find({
        $or: [{ membershipId: null }, { membershipId: { $exists: false } }],
    });

    let scanned      = 0;
    let linked       = 0;
    let alreadySet   = 0;
    let unmatched    = 0;
    const unmatchedDocs = [];

    while (await cursor.hasNext()) {
        const doc = await cursor.next();
        scanned++;

        if (!doc.user || !doc.organisationId) {
            unmatched++;
            unmatchedDocs.push({ doctorId: doc._id, reason: 'missing user or organisationId on Doctor doc' });
            continue;
        }

        const membership = await memberships.findOne({
            userId:         doc.user,
            organisationId: doc.organisationId,
            role:           'doctor',
        });

        if (!membership) {
            unmatched++;
            unmatchedDocs.push({
                doctorId:       doc._id,
                userId:         doc.user,
                organisationId: doc.organisationId,
                reason:         'no matching Membership found (role=doctor) — investigate before Phase M7',
            });
            continue;
        }

        await doctors.updateOne(
            { _id: doc._id },
            { $set: { membershipId: membership._id, updatedAt: new Date() } }
        );
        linked++;
    }

    // Ensure the new sparse unique index exists (matches Doctor.js schema).
    // Tolerant of IndexOptionsConflict (code 85) / IndexKeySpecsConflict
    // (code 86): these mean an index on the same key pattern already
    // exists under a different name — most likely Mongoose's own
    // autoIndex-on-connect already created it (with its default
    // `membershipId_1` name) the first time the app server started up
    // against the updated Doctor.js schema, ahead of this migration
    // running. That index is functionally equivalent (unique + sparse on
    // membershipId) — there is no need for this migration to also have its
    // own identically-scoped index under a different name, so this is
    // safe to treat as "already satisfied" rather than a real failure.
    try {
        await doctors.createIndex(
            { membershipId: 1 },
            { unique: true, sparse: true, name: 'membershipId_unique_sparse' }
        );
    } catch (err) {
        if (err.code === 85 || err.code === 86) {
            console.log('[Migration 008] An equivalent membershipId index already exists (likely created by Mongoose on app startup) — skipping, this is not an error.');
        } else {
            throw err;
        }
    }

    console.log('[Migration 008] Backfill complete.');
    console.log(`[Migration 008]   scanned                : ${scanned}`);
    console.log(`[Migration 008]   linked to Membership    : ${linked}`);
    console.log(`[Migration 008]   already had membershipId: ${alreadySet}`);
    console.log(`[Migration 008]   UNMATCHED (needs review): ${unmatched}`);

    if (unmatchedDocs.length > 0) {
        console.log('[Migration 008] --- Unmatched Doctor documents (review before Phase M7) ---');
        unmatchedDocs.forEach((d) => console.log('  ', JSON.stringify(d)));
    }

    console.log('[Migration 008] NOTE: doctorController self-service routes still fall back to');
    console.log('[Migration 008] Doctor.user lookups for any request without a membershipId claim');
    console.log('[Migration 008] on its access token — see doctorController.js Phase M4 comments.');
};

export const down = async (db) => {
    await db.collection('doctors').updateMany(
        {},
        { $unset: { membershipId: '' } }
    );
    await db.collection('doctors').dropIndex('membershipId_unique_sparse').catch(() => {});
    console.log('[Migration 008] Rolled back — membershipId removed from all Doctor documents.');
};
