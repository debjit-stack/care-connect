/**
 * server/migrations/009-global-email-uniqueness.js
 * ────────────────────────────────────────────────────
 * PHASE M7 — Cleanup (irreversible index change).
 *
 * This is the ONE irreversible step in the entire M1–M7 migration. Every
 * prior phase (M1–M6) was purely additive or backward-compatible. This
 * migration:
 *
 *   1. Re-runs the Phase M1 duplicate-email audit ONE MORE TIME,
 *      immediately before making any change — because M2 through M6 have
 *      been live in production for a while by this point, and new data
 *      (including any duplicate emails that could block this migration)
 *      may have been created since the original M1 audit. ABORTS with no
 *      changes made if any active cross-org duplicate is found — these
 *      MUST be resolved by hand (merge into one Identity + multiple
 *      Memberships) before this migration can be re-run successfully.
 *
 *   2. Drops the old compound unique index on users: { email: 1,
 *      organisationId: 1 } (named `email_organisationId_unique`, created
 *      by migration 003).
 *
 *   3. Creates the new global unique index: { email: 1 }.
 *
 * What this migration deliberately does NOT do:
 *   - Does NOT remove the User.role / User.organisationId FIELDS from
 *     existing documents. They remain as inert legacy/display data —
 *     removing them provides no correctness benefit (every authoritative
 *     read path was already switched to Membership in Phases M3/M5/M7-
 *     prerequisite) and physically stripping fields from millions of
 *     potential records is unnecessary risk for zero gain. If desired,
 *     that can be a separate, low-priority future cleanup — not part of
 *     this migration.
 *   - Does NOT touch the Doctor.user field (kept for the same reason,
 *     see Doctor.js Phase M4 comments).
 *
 * Run with: node server/run-migration-009.js
 *
 * SAFE TO RUN MULTIPLE TIMES: if the global index already exists, index
 * creation is a no-op; if the old index was already dropped, the drop
 * step is skipped gracefully.
 */

export const up = async (db) => {
    const users = db.collection('users');

    // ── Step 1: re-audit (same logic as M1's standalone script, inlined
    // here so this migration is fully self-contained and cannot be run
    // without the check that gates it). ──────────────────────────────────
    console.log('[Migration 009] Re-running duplicate-email audit before making any change...');

    const pipeline = [
        {
            $group: {
                _id:  { $toLower: '$email' },
                count: { $sum: 1 },
                docs: {
                    $push: {
                        _id:            '$_id',
                        organisationId: '$organisationId',
                        role:           '$role',
                        deletedAt:      '$deletedAt',
                    },
                },
            },
        },
        { $match: { count: { $gt: 1 } } },
    ];

    const groups = await users.aggregate(pipeline).toArray();

    const blockingGroups = groups.filter((g) => {
        const orgIds     = new Set(g.docs.map((d) => (d.organisationId ? d.organisationId.toString() : null)));
        const isCrossOrg = orgIds.size > 1;
        const allDeleted = g.docs.every((d) => !!d.deletedAt);
        // Same-org duplicates should be structurally impossible (the OLD
        // compound index already prevents them) — if one somehow exists,
        // treat it as blocking too, since it indicates something is
        // already wrong that must be understood before changing indexes.
        return (isCrossOrg && !allDeleted) || (!isCrossOrg && g.count > 1);
    });

    if (blockingGroups.length > 0) {
        console.error('[Migration 009] ABORTING — found duplicate emails that would violate the new global unique index:');
        blockingGroups.forEach((g) => {
            console.error(`  email: ${g._id}`);
            g.docs.forEach((d) => console.error(`    userId=${d._id} org=${d.organisationId} role=${d.role} deletedAt=${d.deletedAt}`));
        });
        console.error('[Migration 009] Resolve these manually (merge duplicate identities into one User with multiple Memberships) and re-run this migration.');
        console.error('[Migration 009] NO CHANGES WERE MADE.');
        throw new Error(`Migration 009 aborted: ${blockingGroups.length} blocking duplicate-email group(s) found.`);
    }

    console.log('[Migration 009] Audit clean — no blocking duplicates. Proceeding.');

    // ── Step 2: drop the old compound index ─────────────────────────────
    try {
        await users.dropIndex('email_organisationId_unique');
        console.log('[Migration 009] Dropped old index: email_organisationId_unique');
    } catch (err) {
        if (err.codeName === 'IndexNotFound') {
            console.log('[Migration 009] Old compound index not found — already dropped, continuing.');
        } else {
            throw err;
        }
    }

    // ── Step 3: create the new global unique index ──────────────────────
    //
    // IMPORTANT: unlike the earlier, cosmetic index-name collisions seen
    // in Phases M2/M4 (where an equivalent Mongoose-autoIndex-created
    // index under a default name was harmless to leave in place), this
    // step establishes the FINAL data-integrity guarantee the entire
    // M1–M7 migration exists to produce. If an index on { email: 1 }
    // already exists under a different name (e.g. `email_1`, likely
    // auto-created by Mongoose the first time the app connected against
    // an updated schema), this migration does NOT assume it's safe to
    // just skip past — it explicitly inspects that index's own options
    // and only proceeds if it is ALREADY unique. If a same-key index
    // exists but is NOT unique, that would mean global email uniqueness
    // is silently NOT being enforced — this migration aborts rather than
    // silently accepting that.
    const existingIndexes = await users.indexes();
    const existingEmailIndex = existingIndexes.find(
        (idx) => idx.key && Object.keys(idx.key).length === 1 && idx.key.email === 1
    );

    if (existingEmailIndex) {
        if (existingEmailIndex.unique) {
            console.log(`[Migration 009] An index on { email: 1 } already exists (name: "${existingEmailIndex.name}") and IS unique — global email uniqueness is already enforced. No further action needed.`);
        } else {
            console.error(`[Migration 009] ABORTING — an index on { email: 1 } already exists (name: "${existingEmailIndex.name}") but is NOT unique.`);
            console.error('[Migration 009] This means global email uniqueness is NOT currently enforced by the database.');
            console.error(`[Migration 009] Manual action required: drop this index with db.users.dropIndex("${existingEmailIndex.name}") after confirming no duplicate emails exist, then re-run this migration.`);
            throw new Error(`Migration 009 aborted: existing non-unique index "${existingEmailIndex.name}" on {email:1} blocks the required unique constraint.`);
        }
    } else {
        await users.createIndex(
            { email: 1 },
            { unique: true, name: 'email_global_unique' }
        );
        console.log('[Migration 009] Created new global unique index: email_global_unique');
    }

    console.log('[Migration 009] ✓ Complete. User.email is now globally unique across the entire platform.');
    console.log('[Migration 009] This is the final phase of the M1–M7 Identity/Membership migration.');
};

export const down = async (db) => {
    const users = db.collection('users');

    console.log('[Migration 009] Rolling back is only safe if no NEW cross-org-duplicate emails were created');
    console.log('[Migration 009] while the global unique index was active (which is exactly what it existed to prevent,');
    console.log('[Migration 009] so this should always be the case in practice).');

    await users.dropIndex('email_global_unique').catch(() => {});

    await users.createIndex(
        { email: 1, organisationId: 1 },
        { unique: true, name: 'email_organisationId_unique' }
    );

    console.log('[Migration 009] Rolled back — restored old compound (email, organisationId) unique index.');
};
