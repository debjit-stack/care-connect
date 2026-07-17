import { z } from 'zod';
// B3 FIX: previously defined a LOCAL nameSchema here with regex
// /^[a-zA-Z\s'-]+$/, while shared.js's nameField uses /^[a-zA-Z\s''-]+$/
// (a different character class — note the curly-apostrophe variant). A name
// valid at registration could be rejected on profile update, or vice versa.
// Now importing the single nameField from shared.js so both use cases are
// governed by the exact same rule.
import { validate, nameField } from './shared.js';

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

const otpSchema = z
    .string({ required_error: 'Code is required' })
    .trim()
    .regex(/^\d{6}$/, 'Code must be exactly 6 digits');

const registrationIdSchema = z
    .string({ required_error: 'registrationId is required' })
    .trim()
    .uuid('Invalid registrationId format');

// ─── Route schemas — existing auth ────────────────────────────────────────────

export const registerSchema = z.object({
    body: z.object({
        name:     nameField,
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

// ─── Route schemas — OTP FEATURE: patient registration ────────────────────────

export const requestRegistrationOtpSchema = z.object({
    body: z.object({
        name:     nameField,
        email:    emailSchema,
        password: passwordSchema,
    }),
});

export const verifyRegistrationOtpSchema = z.object({
    body: z.object({
        registrationId: registrationIdSchema,
        otp:            otpSchema,
    }),
});

export const resendRegistrationOtpSchema = z.object({
    body: z.object({
        registrationId: registrationIdSchema,
    }),
});

// ─── Route schemas — OTP FEATURE: forgot password ─────────────────────────────

export const forgotPasswordSchema = z.object({
    body: z.object({
        email: emailSchema,
    }),
});

export const verifyForgotPasswordOtpSchema = z.object({
    body: z.object({
        email: emailSchema,
        otp:   otpSchema,
    }),
});

export const resetPasswordWithTokenSchema = z.object({
    body: z.object({
        resetToken:  z.string({ required_error: 'resetToken is required' }).trim().min(1),
        newPassword: passwordSchema,
    }),
});

// ─── A2: step-up (re)verification for sensitive actions ──────────────────────
// Accepts EITHER the caller's current password OR a 6-digit TOTP code — not
// both required, since a user without MFA enrolled has no TOTP to give, and
// a user WITH MFA enrolled can prove identity either way. At least one must
// be present. Deliberately reuses the same passwordSchema/otpSchema shape
// as login/MFA validation rather than a laxer "just check it's a string" —
// this is proving identity for a sensitive action, not a throwaway field.
export const stepUpVerifySchema = z.object({
    body: z.object({
        password: z.string({ invalid_type_error: 'Password must be a string' }).min(1).optional(),
        token:    z.string().trim().regex(/^\d{6}$/, 'Code must be exactly 6 digits').optional(),
    }).refine(
        (d) => Boolean(d.password) || Boolean(d.token),
        { message: 'Provide either your current password or a 6-digit authenticator code' }
    ),
});

// ─── Re-export the single validate() implementation ───────────────────────────
export { validate };
