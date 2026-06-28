import { v4 as uuidv4 } from 'uuid';
import getRedisClient from '../config/redis.js';

const PREFIX = 'mfa:setup';
const TTL_SECONDS = 300; // 5 minutes

const key = (setupId) => `${PREFIX}:${setupId}`;

/**
 * Creates a temporary MFA setup session.
 *
 * Returns:
 * {
 *   setupId,
 *   expiresIn
 * }
 */
export const createMfaSetupSession = async (userId, secret) => {
    const redis = getRedisClient();

    const setupId = uuidv4();

    await redis.set(
        key(setupId),
        JSON.stringify({
            userId: userId.toString(),
            secret,
            createdAt: Date.now(),
        }),
        'EX',
        TTL_SECONDS
    );

    return {
        setupId,
        expiresIn: TTL_SECONDS,
    };
};

/**
 * Loads a setup session.
 *
 * Returns:
 * {
 *   userId,
 *   secret,
 *   createdAt
 * }
 *
 * or null if expired.
 */
export const getMfaSetupSession = async (setupId) => {
    const redis = getRedisClient();

    const data = await redis.get(key(setupId));

    if (!data) {
        return null;
    }

    return JSON.parse(data);
};

/**
 * Deletes the setup session.
 */
export const deleteMfaSetupSession = async (setupId) => {
    const redis = getRedisClient();

    await redis.del(key(setupId));
};

/**
 * Refreshes the TTL.
 * (Optional helper for future use.)
 */
export const refreshMfaSetupSession = async (setupId) => {
    const redis = getRedisClient();

    await redis.expire(key(setupId), TTL_SECONDS);
};

export const MFA_SETUP_TTL_SECONDS = TTL_SECONDS;