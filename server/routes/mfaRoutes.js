/**
 * server/routes/mfaRoutes.js
 * P3C: recover / regenerate-codes routes.
 * A2: /disable now requires a fresh step-up token (see requireStepUp).
 *
 * B7 -- investigated and NOT applying the originally suggested fix:
 * requireMfaPending expects the pending token as an `Authorization: Bearer`
 * header (that's how /setup and /verify-setup receive it, since GET /setup
 * has no body and /verify-setup's client call sets that header explicitly).
 * /recover -- like /validate -- receives `mfaPending` in the JSON request
 * BODY instead (see recoverSchema/validateMfaSchema, and the real client
 * call in api/mfa.js: `API.post('/auth/mfa/recover', { code, mfaPending })`).
 * Adding requireMfaPending to /recover would reject every legitimate
 * request with "Missing MFA session token", since the header it checks is
 * never sent. The body-based token IS still fully verified -- just inline
 * in mfaController.recoverWithCode via verifyMfaPendingToken(), exactly
 * like validateMfa does. This is intentional, consistent design between the
 * two body-token routes vs. the two header-token routes, not an oversight --
 * so the route wiring here is left as-is rather than "fixed" into a
 * breaking change.
 *
 * NOTE on requireStepUp vs requireMfaPending on /disable: these are two
 * different gates for two different moments. requireMfaPending (used by
 * /setup and /verify-setup) identifies a user who is not yet fully logged
 * in. requireStepUp (added here) applies to a user who IS fully logged in
 * and is about to take a sensitive, session-persistent action — turning
 * off their own MFA protection. disableMfa's handler body already checks
 * the submitted password AND TOTP token itself (see mfaController.js) —
 * requireStepUp does not replace that in-handler check, it adds a second,
 * independent layer: the caller must have ALSO passed a fresh step-up
 * challenge before the request is even allowed to reach the handler. This
 * closes the gap where a stolen live access token alone was sufficient to
 * reach the disableMfa handler and attempt the in-body checks at all.
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
import { requireStepUp }    from '../middleware/stepUpMiddleware.js';
import {
    validate,
    verifySetupSchema,
    validateMfaSchema,
    disableMfaSchema,
    recoverSchema,
    regenerateCodesSchema,
} from '../validators/mfaValidators.js';

const router = express.Router();

// -- Pending-token-in-BODY routes (mfaPending is a field in the JSON body) --
router.post('/validate',      validate(validateMfaSchema),  validateMfa);
router.post('/recover',       validate(recoverSchema), recoverWithCode);

// -- Pending-token-in-HEADER routes (Authorization: Bearer <mfaPending>) ---
router.post('/verify-setup',  requireMfaPending, validate(verifySetupSchema), verifySetup);
router.get('/setup',          requireMfaPending, setupMfa);

// -- Full-session routes (require valid access token) -----------------------
router.get('/status',                 protect, getMfaStatus);
router.post('/disable',               protect, requireStepUp, validate(disableMfaSchema),        disableMfa);
router.post('/regenerate-codes',      protect, validate(regenerateCodesSchema),   regenerateCodes);

export default router;
