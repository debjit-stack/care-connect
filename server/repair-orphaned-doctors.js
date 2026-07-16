/**
 * repair-orphaned-doctors.js
 * ───────────────────────────
 * ONE-TIME data repair. Run once, review output, then discard.
 *
 * Finds every Doctor document that is NOT soft-deleted (deletedAt: null or
 * missing) whose linked User is either missing, soft-deleted, or no longer
 * has role: 'doctor' — i.e. every "orphaned" Doctor record of the exact
 * kind found in production (see chat: Doctor 6a37fba85104b84e1ea6ccca
 * linked to User 6a37fba75104b84e1ea6ccc8, whose role was silently
 * converted to 'patient' by the now-fixed registerPatient bug, while the
 * Doctor document itself was never soft-deleted).
 *
 * For each match, sets Doctor.deletedAt = now and cancels any of that
 * doctor's still-Scheduled appointments (mirrors what deleteUser's cascade
 * would have done at the time, had it fired correctly).
 *
 * Dry-run by default — pass --apply to actually write changes.
 *
 * Run with: node repair-orphaned-doctors.js --apply
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import { MongoClient, ObjectId } from 'mongodb';

const APPLY = process.argv.includes('--apply');

const client = new MongoClient(process.env.MONGO_URI);

try {
    await client.connect();
    const db = client.db();

    const doctors = db.collection('doctors');
    const users   = db.collection('users');
    const appointments = db.collection('appointments');

    const liveDoctors = await doctors
        .find({ $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] })
        .toArray();

    console.log(`[Repair] Scanning ${liveDoctors.length} non-deleted Doctor document(s)...`);

    let orphanedCount = 0;

    for (const doc of liveDoctors) {
        const user = await users.findOne({ _id: doc.user });

        const isOrphaned =
            !user ||
            !!user.deletedAt ||
            user.role !== 'doctor';

        if (!isOrphaned) continue;

        orphanedCount++;
        console.log('---');
        console.log(`[Repair] ORPHANED Doctor found: ${doc._id}`);
        console.log(`         linked user: ${doc.user} (${user ? `role=${user.role}, deletedAt=${user.deletedAt}` : 'USER NOT FOUND'})`);
        console.log(`         specialty: ${doc.specialty}`);

        if (!APPLY) {
            console.log('         [dry-run] would set deletedAt and cancel scheduled appointments');
            continue;
        }

        const now = new Date();

        const apptResult = await appointments.updateMany(
            { doctor: doc._id, status: 'Scheduled' },
            { $set: { status: 'Cancelled', notes: 'Cancelled: doctor account no longer active (data repair)' } }
        );

        await doctors.updateOne(
            { _id: doc._id },
            { $set: { deletedAt: now, updatedAt: now } }
        );

        console.log(`         ✓ soft-deleted Doctor, cancelled ${apptResult.modifiedCount} scheduled appointment(s)`);
    }

    console.log('===');
    console.log(`[Repair] ${orphanedCount} orphaned Doctor document(s) found.`);
    console.log(APPLY ? '[Repair] Changes applied.' : '[Repair] DRY RUN — re-run with --apply to write changes.');
} catch (err) {
    console.error(err);
} finally {
    await client.close();
}
