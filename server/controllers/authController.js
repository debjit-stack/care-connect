import User         from '../models/User.js';
import Organisation from '../models/Organisation.js';
import {
    generateAccessToken, generateRefreshToken, verifyRefreshToken,
    revokeRefreshToken, revokeAllRefreshTokens,
    setRefreshCookie, clearRefreshCookie, getRefreshCookie,
} from '../utils/tokens.js';
import audit             from '../utils/audit.js';
import { runWithTenant } from '../plugins/tenantPlugin.js';

// ─── Safe user payload ────────────────────────────────────────────────────────
const safeUser = (user, org) => ({
    _id:            user._id,
    name:           user.name,
    email:          user.email,
    role:           user.role,
    mfaEnabled:     user.mfaEnabled,
    organisationId: user.organisationId ?? null,
    organisation: org ? {
        _id:      org._id,
        name:     org.name,
        slug:     org.slug,
        settings: org.settings,
        features: org.features,
    } : null,
});

// ─── Resolve org from request ─────────────────────────────────────────────────
// Auth routes bypass tenantMiddleware so we resolve org independently here.
// Resolution order:
//   1. X-Organisation-Slug header
//   2. X-Organisation-ID header
//   3. Subdomain
//   4. Auto-fallback: exactly 1 active org → use it (single-tenant / dev)
//                     0 orgs → null (pre-migration)
//                     2+ orgs → null (header required)
const resolveOrgFromRequest = async (req) => {
    const slug = req.headers['x-organisation-slug'];
    if (slug) {
        return Organisation.findOne({ slug: slug.toLowerCase().trim(), deletedAt: null });
    }

    const id = req.headers['x-organisation-id'];
    if (id) {
        return Organisation.findOne({ _id: id, deletedAt: null });
    }

    const host  = req.headers.host || '';
    const parts = host.split('.');
    if (
        parts.length >= 3 &&
        !['www', 'api', 'careconnect', 'localhost'].includes(parts[0])
    ) {
        return Organisation.findOne({ slug: parts[0], deletedAt: null });
    }

    const count = await Organisation.countDocuments({ deletedAt: null, isActive: true });
    if (count === 1) {
        return Organisation.findOne({ deletedAt: null, isActive: true });
    }

    return null;
};

// ─── POST /api/auth/register ──────────────────────────────────────────────────
const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const org   = await resolveOrgFromRequest(req);
        const orgId = org?._id ?? null;

        if (org) {
            if (!org.isAccessible) {
                return res.status(403).json({ message: 'Organisation account is not active.' });
            }
            if (org.features?.patientPortal === false) {
                return res.status(403).json({ message: 'Patient self-registration is disabled.' });
            }
        }

        const existsFilter = orgId
            ? { email, organisationId: orgId, deletedAt: null }
            : { email, deletedAt: null };

        const exists = await User.findOne(existsFilter).skipTenantFilter();
        if (exists) {
            return res.status(409).json({ message: 'An account with this email already exists' });
        }

        let user;
        if (orgId) {
            await runWithTenant(orgId, async () => {
                user = await User.create({ name, email, password, role: 'patient' });
            });
        } else {
            user = await User.create({ name, email, password, role: 'patient' });
        }

        const accessToken  = generateAccessToken(user);
        const refreshToken = await generateRefreshToken(user._id);
        setRefreshCookie(res, refreshToken);

        // M7 FIX: include orgId in audit meta so auth events are traceable per org
        audit(req, 'AUTH_LOGIN_SUCCESS', {
            actorId:      user._id,
            actorRole:    user.role,
            meta:         { event: 'registration', orgId: orgId?.toString() ?? null },
        });

        return res.status(201).json({ user: safeUser(user, org), accessToken });
    } catch (err) {
        console.error('[Auth] registerUser:', err.message);
        return res.status(500).json({ message: 'Registration failed. Please try again.' });
    }
};

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        const org   = await resolveOrgFromRequest(req);
        const orgId = org?._id ?? null;

        if (!org) {
            const count = await Organisation.countDocuments({ deletedAt: null, isActive: true });
            if (count > 1) {
                return res.status(400).json({
                    message: 'Organisation not specified. Include X-Organisation-Slug header.',
                });
            }
        }

        if (org && !org.isAccessible) {
            return res.status(403).json({ message: 'Organisation account is not active.' });
        }

        const userFilter = orgId
            ? { email, organisationId: orgId, deletedAt: null }
            : { email, deletedAt: null };

        const user = await User
            .findOne(userFilter)
            .select('+password +loginAttempts +lockUntil +passwordChangedAt')
            .skipTenantFilter();

        if (!user) {
            // M7 FIX: include orgId in failed login audit
            audit(req, 'AUTH_LOGIN_FAILED', {
                success: false,
                meta:    { reason: 'user_not_found', email, orgId: orgId?.toString() ?? null },
            });
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        if (user.isLocked) {
            const m = Math.ceil((user.lockUntil - Date.now()) / 60000);
            audit(req, 'AUTH_LOGIN_FAILED', {
                actorId: user._id, actorRole: user.role, success: false,
                meta:    { reason: 'account_locked', orgId: orgId?.toString() ?? null },
            });
            return res.status(423).json({
                message: `Account locked. Try again in ${m} minute${m === 1 ? '' : 's'}.`,
            });
        }

        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            await user.recordFailedLogin();
            const after     = user.loginAttempts + 1;
            const remaining = 5 - after;
            audit(req, 'AUTH_LOGIN_FAILED', {
                actorId: user._id, actorRole: user.role, success: false,
                meta:    { reason: 'wrong_password', after, orgId: orgId?.toString() ?? null },
            });
            if (after >= 5) {
                audit(req, 'AUTH_ACCOUNT_LOCKED', {
                    actorId:  user._id,
                    actorRole: user.role,
                    meta:     { orgId: orgId?.toString() ?? null },
                });
                return res.status(423).json({ message: 'Account locked. Try again in 15 minutes.' });
            }
            return res.status(401).json({
                message: `Invalid email or password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
            });
        }

        await user.resetLoginAttempts();

        const accessToken  = generateAccessToken(user);
        const refreshToken = await generateRefreshToken(user._id);
        setRefreshCookie(res, refreshToken);

        // M7 FIX: orgId in successful login audit
        audit(req, 'AUTH_LOGIN_SUCCESS', {
            actorId:  user._id,
            actorRole: user.role,
            meta:     { orgId: orgId?.toString() ?? null },
        });

        return res.status(200).json({ user: safeUser(user, org), accessToken });
    } catch (err) {
        console.error('[Auth] loginUser:', err.message);
        return res.status(500).json({ message: 'Login failed. Please try again.' });
    }
};

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
const refreshAccessToken = async (req, res) => {
    try {
        const token = getRefreshCookie(req);
        if (!token) {
            return res.status(401).json({ message: 'No refresh token' });
        }

        const payload = await verifyRefreshToken(token);

        const user = await User
            .findById(payload.id)
            .select('+passwordChangedAt')
            .skipTenantFilter();

        if (!user || user.deletedAt) {
            clearRefreshCookie(res);
            return res.status(401).json({ message: 'User not found' });
        }

        if (user.isTokenIssuedBeforePasswordChange(payload.iat)) {
            await revokeAllRefreshTokens(user._id);
            clearRefreshCookie(res);
            return res.status(401).json({ message: 'Password recently changed. Please log in again.' });
        }

        await revokeRefreshToken(token);
        const newAccessToken  = generateAccessToken(user);
        const newRefreshToken = await generateRefreshToken(user._id);
        setRefreshCookie(res, newRefreshToken);

        audit(req, 'AUTH_TOKEN_REFRESHED', { actorId: user._id, actorRole: user.role });

        return res.status(200).json({ accessToken: newAccessToken });
    } catch (err) {
        clearRefreshCookie(res);
        return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }
};

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
const logoutUser = async (req, res) => {
    try {
        const token = getRefreshCookie(req);
        if (token) await revokeRefreshToken(token);
        clearRefreshCookie(res);
        audit(req, 'AUTH_LOGOUT', {
            actorId:   req.user?._id ?? null,
            actorRole: req.user?.role ?? 'anonymous',
        });
        return res.status(200).json({ message: 'Logged out successfully' });
    } catch {
        clearRefreshCookie(res);
        return res.status(200).json({ message: 'Logged out' });
    }
};

// ─── POST /api/auth/logout-all ────────────────────────────────────────────────
const logoutAllDevices = async (req, res) => {
    try {
        await revokeAllRefreshTokens(req.user._id);
        clearRefreshCookie(res);
        audit(req, 'AUTH_LOGOUT', {
            actorId:  req.user._id,
            actorRole: req.user.role,
            meta:     { allDevices: true },
        });
        return res.status(200).json({ message: 'Logged out from all devices' });
    } catch (err) {
        console.error('[Auth] logoutAllDevices:', err.message);
        return res.status(500).json({ message: 'Failed to logout from all devices' });
    }
};

// ─── PUT /api/auth/change-password ────────────────────────────────────────────
const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.user._id).select('+password').skipTenantFilter();
        if (!user) return res.status(404).json({ message: 'User not found' });

        const isMatch = await user.matchPassword(currentPassword);
        if (!isMatch) return res.status(401).json({ message: 'Current password is incorrect' });

        user.password = newPassword;
        await user.save();

        await revokeAllRefreshTokens(user._id);
        clearRefreshCookie(res);

        audit(req, 'AUTH_PASSWORD_CHANGED', { actorId: user._id, actorRole: user.role });
        return res.status(200).json({ message: 'Password changed. Please log in again.' });
    } catch (err) {
        console.error('[Auth] changePassword:', err.message);
        return res.status(500).json({ message: 'Failed to change password.' });
    }
};

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).skipTenantFilter();
        if (!user || user.deletedAt) return res.status(404).json({ message: 'User not found' });

        const org = user.organisationId
            ? await Organisation.findById(user.organisationId)
            : null;

        return res.status(200).json({ user: safeUser(user, org) });
    } catch (err) {
        console.error('[Auth] getMe:', err.message);
        return res.status(500).json({ message: 'Failed to fetch user' });
    }
};

export {
    registerUser, loginUser, refreshAccessToken,
    logoutUser, logoutAllDevices, changePassword, getMe,
};
