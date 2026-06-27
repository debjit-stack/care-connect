/**
 * server/routes/mfaRoutes.js
 * ───────────────────────────
 * All MFA routes require authentication (protect middleware).
 * The /validate endpoint is the exception — it uses a short-lived
 * mfa-pending token in the request body instead of a full access token,
 * so protect() is NOT applied there.
 */

import express from 'express';
import {
    setupMfa,
    verifySetup,
    validateMfa,
    disableMfa,
    getMfaStatus,
} from '../controllers/mfaController.js';
import { protect }  from '../middleware/authMiddleware.js';
import {
    validate,
    verifySetupSchema,
    validateMfaSchema,
    disableMfaSchema,
} from '../validators/mfaValidators.js';

const router = express.Router();

// Public (uses mfaPending token in body, not access token)
// Must be in PUBLIC_PATHS in tenantMiddleware
router.post('/validate', validate(validateMfaSchema), validateMfa);

// Protected — require full access token
router.get('/status',        protect, getMfaStatus);
router.get('/setup',         protect, setupMfa);
router.post('/verify-setup', protect, validate(verifySetupSchema), verifySetup);
router.post('/disable',      protect, validate(disableMfaSchema),  disableMfa);

export default router;
