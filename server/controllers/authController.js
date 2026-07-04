import User         from '../models/User.js';
import Organisation from '../models/Organisation.js';
import {
    generateAccessToken,
    generateRefreshToken,
    generateMfaPendingToken,
    generateResetPendingToken,
    verifyResetPendingToken,
    verifyRefreshToken,
    revokeRefreshToken,
    revokeAllRefreshTokens,
    setRefreshCookie,
    clearRefreshCookie,
    getRefreshCookie,
} from '../utils/tokens.js';
import audit             from '../utils/audit.js';
import { runWithTenant } from '../plugins/tenantPlugin.js';
import { sendMail, templates } from '../utils/mailer.js';
import { generateOtp, hashOtp, verifyOtpHash } from '../utils/otp.js';
import {
    createSession,
    getSession,
    patchSession,
    deleteSession,
} from '../utils/redisSessionStore.js';
import {
    recordOtpFailure,
    checkOtpLockout,
    clearOtpFailures,
} from '../utils/totp.js';

// ── OTP flow constants ────────────────────────────────────────────────────────
const REGISTRATION_OTP_TTL_SECONDS = 10 * 60; // 10 minutes
const REGISTRATION_RESEND_COOLDOWN_SECONDS = 60;
const REGISTRATION_MAX_RESENDS = 5;
const FORGOT_PASSWORD_OTP_TTL_SECONDS = 10 * 60;
const FORGOT_PASSWORD_RESEND_COOLDOWN_SECONDS = 60;

// ─── Safe user payload ────────────────────────────────────────────────────────
const safeUser = (user, org) => ({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    mfaEnabled: user.mfaEnabled,
    forceMfa: user.forceMfa ?? false,
    organisationId: user.organisationId ?? null,
    organisation: org ? {
        _id: org._id,
        name: org.name,
        slug: org.slug,
        settings: org.settings,
        features: org.features,
    } : null,
});

// ─── Resolve org from request ─────────────────────────────────────────────────
const resolveOrgFromRequest = async (req) => {
    const slug = req.headers['x-organisation-slug'];
    if (slug) return Organisation.findOne({ slug: slug.toLowerCase().trim(), deletedAt: null });

    const id = req.headers['x-organisation-id'];
    if (id) return Organisation.findOne({ _id: id, deletedAt: null });

    const host  = req.headers.host || '';
    const parts = host.split('.');
    if (parts.length >= 3 && !['www', 'api', 'careconnect', 'localhost'].includes(parts[0])) {
        return Organisation.findOne({ slug: parts[0], deletedAt: null });
    }

    const count = await Organisation.countDocuments({ deletedAt: null, isActive: true });
    if (count === 1) return Organisation.findOne({ deletedAt: null, isActive: true });

    return null;
};

// ─── Shared: issue tokens + respond for a fully-authenticated user ───────────
// PATIENT MFA REMOVAL: this is the single normal-login code path. It's used
// both by the patient bypass below AND by the tail end of the staff MFA
// decision tree once no MFA step applies. Extracting it here means "skip MFA"
// is one function call, not duplicated inline logic.
const issueLoginResponse = async (res, req, user, org) => {
    const accessToken  = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user._id);
    setRefreshCookie(res, refreshToken);

    audit(req, 'AUTH_LOGIN_SUCCESS', {
        actorId:   user._id,
        actorRole: user.role,
        meta:      { orgId: org?._id?.toString() ?? null },
    });

    return res.status(200).json({ user: safeUser(user, org), accessToken });
};

// ─── POST /api/auth/register ──────────────────────────────────────────────────
// NOTE: This direct (non-OTP) registration endpoint is left in place for API
// integrations / backwards compatibility. The web frontend now uses the
// OTP-based flow below (request-otp → verify-otp) for patient self-service
// registration. Admin/receptionist patient creation is unaffected — those
// flows live in receptionistController.js and never touch this endpoint.
const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const org   = await resolveOrgFromRequest(req);
        const orgId = org?._id ?? null;

        if (org) {
            if (!org.isAccessible) return res.status(403).json({ message: 'Organisation account is not active.' });
            if (org.features?.patientPortal === false) return res.status(403).json({ message: 'Patient self-registration is disabled.' });
        }

        const existsFilter = orgId
            ? { email, organisationId: orgId, deletedAt: null }
            : { email, deletedAt: null };

        const exists = await User.findOne(existsFilter).skipTenantFilter();
        if (exists) return res.status(409).json({ message: 'An account with this email already exists' });

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

        audit(req, 'AUTH_LOGIN_SUCCESS', {
            actorId:   user._id,
            actorRole: user.role,
            meta:      { event: 'registration', orgId: orgId?.toString() ?? null },
        });

        return res.status(201).json({ user: safeUser(user, org), accessToken });
    } catch (err) {
        console.error('[Auth] registerUser:', err.message);
        return res.status(500).json({ message: 'Registration failed. Please try again.' });
    }
};

// ────────────────────────────────────────────────────────────────────────────
// OTP FEATURE: Patient self-registration (request-otp → verify-otp → resend)
// ────────────────────────────────────────────────────────────────────────────
// No User document is created until the OTP is verified — avoids unverified
// junk accounts in Mongo. Pending state lives in Redis with a 10-minute TTL.

// ─── POST /api/auth/register/request-otp ──────────────────────────────────────
const requestRegistrationOtp = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const org   = await resolveOrgFromRequest(req);
        const orgId = org?._id ?? null;

        if (org) {
            if (!org.isAccessible) return res.status(403).json({ message: 'Organisation account is not active.' });
            if (org.features?.patientPortal === false) return res.status(403).json({ message: 'Patient self-registration is disabled.' });
        }

        const existsFilter = orgId
            ? { email, organisationId: orgId, deletedAt: null }
            : { email, deletedAt: null };
        const exists = await User.findOne(existsFilter).skipTenantFilter();
        if (exists) return res.status(409).json({ message: 'An account with this email already exists' });

        const otp        = generateOtp();
        const otpHash     = await hashOtp(otp);
        // Password is hashed at User-creation time by the schema's pre-save
        // hook (bcrypt) — here we only need to carry it through Redis until
        // verification, so it's stored as-is in the pending session (Redis is
        // not exposed externally and the session is short-lived + deleted on
        // use). We do NOT persist the plaintext password anywhere in Mongo.
        const { id: registrationId, expiresIn } = await createSession('register', {
            name,
            email,
            password,
            otpHash,
            organisationId: orgId ? orgId.toString() : null,
            attempts:      0,
            resendCount:   0,
            lastSentAt:    Date.now(),
            createdAt:     Date.now(),
            ip:            req.ip,
            userAgent:     req.headers['user-agent'] || null,
        }, REGISTRATION_OTP_TTL_SECONDS);

        sendMail({
            to:  email,
            org,
            ...templates.registrationOtp({ name, otp, expiresInMinutes: Math.round(REGISTRATION_OTP_TTL_SECONDS / 60), org }),
        });

        return res.status(200).json({
            registrationId,
            expiresIn,
            message: 'A verification code has been sent to your email.',
        });
    } catch (err) {
        console.error('[Auth] requestRegistrationOtp:', err.message);
        return res.status(500).json({ message: 'Failed to start registration. Please try again.' });
    }
};

// ─── POST /api/auth/register/resend-otp ───────────────────────────────────────
const resendRegistrationOtp = async (req, res) => {
    try {
        const { registrationId } = req.body;
        const session = await getSession('register', registrationId);
        if (!session) {
            return res.status(400).json({ message: 'This registration session has expired. Please start again.' });
        }

        const secondsSinceLastSend = (Date.now() - session.lastSentAt) / 1000;
        if (secondsSinceLastSend < REGISTRATION_RESEND_COOLDOWN_SECONDS) {
            const wait = Math.ceil(REGISTRATION_RESEND_COOLDOWN_SECONDS - secondsSinceLastSend);
            return res.status(429).json({ message: `Please wait ${wait}s before requesting another code.` });
        }

        if (session.resendCount >= REGISTRATION_MAX_RESENDS) {
            return res.status(429).json({ message: 'Too many code requests. Please start registration again.' });
        }

        const otp     = generateOtp();
        const otpHash = await hashOtp(otp);

        await patchSession('register', registrationId, {
            otpHash,
            resendCount: session.resendCount + 1,
            lastSentAt:  Date.now(),
        });
        // Reset any prior failed-attempt lockout for this session on resend —
        // a fresh code deserves a fresh attempt counter.
        await clearOtpFailures(`register:${registrationId}`);

        const org = session.organisationId ? await Organisation.findById(session.organisationId) : null;
        sendMail({
            to:  session.email,
            org,
            ...templates.registrationOtp({ name: session.name, otp, expiresInMinutes: Math.round(REGISTRATION_OTP_TTL_SECONDS / 60), org }),
        });

        return res.status(200).json({ message: 'A new verification code has been sent.' });
    } catch (err) {
        console.error('[Auth] resendRegistrationOtp:', err.message);
        return res.status(500).json({ message: 'Failed to resend code. Please try again.' });
    }
};

// ─── POST /api/auth/register/verify-otp ───────────────────────────────────────
const verifyRegistrationOtp = async (req, res) => {
    try {
        const { registrationId, otp } = req.body;

        const lockout = await checkOtpLockout(`register:${registrationId}`);
        if (lockout.locked) {
            const mins = Math.ceil(lockout.remaining / 60);
            return res.status(429).json({ message: `Too many incorrect codes. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
        }

        const session = await getSession('register', registrationId);
        if (!session) {
            return res.status(400).json({ message: 'This registration session has expired. Please start again.' });
        }

        const isValid = await verifyOtpHash(otp, session.otpHash);
        if (!isValid) {
            const { attempts, locked } = await recordOtpFailure(`register:${registrationId}`);
            const remaining = 5 - attempts;
            if (locked) {
                return res.status(429).json({ message: 'Too many incorrect codes. Please wait 10 minutes before trying again.' });
            }
            return res.status(401).json({ message: `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` });
        }

        await clearOtpFailures(`register:${registrationId}`);

        // Re-check email uniqueness at the last moment (covers the edge case
        // where someone else registered the same email while this OTP session
        // was pending).
        const orgId = session.organisationId || null;
        const existsFilter = orgId
            ? { email: session.email, organisationId: orgId, deletedAt: null }
            : { email: session.email, deletedAt: null };
        const alreadyExists = await User.findOne(existsFilter).skipTenantFilter();
        if (alreadyExists) {
            await deleteSession('register', registrationId);
            return res.status(409).json({ message: 'An account with this email already exists' });
        }

        let user;
        if (orgId) {
            await runWithTenant(orgId, async () => {
                user = await User.create({
                    name:     session.name,
                    email:    session.email,
                    password: session.password,
                    role:     'patient',
                });
            });
        } else {
            user = await User.create({
                name:     session.name,
                email:    session.email,
                password: session.password,
                role:     'patient',
            });
        }

        await deleteSession('register', registrationId);

        const org = orgId ? await Organisation.findById(orgId) : null;

        // Auto-login — ease-of-onboarding requirement.
        const accessToken  = generateAccessToken(user);
        const refreshToken = await generateRefreshToken(user._id);
        setRefreshCookie(res, refreshToken);

        audit(req, 'AUTH_LOGIN_SUCCESS', {
            actorId:   user._id,
            actorRole: user.role,
            meta:      { event: 'registration_otp', orgId: orgId?.toString() ?? null },
        });

        // Welcome email — fire-and-forget, not required for the response.
        sendMail({
            to:  user.email,
            org,
            ...templates.welcomePatient({ name: user.name, org }),
        });

        return res.status(201).json({ user: safeUser(user, org), accessToken });
    } catch (err) {
        console.error('[Auth] verifyRegistrationOtp:', err.message);
        return res.status(500).json({ message: 'Failed to verify code. Please try again.' });
    }
};

// ────────────────────────────────────────────────────────────────────────────
// OTP FEATURE: Forgot password (request-otp → verify-otp → reset)
// ────────────────────────────────────────────────────────────────────────────

// ─── POST /api/auth/forgot-password ───────────────────────────────────────────
// Always returns the same generic response regardless of whether the email
// exists, to avoid account enumeration.
const GENERIC_FORGOT_PASSWORD_MESSAGE =
    'If an account with that email exists, a verification code has been sent.';

const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const org = await resolveOrgFromRequest(req);

        const userFilter = org
            ? { email, organisationId: org._id, deletedAt: null }
            : { email, deletedAt: null };

        const user = await User.findOne(userFilter).skipTenantFilter();

        if (user) {
            const otp     = generateOtp();
            const otpHash = await hashOtp(otp);

            // Keyed by userId (not a random uuid) so verify-forgot-password-otp
            // can look the session up again by re-resolving email → user,
            // without ever handing the client an internal session identifier.
            await createSession('forgot', {
                userId: user._id.toString(),
                otpHash,
                lastSentAt: Date.now(),
                createdAt:  Date.now(),
                ip:         req.ip,
                userAgent:  req.headers['user-agent'] || null,
            }, FORGOT_PASSWORD_OTP_TTL_SECONDS, user._id.toString());

            const userOrg = user.organisationId ? await Organisation.findById(user.organisationId) : org;
            sendMail({
                to:  user.email,
                org: userOrg,
                ...templates.forgotPasswordOtp({
                    name: user.name,
                    otp,
                    expiresInMinutes: Math.round(FORGOT_PASSWORD_OTP_TTL_SECONDS / 60),
                    org: userOrg,
                }),
            });

            audit(req, 'AUTH_LOGIN_FAILED', {
                actorId: user._id, actorRole: user.role, success: true,
                meta: { event: 'forgot_password_requested' },
            });
        }

        return res.status(200).json({ message: GENERIC_FORGOT_PASSWORD_MESSAGE });
    } catch (err) {
        console.error('[Auth] forgotPassword:', err.message);
        // Still return the generic message — don't leak errors that could
        // hint at account existence via response shape/timing.
        return res.status(200).json({ message: GENERIC_FORGOT_PASSWORD_MESSAGE });
    }
};

// ─── POST /api/auth/forgot-password/resend-otp ────────────────────────────────
const resendForgotPasswordOtp = async (req, res) => {
    try {
        const { email } = req.body;
        const org = await resolveOrgFromRequest(req);
        const userFilter = org
            ? { email, organisationId: org._id, deletedAt: null }
            : { email, deletedAt: null };
        const user = await User.findOne(userFilter).skipTenantFilter();

        // Same generic response whether or not the user/session exists.
        if (user) {
            const session = await getSession('forgot', user._id.toString());
            if (session) {
                const secondsSinceLastSend = (Date.now() - session.lastSentAt) / 1000;
                if (secondsSinceLastSend >= FORGOT_PASSWORD_RESEND_COOLDOWN_SECONDS) {
                    const otp     = generateOtp();
                    const otpHash = await hashOtp(otp);
                    await patchSession('forgot', user._id.toString(), { otpHash, lastSentAt: Date.now() });
                    await clearOtpFailures(`forgot:${user._id.toString()}`);

                    const userOrg = user.organisationId ? await Organisation.findById(user.organisationId) : org;
                    sendMail({
                        to:  user.email,
                        org: userOrg,
                        ...templates.forgotPasswordOtp({
                            name: user.name,
                            otp,
                            expiresInMinutes: Math.round(FORGOT_PASSWORD_OTP_TTL_SECONDS / 60),
                            org: userOrg,
                        }),
                    });
                }
            }
        }

        return res.status(200).json({ message: GENERIC_FORGOT_PASSWORD_MESSAGE });
    } catch (err) {
        console.error('[Auth] resendForgotPasswordOtp:', err.message);
        return res.status(200).json({ message: GENERIC_FORGOT_PASSWORD_MESSAGE });
    }
};

// ─── POST /api/auth/forgot-password/verify-otp ────────────────────────────────
const verifyForgotPasswordOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;
        const org = await resolveOrgFromRequest(req);
        const userFilter = org
            ? { email, organisationId: org._id, deletedAt: null }
            : { email, deletedAt: null };
        const user = await User.findOne(userFilter).skipTenantFilter();

        const GENERIC_INVALID = { status: 401, message: 'Invalid or expired code.' };
        if (!user) return res.status(GENERIC_INVALID.status).json({ message: GENERIC_INVALID.message });

        const lockoutKey = `forgot:${user._id.toString()}`;
        const lockout = await checkOtpLockout(lockoutKey);
        if (lockout.locked) {
            const mins = Math.ceil(lockout.remaining / 60);
            return res.status(429).json({ message: `Too many incorrect codes. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
        }

        const session = await getSession('forgot', user._id.toString());
        if (!session) return res.status(GENERIC_INVALID.status).json({ message: GENERIC_INVALID.message });

        const isValid = await verifyOtpHash(otp, session.otpHash);
        if (!isValid) {
            const { attempts, locked } = await recordOtpFailure(lockoutKey);
            const remaining = 5 - attempts;
            if (locked) {
                return res.status(429).json({ message: 'Too many incorrect codes. Please wait 10 minutes before trying again.' });
            }
            return res.status(401).json({ message: `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` });
        }

        await clearOtpFailures(lockoutKey);
        await deleteSession('forgot', user._id.toString());

        const resetToken = generateResetPendingToken(user._id);

        return res.status(200).json({ resetToken, expiresIn: 600 });
    } catch (err) {
        console.error('[Auth] verifyForgotPasswordOtp:', err.message);
        return res.status(500).json({ message: 'Failed to verify code. Please try again.' });
    }
};

// ─── POST /api/auth/forgot-password/reset ─────────────────────────────────────
// Deliberately does NOT auto-login — a fresh normal login is required after
// this security-sensitive action, consistent with the admin-triggered
// resetPassword flow.
const resetPasswordWithToken = async (req, res) => {
    try {
        const { resetToken, newPassword } = req.body;

        let payload;
        try {
            payload = verifyResetPendingToken(resetToken);
        } catch {
            return res.status(401).json({ message: 'This reset link has expired. Please request a new one.' });
        }

        const user = await User.findById(payload.id).skipTenantFilter();
        if (!user || user.deletedAt) {
            return res.status(404).json({ message: 'Account not found.' });
        }

        user.password = newPassword;
        await user.save();

        await revokeAllRefreshTokens(user._id);

        audit(req, 'AUTH_PASSWORD_CHANGED', {
            actorId:      user._id,
            actorRole:    user.role,
            resourceType: 'User',
            resourceId:   user._id,
            meta:         { resetBy: 'self_service_otp' },
        });

        const org = user.organisationId ? await Organisation.findById(user.organisationId) : null;
        sendMail({
            to:  user.email,
            org,
            ...templates.passwordResetConfirmed({ userName: user.name, org }),
        });

        return res.status(200).json({ message: 'Password reset successful. Please log in with your new password.' });
    } catch (err) {
        console.error('[Auth] resetPasswordWithToken:', err.message);
        return res.status(500).json({ message: 'Failed to reset password. Please try again.' });
    }
};

const sendMfaChallenge = (
    res,
    userId,
    setupRequired,
    message
) => {
    const mfaPending = generateMfaPendingToken(userId);

    return res.status(200).json({
        mfaRequired: true,
        mfaSetupRequired: setupRequired,
        mfaPending,
        message,
    });
};


// ─── POST /api/auth/login ─────────────────────────────────────────────────────
// PATIENT MFA REMOVAL: patients now bypass the entire MFA decision tree via a
// single centralized gate right after password verification / lockout reset.
// - org.features.mfaRequired is now interpreted as "require MFA for staff"
//   (see Organisation.js comment + SecurityPanel.jsx copy) — it is simply
//   never evaluated for a patient login.
// - Existing patient mfaEnabled/mfaSecret/recoveryCodes fields are left
//   completely untouched (no migration). If patient MFA is ever reintroduced,
//   removing this early-return is the only change needed.
// - Staff (admin/super_admin/doctor/receptionist) MFA behavior is 100%
//   unchanged below this gate.
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        const org   = await resolveOrgFromRequest(req);
        const orgId = org?._id ?? null;

        if (!org) {
            const count = await Organisation.countDocuments({ deletedAt: null, isActive: true });
            if (count > 1) return res.status(400).json({ message: 'Organisation not specified. Include X-Organisation-Slug header.' });
        }

        if (org && !org.isAccessible) return res.status(403).json({ message: 'Organisation account is not active.' });

        const userFilter = orgId
            ? { email, organisationId: orgId, deletedAt: null }
            : { email, deletedAt: null };

        const user = await User
            .findOne(userFilter)
            .select('+password +loginAttempts +lockUntil +passwordChangedAt +forceMfa')
            .skipTenantFilter();

        if (!user) {
            audit(req, 'AUTH_LOGIN_FAILED', { success: false, meta: { reason: 'user_not_found', email, orgId: orgId?.toString() ?? null } });
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        if (user.isLocked) {
            const m = Math.ceil((user.lockUntil - Date.now()) / 60000);
            audit(req, 'AUTH_LOGIN_FAILED', { actorId: user._id, actorRole: user.role, success: false, meta: { reason: 'account_locked', orgId: orgId?.toString() ?? null } });
            return res.status(423).json({ message: `Account locked. Try again in ${m} minute${m === 1 ? '' : 's'}.` });
        }

        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            await user.recordFailedLogin();
            const after     = user.loginAttempts + 1;
            const remaining = 5 - after;
            audit(req, 'AUTH_LOGIN_FAILED', { actorId: user._id, actorRole: user.role, success: false, meta: { reason: 'wrong_password', after, orgId: orgId?.toString() ?? null } });
            if (after >= 5) {
                audit(req, 'AUTH_ACCOUNT_LOCKED', { actorId: user._id, actorRole: user.role, meta: { orgId: orgId?.toString() ?? null } });
                return res.status(423).json({ message: 'Account locked. Try again in 15 minutes.' });
            }
            return res.status(401).json({ message: `Invalid email or password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` });
        }

        await user.resetLoginAttempts();

        // ─────────────────────────────────────────────────────────────────
        // PATIENT MFA REMOVAL: single centralized bypass gate.
        // ─────────────────────────────────────────────────────────────────
        if (user.role === 'patient') {
            return issueLoginResponse(res, req, user, org);
        }

// ─────────────────────────────────────────────────────────────────────
// Enterprise MFA Decision Tree (STAFF ONLY from here down)
// Priority:
// 1. Organisation Policy (staff-scoped)
// 2. User Force MFA
// 3. User Voluntary MFA
// ─────────────────────────────────────────────────────────────────────

        const orgMfaRequired = org?.features?.mfaRequired ?? false;
        const forceMfa = Boolean(user.forceMfa);

        // ----------------------------------------------------
        // CASE 1
        // Organisation requires MFA (staff)
        // ----------------------------------------------------
        if (orgMfaRequired) {
            if (user.mfaEnabled) {
                return sendMfaChallenge(
                    res,
                    user._id,
                    false,
                    "Please enter your authenticator code."
                );
            }

            return sendMfaChallenge(
                res,
                user._id,
                true,
                "Your organisation requires MFA."
            );
        }

        // ----------------------------------------------------
        // CASE 2
        // Admin forced MFA for this user
        // ----------------------------------------------------
        if (forceMfa) {
            if (user.mfaEnabled) {
                return sendMfaChallenge(
                    res,
                    user._id,
                    false,
                    "Please enter your authenticator code."
                );
            }

            return sendMfaChallenge(
                res,
                user._id,
                true,
                "Your organisation requires MFA."
            );
        }

        // ----------------------------------------------------
        // CASE 3
        // User voluntarily enabled MFA
        // ----------------------------------------------------
        if (user.mfaEnabled) {
            return sendMfaChallenge(
                res,
                user._id,
                false,
                "Please enter your authenticator code."
            );
        }

        // ── Normal login (no MFA) ─────────────────────────────────────────────
        return issueLoginResponse(res, req, user, org);
    } catch (err) {
        console.error('[Auth] loginUser:', err.message);
        return res.status(500).json({ message: 'Login failed. Please try again.' });
    }
};

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
const refreshAccessToken = async (req, res) => {
    try {
        const token = getRefreshCookie(req);
        if (!token) return res.status(401).json({ message: 'No refresh token' });

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
        audit(req, 'AUTH_LOGOUT', { actorId: req.user?._id ?? null, actorRole: req.user?.role ?? 'anonymous' });
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
        audit(req, 'AUTH_LOGOUT', { actorId: req.user._id, actorRole: req.user.role, meta: { allDevices: true } });
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

        const org = user.organisationId ? await Organisation.findById(user.organisationId) : null;
        return res.status(200).json({ user: safeUser(user, org) });
    } catch (err) {
        console.error('[Auth] getMe:', err.message);
        return res.status(500).json({ message: 'Failed to fetch user' });
    }
};

export {
    registerUser, loginUser, refreshAccessToken,
    logoutUser, logoutAllDevices, changePassword, getMe,
    // OTP FEATURE
    requestRegistrationOtp, resendRegistrationOtp, verifyRegistrationOtp,
    forgotPassword, resendForgotPasswordOtp, verifyForgotPasswordOtp, resetPasswordWithToken,
};
