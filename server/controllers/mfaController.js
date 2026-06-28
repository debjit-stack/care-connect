/**
 * server/controllers/mfaController.js
 * ─────────────────────────────────────
 * Handles all TOTP MFA operations.
 *
 * Login flow when MFA is enabled:
 *   1. POST /api/auth/login  → password correct + mfaEnabled
 *      → returns { mfaPending: <short-lived JWT>, mfaRequired: true }
 *      → does NOT set refresh cookie or return full accessToken yet
 *   2. POST /api/auth/mfa/validate  → { token: "123456", mfaPending: "..." }
 *      → TOTP verified → returns { accessToken, user } + sets refresh cookie
 *
 * Setup flow:
 *   1. GET  /api/auth/mfa/setup       → generates secret + QR code
 *   2. POST /api/auth/mfa/verify-setup → confirms TOTP works → enables MFA
 *
 * Disable flow:
 *   POST /api/auth/mfa/disable → current password + valid TOTP → disables MFA
 */

import User      from '../models/User.js';
import audit     from '../utils/audit.js';
import {
    generateSecret,
    verifyToken,
    encryptSecret,
    decryptSecret,
} from '../utils/totp.js';
import {
    generateAccessToken,
    generateRefreshToken,
    setRefreshCookie,
    verifyMfaPendingToken,
} from '../utils/tokens.js';
import {
    createMfaSetupSession,
    getMfaSetupSession,
    deleteMfaSetupSession,
} from '../utils/mfaSetupStore.js';

// ─── GET /api/auth/mfa/setup ──────────────────────────────────────────────────
// Generates a temporary MFA setup session.
// The secret is stored in Redis for 5 minutes and is NOT persisted to MongoDB
// until verify-setup succeeds.
export const setupMfa = async (req, res) => {
    try {
        const user = await User.findById(req.mfaUserId).skipTenantFilter();

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.mfaEnabled) {
            return res.status(400).json({ message: 'MFA is already enabled.' });
        }

        // Generate new TOTP secret
        const { secret, otpauthUrl, qrDataUri } = await generateSecret(user.email);

        // Store temporary secret in Redis (expires in 5 minutes)
        const { setupId, expiresIn } = await createMfaSetupSession(user._id, secret);

        audit(req, 'AUTH_MFA_SETUP_STARTED', {
            actorId:      user._id,
            actorRole:    user.role,
            resourceType: 'User',
            resourceId:   user._id,
        });

        return res.json({ setupId, qrDataUri, otpauthUrl, expiresIn });
    } catch (err) {
        console.error('[MFA] setupMfa:', err);
        return res.status(500).json({ message: 'Failed to generate MFA setup.' });
    }
};

// ─── POST /api/auth/mfa/verify-setup ─────────────────────────────────────────
// Confirms the user's authenticator app is configured correctly.
// Encrypts and saves the secret, sets mfaEnabled = true, and issues a full
// authenticated session so the user lands directly on their dashboard.
//
// FIX: removed the dead `res.json(...)` call that appeared after a completed
// `return res.json(...)` inside the try block — it was unreachable and caused
// confusion about the actual response path.
export const verifySetup = async (req, res) => {
    try {
        const { token, setupId } = req.body;

        const user = await User.findById(req.mfaUserId).skipTenantFilter();
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (user.mfaEnabled) {
            // Clean up any stale setup session
            if (setupId) await deleteMfaSetupSession(setupId).catch(() => {});
            return res.status(400).json({ message: 'MFA is already enabled.' });
        }

        // Retrieve the temporary secret from Redis
        const setupSession = await getMfaSetupSession(setupId);

        if (!setupSession) {
            return res.status(400).json({
                message: 'MFA setup session expired. Please scan the QR code again.',
            });
        }

        if (setupSession.userId !== user._id.toString()) {
            return res.status(403).json({ message: 'Invalid MFA setup session.' });
        }

        // Verify the TOTP token against the temporary secret
        const isValid = verifyToken(setupSession.secret, token);

        if (!isValid) {
            return res.status(401).json({
                message: 'Invalid code. Please check your authenticator app and try again.',
            });
        }

        // Persist MFA configuration — encrypt secret before saving
        user.mfaSecret  = encryptSecret(setupSession.secret);
        user.mfaEnabled = true;
        await user.save();

        // Clean up Redis setup session
        await deleteMfaSetupSession(setupId).catch(() => {});

        audit(req, 'AUTH_MFA_SETUP_COMPLETED', {
            actorId:      user._id,
            actorRole:    user.role,
            resourceType: 'User',
            resourceId:   user._id,
        });

        // Issue a full authenticated session so the user lands on the dashboard
        const accessToken  = generateAccessToken(user);
        const refreshToken = await generateRefreshToken(user._id);
        setRefreshCookie(res, refreshToken);

        audit(req, 'AUTH_LOGIN_SUCCESS', {
            actorId:   user._id,
            actorRole: user.role,
            meta:      { method: 'mfa_setup' },
        });

        return res.json({
            message: 'MFA enabled successfully.',
            accessToken,
            user: {
                _id:        user._id,
                name:       user.name,
                email:      user.email,
                role:       user.role,
                mfaEnabled: user.mfaEnabled,
                forceMfa:   user.forceMfa ?? false,
            },
        });
    } catch (err) {
        console.error('[MFA] verifySetup:', err.message);
        return res.status(500).json({ message: 'Failed to enable MFA. Please try again.' });
    }
};

// ─── POST /api/auth/mfa/validate ─────────────────────────────────────────────
// Step 2 of login when mfaEnabled = true.
// Validates the TOTP token, issues full access + refresh tokens.
export const validateMfa = async (req, res) => {
    try {
        const { token, mfaPending } = req.body;

        // Verify the short-lived MFA-pending JWT
        let pending;
        try {
            pending = verifyMfaPendingToken(mfaPending);
        } catch {
            return res.status(401).json({
                message: 'MFA session expired. Please log in again.',
            });
        }

        const user = await User
            .findById(pending.id)
            .select('+mfaSecret')
            .skipTenantFilter();

        if (!user || user.deletedAt) {
            return res.status(401).json({ message: 'User not found.' });
        }

        if (!user.mfaEnabled || !user.mfaSecret) {
            return res.status(400).json({ message: 'MFA is not set up for this account.' });
        }

        // Decrypt stored secret and verify token
        const plainSecret = decryptSecret(user.mfaSecret);
        const isValid     = verifyToken(plainSecret, token);

        if (!isValid) {
            audit(req, 'AUTH_LOGIN_FAILED', {
                actorId:   user._id,
                actorRole: user.role,
                success:   false,
                meta:      { reason: 'invalid_totp' },
            });
            return res.status(401).json({
                message: 'Invalid TOTP token. Please try again.',
            });
        }

        // TOTP verified — issue full session tokens
        const accessToken  = generateAccessToken(user);
        const refreshToken = await generateRefreshToken(user._id);
        setRefreshCookie(res, refreshToken);

        audit(req, 'AUTH_LOGIN_SUCCESS', {
            actorId:   user._id,
            actorRole: user.role,
            meta:      { method: 'mfa_totp' },
        });

        return res.json({
            accessToken,
            user: {
                _id:        user._id,
                name:       user.name,
                email:      user.email,
                role:       user.role,
                mfaEnabled: user.mfaEnabled,
            },
        });
    } catch (err) {
        console.error('[MFA] validateMfa:', err.message);
        return res.status(500).json({ message: 'MFA validation failed. Please try again.' });
    }
};

// ─── POST /api/auth/mfa/disable ───────────────────────────────────────────────
// Requires current password + a valid TOTP before disabling MFA.
// Both checks must pass — either alone is insufficient.
export const disableMfa = async (req, res) => {
    try {
        const { password, token } = req.body;

        const user = await User
            .findById(req.user._id)
            .select('+password +mfaSecret')
            .skipTenantFilter();

        if (!user) return res.status(404).json({ message: 'User not found' });

        if (!user.mfaEnabled) {
            return res.status(400).json({ message: 'MFA is not currently enabled.' });
        }

        // Verify current password
        const passwordOk = await user.matchPassword(password);
        if (!passwordOk) {
            return res.status(401).json({ message: 'Incorrect password.' });
        }

        // Verify TOTP
        const plainSecret = decryptSecret(user.mfaSecret);
        const tokenOk     = verifyToken(plainSecret, token);
        if (!tokenOk) {
            return res.status(401).json({ message: 'Invalid TOTP token.' });
        }

        user.mfaEnabled = false;
        user.mfaSecret  = undefined;
        await user.save();

        audit(req, 'AUTH_MFA_DISABLED', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   user._id,
            meta:         { action: 'mfa_disabled' },
        });

        return res.json({ message: 'MFA disabled successfully.' });
    } catch (err) {
        console.error('[MFA] disableMfa:', err.message);
        return res.status(500).json({ message: 'Failed to disable MFA. Please try again.' });
    }
};

// ─── GET /api/auth/mfa/status ─────────────────────────────────────────────────
// Returns the current MFA state + org-level enforcement setting.
export const getMfaStatus = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).skipTenantFilter();
        if (!user) return res.status(404).json({ message: 'User not found' });

        return res.json({
            mfaEnabled:  user.mfaEnabled,
            mfaRequired: req.org?.features?.mfaRequired ?? false,
        });
    } catch (err) {
        console.error('[MFA] getMfaStatus:', err.message);
        return res.status(500).json({ message: 'Failed to fetch MFA status.' });
    }
};
