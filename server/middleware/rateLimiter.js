import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import getRedisClient from '../config/redis.js';
import { extractOrgIdentifier } from '../utils/orgIdentifier.js';

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
// PHASE2-H1 FIX: the key previously was `${ip}:${email}` only. Because
// CareConnect intentionally allows the same email to exist independently in
// different hospitals (that's the whole point of the (email, organisationId)
// compound unique index — see User.js), two completely unrelated accounts
// that happen to share an email — one in Hospital A, one in Hospital B —
// produced the IDENTICAL rate-limit key when attempted from the same IP.
// Five failed attempts against Hospital A's account would lock out attempts
// against Hospital B's account too, for 15 minutes, even though the accounts
// share nothing but an email string and an unlucky visitor's IP.
//
// The key now also includes the raw org identifier the client claims
// (X-Organisation-Slug/-Id header or subdomain — extracted with no DB call
// via extractOrgIdentifier, since a rate-limit key only needs to bucket
// correctly, not validate that the claimed org actually exists). Two
// different claimed orgs now get two different buckets. Single-org
// deployments that never send an org header are unaffected — every request
// resolves to the same 'no-org' bucket component, identical to today's
// behavior.
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
    keyGenerator: (req) => {
        const org    = extractOrgIdentifier(req);
        const orgKey = org ? `${org.type}:${org.value}` : 'no-org';
        return `${ipKeyGenerator(req.ip)}:${orgKey}:${(req.body?.email || '').toLowerCase()}`;
    },
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

// -- A2: Step-up verification rate limiter ------------------------------------
// Keyed by the AUTHENTICATED user's id rather than IP+email — this route
// sits behind `protect`, so req.user is always populated by the time this
// limiter runs, and the thing worth rate-limiting is "how many times has
// THIS account's password/TOTP been guessed at just now", not IP traffic
// generally (a shared-IP office full of legitimate staff shouldn't share a
// bucket the way anonymous login attempts might reasonably want to).
// Falls back to ipKeyGenerator only in the defensive case req.user is
// somehow missing (should never happen given route ordering, but a rate
// limiter should never itself throw if that invariant is ever violated).
const STEP_UP_WINDOW_MS = 15 * 60 * 1000;
export const stepUpRateLimiter = rateLimit({
    validate: false,
    windowMs: STEP_UP_WINDOW_MS,
    max: 8,
    message: {
        message: 'Too many verification attempts. Please wait 15 minutes before trying again.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('step-up', STEP_UP_WINDOW_MS / 1000),
    keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req.ip),
});
