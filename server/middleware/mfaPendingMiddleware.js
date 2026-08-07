import User from '../models/User.js';
import { verifyMfaPendingToken } from '../utils/tokens.js';

/**
 * Middleware for MFA enrollment/verification before a full login session exists.
 *
 * Flow:
 * 1. User enters correct email/password
 * 2. Server returns mfaPending JWT
 * 3. Frontend sends:
 *
 *    Authorization: Bearer <mfaPending>
 *
 * 4. This middleware validates the short-lived token and loads the user.
 *
 * NOTE:
 * This middleware is ONLY for:
 *   - GET  /api/auth/mfa/setup
 *   - POST /api/auth/mfa/verify-setup
 *
 * It should NEVER replace the normal protect() middleware.
 *
 * PHASE M-follow-up FIX: also surfaces req.mfaOrgId, decoded from the
 * pending token's orgId claim (see tokens.js). Without this, the MFA
 * completion step for a multi-org identity had no way to know which
 * organisation's login attempt the eventual access token should be scoped
 * to — it would always fall back to whatever generateAccessToken(user)
 * derives from the (possibly stale, legacy) User.organisationId field.
 * null for super_admin / platform-login, matching that flow's lack of any
 * org context at all.
 */
export const requireMfaPending = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                message: 'Missing MFA session token.',
            });
        }

        const token = authHeader.split(' ')[1];

        let payload;

        try {
            payload = verifyMfaPendingToken(token);
        } catch {
            return res.status(401).json({
                message: 'MFA session expired. Please log in again.',
            });
        }

        const user = await User.findById(payload.id).skipTenantFilter();

        if (!user || user.deletedAt) {
            return res.status(401).json({
                message: 'User not found.',
            });
        }

        // Make the user (and org context) available to downstream controllers
        req.mfaUserId = user._id;
        req.mfaUser = user;
        req.mfaOrgId = payload.orgId || null;

        next();
    } catch (err) {
        console.error('[MFA Pending Middleware]', err);

        return res.status(500).json({
            message: 'Failed to validate MFA session.',
        });
    }
};
