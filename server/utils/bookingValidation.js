import Doctor from '../models/Doctor.js';
import { getCurrentOrgId } from '../plugins/tenantPlugin.js';

/**
 * validateBookingSlot
 * ───────────────────
 * C3 FIX: Shared server-side availability validator used by both
 * patientController and receptionistController.
 *
 * Checks:
 *   (a) appointmentDate is today or in the future
 *   (b) Doctor exists, is not soft-deleted (C4 FIX), AND belongs to the
 *       ambient tenant (PHASE3-3B FIX — see below)
 *   (c) The day of week is a working day for this doctor
 *   (d) The requested time slot falls within working hours
 *
 * PHASE3-3B FIX: the doctor lookup previously relied SOLELY on
 * tenantPlugin's implicit query-hook filtering (no explicit organisationId
 * check anywhere in this function) to prevent a doctorId from a different
 * organisation from ever being found here. That filtering is real and,
 * after Phase 1's tenant-binding enforcement, trustworthy for the request
 * lifecycles that actually reach this function today — this was not a live
 * exploitable gap. But it meant tenant isolation for one of the app's most
 * security-sensitive operations (booking an appointment) depended entirely
 * on every future caller remembering never to call this with
 * .skipTenantFilter() active or from outside a runWithTenant() context —
 * an easy thing for a future change to get wrong silently, since nothing
 * here would fail loudly if it did.
 *
 * This now does the lookup with .skipTenantFilter() explicitly (so it is
 * self-contained and correct regardless of ambient context) and adds an
 * explicit organisationId comparison. The 404 message is deliberately
 * identical to the "doctor doesn't exist at all" case — a cross-tenant
 * doctorId should be indistinguishable from a nonexistent one to the caller,
 * so this never becomes an oracle for probing which doctor IDs exist in
 * other organisations.
 *
 * @param {string} doctorId        — Doctor document _id
 * @param {string} appointmentDate — YYYY-MM-DD string (already Zod-validated)
 * @param {string} appointmentTime — "09:00 AM" format (already Zod-validated)
 * @returns {{ valid: true, doctor: object } | { valid: false, status: number, message: string }}
 */
export const validateBookingSlot = async (doctorId, appointmentDate, appointmentTime) => {
    // (a) Future-date check — compare UTC dates so timezone on server doesn't matter
    const bookingDate = new Date(`${appointmentDate}T00:00:00Z`);
    const now         = new Date();
    const today       = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    if (bookingDate < today) {
        return {
            valid:   false,
            status:  400,
            message: 'Appointment date must be today or in the future.',
        };
    }

    // (b) C4 FIX: check Doctor.deletedAt — soft-deleted doctors must not be bookable.
    // PHASE3-3B FIX: explicit .skipTenantFilter() + explicit organisationId
    // comparison — see function-level comment above.
    const doctor = await Doctor.findOne({ _id: doctorId, deletedAt: null }).skipTenantFilter().lean();
    if (!doctor) {
        return {
            valid:   false,
            status:  404,
            message: 'Doctor not found or no longer available.',
        };
    }

    const ambientOrgId = getCurrentOrgId();
    if (ambientOrgId && String(doctor.organisationId ?? '') !== String(ambientOrgId)) {
        // Deliberately the SAME message/status as "doctor doesn't exist" —
        // never reveal that a doctorId is valid in a different organisation.
        return {
            valid:   false,
            status:  404,
            message: 'Doctor not found or no longer available.',
        };
    }

    // (c) Working-day check
    const dayOfWeek = bookingDate.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const workHours = doctor.availability?.find(
        (a) => a.day.toLowerCase() === dayOfWeek.toLowerCase()
    );

    if (!workHours?.startTime || !workHours?.endTime) {
        return {
            valid:   false,
            status:  400,
            message: `This doctor is not available on ${dayOfWeek}s.`,
        };
    }

    // (d) Working-hours check
    // Slot arrives as "09:00 AM" (12-hour format from the slot picker).
    // Work hours are stored as "HH:MM" 24-hour strings.
    const toMinutes = (t) => {
        const match = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
        if (!match) return null;
        let [, h, m, period] = match;
        h = parseInt(h, 10);
        m = parseInt(m, 10);
        if (period.toUpperCase() === 'PM' && h !== 12) h += 12;
        if (period.toUpperCase() === 'AM' && h === 12) h = 0;
        return h * 60 + m;
    };

    const slotMin = toMinutes(appointmentTime);
    if (slotMin === null) {
        return { valid: false, status: 400, message: 'Invalid appointment time format.' };
    }

    const [startH, startM] = workHours.startTime.split(':').map(Number);
    const [endH,   endM]   = workHours.endTime.split(':').map(Number);
    const startMin = startH * 60 + startM;
    const endMin   = endH   * 60 + endM;

    if (slotMin < startMin || slotMin >= endMin) {
        return {
            valid:   false,
            status:  400,
            message: `The time ${appointmentTime} is outside this doctor's working hours (${workHours.startTime}–${workHours.endTime}).`,
        };
    }

    return { valid: true, doctor };
};
