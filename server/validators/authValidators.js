import { z } from 'zod';
// M2 FIX (carried over): single validate() implementation, re-exported from
// shared.js rather than duplicated here.
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

// ─── Route schemas — OTP FEATURE: patient registration ────────────────────────

export const requestRegistrationOtpSchema = z.object({
    body: z.object({
        name:     nameSchema,
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

// ─── Re-export the single validate() implementation ───────────────────────────
export { validate };
