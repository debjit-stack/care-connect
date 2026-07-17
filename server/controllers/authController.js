import bcrypt        from 'bcryptjs';
import User          from '../models/User.js';
import Organisation  from '../models/Organisation.js';
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
    generateStepUpToken,
} from '../utils/tokens.js';
import audit             from '../utils/audit.js';
import { runWithTenant } from '../plugins/tenantPlugin.js';
import { resolveOrganisation } from '../utils/resolveOrg.js';
import { sendMail, templates } from '../utils/mailer.js';
import { generateOtp, hashOtp, verifyOtpHash } from '../utils/otp.js';
import { decryptSecret, verifyToken } from '../utils/totp.js';
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

// A2: how long a step-up token is valid for once issued — matches
// generateStepUpToken's own default expiry in tokens.js. Returned in the
// response body so the frontend knows exactly when to re-prompt rather
// than guessing or hardcoding a duplicate value.
const STEP_UP_TOKEN_EXPIRES_IN_SECONDS = 300;

// NEW-L1: a fixed, precomputed bcrypt hash used ONLY to burn roughly the same
// amount of CPU time as a real bcrypt.compare() when no session/user exists,
// so "wrong code" and "no such account" responses take a similar amount of
// time. This is not a secret and matches no real OTP.
const DUMMY_BCRYPT_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8xkO/tCiOSk.tE/1x3AbHqjRw9kAmy';
const burnTimingBudget = () => bcrypt.compare('0'.repeat(6), DUMMY_BCRYPT_HASH);

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
// PHASE5-L1 FIX: this function's independent extraction/lookup/fallback
// logic (flagged as L1 in the multi-tenant audit, and deferred from Phase 2
// specifically to be addressed here) has been replaced with a thin wrapper
// around the shared resolveOrganisation() utility (server/utils/resolveOrg.js),
// the same one tenantMiddleware.resolveTenant now uses. The two can no
// longer silently diverge on org-resolution semantics.
//
// This collapses the discriminated { status, org } result down to a plain
// nullable org for the callers below that only ever checked truthiness
// (requestRegistrationOtp, forgotPassword, resendForgotPasswordOtp,
// verifyForgotPasswordOtp, registerUser) — none of those need to
// distinguish 'not_found' from 'ambiguous'/'no_orgs', they all already
// treat "no org resolved" uniformly. loginUser is the one exception that
// DOES care about the distinction — see its own updated logic below, which
// now calls resolveOrganisation() directly instead of going through this
// wrapper, rather than re-deriving an equivalent count check independently
// (which is exactly how it drifted out of sync with this function during
// Phase 2's follow-up fix).
const resolveOrgFromRequest = async (req) => {
    const result = await resolveOrganisation(req);
    return result.status === 'resolved' ? result.org : null;
};

// ─── Shared: issue tokens + respond for a fully-authenticated user ───────────
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

// ─── Helper: create a patient User from an already-hashed password ──────────
// NEW-M1 FIX: used by verifyRegistrationOtp. The pending Redis session now
// stores a bcrypt hash (never plaintext), so creation here must NOT let the
// User model's pre-save hook hash it a second time — that would corrupt the
// password (double-hashed values never match on login). The transient
// `_preHashed` flag (see User.js) tells the hook to skip hashing exactly once.
const createPatientFromHashedPassword = async ({ name, email, passwordHash }) => {
    const user = new User({ name, email, password: passwordHash, role: 'patient' });
    user._preHashed = true;
    await user.save();
    return user;
};

// ─── POST /api/auth/register ──────────────────────────────────────────────────
// Direct (non-OTP) registration endpoint, left in place for API integrations.
// The web frontend uses the OTP-based flow below.
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

        const otp     = generateOtp();
        const otpHash = await hashOtp(otp);

        // NEW-M1 FIX: hash the password NOW, before it ever touches Redis.
        // Previously the plaintext password was stored in the pending
        // session for up to 10 minutes — this hashes it up front using the
        // same bcrypt cost factor as the User model, and the plaintext is
        // never persisted anywhere.
        const passwordHash = await bcrypt.hash(password, 12);

        const { id: registrationId, expiresIn } = await createSession('register', {
            name,
            email,
            passwordHash,
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

        // NEW-M2 FIX: explicitly restart the full TTL window on resend — a
        // freshly-sent code should be valid for the full window, not
        // whatever time happened to be left on the old session.
        await patchSession('register', registrationId, {
            otpHash,
            resendCount: session.resendCount + 1,
            lastSentAt:  Date.now(),
        }, { ttlSeconds: REGISTRATION_OTP_TTL_SECONDS });

        // NEW-C1 FIX: do NOT clear the failed-attempt lockout counter here.
        // The previous behavior let anyone reset their attempt budget to
        // zero simply by requesting a new code once the 60s cooldown
        // elapsed — defeating the 5-attempt lockout entirely. A resend now
        // only refreshes the code and its TTL; the lockout counter is only
        // ever cleared on a SUCCESSFUL verification.

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
                user = await createPatientFromHashedPassword({
                    name:         session.name,
                    email:        session.email,
                    passwordHash: session.passwordHash,
                });
            });
        } else {
            user = await createPatientFromHashedPassword({
                name:         session.name,
                email:        session.email,
                passwordHash: session.passwordHash,
            });
        }

        await deleteSession('register', registrationId);

        const org = orgId ? await Organisation.findById(orgId) : null;

        const accessToken  = generateAccessToken(user);
        const refreshToken = await generateRefreshToken(user._id);
        setRefreshCookie(res, refreshToken);

        audit(req, 'AUTH_LOGIN_SUCCESS', {
            actorId:   user._id,
            actorRole: user.role,
            meta:      { event: 'registration_otp', orgId: orgId?.toString() ?? null },
        });

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

const GENERIC_FORGOT_PASSWORD_MESSAGE =
    'If an account with that email exists, a verification code has been sent.';

// ─── POST /api/auth/forgot-password ───────────────────────────────────────────
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

            // NEW-M3 FIX: this event was previously logged as
            // AUTH_LOGIN_FAILED with success:true, which is self-
            // contradictory in the audit trail. It now has its own,
            // accurately-named action.
            audit(req, 'AUTH_PASSWORD_RESET_REQUESTED', {
                actorId: user._id, actorRole: user.role, success: true,
            });
        } else {
            // NEW-L1: burn roughly the same amount of time as the
            // hash-and-send path above so response timing doesn't hint at
            // whether the email exists.
            await burnTimingBudget();
        }

        return res.status(200).json({ message: GENERIC_FORGOT_PASSWORD_MESSAGE });
    } catch (err) {
        console.error('[Auth] forgotPassword:', err.message);
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

        if (user) {
            const session = await getSession('forgot', user._id.toString());
            if (session) {
                const secondsSinceLastSend = (Date.now() - session.lastSentAt) / 1000;
                if (secondsSinceLastSend >= FORGOT_PASSWORD_RESEND_COOLDOWN_SECONDS) {
                    const otp     = generateOtp();
                    const otpHash = await hashOtp(otp);

                    // NEW-M2 FIX: restart the full TTL window on resend.
                    await patchSession('forgot', user._id.toString(), {
                        otpHash,
                        lastSentAt: Date.now(),
                    }, { ttlSeconds: FORGOT_PASSWORD_OTP_TTL_SECONDS });

                    // NEW-C1 FIX: do NOT clear the OTP failure/lockout
                    // counter on resend — see the identical fix note in
                    // resendRegistrationOtp above.

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
        } else {
            await burnTimingBudget();
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

        if (!user) {
            // NEW-L1: equalize timing with the "user exists, wrong OTP" path.
            await burnTimingBudget();
            return res.status(GENERIC_INVALID.status).json({ message: GENERIC_INVALID.message });
        }

        const lockoutKey = `forgot:${user._id.toString()}`;
        const lockout = await checkOtpLockout(lockoutKey);
        if (lockout.locked) {
            const mins = Math.ceil(lockout.remaining / 60);
            return res.status(429).json({ message: `Too many incorrect codes. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
        }

        const session = await getSession('forgot', user._id.toString());
        if (!session) {
            await burnTimingBudget();
            return res.status(GENERIC_INVALID.status).json({ message: GENERIC_INVALID.message });
        }

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


// ─── Shared: password/lockout/MFA decision, used by BOTH login endpoints ──────
// PHASE-E FIX: previously this logic existed twice — once inline for the
// super_admin bypass, once inline for ordinary users — with the two copies
// already having drifted once (the super_admin copy initially omitted MFA
// enforcement and audit-on-failure; see the earlier review notes). Extracted
// once, here, so there is exactly one implementation for both
// /api/auth/login and the new /api/auth/platform-login to call — a third
// inline copy is exactly the kind of drift risk Phase 5's L1 consolidation
// was about avoiding elsewhere in this file. Behavior is unchanged from
// both prior inline versions — same messages, same status codes, same
// audit calls — this is a structural extraction only, not a logic change.
// `org` is null for the platform-login path (super_admin never has one);
// `orgMfaRequired` naturally evaluates to false in that case.
// ─── Shared: lockout check + password verification, used by BOTH
// authenticateAndRespond below AND loginUser's wrong-endpoint rejection ──
// PHASE-E FOLLOW-UP FIX (maintainability): this used to exist twice — once
// here, once again inline inside loginUser's super_admin-rejection branch
// (added when that branch was changed to verify the password before
// revealing anything, per the account-enumeration fix). Two copies of
// lockout/password-verification logic is exactly the drift risk this
// file's other extractions (authenticateAndRespond itself, Phase 5's
// resolveOrganisation) exist to avoid — this consolidates it back down to
// one implementation. Callers get back a discriminated result rather than
// a response directly, since what happens on a successful match differs
// between the two call sites (issue a real session vs. reveal a redirect
// message) — only the locked/wrong-password outcomes are identical
// everywhere, so only those are respond-agnostic here.
const verifyPasswordAndLockout = async (req, user, org = null) => {
    const orgId = org?._id?.toString() ?? null;

    if (user.isLocked) {
        const m = Math.ceil((user.lockUntil - Date.now()) / 60000);
        audit(req, 'AUTH_LOGIN_FAILED', {
            actorId: user._id, actorRole: user.role, success: false,
            meta: { reason: 'account_locked', orgId },
        });
        return {
            outcome: 'locked',
            status:  423,
            message: `Account locked. Try again in ${m} minute${m === 1 ? '' : 's'}.`,
        };
    }

    const isMatch = await user.matchPassword(req.body.password);

    if (!isMatch) {
        await user.recordFailedLogin();
        const after     = user.loginAttempts + 1;
        const remaining = 5 - after;

        audit(req, 'AUTH_LOGIN_FAILED', {
            actorId: user._id, actorRole: user.role, success: false,
            meta: { reason: 'wrong_password', after, orgId },
        });

        if (after >= 5) {
            audit(req, 'AUTH_ACCOUNT_LOCKED', { actorId: user._id, actorRole: user.role, meta: { orgId } });
            return { outcome: 'locked', status: 423, message: 'Account locked. Try again in 15 minutes.' };
        }

        return {
            outcome: 'wrong_password',
            status:  401,
            message: `Invalid email or password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
        };
    }

    await user.resetLoginAttempts();
    return { outcome: 'match' };
};

const authenticateAndRespond = async (req, res, user, org) => {
    const check = await verifyPasswordAndLockout(req, user, org);

    if (check.outcome !== 'match') {
        return res.status(check.status).json({ message: check.message });
    }

    // PATIENT MFA REMOVAL: single centralized bypass gate. (super_admin
    // never matches this — role is always 'super_admin' on that path.)
    if (user.role === 'patient') {
        return issueLoginResponse(res, req, user, org);
    }

    // Enterprise MFA Decision Tree (STAFF ONLY from here down — includes
    // super_admin, per SecurityPanel.jsx treating it as a manageable
    // "staff" role for MFA enforcement purposes).
    const orgMfaRequired = org?.features?.mfaRequired ?? false;
    const forceMfa = Boolean(user.forceMfa);

    if (orgMfaRequired || forceMfa) {
        if (user.mfaEnabled) {
            return sendMfaChallenge(res, user._id, false, 'Please enter your authenticator code.');
        }
        return sendMfaChallenge(res, user._id, true, 'Your organisation requires MFA.');
    }

    if (user.mfaEnabled) {
        return sendMfaChallenge(res, user._id, false, 'Please enter your authenticator code.');
    }

    return issueLoginResponse(res, req, user, org);
};

// ─── POST /api/auth/login (hospital users only) ────────────────────────────────
// PATIENT MFA REMOVAL: patients bypass the entire MFA decision tree via a
// single centralized gate right after password verification (see
// authenticateAndRespond above). Staff behavior is unchanged below that
// gate. See Organisation.js / SecurityPanel.jsx for the "mfaRequired =
// staff-only" reinterpretation.
const loginUser = async (req, res) => {
    try {
        const { email } = req.body;

        // PHASE-E FIX (Bug #1, route-based — not a client-supplied flag):
        // a super_admin may ONLY authenticate via the dedicated
        // /api/auth/platform-login endpoint. The actual super_admin
        // authentication logic still lives exclusively in
        // platformLoginUser below — this block never issues a real login
        // or MFA challenge — but it DOES verify the password before
        // deciding what to reveal.
        //
        // PHASE-E FOLLOW-UP FIX: previously this rejected with the
        // specific "Please use the Platform Login" message the MOMENT an
        // email matching a super_admin was found — before any password
        // check at all. That let anyone probe /api/auth/login with
        // candidate emails and learn, with zero knowledge of any password,
        // which ones belong to a super_admin account: the single highest-
        // privilege role in the system. The specific redirect message is
        // now only ever returned AFTER the password has been verified
        // against that account — i.e. only to someone who already knows
        // the correct credentials and simply used the wrong page. A wrong
        // password on a super_admin's email now produces the exact same
        // response shape as a wrong password on any other account (see the
        // normal-path wrong-password branch further down — same message
        // format, same lockout behavior, same audit reason string), so
        // response content alone can never distinguish "this email belongs
        // to a super_admin" from "this email belongs to an ordinary user"
        // without a correct password either way.
        const maybeSuperAdmin = await User.findOne({
            email, role: 'super_admin', deletedAt: null,
        })
            .select('+password +loginAttempts +lockUntil')
            .skipTenantFilter();

        if (maybeSuperAdmin) {
            const check = await verifyPasswordAndLockout(req, maybeSuperAdmin, null);

            if (check.outcome !== 'match') {
                return res.status(check.status).json({ message: check.message });
            }

            // Correct credentials, wrong endpoint — safe to reveal now,
            // since the requester has already proven they know this
            // account's password. verifyPasswordAndLockout has already
            // handled the locked/wrong-password outcomes identically to
            // any other account above; this audit entry is specific to
            // the 'match' outcome only.
            audit(req, 'AUTH_LOGIN_FAILED', {
                actorId: maybeSuperAdmin._id, actorRole: maybeSuperAdmin.role, success: false,
                meta: { reason: 'wrong_login_endpoint' },
            });
            return res.status(403).json({ message: 'Please use the Platform Login.' });
        }

        // PHASE5-L1 FIX: previously called resolveOrgFromRequest() (a plain
        // nullable-org wrapper) and then re-derived its own separate
        // count-based ambiguity check afterward — this is exactly the
        // duplicate logic that drifted out of sync with
        // resolveOrgFromRequest during the Phase 2 follow-up fix. Now calls
        // the shared resolveOrganisation() utility directly to get the
        // precise reason, with no second DB count query needed.
        const orgResult = await resolveOrganisation(req);

        let org = null;
        if (orgResult.status === 'resolved') {
            org = orgResult.org;
        } else if (orgResult.status === 'not_found') {
            return res.status(400).json({ message: 'Organisation not specified. Include X-Organisation-Slug header.' });
        } else if (orgResult.status === 'ambiguous') {
            return res.status(400).json({ message: 'Organisation not specified. Include X-Organisation-Slug header.' });
        }
        // orgResult.status === 'no_orgs' → org stays null; a fresh install
        // with zero organisations has nothing to scope login against.

        const orgId = org?._id ?? null;

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

        return authenticateAndRespond(req, res, user, org);
    } catch (err) {
        console.error('[Auth] loginUser:', err.message);
        return res.status(500).json({ message: 'Login failed. Please try again.' });
    }
};

// ─── POST /api/auth/platform-login (super_admin only) ──────────────────────────
// PHASE-E FIX (Bug #1, route-based): the ONLY endpoint that can ever
// authenticate a super_admin. Structurally cannot authenticate a
// non-super_admin — there is no hospital-user lookup anywhere in this
// function at all, so "reject non-super_admin" isn't a check that could be
// forgotten or bypassed, it's simply not a code path that exists here.
// Never resolves an organisation, never sends/expects an
// X-Organisation-Slug header — see tenantMiddleware.js's PUBLIC_EXACT list,
// where this route is now included alongside /api/auth/login.
const platformLoginUser = async (req, res) => {
    try {
        const { email } = req.body;

        const superAdmin = await User.findOne({
            email, role: 'super_admin', deletedAt: null,
        })
            .select('+password +loginAttempts +lockUntil +passwordChangedAt +forceMfa')
            .skipTenantFilter();

        if (!superAdmin) {
            // Deliberately generic — see loginUser's rejection above for
            // the asymmetric reasoning. An untrusted requester probing
            // this endpoint learns nothing about whether the email exists
            // or belongs to a hospital account.
            audit(req, 'AUTH_LOGIN_FAILED', {
                success: false,
                meta: { reason: 'platform_login_no_such_super_admin', email },
            });
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        // Super Admin never belongs to an organisation.
        return authenticateAndRespond(req, res, superAdmin, null);
    } catch (err) {
        console.error('[Auth] platformLoginUser:', err.message);
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
// A2: now sits behind requireStepUp (see authRoutes.js) — the route-level
// middleware already guarantees a fresh step-up token was presented before
// this handler ever runs, so no change needed in the handler body itself.
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

// ─── A2: POST /api/auth/step-up/verify ─────────────────────────────────────────
// Issues a short-lived step-up token proving the caller has JUST re-supplied
// their password or a valid TOTP code, for use by requireStepUp-gated
// routes (change-password, MFA disable, org security-policy updates).
//
// Protected route (mounted with `protect` — see authRoutes.js): the caller
// must already hold a valid access token. This adds a SECOND, fresher proof
// on top of that, rather than replacing normal authentication. Accepts
// EITHER a password OR a TOTP code (stepUpVerifySchema requires at least
// one) — a user without MFA enrolled simply has no TOTP option available.
const stepUpVerify = async (req, res) => {
    try {
        const { password, token } = req.body;

        const user = await User
            .findById(req.user._id)
            .select('+password +mfaSecret')
            .skipTenantFilter();

        if (!user) return res.status(404).json({ message: 'User not found.' });

        let verified = false;
        let method   = null;

        if (password) {
            verified = await user.matchPassword(password);
            method   = 'password';
        } else if (token) {
            if (!user.mfaEnabled || !user.mfaSecret) {
                return res.status(400).json({ message: 'MFA is not enabled on this account — use your password instead.' });
            }
            const plainSecret = decryptSecret(user.mfaSecret);
            verified = verifyToken(plainSecret, token);
            method   = 'totp';
        }

        if (!verified) {
            audit(req, 'AUTH_LOGIN_FAILED', {
                actorId: user._id, actorRole: user.role, success: false,
                meta: { reason: 'step_up_failed', method },
            });
            return res.status(401).json({ message: 'Verification failed. Please check your password or code.' });
        }

        const stepUpToken = generateStepUpToken(user._id);

        audit(req, 'AUTH_MFA_VERIFIED', {
            actorId: user._id, actorRole: user.role,
            meta: { event: 'step_up_verified', method },
        });

        return res.status(200).json({
            stepUpToken,
            expiresIn: STEP_UP_TOKEN_EXPIRES_IN_SECONDS,
        });
    } catch (err) {
        console.error('[Auth] stepUpVerify:', err.message);
        return res.status(500).json({ message: 'Verification failed. Please try again.' });
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
    registerUser, loginUser, platformLoginUser, refreshAccessToken,
    logoutUser, logoutAllDevices, changePassword, getMe, stepUpVerify,
    requestRegistrationOtp, resendRegistrationOtp, verifyRegistrationOtp,
    forgotPassword, resendForgotPasswordOtp, verifyForgotPasswordOtp, resetPasswordWithToken,
};
