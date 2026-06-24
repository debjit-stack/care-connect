import { z } from 'zod';
import {
    validate,
    mongoId,
    emailField,
    nameField,
    passwordField,
    positiveInt,
    timeHHMM,
} from './shared.js';

// ─── POST /admin/doctors ──────────────────────────────────────────────────────
export const createDoctorSchema = z.object({
    body: z.object({
        name:            nameField,
        email:           emailField,
        password:        passwordField,
        specialty:       z
            .string({ required_error: 'Specialty is required' })
            .trim()
            .min(2,   'Specialty must be at least 2 characters')
            .max(100, 'Specialty must be under 100 characters'),
        qualifications:  z
            .string()
            .trim()
            .max(500, 'Qualifications must be under 500 characters')
            .optional(),
        experienceYears: z
            .number({ invalid_type_error: 'Experience years must be a number' })
            .int()
            .min(0,  'Experience years cannot be negative')
            .max(60, 'Experience years seems too high')
            .optional(),
    }),
});

// ─── POST /admin/staff ────────────────────────────────────────────────────────
export const createStaffSchema = z.object({
    body: z.object({
        name:     nameField,
        email:    emailField,
        password: passwordField,
        role:     z.enum(['receptionist', 'admin'], {
            errorMap: () => ({ message: 'Role must be receptionist or admin' }),
        }),
    }),
});

// ─── PUT /admin/users/:id ─────────────────────────────────────────────────────
export const updateUserSchema = z.object({
    params: z.object({ id: mongoId }),
    body: z.object({
        name:  nameField.optional(),
        email: emailField.optional(),
    }).refine(
        (d) => d.name !== undefined || d.email !== undefined,
        { message: 'At least one field (name, email) must be provided' }
    ),
});

// ─── PUT /admin/users/:id/reset-password ─────────────────────────────────────
export const resetPasswordSchema = z.object({
    params: z.object({ id: mongoId }),
    body: z.object({
        newPassword: passwordField,
    }),
});

// ─── PUT /admin/doctors/:id ───────────────────────────────────────────────────
const dayScheduleSchema = z.object({
    day: z.enum([
        'Monday', 'Tuesday', 'Wednesday', 'Thursday',
        'Friday', 'Saturday', 'Sunday',
    ]),
    startTime: timeHHMM,
    endTime:   timeHHMM,
}).refine(
    (d) => d.startTime < d.endTime,
    { message: 'Start time must be before end time' }
);

export const updateDoctorProfileSchema = z.object({
    params: z.object({ id: mongoId }),
    body: z.object({
        specialty:       z.string().trim().min(2).max(100).optional(),
        qualifications:  z.string().trim().max(500).optional(),
        experienceYears: z.number().int().min(0).max(60).optional(),
        availability:    z
            .array(dayScheduleSchema)
            .max(7)
            .refine(
                (arr) => {
                    const days = arr.map((d) => d.day);
                    return days.length === new Set(days).size;
                },
                { message: 'Duplicate days are not allowed' }
            )
            .optional(),
    }).refine(
        (d) => Object.values(d).some((v) => v !== undefined),
        { message: 'At least one field must be provided' }
    ),
});

// ─── GET /admin/users?role= ───────────────────────────────────────────────────
export const getUsersSchema = z.object({
    query: z.object({
        role: z
            .enum(['patient', 'doctor', 'receptionist', 'admin'])
            .optional(),
    }),
});

export { validate };
