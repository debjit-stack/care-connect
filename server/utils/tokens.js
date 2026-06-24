import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import getRedisClient from '../config/redis.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_EXPIRES  = process.env.JWT_ACCESS_EXPIRES  || '15m';
const REFRESH_TOKEN_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';
const REFRESH_TOKEN_TTL_SEC = 7 * 24 * 60 * 60; // 7 days in seconds

// ─── Access token ─────────────────────────────────────────────────────────────

export const generateAccessToken = (user) => {
    return jwt.sign(
        {
            id:   user._id,
            role: user.role,
        },
        process.env.JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRES }
    );
};

export const verifyAccessToken = (token) => {
    return jwt.verify(token, process.env.JWT_SECRET);
};

// ─── Refresh token ────────────────────────────────────────────────────────────
// Refresh tokens are opaque UUIDs stored in Redis.
// Redis key: refresh:{userId}:{tokenId}  →  value: "valid"
// This lets us revoke ALL sessions for a user or a single session.

export const generateRefreshToken = async (userId) => {
    const redis   = getRedisClient();
    const tokenId = uuidv4();
    const key     = `refresh:${userId}:${tokenId}`;

    await redis.set(key, 'valid', 'EX', REFRESH_TOKEN_TTL_SEC);

    // The token sent to the client encodes both userId and tokenId so the
    // server can look up the exact Redis key on verification.
    return jwt.sign(
        { id: userId, jti: tokenId },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: REFRESH_TOKEN_EXPIRES }
    );
};

export const verifyRefreshToken = async (token) => {
    // Step 1 — verify JWT signature and expiry
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

    // Step 2 — verify the token still exists in Redis (not revoked)
    const redis = getRedisClient();
    const key   = `refresh:${payload.id}:${payload.jti}`;
    const value = await redis.get(key);

    if (!value) {
        throw new Error('Refresh token revoked or expired');
    }

    return payload;
};

export const revokeRefreshToken = async (token) => {
    try {
        const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
        const redis   = getRedisClient();
        const key     = `refresh:${payload.id}:${payload.jti}`;
        await redis.del(key);
    } catch {
        // Token already invalid — nothing to revoke
    }
};

export const revokeAllRefreshTokens = async (userId) => {
    const redis   = getRedisClient();
    // Scan for all refresh tokens belonging to this user
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
        httpOnly:  true,                                     // not readable by JS
        secure:    process.env.NODE_ENV === 'production',    // HTTPS only in prod
        sameSite:  'strict',                                 // CSRF protection
        maxAge:    REFRESH_TOKEN_TTL_SEC * 1000,             // milliseconds
        path:      '/api/auth',                              // only sent to auth routes
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
