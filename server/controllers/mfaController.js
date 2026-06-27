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

// ─── GET /api/auth/mfa/setup ──────────────────────────────────────────────────
// Generates a new TOTP secret and QR code for the authenticated user.
// The secret is returned in plain text ONCE here — it is NOT saved to DB yet.
// It is only saved after the user confirms their authenticator works via verify-setup.
export const setupMfa = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).skipTenantFilter();
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (user.mfaEnabled) {
            return res.status(400).json({ message: 'MFA is already enabled for this account.' });
        }

        const { secret, otpauthUrl, qrDataUri } = await generateSecret(user.email);

        // Return the secret in plain text — frontend must show QR code
        // and then call verify-setup with this secret + first token.
        // The secret is NOT stored in the DB until verify-setup succeeds.
        res.json({
            secret,       // base32 — needed by verify-setup
            otpauthUrl,   // for manual entry in authenticator apps
            qrDataUri,    // base64 PNG — display as <img src={qrDataUri} />
        });
    } catch (err) {
        console.error('[MFA] setupMfa:', err.message);
        res.status(500).json({ message: 'Failed to generate MFA setup. Please try again.' });
    }
};

// ─── POST /api/auth/mfa/verify-setup ─────────────────────────────────────────
// Confirms the user's authenticator app is configured correctly.
// Encrypts and saves the secret, sets mfaEnabled = true.
export const verifySetup = async (req, res) => {
    try {
        const { token, secret } = req.body;

        const user = await User.findById(req.user._id).skipTenantFilter();
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (user.mfaEnabled) {
            return res.status(400).json({ message: 'MFA is already enabled.' });
        }

        // Verify the token against the provided secret
        const isValid = verifyToken(secret, token);
        if (!isValid) {
            return res.status(400).json({
                message: 'Invalid TOTP token. Please check your authenticator app and try again.',
            });
        }

        // Encrypt and persist the secret
        user.mfaSecret  = encryptSecret(secret);
        user.mfaEnabled = true;
        await user.save();

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   user._id,
            meta:         { action: 'mfa_enabled' },
        });

        res.json({ message: 'MFA enabled successfully. Your account is now more secure.' });
    } catch (err) {
        console.error('[MFA] verifySetup:', err.message);
        res.status(500).json({ message: 'Failed to enable MFA. Please try again.' });
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
                actorId:  user._id,
                actorRole: user.role,
                success:  false,
                meta:     { reason: 'invalid_totp' },
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
            actorId:  user._id,
            actorRole: user.role,
            meta:     { method: 'mfa_totp' },
        });

        res.json({
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
        res.status(500).json({ message: 'MFA validation failed. Please try again.' });
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

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   user._id,
            meta:         { action: 'mfa_disabled' },
        });

        res.json({ message: 'MFA disabled successfully.' });
    } catch (err) {
        console.error('[MFA] disableMfa:', err.message);
        res.status(500).json({ message: 'Failed to disable MFA. Please try again.' });
    }
};

// ─── GET /api/auth/mfa/status ─────────────────────────────────────────────────
// Returns the current MFA state + org-level enforcement setting.
export const getMfaStatus = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).skipTenantFilter();
        if (!user) return res.status(404).json({ message: 'User not found' });

        res.json({
            mfaEnabled:  user.mfaEnabled,
            mfaRequired: req.org?.features?.mfaRequired ?? false,
        });
    } catch (err) {
        console.error('[MFA] getMfaStatus:', err.message);
        res.status(500).json({ message: 'Failed to fetch MFA status.' });
    }
};
