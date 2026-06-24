import { z } from 'zod';
import { validate, mongoId, isoDate, timeHHMM } from './shared.js';

// ─── GET /doctors/:id  ────────────────────────────────────────────────────────
export const getDoctorByIdSchema = z.object({
    params: z.object({ id: mongoId }),
});

// ─── GET /doctors/:id/availability?date=YYYY-MM-DD ───────────────────────────
export const getDoctorAvailabilitySchema = z.object({
    params: z.object({ id: mongoId }),
    query:  z.object({
        date: isoDate,
    }),
});

// ─── GET /doctors/patient-history/:patientId ─────────────────────────────────
export const patientHistorySchema = z.object({
    params: z.object({ patientId: mongoId }),
});

// ─── PUT /doctors/appointments/:appointmentId ─────────────────────────────────
// Doctor updates notes/prescription/status after a consultation.
export const updateAppointmentSchema = z.object({
    params: z.object({
        appointmentId: mongoId,
    }),
    body: z.object({
        notes:        z.string().trim().max(5000, 'Notes cannot exceed 5000 characters').optional(),
        prescription: z.string().trim().max(5000, 'Prescription cannot exceed 5000 characters').optional(),
        status:       z.enum(['Scheduled', 'Completed', 'Cancelled']).optional(),
    }).refine(
        (d) => Object.keys(d).length > 0,
        { message: 'At least one field (notes, prescription, status) must be provided' }
    ),
});

// ─── PUT /doctors/my-availability ─────────────────────────────────────────────
// Array of { day, startTime, endTime } — only days with both times set are saved.
const dayScheduleSchema = z.object({
    day: z.enum([
        'Monday', 'Tuesday', 'Wednesday', 'Thursday',
        'Friday', 'Saturday', 'Sunday',
    ], { errorMap: () => ({ message: 'Invalid day of week' }) }),
    startTime: timeHHMM,
    endTime:   timeHHMM,
}).refine(
    (d) => d.startTime < d.endTime,
    { message: 'Start time must be before end time' }
);

export const updateMyAvailabilitySchema = z.object({
    body: z.object({
        availability: z
            .array(dayScheduleSchema)
            .max(7, 'Cannot have more than 7 day schedules')
            .refine(
                (arr) => {
                    const days = arr.map((d) => d.day);
                    return days.length === new Set(days).size;
                },
                { message: 'Duplicate days are not allowed' }
            ),
    }),
});

// ─── Exports ──────────────────────────────────────────────────────────────────
export {
    validate,
    getDoctorByIdSchema        as validateGetDoctorById,
    getDoctorAvailabilitySchema as validateGetAvailability,
    patientHistorySchema        as validatePatientHistory,
    updateAppointmentSchema     as validateUpdateAppointment,
    updateMyAvailabilitySchema  as validateMyAvailability,
};
