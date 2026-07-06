import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import getRedisClient from '../config/redis.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const ACCESS_TOKEN_EXPIRES    = process.env.JWT_ACCESS_EXPIRES    || '15m';
const REFRESH_TOKEN_EXPIRES   = process.env.JWT_REFRESH_EXPIRES   || '7d';
const REFRESH_TOKEN_TTL_SEC   = 7 * 24 * 60 * 60;
// MFA-pending token is very short-lived — user has 5 minutes to enter their TOTP
const MFA_PENDING_EXPIRES     = process.env.JWT_MFA_PENDING_EXPIRES || '5m';
// Reset-pending token — issued after a forgot-password OTP is verified,
// short-lived, single purpose (only usable against /auth/forgot-password/reset)
const RESET_PENDING_EXPIRES   = process.env.JWT_RESET_PENDING_EXPIRES || '10m';

// ─── Access token ─────────────────────────────────────────────────────────────
// PHASE1-C2 FIX: access tokens now carry an `organisationId` claim (null for
// super_admin / any user with no org). Previously the payload was only
// { id, role }, which meant the token itself carried no verifiable tenant
// binding — any consumer of the token (including this app's own `protect`
// middleware) had no way to detect a user being silently re-scoped to a
// different tenant after the token was issued, without a fresh DB lookup
// AND an explicit comparison (which nothing did — see authMiddleware.js).
// This claim doesn't replace the DB check in `protect` (a live lookup is
// still authoritative), it lets `protect` catch drift between the org the
// token was issued for and the user's *current* org in one extra comparison.
export const generateAccessToken = (user) => {
    return jwt.sign(
        {
            id:             user._id,
            role:           user.role,
            organisationId: user.organisationId ? user.organisationId.toString() : null,
        },
        process.env.JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRES }
    );
};

export const verifyAccessToken = (token) => {
    return jwt.verify(token, process.env.JWT_SECRET);
};

// ─── MFA-pending token ────────────────────────────────────────────────────────
// Issued after password is correct but before TOTP is verified.
// This is a DIFFERENT secret from JWT_SECRET — it signs only the pending state.
// The client sends this back to /api/auth/mfa/validate with their TOTP token.
// It contains no role or session claims — it only identifies the user for MFA.
export const generateMfaPendingToken = (userId) => {
    return jwt.sign(
        { id: userId, mfaPending: true },
        process.env.JWT_MFA_PENDING_SECRET || process.env.JWT_SECRET + '_mfa',
        { expiresIn: MFA_PENDING_EXPIRES }
    );
};

export const verifyMfaPendingToken = (token) => {
    const payload = jwt.verify(
        token,
        process.env.JWT_MFA_PENDING_SECRET || process.env.JWT_SECRET + '_mfa'
    );
    if (!payload.mfaPending) {
        throw new Error('Not an MFA pending token');
    }
    return payload;
};

// ─── Reset-pending token (forgot-password flow) ──────────────────────────────
// Issued only after the user has proven ownership of their email via OTP.
// Single purpose: exchanged for a new password at /auth/forgot-password/reset.
// Distinct secret from both JWT_SECRET and the MFA-pending secret so a leaked
// reset token can never be replayed as an access or MFA token, and vice versa.
export const generateResetPendingToken = (userId) => {
    return jwt.sign(
        { id: userId, resetPending: true },
        process.env.JWT_RESET_PENDING_SECRET || process.env.JWT_SECRET + '_reset',
        { expiresIn: RESET_PENDING_EXPIRES }
    );
};

export const verifyResetPendingToken = (token) => {
    const payload = jwt.verify(
        token,
        process.env.JWT_RESET_PENDING_SECRET || process.env.JWT_SECRET + '_reset'
    );
    if (!payload.resetPending) {
        throw new Error('Not a reset pending token');
    }
    return payload;
};

// ─── Refresh token ────────────────────────────────────────────────────────────
export const generateRefreshToken = async (userId) => {
    const redis   = getRedisClient();
    const tokenId = uuidv4();
    const key     = `refresh:${userId}:${tokenId}`;
    await redis.set(key, 'valid', 'EX', REFRESH_TOKEN_TTL_SEC);
    return jwt.sign(
        { id: userId, jti: tokenId },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: REFRESH_TOKEN_EXPIRES }
    );
};

export const verifyRefreshToken = async (token) => {
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const redis   = getRedisClient();
    const key     = `refresh:${payload.id}:${payload.jti}`;
    const value   = await redis.get(key);
    if (!value) throw new Error('Refresh token revoked or expired');
    return payload;
};

export const revokeRefreshToken = async (token) => {
    try {
        const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
        const redis   = getRedisClient();
        await redis.del(`refresh:${payload.id}:${payload.jti}`);
    } catch {
        // already invalid
    }
};

export const revokeAllRefreshTokens = async (userId) => {
    const redis   = getRedisClient();
    const pattern = `refresh:${userId}:*`;
    let cursor    = '0';
    do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
};

// ─── Cookie helpers ───────────────────────────────────────────────────────────
const COOKIE_NAME = 'careconnect_refresh';

export const setRefreshCookie = (res, token) => {
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge:   REFRESH_TOKEN_TTL_SEC * 1000,
        path:     '/api/auth',
    });
};

export const clearRefreshCookie = (res) => {
    res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path:     '/api/auth',
    });
};

export const getRefreshCookie = (req) => req.cookies?.[COOKIE_NAME] ?? null;
