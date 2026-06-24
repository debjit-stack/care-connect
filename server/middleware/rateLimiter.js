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