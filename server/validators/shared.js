/**
 * shared.js
 * ─────────
 * Reusable Zod field definitions imported by every domain validator.
 * Single source of truth — change a rule here and it propagates everywhere.
 */

import { z } from 'zod';

// ─── Primitives ───────────────────────────────────────────────────────────────

export const mongoId = z
    .string({ required_error: 'ID is required' })
    .regex(/^[a-f\d]{24}$/i, 'Invalid ID format');

export const emailField = z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Invalid email address');

export const nameField = z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(2,   'Name must be at least 2 characters')
    .max(100, 'Name must be under 100 characters')
    .regex(/^[a-zA-Z\s''-]+$/, 'Name may only contain letters, spaces, hyphens, apostrophes');

export const passwordField = z
    .string({ required_error: 'Password is required' })
    .min(8,  'Password must be at least 8 characters')
    .max(72, 'Password must be under 72 characters')
    .regex(/[A-Z]/,        'Password must contain at least one uppercase letter')
    .regex(/[0-9]/,        'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

// ISO 8601 date string — e.g. "2024-12-25"
export const isoDate = z
    .string({ required_error: 'Date is required' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .refine((d) => !isNaN(Date.parse(d)), 'Date is not a valid calendar date');

// Time in "HH:MM" 24-hour format (availability start/end)
export const timeHHMM = z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be in HH:MM format (24-hour)');

// Positive integer for things like experience years, price
export const positiveInt = z
    .number({ invalid_type_error: 'Must be a number' })
    .int('Must be a whole number')
    .positive('Must be greater than zero');

export const positiveNumber = z
    .number({ invalid_type_error: 'Must be a number' })
    .positive('Must be greater than zero');

// ─── Reusable param schemas ───────────────────────────────────────────────────

export const idParam = z.object({
    params: z.object({ id: mongoId }),
});

// ─── validate() middleware factory ────────────────────────────────────────────
// FIX: removed the unreachable duplicate `next()` call that existed after
// the `return next()` statement at the end of the function.

export const validate = (schema) => (req, res, next) => {
    const result = schema.safeParse({
        body:   req.body,
        params: req.params,
        query:  req.query,
    });

    if (!result.success) {
        const errors = result.error.issues.map((e) => ({
            field:   e.path.slice(1).join('.'),
            message: e.message,
        }));
        return res.status(400).json({ message: 'Validation failed', errors });
    }

    if (result.data.body) {
        req.body = result.data.body;
    }

    if (result.data.params) {
        Object.assign(req.params, result.data.params);
    }

    if (result.data.query) {
        Object.assign(req.query, result.data.query);
    }

    return next();
};
