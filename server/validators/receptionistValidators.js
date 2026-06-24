import { z } from 'zod';
import { validate, mongoId, isoDate, emailField, nameField, passwordField } from './shared.js';

// ─── POST /receptionist/register-patient ─────────────────────────────────────
export const registerPatientSchema = z.object({
    body: z.object({
        name:     nameField,
        email:    emailField,
        password: passwordField,
    }),
});

// ─── POST /receptionist/book-appointment ─────────────────────────────────────
const appointmentTimeSchema = z
    .string({ required_error: 'Appointment time is required' })
    .regex(
        /^(0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i,
        'Appointment time must be in format "09:00 AM"'
    );

export const bookOfflineAppointmentSchema = z.object({
    body: z.object({
        patientId:       mongoId,
        doctorId:        mongoId,
        appointmentDate: isoDate,
        appointmentTime: appointmentTimeSchema,
    }),
});

// ─── POST /receptionist/book-package ─────────────────────────────────────────
export const bookPackageForPatientSchema = z.object({
    body: z.object({
        patientId: mongoId,
        packageId: mongoId,
    }),
});

// ─── GET /receptionist/search-patients?q= ────────────────────────────────────
// The raw regex injection fix lives here:
// q is stripped of all regex metacharacters before it ever touches MongoDB.
export const searchPatientsSchema = z.object({
    query: z.object({
        q: z
            .string({ required_error: 'Search query is required' })
            .trim()
            .min(1,   'Search query cannot be empty')
            .max(100, 'Search query is too long')
            // Escape all regex metacharacters — prevents ReDoS
            .transform((val) => val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    }),
});

// ─── GET /receptionist/appointments?date= ────────────────────────────────────
export const getAppointmentsByDateSchema = z.object({
    query: z.object({
        date: isoDate,
    }),
});

export { validate };
