import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import getRedisClient from '../config/redis.js';

const ACCESS_TOKEN_EXPIRES    = process.env.JWT_ACCESS_EXPIRES    || '15m';
const REFRESH_TOKEN_EXPIRES   = process.env.JWT_REFRESH_EXPIRES   || '7d';
const REFRESH_TOKEN_TTL_SEC   = 7 * 24 * 60 * 60;
const MFA_PENDING_EXPIRES     = process.env.JWT_MFA_PENDING_EXPIRES || '5m';
const RESET_PENDING_EXPIRES   = process.env.JWT_RESET_PENDING_EXPIRES || '10m';

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

// ─── Step-up token (A2: sensitive-action re-verification) ────────────────────
// Proves the caller has recently re-supplied their password or a valid TOTP
// code, independent of how old their access token is. Short-lived (5 min),
// single-purpose, and — like mfaPending/resetPending — signed with its own
// dedicated secret so a leaked token of one type can never be replayed as
// another. Issued by POST /api/auth/step-up/verify (protected route — the
// caller must already hold a valid access token; this only adds a second,
// fresher proof on top of it), consumed by requireStepUp middleware.
const STEP_UP_EXPIRES = process.env.JWT_STEP_UP_EXPIRES || '5m';

export const generateStepUpToken = (userId) => {
    return jwt.sign(
        { id: userId, stepUp: true },
        process.env.JWT_STEP_UP_SECRET || process.env.JWT_SECRET + '_stepup',
        { expiresIn: STEP_UP_EXPIRES }
    );
};

export const verifyStepUpToken = (token) => {
    const payload = jwt.verify(
        token,
        process.env.JWT_STEP_UP_SECRET || process.env.JWT_SECRET + '_stepup'
    );
    if (!payload.stepUp) {
        throw new Error('Not a step-up token');
    }
    return payload;
};

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
