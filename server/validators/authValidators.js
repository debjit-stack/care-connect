import { z } from 'zod';
// M2 FIX: this file used to define its own copy of the validate() middleware
// factory, duplicating the one in shared.js. Two copies meant a fix applied
// to one (e.g. the earlier double-next() bug fix) could silently miss the
// other. There is now exactly one implementation, re-exported from here so
// existing imports (`import { validate } from './authValidators.js'`)
// continue to work unchanged.
import { validate } from './shared.js';

// ─── Reusable field definitions ───────────────────────────────────────────────

const emailSchema = z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Invalid email address');

const passwordSchema = z
    .string({ required_error: 'Password is required' })
    .min(8,  'Password must be at least 8 characters')
    .max(72, 'Password must be under 72 characters')  // bcrypt limit
    .regex(/[A-Z]/,        'Password must contain at least one uppercase letter')
    .regex(/[0-9]/,        'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

const nameSchema = z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(2,   'Name must be at least 2 characters')
    .max(100, 'Name must be under 100 characters')
    .regex(/^[a-zA-Z\s'-]+$/, 'Name may only contain letters, spaces, hyphens, and apostrophes');

// ─── Route schemas ────────────────────────────────────────────────────────────

export const registerSchema = z.object({
    body: z.object({
        name:     nameSchema,
        email:    emailSchema,
        password: passwordSchema,
    }),
});

export const loginSchema = z.object({
    body: z.object({
        email:    emailSchema,
        password: z.string({ required_error: 'Password is required' }).min(1),
    }),
});

export const changePasswordSchema = z.object({
    body: z.object({
        currentPassword: z.string({ required_error: 'Current password is required' }).min(1),
        newPassword:     passwordSchema,
    }).refine(
        (data) => data.currentPassword !== data.newPassword,
        { message: 'New password must be different from current password', path: ['newPassword'] }
    ),
});

// ─── Re-export the single validate() implementation ───────────────────────────
export { validate };
