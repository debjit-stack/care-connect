/**
 * Migration: 002-appointment-uniqueness
 *
 * 1. Adds a unique compound index on Appointment (doctor + appointmentDate + appointmentTime)
 *    to prevent double-booking at the database level.
 *
 * 2. Adds deletedAt to HealthPackage for soft-delete support.
 *
 * IMPORTANT: Before running this migration, check for and resolve any existing
 * duplicate appointments:
 *
 *   db.appointments.aggregate([
 *     { $group: {
 *         _id: { doctor: "$doctor", date: "$appointmentDate", time: "$appointmentTime" },
 *         count: { $sum: 1 }, ids: { $push: "$_id" }
 *     }},
 *     { $match: { count: { $gt: 1 } } }
 *   ])
 *
 * If duplicates exist, manually cancel the extras before running this migration.
 */

export const up = async (db) => {
    const appointments = db.collection('appointments');

    // Partial unique index — only applies to non-cancelled appointments.
    // Two cancelled appointments on the same slot are allowed (historical records).
    await appointments.createIndex(
        {
            doctor:          1,
            appointmentDate: 1,
            appointmentTime: 1,
        },
        {
            unique:                true,
            partialFilterExpression: { status: { $ne: 'Cancelled' } },
            name: 'unique_active_appointment_slot',
        }
    );

    console.log('[Migration 002] Unique appointment slot index created');

    // Add deletedAt to HealthPackage
    await db.collection('healthpackages').updateMany(
        { deletedAt: { $exists: false } },
        { $set: { deletedAt: null } }
    );

    console.log('[Migration 002] HealthPackage soft-delete field added');
};

export const down = async (db) => {
    await db.collection('appointments').dropIndex('unique_active_appointment_slot');
    await db.collection('healthpackages').updateMany(
        {},
        { $unset: { deletedAt: '' } }
    );
    console.log('[Migration 002] Rolled back');
};
