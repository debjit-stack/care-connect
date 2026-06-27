/**
 * server/validators/mfaValidators.js
 * ────────────────────────────────────
 * Zod schemas for all MFA routes.
 */

import { z }        from 'zod';
import { validate } from './shared.js';

// 6-digit numeric TOTP token
const totpToken = z
    .string({ required_error: 'TOTP token is required' })
    .trim()
    .regex(/^\d{6}$/, 'TOTP token must be exactly 6 digits');

// ─── POST /api/auth/mfa/verify-setup ─────────────────────────────────────────
// Confirms the user's authenticator app is working before enabling MFA.
export const verifySetupSchema = z.object({
    body: z.object({
        token:  totpToken,
        secret: z
            .string({ required_error: 'Secret is required' })
            .trim()
            .min(16, 'Invalid secret'),
    }),
});

// ─── POST /api/auth/mfa/validate ─────────────────────────────────────────────
// Used during login when mfaEnabled = true.
export const validateMfaSchema = z.object({
    body: z.object({
        token:       totpToken,
        mfaPending:  z
            .string({ required_error: 'MFA pending token is required' })
            .trim()
            .min(1),
    }),
});

// ─── POST /api/auth/mfa/disable ──────────────────────────────────────────────
// Requires current password + valid TOTP before disabling.
export const disableMfaSchema = z.object({
    body: z.object({
        password: z.string({ required_error: 'Password is required' }).min(1),
        token:    totpToken,
    }),
});

export { validate };
