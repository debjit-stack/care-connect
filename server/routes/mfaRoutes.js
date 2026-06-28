/**
 * server/routes/mfaRoutes.js
 * ───────────────────────────
 * MFA Routes
 *
 * Authentication modes:
 *
 * 1. mfaPending token
 *    Used during first-time MFA enrollment after password verification.
 *
 * 2. protect()
 *    Used after the user has a normal authenticated session.
 */

import express from 'express';

import {
    setupMfa,
    verifySetup,
    validateMfa,
    disableMfa,
    getMfaStatus,
} from '../controllers/mfaController.js';

import { protect } from '../middleware/authMiddleware.js';
import { requireMfaPending } from '../middleware/mfaPendingMiddleware.js';

import {
    validate,
    verifySetupSchema,
    validateMfaSchema,
    disableMfaSchema,
} from '../validators/mfaValidators.js';

const router = express.Router();

/**
 * ---------------------------------------------------------
 * Login MFA Validation
 *
 * User already has MFA enabled.
 * Password was verified.
 * Client submits:
 *
 * {
 *    token,
 *    mfaPending
 * }
 * ---------------------------------------------------------
 */
router.post(
    '/validate',
    validate(validateMfaSchema),
    validateMfa
);

/**
 * ---------------------------------------------------------
 * First-time MFA Setup
 *
 * Uses the short-lived mfaPending JWT.
 * No normal access token exists yet.
 * ---------------------------------------------------------
 */
router.get(
    '/setup',
    requireMfaPending,
    setupMfa
);

router.post(
    '/verify-setup',
    requireMfaPending,
    validate(verifySetupSchema),
    verifySetup
);

/**
 * ---------------------------------------------------------
 * Normal authenticated user routes
 * ---------------------------------------------------------
 */
router.get(
    '/status',
    protect,
    getMfaStatus
);

router.post(
    '/disable',
    protect,
    validate(disableMfaSchema),
    disableMfa
);

export default router;