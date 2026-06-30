import { z } from 'zod';
import { validate, mongoId, isoDate, nameField } from './shared.js';

// ─── POST /patient/book-appointment ──────────────────────────────────────────
const appointmentTimeSchema = z
    .string({ required_error: 'Appointment time is required' })
    .regex(
        /^(0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i,
        'Appointment time must be in format "09:00 AM"'
    );

export const bookAppointmentSchema = z.object({
    body: z.object({
        doctorId:        mongoId,
        appointmentDate: isoDate,
        appointmentTime: appointmentTimeSchema,
        type:            z.enum(['Online', 'Offline'], {
            errorMap: () => ({ message: 'Type must be Online or Offline' }),
        }),
    }),
});

// ─── POST /patient/book-package ───────────────────────────────────────────────
export const bookPackageSchema = z.object({
    body: z.object({
        packageId: mongoId,
    }),
});

// ─── WS4: PUT /patient/profile ────────────────────────────────────────────────
// All fields optional — patient can update any subset.
const phoneField = z
    .string()
    .trim()
    .regex(/^[\d\s+()-]{7,20}$/, 'Please enter a valid phone number')
    .optional()
    .or(z.literal(''));

const dateOfBirthField = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format')
    .refine((d) => !isNaN(Date.parse(d)), 'Invalid date')
    .refine((d) => new Date(d) <= new Date(), 'Date of birth cannot be in the future')
    .refine((d) => new Date(d) >= new Date('1900-01-01'), 'Please enter a valid date of birth')
    .optional()
    .or(z.literal(''));

const bloodGroupField = z
    .enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], {
        errorMap: () => ({ message: 'Please select a valid blood group' }),
    })
    .optional()
    .or(z.literal(''));

const allergiesField = z
    .string()
    .trim()
    .max(500, 'Allergies field cannot exceed 500 characters')
    .optional()
    .or(z.literal(''));

export const updateProfileSchema = z.object({
    body: z.object({
        name:        nameField.optional(),
        phone:       phoneField,
        dateOfBirth: dateOfBirthField,
        bloodGroup:  bloodGroupField,
        allergies:   allergiesField,
    }).refine(
        (d) => Object.values(d).some((v) => v !== undefined),
        { message: 'At least one field must be provided' }
    ),
});

// ─── WS4: DELETE /patient/appointments/:id ────────────────────────────────────
export const cancelAppointmentSchema = z.object({
    params: z.object({
        id: mongoId,
    }),
});

export { validate };
