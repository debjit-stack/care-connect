/**
 * server/routes/mfaRoutes.js
 * P3C: Added POST /recover and POST /regenerate-codes routes.
 * All existing routes preserved exactly.
 */

import express from 'express';
import {
    setupMfa,
    verifySetup,
    validateMfa,
    disableMfa,
    getMfaStatus,
    recoverWithCode,
    regenerateCodes,
} from '../controllers/mfaController.js';
import { protect }          from '../middleware/authMiddleware.js';
import {requireMfaPending}    from '../middleware/mfaPendingMiddleware.js';
import {
    validate,
    verifySetupSchema,
    validateMfaSchema,
    disableMfaSchema,
    recoverSchema,
    regenerateCodesSchema,
} from '../validators/mfaValidators.js';

const router = express.Router();

// ── Pending-token routes (use mfaPending JWT, not access token) ───────────────
// These are in tenantMiddleware PUBLIC_PATHS
router.post('/validate',      validate(validateMfaSchema),  validateMfa);
router.post('/verify-setup',  requireMfaPending, validate(verifySetupSchema), verifySetup);
router.get('/setup',          requireMfaPending, setupMfa);

// P3C: Recovery — also uses mfaPending (user has passed password but not TOTP)
router.post('/recover',       validate(recoverSchema), recoverWithCode);

// ── Full-session routes (require valid access token) ──────────────────────────
router.get('/status',                 protect, getMfaStatus);
router.post('/disable',               protect, validate(disableMfaSchema),        disableMfa);
router.post('/regenerate-codes',      protect, validate(regenerateCodesSchema),   regenerateCodes);

export default router;
