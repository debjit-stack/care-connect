/**
 * server/utils/redisSessionStore.js
 * ───────────────────────────────────
 * Generic, prefix-keyed, TTL-based Redis session helper.
 *
 * Used by:
 *   - registration OTP flow      (prefix: 'register')
 *   - forgot-password OTP flow   (prefix: 'forgot')
 *
 * NOT used by mfaSetupStore.js — that file is live, working, staff-only
 * code and is intentionally left untouched by this feature. A future
 * cleanup pass could migrate it onto this generic store, but that's a
 * separate refactor with its own review, not bundled here.
 *
 * Session shape is caller-defined; this module only handles the
 * get/set/patch/delete/TTL mechanics.
 */

import { v4 as uuidv4 } from 'uuid';
import getRedisClient from '../config/redis.js';

const key = (prefix, id) => `session:${prefix}:${id}`;

/**
 * Creates a new session under `prefix`, returns { id, expiresIn }.
 * If `id` is not provided, a uuid is generated.
 */
export const createSession = async (prefix, data, ttlSeconds, id = null) => {
    const redis = getRedisClient();
    const sessionId = id || uuidv4();

    await redis.set(
        key(prefix, sessionId),
        JSON.stringify(data),
        'EX',
        ttlSeconds
    );

    return { id: sessionId, expiresIn: ttlSeconds };
};

/**
 * Loads a session. Returns null if missing/expired.
 */
export const getSession = async (prefix, id) => {
    const redis = getRedisClient();
    const data = await redis.get(key(prefix, id));
    if (!data) return null;
    return JSON.parse(data);
};

/**
 * Merges `patch` into the existing session and rewrites it, optionally
 * resetting the TTL (pass the same ttlSeconds used at creation to refresh,
 * or omit to preserve the current remaining TTL).
 */
export const patchSession = async (prefix, id, patch, ttlSeconds = null) => {
    const redis = getRedisClient();
    const redisKey = key(prefix, id);
    const existing = await getSession(prefix, id);
    if (!existing) return null;

    const updated = { ...existing, ...patch };

    if (ttlSeconds) {
        await redis.set(redisKey, JSON.stringify(updated), 'EX', ttlSeconds);
    } else {
        const ttl = await redis.ttl(redisKey);
        await redis.set(redisKey, JSON.stringify(updated), 'EX', ttl > 0 ? ttl : 60);
    }

    return updated;
};

/**
 * Deletes a session outright (used after successful verification, or to
 * invalidate a stale one before issuing a new OTP).
 */
export const deleteSession = async (prefix, id) => {
    const redis = getRedisClient();
    await redis.del(key(prefix, id));
};

/**
 * Returns remaining TTL in seconds, or 0 if the session doesn't exist.
 */
export const getSessionTtl = async (prefix, id) => {
    const redis = getRedisClient();
    const ttl = await redis.ttl(key(prefix, id));
    return ttl > 0 ? ttl : 0;
};
