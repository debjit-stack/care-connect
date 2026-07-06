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

// PHASE3-3C FIX: previously missing entirely from settingsSchema. Since
// validate() (shared.js) rewrites req.body with the Zod-parsed result and
// this schema did not use .passthrough(), any `smtp` key sent by a client
// was silently dropped before it ever reached organisationController.js —
// there was no way to configure per-org SMTP through the API at all, even
// though mailer.js has read org.settings.smtp.* since the per-org email
// feature was built. Mirrors the field shape now declared on the
// Organisation model (see models/Organisation.js).
//
// `pass` intentionally has a generous but bounded max length (SMTP auth
// "passwords" for many providers are actually long API keys/app passwords,
// not short human passwords) and no other complexity requirements — it's a
// credential for an external system CareConnect doesn't control, not an
// account password subject to this app's own password policy.
const smtpSchema = z.object({
    host:   z.string().trim().min(1).max(255).nullable().optional(),
    port:   z.number().int().min(1).max(65535).optional(),
    secure: z.boolean().optional(),
    user:   z.string().trim().max(255).nullable().optional(),
    pass:   z.string().min(1).max(500).nullable().optional(),
    from:   z.string().trim().email('SMTP "from" must be a valid email address').nullable().optional(),
}).optional();

const settingsSchema = z.object({
    logoUrl:      z.string().url('Invalid logo URL').nullable().optional(),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex colour').optional(),
    timezone:     z.string().max(50).optional(),
    locale:       z.string().max(10).optional(),
    currency:     z.string().length(3, 'Currency must be a 3-letter ISO code').optional(),
    smtp:         smtpSchema,
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
