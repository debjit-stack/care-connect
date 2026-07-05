import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import getRedisClient from '../config/redis.js';

// -- Redis store for rate limiter ------------------------------------------
// B4 FIX: makeRedisStore previously hardcoded `redis.expire(key, 900)` (15
// minutes) regardless of which limiter used it. registerRateLimiter is
// configured for windowMs: 3600000 (1 hour), but its Redis key expired after
// only 15 minutes -- so the counter silently reset 4x more often than the
// limiter's own config implied, making it 4x weaker than intended (a user
// could register 3 accounts every 15 minutes instead of every hour).
// windowSec is now a required parameter, always derived from the same
// windowMs each limiter is configured with, so the Redis TTL and the
// rate-limit window can never drift apart again.
const makeRedisStore = (prefix, windowSec) => ({
    init: () => {},

    async increment(key) {
        const redis = getRedisClient();
        const redisKey = `rl:${prefix}:${key}`;

        const current = await redis.incr(redisKey);

        if (current === 1) {
            await redis.expire(redisKey, windowSec);
        }

        return {
            totalHits: current,
            resetTime: undefined,
        };
    },

    async decrement(key) {
        const redis = getRedisClient();
        const redisKey = `rl:${prefix}:${key}`;
        await redis.decr(redisKey);
    },

    async resetKey(key) {
        const redis = getRedisClient();
        const redisKey = `rl:${prefix}:${key}`;
        await redis.del(redisKey);
    },
});

// -- Login rate limiter ------------------------------------------------------

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const loginRateLimiter = rateLimit({
    validate: false,
    windowMs: LOGIN_WINDOW_MS,
    max: 5,
    message: {
        message:
            'Too many login attempts from this IP. Please try again in 15 minutes.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    store: makeRedisStore('login', LOGIN_WINDOW_MS / 1000),
    keyGenerator: (req) =>
        `${ipKeyGenerator(req.ip)}:${(req.body?.email || '').toLowerCase()}`,
});

// -- Register rate limiter ----------------------------------------------------

const REGISTER_WINDOW_MS = 60 * 60 * 1000;
export const registerRateLimiter = rateLimit({
    validate: false,
    windowMs: REGISTER_WINDOW_MS,
    max: 3,
    message: {
        message:
            'Too many accounts created from this IP. Please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('register', REGISTER_WINDOW_MS / 1000),
});

// -- Refresh token rate limiter -----------------------------------------------

const REFRESH_WINDOW_MS = 15 * 60 * 1000;
export const refreshRateLimiter = rateLimit({
    validate: false,
    windowMs: REFRESH_WINDOW_MS,
    max: 30,
    message: {
        message:
            'Too many token refresh requests. Please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('refresh', REFRESH_WINDOW_MS / 1000),
});

// -- General API rate limiter --------------------------------------------------

const API_WINDOW_MS = 15 * 60 * 1000;
export const apiRateLimiter = rateLimit({
    validate: false,
    windowMs: API_WINDOW_MS,
    max: 200,
    message: {
        message: 'Too many requests from this IP. Please slow down.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('api', API_WINDOW_MS / 1000),
});

// -- OTP FEATURE: Registration OTP rate limiter -------------------------------
const REGISTER_OTP_WINDOW_MS = 15 * 60 * 1000;
export const registerOtpRateLimiter = rateLimit({
    validate: false,
    windowMs: REGISTER_OTP_WINDOW_MS,
    max: 8,
    message: {
        message: 'Too many registration attempts from this IP. Please try again in 15 minutes.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('register-otp', REGISTER_OTP_WINDOW_MS / 1000),
});

// -- OTP FEATURE: Forgot-password rate limiter --------------------------------
const FORGOT_PASSWORD_WINDOW_MS = 15 * 60 * 1000;
export const forgotPasswordRateLimiter = rateLimit({
    validate: false,
    windowMs: FORGOT_PASSWORD_WINDOW_MS,
    max: 8,
    message: {
        message: 'Too many password reset requests from this IP. Please try again in 15 minutes.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('forgot-password', FORGOT_PASSWORD_WINDOW_MS / 1000),
});
