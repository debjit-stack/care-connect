/**
 * server/controllers/mfaController.js
 * ─────────────────────────────────────
 * Handles all TOTP MFA operations.
 * P3B: OTP rate limiting on validateMfa + verifySetup
 * P3C: POST /mfa/recover, POST /mfa/regenerate-codes
 * P3D: Security emails on enable/disable
 *
 * All existing handler logic is preserved exactly.
 */

import User      from '../models/User.js';
import audit     from '../utils/audit.js';
import {
    generateSecret,
    verifyToken,
    encryptSecret,
    decryptSecret,
    generateRecoveryCodes,
    hashRecoveryCode,
    verifyRecoveryCode,
    recordOtpFailure,
    checkOtpLockout,
    clearOtpFailures,
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
import { sendMail, templates } from '../utils/mailer.js';

// ─── GET /api/auth/mfa/setup ──────────────────────────────────────────────────
export const setupMfa = async (req, res) => {
    try {
        const user = await User.findById(req.mfaUserId).skipTenantFilter();
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (user.mfaEnabled) {
            return res.status(400).json({ message: 'MFA is already enabled.' });
        }

        const { secret, otpauthUrl, qrDataUri } = await generateSecret(user.email);
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
// P3B: Rate-limit OTP attempts during setup.
// P3C: Generate recovery codes on successful setup.
// P3D: Send mfaEnabled email.
export const verifySetup = async (req, res) => {
    try {
        const { token, setupId } = req.body;

        const user = await User
            .findById(req.mfaUserId)
            .select('+recoveryCodes')
            .skipTenantFilter();
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (user.mfaEnabled) {
            if (setupId) await deleteMfaSetupSession(setupId).catch(() => {});
            return res.status(400).json({ message: 'MFA is already enabled.' });
        }

        // P3B: Check OTP lockout before doing any work
        const lockout = await checkOtpLockout(user._id);
        if (lockout.locked) {
            const mins = Math.ceil(lockout.remaining / 60);
            return res.status(429).json({
                message: `Too many incorrect codes. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
            });
        }

        const setupSession = await getMfaSetupSession(setupId);
        if (!setupSession) {
            return res.status(400).json({
                message: 'MFA setup session expired. Please scan the QR code again.',
            });
        }

        if (setupSession.userId !== user._id.toString()) {
            return res.status(403).json({ message: 'Invalid MFA setup session.' });
        }

        const isValid = verifyToken(setupSession.secret, token);

        if (!isValid) {
            // P3B: Record failure
            const { attempts, locked } = await recordOtpFailure(user._id);
            const remaining = 5 - attempts;

            if (locked) {
                return res.status(429).json({
                    message: 'Too many incorrect codes. Please wait 10 minutes before trying again.',
                });
            }

            return res.status(401).json({
                message: `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
            });
        }

        // P3B: Clear failure counter on success
        await clearOtpFailures(user._id);

        // P3C: Generate recovery codes before saving
        const plainCodes = generateRecoveryCodes();
        const hashedCodes = await Promise.all(
            plainCodes.map(async ({ plain }) => ({
                codeHash: await hashRecoveryCode(plain),
                usedAt:   null,
            }))
        );

        // Persist MFA — encrypt secret, store recovery code hashes
        user.mfaSecret     = encryptSecret(setupSession.secret);
        user.mfaEnabled    = true;
        user.recoveryCodes = hashedCodes;
        await user.save();

        await deleteMfaSetupSession(setupId).catch(() => {});

        audit(req, 'AUTH_MFA_SETUP_COMPLETED', {
            actorId:      user._id,
            actorRole:    user.role,
            resourceType: 'User',
            resourceId:   user._id,
        });

        // P3D: Send MFA enabled security email (fire-and-forget)
        const org = req.org ?? null;
        sendMail({
            to:  user.email,
            org,
            ...templates.mfaEnabled({ userName: user.name, org }),
        });

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
            // P3C: Return plain codes ONE TIME — never stored, never retrievable again
            recoveryCodes: plainCodes.map((c) => c.formatted),
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
// P3B: Rate-limit TOTP attempts during login step-2.
export const validateMfa = async (req, res) => {
    try {
        const { token, mfaPending } = req.body;

        let pending;
        try {
            pending = verifyMfaPendingToken(mfaPending);
        } catch {
            return res.status(401).json({ message: 'MFA session expired. Please log in again.' });
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

        // P3B: Check lockout before verifying
        const lockout = await checkOtpLockout(user._id);
        if (lockout.locked) {
            const mins = Math.ceil(lockout.remaining / 60);
            audit(req, 'AUTH_LOGIN_FAILED', {
                actorId: user._id, actorRole: user.role, success: false,
                meta:    { reason: 'otp_rate_limited' },
            });
            return res.status(429).json({
                message: `Too many incorrect codes. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
            });
        }

        const plainSecret = decryptSecret(user.mfaSecret);
        const isValid     = verifyToken(plainSecret, token);

        if (!isValid) {
            // P3B: Record failure and return remaining attempts
            const { attempts, locked } = await recordOtpFailure(user._id);
            const remaining = 5 - attempts;

            audit(req, 'AUTH_LOGIN_FAILED', {
                actorId: user._id, actorRole: user.role, success: false,
                meta:    { reason: 'invalid_totp', attempts },
            });

            if (locked) {
                return res.status(429).json({
                    message: 'Too many incorrect codes. Please wait 10 minutes before trying again.',
                });
            }

            return res.status(401).json({
                message: `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
            });
        }

        // P3B: Clear counter on success
        await clearOtpFailures(user._id);

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
// P3D: Send mfaDisabled security email.
export const disableMfa = async (req, res) => {
    try {
        const { password, token } = req.body;

        const user = await User
            .findById(req.user._id)
            .select('+password +mfaSecret')
            .skipTenantFilter();

        if (!user)              return res.status(404).json({ message: 'User not found' });
        if (!user.mfaEnabled)   return res.status(400).json({ message: 'MFA is not currently enabled.' });

        const passwordOk = await user.matchPassword(password);
        if (!passwordOk) return res.status(401).json({ message: 'Incorrect password.' });

        const plainSecret = decryptSecret(user.mfaSecret);
        const tokenOk     = verifyToken(plainSecret, token);
        if (!tokenOk) return res.status(401).json({ message: 'Invalid TOTP token.' });

        user.mfaEnabled    = false;
        user.mfaSecret     = undefined;
        user.recoveryCodes = [];
        await user.save();

        audit(req, 'AUTH_MFA_DISABLED', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   user._id,
            meta:         { action: 'mfa_disabled' },
        });

        // P3D: Security email (fire-and-forget)
        sendMail({
            to:  user.email,
            org: req.org ?? null,
            ...templates.mfaDisabled({ userName: user.name, org: req.org ?? null }),
        });

        return res.json({ message: 'MFA disabled successfully.' });
    } catch (err) {
        console.error('[MFA] disableMfa:', err.message);
        return res.status(500).json({ message: 'Failed to disable MFA. Please try again.' });
    }
};

// ─── GET /api/auth/mfa/status ─────────────────────────────────────────────────
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

// ─── P3C: POST /api/auth/mfa/recover ─────────────────────────────────────────
// Allows a user to bypass TOTP using a one-time recovery code.
// Requires mfaPending token (same flow as validateMfa) so the user
// must have successfully entered their password first.
export const recoverWithCode = async (req, res) => {
    try {
        const { code, mfaPending } = req.body;

        let pending;
        try {
            pending = verifyMfaPendingToken(mfaPending);
        } catch {
            return res.status(401).json({ message: 'Session expired. Please log in again.' });
        }

        const user = await User
            .findById(pending.id)
            .select('+mfaSecret +recoveryCodes')
            .skipTenantFilter();

        if (!user || user.deletedAt) {
            return res.status(401).json({ message: 'User not found.' });
        }

        if (!user.mfaEnabled) {
            return res.status(400).json({ message: 'MFA is not set up for this account.' });
        }

        if (!user.recoveryCodes?.length) {
            return res.status(400).json({
                message: 'No recovery codes available. Please contact your administrator.',
            });
        }

        // P3B: Rate-limit recovery attempts too
        const lockout = await checkOtpLockout(`recover:${user._id}`);
        if (lockout.locked) {
            const mins = Math.ceil(lockout.remaining / 60);
            return res.status(429).json({
                message: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
            });
        }

        const matchIndex = await verifyRecoveryCode(code, user.recoveryCodes);

        if (matchIndex === -1) {
            const { attempts, locked } = await recordOtpFailure(`recover:${user._id}`);
            const remaining = 5 - attempts;

            audit(req, 'AUTH_LOGIN_FAILED', {
                actorId: user._id, actorRole: user.role, success: false,
                meta:    { reason: 'invalid_recovery_code', attempts },
            });

            if (locked) {
                return res.status(429).json({
                    message: 'Too many failed attempts. Please wait 10 minutes.',
                });
            }

            return res.status(401).json({
                message: `Invalid or already-used recovery code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
            });
        }

        // Mark code as used
        user.recoveryCodes[matchIndex].usedAt = new Date();
        await user.save();

        await clearOtpFailures(`recover:${user._id}`);

        const accessToken  = generateAccessToken(user);
        const refreshToken = await generateRefreshToken(user._id);
        setRefreshCookie(res, refreshToken);

        const usedCount      = user.recoveryCodes.filter((c) => c.usedAt).length;
        const remainingCodes = user.recoveryCodes.length - usedCount;

        audit(req, 'AUTH_LOGIN_SUCCESS', {
            actorId:   user._id,
            actorRole: user.role,
            meta:      { method: 'recovery_code', remainingCodes },
        });

        return res.json({
            accessToken,
            remainingCodes,
            message: `Signed in with recovery code. ${remainingCodes} code${remainingCodes === 1 ? '' : 's'} remaining.`,
            user: {
                _id:        user._id,
                name:       user.name,
                email:      user.email,
                role:       user.role,
                mfaEnabled: user.mfaEnabled,
            },
        });
    } catch (err) {
        console.error('[MFA] recoverWithCode:', err.message);
        return res.status(500).json({ message: 'Recovery failed. Please try again.' });
    }
};

// ─── P3C: POST /api/auth/mfa/regenerate-codes ────────────────────────────────
// Generates a fresh set of 8 recovery codes.
// Requires a valid TOTP to prevent session hijacking.
// Old codes are immediately invalidated.
export const regenerateCodes = async (req, res) => {
    try {
        const { token } = req.body;

        const user = await User
            .findById(req.user._id)
            .select('+mfaSecret +recoveryCodes')
            .skipTenantFilter();

        if (!user)            return res.status(404).json({ message: 'User not found' });
        if (!user.mfaEnabled) return res.status(400).json({ message: 'MFA is not enabled.' });

        const plainSecret = decryptSecret(user.mfaSecret);
        const isValid     = verifyToken(plainSecret, token);
        if (!isValid) return res.status(401).json({ message: 'Invalid TOTP token.' });

        const plainCodes  = generateRecoveryCodes();
        const hashedCodes = await Promise.all(
            plainCodes.map(async ({ plain }) => ({
                codeHash: await hashRecoveryCode(plain),
                usedAt:   null,
            }))
        );

        user.recoveryCodes = hashedCodes;
        await user.save();

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   user._id,
            meta:         { action: 'recovery_codes_regenerated' },
        });

        return res.json({
            message:       'Recovery codes regenerated. Store these safely — they will not be shown again.',
            recoveryCodes: plainCodes.map((c) => c.formatted),
        });
    } catch (err) {
        console.error('[MFA] regenerateCodes:', err.message);
        return res.status(500).json({ message: 'Failed to regenerate recovery codes.' });
    }
};
