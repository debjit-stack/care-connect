import { verifyStepUpToken } from '../utils/tokens.js';

/**
 * server/middleware/stepUpMiddleware.js
 * ────────────────────────────────────────
 * requireStepUp
 * ─────────────
 * Gates a sensitive action behind fresh proof of identity, independent of
 * how old the caller's access token is. Must run AFTER `protect` — it
 * reads req.user (already authenticated) and additionally requires a
 * short-lived (5 min) step-up token, obtained via
 * POST /api/auth/step-up/verify (password or TOTP), sent by the client as
 * the X-Step-Up-Token header.
 *
 * Distinct from mfaPendingMiddleware's requireMfaPending: that gate exists
 * BEFORE a full session exists (during login/enrollment) and identifies a
 * user who is not yet authenticated at all. This gate exists AFTER a full
 * session already exists, immediately before an action that deserves
 * fresher proof than "the access token is still valid" — e.g. disabling
 * MFA, changing the password, or an organisation's security policy.
 *
 * The response shape (`stepUpRequired: true`) is deliberately consistent
 * across all three failure modes below (missing/expired/mismatched token)
 * so the frontend can react uniformly — show the step-up prompt — without
 * needing to distinguish why the gate failed.
 */
export const requireStepUp = (req, res, next) => {
    const token = req.headers['x-step-up-token'];

    if (!token) {
        return res.status(401).json({
            message: 'This action requires recent identity verification.',
            stepUpRequired: true,
        });
    }

    let payload;
    try {
        payload = verifyStepUpToken(token);
    } catch {
        return res.status(401).json({
            message: 'Identity verification expired. Please verify again.',
            stepUpRequired: true,
        });
    }

    // A stolen/replayed step-up token issued for a different user must
    // never satisfy this gate for the current session, even if it's
    // otherwise well-formed and unexpired.
    if (!req.user || String(payload.id) !== String(req.user._id)) {
        return res.status(403).json({
            message: 'Identity verification does not match the current session.',
            stepUpRequired: true,
        });
    }

    next();
};
