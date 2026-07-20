/**
 * server/migrations/007-membership-model.js
 * ─────────────────────────────────────────────
 * PHASE M2 — Membership model backfill.
 *
 * Creates exactly one Membership document for every existing User that has
 * an organisationId (i.e. every hospital-scoped user: admin, doctor,
 * receptionist, patient). super_admin users (organisationId: null) are
 * skipped entirely — they never have a Membership.
 *
 * Mapping from current User state to the new Membership:
 *   User.deletedAt == null   → Membership.status = 'active',   removedAt = null
 *   User.deletedAt != null   → Membership.status = 'removed',  removedAt = User.deletedAt
 *   User.role                → Membership.role (unchanged, same enum values)
 *   User.forceMfa            → Membership.forceMfa
 *   User.createdAt           → Membership.joinedAt
 *
 * Idempotent: upserts on the (userId, organisationId) unique key, so
 * re-running this migration is always safe and never creates duplicates.
 *
 * IMPORTANT: this migration is purely additive. It does not modify any
 * User document, does not touch the existing email_1_organisationId_1
 * index, and nothing in the running application reads the Membership
 * collection yet — that begins in Phase M3.
 *
 * Per MIGRATIONS.md conventions: schema baseline is currently Version 006.
 * This is migration 007, using the standalone-runner convention
 * established by 005/006 (see server/run-migration-007.js).
 *
 * Run with: node server/run-migration-007.js
 */

export const up = async (db) => {
    const users       = db.collection('users');
    const memberships = db.collection('memberships');

    // Ensure indexes exist before writing — matches the pattern already
    // used in migration 003 (creating indexes as part of the migration
    // itself, not relying solely on Mongoose's auto-index-on-connect,
    // since this script runs standalone via the native driver).
    await memberships.createIndex(
        { userId: 1, organisationId: 1 },
        { unique: true, name: 'userId_organisationId_unique' }
    );
    await memberships.createIndex(
        { organisationId: 1, role: 1, status: 1 },
        { name: 'org_role_status' }
    );
    await memberships.createIndex(
        { userId: 1, status: 1 },
        { name: 'userId_status' }
    );
    console.log('[Migration 007] Membership indexes ensured.');

    // Only org-scoped users get a Membership. super_admin (organisationId:
    // null) is explicitly excluded — see file header.
    const cursor = users.find({ organisationId: { $ne: null } });

    let created  = 0;
    let updated  = 0;
    let skipped  = 0;
    let scanned  = 0;

    while (await cursor.hasNext()) {
        const user = await cursor.next();
        scanned++;

        if (!user.organisationId || !user.role) {
            skipped++;
            continue;
        }

        const isDeleted = !!user.deletedAt;

        const membershipDoc = {
            userId:         user._id,
            organisationId: user.organisationId,
            role:           user.role,
            status:         isDeleted ? 'removed' : 'active',
            forceMfa:       user.forceMfa ?? false,
            joinedAt:       user.createdAt ?? new Date(),
            removedAt:      isDeleted ? user.deletedAt : null,
            invitedBy:      null,
            updatedAt:      new Date(),
        };

        const result = await memberships.updateOne(
            { userId: user._id, organisationId: user.organisationId },
            {
                $set: membershipDoc,
                $setOnInsert: { createdAt: new Date() },
            },
            { upsert: true }
        );

        if (result.upsertedCount > 0) created++;
        else updated++;
    }

    console.log('[Migration 007] Membership backfill complete.');
    console.log(`[Migration 007]   scanned org-scoped users : ${scanned}`);
    console.log(`[Migration 007]   memberships created      : ${created}`);
    console.log(`[Migration 007]   memberships already existed / updated : ${updated}`);
    console.log(`[Migration 007]   skipped (missing role/org): ${skipped}`);
    console.log('[Migration 007] Schema addition is now available at Version 007 baseline (Membership collection).');
    console.log('[Migration 007] NOTE: no application code reads from Membership yet — that begins in Phase M3.');
};

export const down = async (db) => {
    await db.collection('memberships').drop().catch(() => {
        console.log('[Migration 007] memberships collection did not exist — nothing to drop.');
    });
    console.log('[Migration 007] Rolled back — Membership collection dropped. No User documents were ever modified by this migration, so no User-side rollback is needed.');
};
