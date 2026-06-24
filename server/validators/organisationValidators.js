import { z } from 'zod';
import { validate, mongoId } from './shared.js';

const slugField = z
    .string({ required_error: 'Slug is required' })
    .trim()
    .toLowerCase()
    .min(3,   'Slug must be at least 3 characters')
    .max(63,  'Slug must be under 63 characters')
    .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens')
    .refine((s) => !s.startsWith('-') && !s.endsWith('-'), 'Slug cannot start or end with a hyphen');

const addressSchema = z.object({
    line1:   z.string().trim().max(200).optional(),
    city:    z.string().trim().max(100).optional(),
    state:   z.string().trim().max(100).optional(),
    pincode: z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits').optional(),
    country: z.string().trim().max(100).optional(),
}).optional();

const settingsSchema = z.object({
    logoUrl:      z.string().url('Invalid logo URL').nullable().optional(),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex colour').optional(),
    timezone:     z.string().max(50).optional(),
    locale:       z.string().max(10).optional(),
    currency:     z.string().length(3, 'Currency must be a 3-letter ISO code').optional(),
}).optional();

// ─── POST /api/organisations (super-admin only) ───────────────────────────────
export const createOrganisationSchema = z.object({
    body: z.object({
        name:         z.string({ required_error: 'Name is required' }).trim().min(2).max(200),
        slug:         slugField,
        contactEmail: z.string({ required_error: 'Contact email is required' }).email().toLowerCase(),
        contactPhone: z.string().trim().max(20).optional(),
        address:      addressSchema,
        plan:         z.enum(['trial', 'basic', 'pro', 'enterprise']).optional(),
        settings:     settingsSchema,
    }),
});

// ─── PUT /api/organisations/:id (super-admin or org-admin) ───────────────────
export const updateOrganisationSchema = z.object({
    params: z.object({ id: mongoId }),
    body: z.object({
        name:         z.string().trim().min(2).max(200).optional(),
        contactEmail: z.string().email().toLowerCase().optional(),
        contactPhone: z.string().trim().max(20).optional(),
        address:      addressSchema,
        settings:     settingsSchema,
        features: z.object({
            onlineBooking:  z.boolean().optional(),
            healthPackages: z.boolean().optional(),
            patientPortal:  z.boolean().optional(),
            analytics:      z.boolean().optional(),
            mfaRequired:    z.boolean().optional(),
        }).optional(),
    }).refine(
        (d) => Object.values(d).some((v) => v !== undefined),
        { message: 'At least one field must be provided' }
    ),
});

// ─── GET /api/organisations/:id ───────────────────────────────────────────────
export const getOrganisationSchema = z.object({
    params: z.object({ id: mongoId }),
});

export { validate };
