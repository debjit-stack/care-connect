/**
 * m1-audit-duplicate-emails.js
 * ──────────────────────────────
 * PHASE M1 — Identity model prep.
 *
 * READ-ONLY. Makes zero writes to the database. Safe to run against
 * production at any time, any number of times.
 *
 * Purpose:
 *   The eventual M7 cleanup phase replaces the current
 *   { email, organisationId } compound unique index on `users` with a
 *   GLOBAL { email } unique index — because the whole point of the
 *   Identity/Membership split is that one email = one identity, full stop,
 *   regardless of how many organisations that identity has a relationship
 *   with.
 *
 *   That only works if no two DIFFERENT identities in the current database
 *   already share an email across different organisations. Today's schema
 *   permits this (scenario 4 in the architecture doc: "patient visits
 *   Hospital A, later wants to register at Hospital B" — if that ever
 *   *succeeded* under some historical code path, or if any other route to
 *   duplicate same-email-different-org rows existed), and if it happened,
 *   those rows must be identified and merged (by hand — this is a data
 *   decision, not something to automate) BEFORE M7 can run.
 *
 * What this script does:
 *   1. Groups all `users` documents by lowercased email.
 *   2. Reports any email shared by more than one document.
 *   3. For each such group, shows enough detail (org, role, deletedAt,
 *      createdAt) for a human to decide: are these the same real person
 *      who needs merging under the new Membership model, or are they two
 *      genuinely different people who happen to share an email (which
 *      itself would need a business decision — e.g. shared family email,
 *      data entry error)?
 *   4. Writes a JSON report to disk (not to the database) for review.
 *
 * This script does NOT decide anything and does NOT modify anything.
 * It exists purely to make M7's risk visible now, at the start of the
 * project, rather than six phases in.
 *
 * Run with: node m1-audit-duplicate-emails.js
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URI);

const REPORT_PATH = path.join(__dirname, 'm1-duplicate-email-report.json');

try {
    await client.connect();
    const db = client.db();
    const users = db.collection('users');
    const organisations = db.collection('organisations');

    console.log('[M1 Audit] Scanning users collection for duplicate emails across organisations...');

    // Group by lowercased email, collect every document in each group.
    const pipeline = [
        {
            $group: {
                _id: { $toLower: '$email' },
                count: { $sum: 1 },
                docs: {
                    $push: {
                        _id:            '$_id',
                        organisationId: '$organisationId',
                        role:           '$role',
                        deletedAt:      '$deletedAt',
                        createdAt:      '$createdAt',
                        name:           '$name',
                    },
                },
            },
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
    ];

    const groups = await users.aggregate(pipeline).toArray();

    console.log(`[M1 Audit] Total distinct emails with more than one User document: ${groups.length}`);

    if (groups.length === 0) {
        console.log('[M1 Audit] ✓ No duplicate emails found. M7 (global unique index) is safe to run once earlier phases complete.');
    }

    // Resolve org names for readability in the report.
    const orgCache = new Map();
    const resolveOrgName = async (orgId) => {
        if (!orgId) return '(no organisation / super_admin)';
        const key = orgId.toString();
        if (orgCache.has(key)) return orgCache.get(key);
        const org = await organisations.findOne({ _id: orgId }, { projection: { name: 1, slug: 1 } });
        const label = org ? `${org.name} (${org.slug})` : `(org not found: ${key})`;
        orgCache.set(key, label);
        return label;
    };

    const report = {
        generatedAt: new Date().toISOString(),
        totalDuplicateEmailGroups: groups.length,
        groups: [],
    };

    let sameOrgDuplicates = 0;      // shouldn't be possible given the current compound index, flagged if found
    let crossOrgDuplicates = 0;     // the case M7 actually needs to worry about
    let allDeletedGroups = 0;       // duplicates where every row is already soft-deleted — lower priority

    for (const g of groups) {
        const orgIds = new Set(g.docs.map((d) => (d.organisationId ? d.organisationId.toString() : null)));
        const isCrossOrg = orgIds.size > 1;
        const allDeleted = g.docs.every((d) => !!d.deletedAt);

        if (isCrossOrg) crossOrgDuplicates++;
        else sameOrgDuplicates++;
        if (allDeleted) allDeletedGroups++;

        const enrichedDocs = [];
        for (const d of g.docs) {
            enrichedDocs.push({
                userId:        d._id.toString(),
                organisation:  await resolveOrgName(d.organisationId),
                role:          d.role,
                deletedAt:     d.deletedAt ?? null,
                createdAt:     d.createdAt,
                name:          d.name,
            });
        }

        report.groups.push({
            email:          g._id,
            documentCount:  g.count,
            crossOrg:       isCrossOrg,
            allSoftDeleted: allDeleted,
            recommendation: isCrossOrg
                ? (allDeleted
                    ? 'Low priority — all rows already soft-deleted. Still must be resolved before M7, but not urgent.'
                    : 'ACTION REQUIRED before M7 — decide: merge into one Identity with multiple Memberships, or these are genuinely different people and one must be re-emailed.')
                : 'Unexpected — same org, same email, multiple documents. Should not be possible under the current unique index. Investigate directly.',
            documents: enrichedDocs,
        });
    }

    report.summary = {
        crossOrgDuplicateGroups: crossOrgDuplicates,
        sameOrgDuplicateGroups_unexpected: sameOrgDuplicates,
        groupsWhereAllRowsAlreadyDeleted: allDeletedGroups,
        groupsNeedingActiveDecision: crossOrgDuplicates - allDeletedGroups + sameOrgDuplicates,
    };

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

    console.log('===');
    console.log(`[M1 Audit] Cross-org duplicate email groups: ${crossOrgDuplicates}`);
    console.log(`[M1 Audit]   ...of which all rows already soft-deleted (lower priority): ${allDeletedGroups}`);
    console.log(`[M1 Audit]   ...of which at least one row is ACTIVE (needs a decision before M7): ${crossOrgDuplicates - allDeletedGroups}`);
    console.log(`[M1 Audit] Unexpected same-org duplicate groups: ${sameOrgDuplicates}`);
    console.log(`[M1 Audit] Full report written to: ${REPORT_PATH}`);
    console.log('[M1 Audit] This script made no changes to the database.');
} catch (err) {
    console.error('[M1 Audit] Failed:', err);
    process.exitCode = 1;
} finally {
    await client.close();
}
