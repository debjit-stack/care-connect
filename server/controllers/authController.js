import bcrypt        from 'bcryptjs';
import User          from '../models/User.js';
import Organisation  from '../models/Organisation.js';
import Membership    from '../models/Membership.js';
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

// ─── PHASE M3: resolve or create this user's Membership for this org ─────────
// Called at every point an access token is issued for an org-scoped login
// (i.e. everywhere EXCEPT super_admin/platform-login). Deliberately
// NON-DESTRUCTIVE toward an EXISTING Membership — it only ever creates one
// via $setOnInsert when none exists yet (a safety net for any gap between
// the Phase M2 backfill and a User created since), and never overwrites an
// existing Membership's role/status. Keeping status/role changes exclusive
// to the dedicated create/restore/delete code paths (registerPatient,
// createStaff, createDoctor, deleteUser — Phase M3 dual-write) means login
// itself stays a read-mostly operation and can never silently reactivate a
// Membership that was deliberately removed.
//
// Returns null for super_admin (no Membership concept applies) or when no
// org is available (should not happen for a non-super_admin login, but
// fails safe rather than throwing).
const resolveOrCreateMembership = async (user, org) => {
    if (!org || user.role === 'super_admin') return null;

    const membership = await Membership.findOneAndUpdate(
        { userId: user._id, organisationId: org._id },
        {
            $setOnInsert: {
                userId:         user._id,
                organisationId: org._id,
                role:           user.role,
                status:         'active',
                forceMfa:       user.forceMfa ?? false,
                joinedAt:       new Date(),
            },
        },
        { upsert: true, new: true }
    );

    return membership;
};

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
    const result = await resolveOrganisation(req);
    return result.status === 'resolved' ? result.org : null;
};

// ─── Shared: issue tokens + respond for a fully-authenticated user ───────────
// PHASE M3 FIX: now resolves/creates this user's Membership for `org`
// before minting the access token, and embeds membershipId in it. See
// resolveOrCreateMembership above for why this is safe to call
// unconditionally (super_admin/no-org simply yields null, and
// generateAccessToken already treats a null membershipId as "omit the
// claim" — fully backward compatible with pre-Phase-M3 tokens still in
// circulation).
const issueLoginResponse = async (res, req, user, org) => {
    const membership = await resolveOrCreateMembership(user, org);

    const accessToken  = generateAccessToken(user, membership?._id ?? null);
    const refreshToken = await generateRefreshToken(user._id);
    setRefreshCookie(res, refreshToken);

    audit(req, 'AUTH_LOGIN_SUCCESS', {
        actorId:   user._id,
        actorRole: user.role,
        meta:      { orgId: org?._id?.toString() ?? null, membershipId: membership?._id?.toString() ?? null },
    });

    return res.status(200).json({ user: safeUser(user, org), accessToken });
};

// ─── Helper: create a patient User from an already-hashed password ──────────
const createPatientFromHashedPassword = async ({ name, email, passwordHash }) => {
    const user = new User({ name, email, password: passwordHash, role: 'patient' });
    user._preHashed = true;
    await user.save();
    return user;
};

// ─── POST /api/auth/register ──────────────────────────────────────────────────
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

        // PHASE M3 FIX: dual-write — a freshly self-registered patient gets
        // their Membership created at the same moment their User document
        // is created, not lazily discovered on next login. Harmless no-op
        // if org is null (matches resolveOrCreateMembership's own guard).
        const membership = await resolveOrCreateMembership(user, org);

        const accessToken  = generateAccessToken(user, membership?._id ?? null);
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
// ─── POST /api/auth/register/request-otp ──────────────────────────────────────
// PHASE M7 PREREQUISITE FIX: same global-identity reasoning as Phase
// M5/M6 (registerPatient/createStaff/createDoctor), applied to
// self-registration. This MUST be fixed before Phase M7 adds a global
// unique index on User.email — without it, a second-hospital
// self-registration for an email that already exists elsewhere would
// start hitting a raw duplicate-key error instead of today's (already
// wrong, but at least non-crashing) silent-duplicate-creation behaviour.
//
// Trust model note: OTP verification proves control of the mailbox, which
// this codebase already treats as sufficient proof to take an action on an
// existing account WITHOUT the original password (see the forgot-password
// flow, which resets a password via email OTP alone). Reusing that same
// standard here — allowing OTP-proven self-registration to attach a new
// Membership to an existing identity — is consistent with, not a
// weakening of, the trust level already established elsewhere in this
// codebase. What it must NOT do is let the newly-submitted password
// overwrite the existing identity's real password, or let the submitted
// name overwrite it either — those remain owned exclusively by whoever
// already controls that password, exactly as in Phase M5/M6.
const requestRegistrationOtp = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const org   = await resolveOrgFromRequest(req);
        const orgId = org?._id ?? null;

        if (org) {
            if (!org.isAccessible) return res.status(403).json({ message: 'Organisation account is not active.' });
            if (org.features?.patientPortal === false) return res.status(403).json({ message: 'Patient self-registration is disabled.' });
        }

        // Global identity lookup — no organisationId in this query.
        const matches = await User.find({ email }).skipTenantFilter();

        if (matches.length > 1) {
            console.error(`[Auth] requestRegistrationOtp: multiple global User documents share email ${email} — manual resolution required.`, matches.map((m) => m._id));
            return res.status(409).json({ message: 'An account with this email already exists' });
        }

        const existingUser = matches[0] ?? null;

        let membershipAction = 'create'; // 'create' | 'reuse' | 'reactivate'
        let existingUserId   = null;

        if (existingUser) {
            existingUserId = existingUser._id.toString();

            if (!orgId) {
                // No-org (single-tenant/dev) deployment — an existing
                // global identity with no org context to disambiguate
                // against is treated the same as today: already exists.
                return res.status(409).json({ message: 'An account with this email already exists' });
            }

            const membership = await Membership.findOne({ userId: existingUser._id, organisationId: orgId });

            if (!membership) {
                membershipAction = 'reuse';
            } else if (membership.status === 'active') {
                return res.status(409).json({
                    message: membership.role === 'patient'
                        ? 'An account with this email already exists at this organisation. Please log in instead.'
                        : 'This email belongs to an account with a different active role at this organisation.',
                });
            } else if (membership.role !== 'patient') {
                return res.status(409).json({
                    message: 'This email belongs to a deleted account with a different role at this organisation. Please contact the hospital directly.',
                });
            } else {
                membershipAction = 'reactivate';
            }
        }

        const otp     = generateOtp();
        const otpHash = await hashOtp(otp);
        const passwordHash = await bcrypt.hash(password, 12);

        const { id: registrationId, expiresIn } = await createSession('register', {
            name,
            email,
            passwordHash,
            otpHash,
            organisationId:   orgId ? orgId.toString() : null,
            existingUserId,
            membershipAction,
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
        }, { ttlSeconds: REGISTRATION_OTP_TTL_SECONDS });

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
// ─── POST /api/auth/register/verify-otp ───────────────────────────────────────
// PHASE M7 PREREQUISITE FIX: branches on the membershipAction decided by
// requestRegistrationOtp above — 'create' (brand-new identity, unchanged
// from pre-M7 behaviour), 'reuse' (existing identity, new org — Membership
// only, password/name never touched), or 'reactivate' (existing identity,
// removed Membership at this org, same role — reactivate it).
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

        const orgId             = session.organisationId || null;
        const membershipAction  = session.membershipAction || 'create';
        const org               = orgId ? await Organisation.findById(orgId) : null;

        let user;

        if (membershipAction === 'create') {
            // Brand-new identity — unchanged from pre-M7 behaviour, except
            // the existence re-check below is now global rather than
            // org-scoped, matching requestRegistrationOtp's own check.
            const matches = await User.find({ email: session.email }).skipTenantFilter();
            if (matches.length > 0) {
                await deleteSession('register', registrationId);
                return res.status(409).json({ message: 'An account with this email already exists' });
            }

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

            await Membership.create({
                userId:         user._id,
                organisationId: orgId,
                role:           'patient',
                status:         'active',
                joinedAt:       new Date(),
            });
        } else {
            // 'reuse' or 'reactivate' — existing identity. Re-fetch fresh
            // (not from the Redis session, which only stored the id) to
            // avoid acting on stale data, and to allow password/MFA reads
            // needed for safeUser()/token issuance below.
            user = await User.findById(session.existingUserId).skipTenantFilter();
            if (!user || user.deletedAt) {
                await deleteSession('register', registrationId);
                return res.status(404).json({ message: 'Account no longer available. Please start again.' });
            }

            if (membershipAction === 'reuse') {
                await Membership.create({
                    userId:         user._id,
                    organisationId: orgId,
                    role:           'patient',
                    status:         'active',
                    joinedAt:       new Date(),
                });
            } else {
                // 'reactivate'
                const membership = await Membership.findOne({ userId: user._id, organisationId: orgId });
                if (!membership || membership.status === 'active') {
                    // Re-check: state may have changed since request-otp
                    // (e.g. someone else already reactivated it). Fail
                    // safe rather than silently double-processing.
                    await deleteSession('register', registrationId);
                    return res.status(409).json({ message: 'This account is already active at this organisation. Please log in instead.' });
                }
                membership.status    = 'active';
                membership.removedAt = null;
                await membership.save();
            }
        }

        await deleteSession('register', registrationId);

        // PHASE M3 FIX: same dual-write pattern as registerUser.
        const membership   = await resolveOrCreateMembership(user, org);
        const accessToken  = generateAccessToken(user, membership?._id ?? null);
        const refreshToken = await generateRefreshToken(user._id);
        setRefreshCookie(res, refreshToken);

        audit(req, 'AUTH_LOGIN_SUCCESS', {
            actorId:   user._id,
            actorRole: user.role,
            meta:      { event: 'registration_otp', membershipAction, orgId: orgId?.toString() ?? null },
        });

        // Welcome email only for a genuinely brand-new identity — a
        // 'reuse'/'reactivate' outcome means this person already knows
        // this platform.
        if (membershipAction === 'create') {
            sendMail({
                to:  user.email,
                org,
                ...templates.welcomePatient({ name: user.name, org }),
            });
        }

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

            audit(req, 'AUTH_PASSWORD_RESET_REQUESTED', {
                actorId: user._id, actorRole: user.role, success: true,
            });
        } else {
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

                    await patchSession('forgot', user._id.toString(), {
                        otpHash,
                        lastSentAt: Date.now(),
                    }, { ttlSeconds: FORGOT_PASSWORD_OTP_TTL_SECONDS });

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

// ─── Shared: lockout check + password verification (unchanged from before) ──
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

    // PATIENT MFA REMOVAL: single centralized bypass gate.
    if (user.role === 'patient') {
        return issueLoginResponse(res, req, user, org);
    }

    // Enterprise MFA Decision Tree (STAFF ONLY from here down).
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
const loginUser = async (req, res) => {
    try {
        const { email } = req.body;

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

            audit(req, 'AUTH_LOGIN_FAILED', {
                actorId: maybeSuperAdmin._id, actorRole: maybeSuperAdmin.role, success: false,
                meta: { reason: 'wrong_login_endpoint' },
            });
            return res.status(403).json({ message: 'Please use the Platform Login.' });
        }

        const orgResult = await resolveOrganisation(req);

        let org = null;
        if (orgResult.status === 'resolved') {
            org = orgResult.org;
        } else if (orgResult.status === 'not_found') {
            return res.status(400).json({ message: 'Organisation not specified. Include X-Organisation-Slug header.' });
        } else if (orgResult.status === 'ambiguous') {
            return res.status(400).json({ message: 'Organisation not specified. Include X-Organisation-Slug header.' });
        }

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
const platformLoginUser = async (req, res) => {
    try {
        const { email } = req.body;

        const superAdmin = await User.findOne({
            email, role: 'super_admin', deletedAt: null,
        })
            .select('+password +loginAttempts +lockUntil +passwordChangedAt +forceMfa')
            .skipTenantFilter();

        if (!superAdmin) {
            audit(req, 'AUTH_LOGIN_FAILED', {
                success: false,
                meta: { reason: 'platform_login_no_such_super_admin', email },
            });
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        // Super Admin never belongs to an organisation — issueLoginResponse
        // will correctly resolve no Membership at all (see
        // resolveOrCreateMembership's super_admin guard).
        return authenticateAndRespond(req, res, superAdmin, null);
    } catch (err) {
        console.error('[Auth] platformLoginUser:', err.message);
        return res.status(500).json({ message: 'Login failed. Please try again.' });
    }
};

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
// PHASE M3 NOTE: refresh re-mints the access token via generateAccessToken(user)
// WITHOUT re-resolving membershipId here — this matches the architecture
// document's Phase M3 backward-compatibility plan: a refresh issued against
// a pre-Phase-M3 session simply continues to omit the claim (protect falls
// back to the pre-existing Phase 1 checks for that token), and since access
// tokens are short-lived, this self-resolves within one login cycle. A
// dedicated fix to also carry membershipId through refresh is deferred to
// keep this phase's diff minimal; tracked as a Phase M3 follow-up.
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

        // PHASE M3: re-resolve membership so a refreshed token also carries
        // membershipId going forward (closes the gap noted above on the
        // very next refresh cycle, rather than requiring a full re-login).
        const org = user.organisationId ? await Organisation.findById(user.organisationId) : null;
        const membership = await resolveOrCreateMembership(user, org);

        const newAccessToken  = generateAccessToken(user, membership?._id ?? null);
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

// ─── A2: POST /api/auth/step-up/verify ─────────────────────────────────────────
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
