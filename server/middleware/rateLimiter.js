import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import getRedisClient from '../config/redis.js';

// ─── Redis store for rate limiter ─────────────────────────────────────────────

const makeRedisStore = (prefix) => ({
    init: () => {},

    async increment(key) {
        const redis = getRedisClient();
        const redisKey = `rl:${prefix}:${key}`;

        const current = await redis.incr(redisKey);

        if (current === 1) {
            await redis.expire(redisKey, 900);
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

// ─── Login rate limiter ───────────────────────────────────────────────────────

export const loginRateLimiter = rateLimit({
    validate: false,
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: {
        message:
            'Too many login attempts from this IP. Please try again in 15 minutes.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    store: makeRedisStore('login'),
    keyGenerator: (req) =>
        `${ipKeyGenerator(req.ip)}:${(req.body?.email || '').toLowerCase()}`,
});

// ─── Register rate limiter ────────────────────────────────────────────────────

export const registerRateLimiter = rateLimit({
    validate: false,
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: {
        message:
            'Too many accounts created from this IP. Please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('register'),
});

// ─── Refresh token rate limiter ───────────────────────────────────────────────

export const refreshRateLimiter = rateLimit({
    validate: false,
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: {
        message:
            'Too many token refresh requests. Please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('refresh'),
});

// ─── General API rate limiter ─────────────────────────────────────────────────

export const apiRateLimiter = rateLimit({
    validate: false,
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: {
        message: 'Too many requests from this IP. Please slow down.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('api'),
});

// ─── OTP FEATURE: Registration OTP rate limiter ───────────────────────────────
// Coarse IP-based guard on the request-otp/resend-otp endpoints, on top of
// the fine-grained per-registrationId attempt lockout enforced inside
// otpAuthController via recordOtpFailure/checkOtpLockout. This stops someone
// from spinning up unlimited registration sessions from one IP to spam an
// inbox or hammer the mailer.
export const registerOtpRateLimiter = rateLimit({
    validate: false,
    windowMs: 15 * 60 * 1000,
    max: 8,
    message: {
        message: 'Too many registration attempts from this IP. Please try again in 15 minutes.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('register-otp'),
});

// ─── OTP FEATURE: Forgot-password rate limiter ────────────────────────────────
export const forgotPasswordRateLimiter = rateLimit({
    validate: false,
    windowMs: 15 * 60 * 1000,
    max: 8,
    message: {
        message: 'Too many password reset requests from this IP. Please try again in 15 minutes.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('forgot-password'),
});
