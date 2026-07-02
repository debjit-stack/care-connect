/**
 * server/utils/totp.js
 * ────────────────────
 * TOTP utilities using speakeasy.
 * P3B: OTP rate limiting helpers (Redis attempt counter)
 * P3C: Recovery code generation, hashing, verification
 */

import speakeasy  from 'speakeasy';
import QRCode     from 'qrcode';
import crypto     from 'crypto';
import bcrypt     from 'bcryptjs';
import env        from '../config/env.js';
import getRedisClient from '../config/redis.js';

const APP_NAME   = env.APP_NAME;
const ALGORITHM  = 'aes-256-gcm';
const IV_LENGTH  = 12;

// ── Encryption key ────────────────────────────────────────────────────────────
const getEncKey = () => {
    const keyHex = env.MFA_ENCRYPTION_KEY;
    if (!keyHex)             throw new Error('MFA_ENCRYPTION_KEY is missing');
    if (keyHex.length !== 64) throw new Error(`MFA_ENCRYPTION_KEY must be 64 hex chars. Got: ${keyHex.length}`);
    if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error('Invalid hex in MFA_ENCRYPTION_KEY');
    return Buffer.from(keyHex, 'hex');
};

// ── Generate TOTP secret ──────────────────────────────────────────────────────
export const generateSecret = async (userEmail) => {
    const secret = speakeasy.generateSecret({
        name:   `${APP_NAME} (${userEmail})`,
        issuer: APP_NAME,
        length: 20,
    });
    const qrDataUri = await QRCode.toDataURL(secret.otpauth_url);
    return {
        secret:     secret.base32,
        otpauthUrl: secret.otpauth_url,
        qrDataUri,
    };
};

// ── Verify TOTP token ─────────────────────────────────────────────────────────
// window: 1 allows ±30s clock skew
export const verifyToken = (base32Secret, token) => {
    return speakeasy.totp.verify({
        secret:   base32Secret,
        encoding: 'base32',
        token:    String(token).replace(/\s/g, ''),
        window:   1,
    });
};

// ── Encrypt TOTP secret for DB storage ───────────────────────────────────────
export const encryptSecret = (plainSecret) => {
    const key       = getEncKey();
    const iv        = crypto.randomBytes(IV_LENGTH);
    const cipher    = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plainSecret, 'utf8'), cipher.final()]);
    const authTag   = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

// ── Decrypt TOTP secret ───────────────────────────────────────────────────────
export const decryptSecret = (encryptedSecret) => {
    const key    = getEncKey();
    const parts  = encryptedSecret.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted secret format');
    const iv         = Buffer.from(parts[0], 'hex');
    const authTag    = Buffer.from(parts[1], 'hex');
    const ciphertext = Buffer.from(parts[2], 'hex');
    const decipher   = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};

// ─────────────────────────────────────────────────────────────────────────────
// P3B — OTP RATE LIMITING
// ─────────────────────────────────────────────────────────────────────────────
// Key: otp:fail:{userId}
// Max 5 failures in 10 minutes, then lock until TTL expires.
// Called from mfaController.validateMfa and mfaController.verifySetup.

const OTP_MAX_ATTEMPTS  = 5;
const OTP_WINDOW_SEC    = 10 * 60; // 10 minutes

/**
 * Increment OTP failure counter.
 * Returns { attempts, locked } after incrementing.
 */
export const recordOtpFailure = async (userId) => {
    const redis = getRedisClient();
    const key   = `otp:fail:${userId}`;
    const count = await redis.incr(key);
    if (count === 1) {
        // Set TTL only on first failure so the window resets properly
        await redis.expire(key, OTP_WINDOW_SEC);
    }
    return {
        attempts: count,
        locked:   count >= OTP_MAX_ATTEMPTS,
    };
};

/**
 * Check if user is currently locked out of OTP.
 * Returns { locked, remaining } — remaining is seconds until unlock.
 */
export const checkOtpLockout = async (userId) => {
    const redis = getRedisClient();
    const key   = `otp:fail:${userId}`;
    const count = parseInt(await redis.get(key) ?? '0', 10);
    if (count < OTP_MAX_ATTEMPTS) return { locked: false, remaining: 0 };
    const ttl = await redis.ttl(key);
    return { locked: true, remaining: ttl > 0 ? ttl : 0 };
};

/**
 * Clear OTP failure counter on success.
 */
export const clearOtpFailures = async (userId) => {
    const redis = getRedisClient();
    await redis.del(`otp:fail:${userId}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// P3C — RECOVERY CODES
// ─────────────────────────────────────────────────────────────────────────────
// 8 codes, each 8 alphanumeric characters (uppercase).
// Stored as bcrypt hashes — plain codes returned once to user on setup.
// Format shown to user: XXXX-XXXX (split in two for readability).

const RECOVERY_CODE_COUNT  = 8;
const RECOVERY_CODE_LENGTH = 8;
const RECOVERY_CODE_CHARS  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O,0,I,1 (ambiguous)

/**
 * Generate 8 plain recovery codes.
 * Returns array of { plain, formatted } objects.
 */
export const generateRecoveryCodes = () => {
    const codes = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
        let code = '';
        const bytes = crypto.randomBytes(RECOVERY_CODE_LENGTH);
        for (let j = 0; j < RECOVERY_CODE_LENGTH; j++) {
            code += RECOVERY_CODE_CHARS[bytes[j] % RECOVERY_CODE_CHARS.length];
        }
        codes.push({
            plain:     code,
            formatted: `${code.slice(0, 4)}-${code.slice(4)}`,
        });
    }
    return codes;
};

/**
 * Hash a single recovery code for storage.
 * Uses bcrypt with 10 rounds — codes are short so cost is kept low.
 */
export const hashRecoveryCode = async (plainCode) => {
    const normalised = plainCode.replace(/-/g, '').toUpperCase().trim();
    return bcrypt.hash(normalised, 10);
};

/**
 * Verify a submitted recovery code against an array of stored hashes.
 * Returns the index of the matching unused code, or -1 if none match.
 *
 * @param {string} submitted     — raw code from user (may contain dash)
 * @param {Array}  storedCodes   — User.recoveryCodes array [{ codeHash, usedAt }]
 */
export const verifyRecoveryCode = async (submitted, storedCodes) => {
    const normalised = submitted.replace(/-/g, '').toUpperCase().trim();
    if (normalised.length !== RECOVERY_CODE_LENGTH) return -1;

    for (let i = 0; i < storedCodes.length; i++) {
        const entry = storedCodes[i];
        if (entry.usedAt) continue; // already used
        const match = await bcrypt.compare(normalised, entry.codeHash);
        if (match) return i;
    }
    return -1;
};
