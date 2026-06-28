import { z } from 'zod';

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

// ─── Validation middleware factory ────────────────────────────────────────────

export const validate = (schema) => (req, res, next) => {
    const result = schema.safeParse({ body: req.body, params: req.params, query: req.query });

    if (!result.success) {
        const errors = result.error.issues.map((e) => ({
            field:   e.path.slice(1).join('.'),  // strip leading 'body'/'params'/'query'
            message: e.message,
        }));
        return res.status(400).json({
            message: 'Validation failed',
            errors,
        });
    }

    // Replace req.body with the cleaned/coerced values from Zod
    // req.body   = result.data.body   ?? req.body;
    // req.params = result.data.params ?? req.params;
    // req.query  = result.data.query  ?? req.query;
    if (result.data.body) {
    req.body = result.data.body;
    }

    if (result.data.params) {
        Object.assign(req.params, result.data.params);
    }

    if (result.data.query) {
        Object.assign(req.query, result.data.query);
    }

    next();
};
