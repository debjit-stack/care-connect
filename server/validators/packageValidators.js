import { z } from 'zod';
import { validate, mongoId, positiveNumber } from './shared.js';

// ─── POST /packages ───────────────────────────────────────────────────────────
export const createPackageSchema = z.object({
    body: z.object({
        name: z
            .string({ required_error: 'Package name is required' })
            .trim()
            .min(2,   'Package name must be at least 2 characters')
            .max(200, 'Package name must be under 200 characters'),
        price: positiveNumber,
        details: z
            .string({ required_error: 'Details are required' })
            .trim()
            .min(10,  'Details must be at least 10 characters')
            .max(2000, 'Details must be under 2000 characters'),
    }),
});

// ─── PUT /packages/:id ────────────────────────────────────────────────────────
export const updatePackageSchema = z.object({
    params: z.object({ id: mongoId }),
    body: z.object({
        name: z
            .string()
            .trim()
            .min(2)
            .max(200)
            .optional(),
        price:   positiveNumber.optional(),
        details: z.string().trim().min(10).max(2000).optional(),
    }).refine(
        (d) => Object.values(d).some((v) => v !== undefined),
        { message: 'At least one field (name, price, details) must be provided' }
    ),
});

// ─── DELETE /packages/:id ─────────────────────────────────────────────────────
export const deletePackageSchema = z.object({
    params: z.object({ id: mongoId }),
});

export { validate };
