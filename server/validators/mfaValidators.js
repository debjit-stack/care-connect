/**
 * server/validators/mfaValidators.js
 * ─────────────────────────────────────
 * Zod schemas for all MFA routes.
 * P3C: Added recoverSchema and regenerateCodesSchema.
 */

import { z }        from 'zod';
import { validate } from './shared.js';

// ── Shared: 6-digit TOTP token ────────────────────────────────────────────────
const totpToken = z
    .string({ required_error: 'TOTP token is required' })
    .trim()
    .regex(/^\d{6}$/, 'TOTP token must be exactly 6 digits');

// ── POST /api/auth/mfa/verify-setup ──────────────────────────────────────────
export const verifySetupSchema = z.object({
    body: z.object({
        token:   totpToken,
        setupId: z
            .string({ required_error: 'setupId is required' })
            .trim()
            .uuid('Invalid setupId format'),
    }),
});

// ── POST /api/auth/mfa/validate ───────────────────────────────────────────────
export const validateMfaSchema = z.object({
    body: z.object({
        token:      totpToken,
        mfaPending: z
            .string({ required_error: 'mfaPending token is required' })
            .trim()
            .min(1, 'mfaPending token is required'),
    }),
});

// ── POST /api/auth/mfa/disable ────────────────────────────────────────────────
export const disableMfaSchema = z.object({
    body: z.object({
        password: z.string({ required_error: 'Password is required' }).min(1),
        token:    totpToken,
    }),
});

// ── P3C: POST /api/auth/mfa/recover ──────────────────────────────────────────
// Recovery code is 8 uppercase alphanumeric chars, optionally with a dash
// in the middle (XXXX-XXXX format shown to user). Both formats accepted.
export const recoverSchema = z.object({
    body: z.object({
        code: z
            .string({ required_error: 'Recovery code is required' })
            .trim()
            .transform((v) => v.replace(/-/g, '').toUpperCase())
            .refine(
                (v) => /^[A-Z0-9]{8}$/.test(v),
                'Recovery code must be 8 alphanumeric characters (e.g. ABCD-1234)'
            ),
        mfaPending: z
            .string({ required_error: 'mfaPending token is required' })
            .trim()
            .min(1),
    }),
});

// ── P3C: POST /api/auth/mfa/regenerate-codes ─────────────────────────────────
// Requires current TOTP to prevent someone who just grabbed a session
// from silently regenerating (and thereby invalidating) all backup codes.
export const regenerateCodesSchema = z.object({
    body: z.object({
        token: totpToken,
    }),
});

export { validate };
