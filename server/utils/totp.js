/**
 * server/utils/totp.js
 * ────────────────────
 * TOTP (Time-based One-Time Password) utilities using speakeasy.
 *
 * Flow:
 *   1. generateSecret(user)  → { secret (base32), otpauthUrl, qrDataUri }
 *   2. verifyToken(secret, token) → boolean
 *   3. encryptSecret / decryptSecret → AES-256-GCM storage
 *
 * The raw secret is NEVER stored in plain text. It is AES-256-GCM encrypted
 * with MFA_ENCRYPTION_KEY before being saved to User.mfaSecret.
 */

import speakeasy  from 'speakeasy';
import QRCode     from 'qrcode';
import crypto     from 'crypto';
import env        from '../config/env.js';

const APP_NAME          = env.APP_NAME;
const ALGORITHM         = 'aes-256-gcm';
const IV_LENGTH         = 12; // 96-bit IV for GCM
const TAG_LENGTH        = 16;

// ── Validate encryption key at startup ───────────────────────────────────────
const getEncKey = () => {
    const keyHex = env.MFA_ENCRYPTION_KEY;

    if (!keyHex) {
        throw new Error("MFA_ENCRYPTION_KEY is missing");
    }

    if (keyHex.length !== 64) {
        throw new Error(
            `MFA_ENCRYPTION_KEY must be exactly 64 hex characters. Current length: ${keyHex.length}`
        );
    }

    if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
        throw new Error("Invalid hex key");
    }

    return Buffer.from(keyHex, "hex");
};

// ── Generate a new TOTP secret for a user ────────────────────────────────────
export const generateSecret = async (userEmail) => {
    const secret = speakeasy.generateSecret({
        name:   `${APP_NAME} (${userEmail})`,
        issuer: APP_NAME,
        length: 20,
    });

    // Generate QR code as a data URI (base64 PNG) so the frontend
    // can display it inline without any additional server roundtrip.
    const qrDataUri = await QRCode.toDataURL(secret.otpauth_url);

    return {
        secret:      secret.base32,   // raw — only returned once, never stored plain
        otpauthUrl:  secret.otpauth_url,
        qrDataUri,
    };
};

// ── Verify a 6-digit TOTP token ───────────────────────────────────────────────
// window: 1 allows the previous and next 30-second windows to account for
// minor clock skew between server and authenticator app.
export const verifyToken = (base32Secret, token) => {
    return speakeasy.totp.verify({
        secret:   base32Secret,
        encoding: 'base32',
        token:    String(token).replace(/\s/g, ''),
        window:   1,
    });
};

// ── Encrypt a TOTP secret for DB storage ──────────────────────────────────────
export const encryptSecret = (plainSecret) => {
    const key = getEncKey();
    const iv  = crypto.randomBytes(IV_LENGTH);

    const cipher     = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted  = Buffer.concat([cipher.update(plainSecret, 'utf8'), cipher.final()]);
    const authTag    = cipher.getAuthTag();

    // Format: iv(hex):tag(hex):ciphertext(hex)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

// ── Decrypt a stored TOTP secret ──────────────────────────────────────────────
export const decryptSecret = (encryptedSecret) => {
    const key    = getEncKey();
    const parts  = encryptedSecret.split(':');

    if (parts.length !== 3) {
        throw new Error('Invalid encrypted secret format');
    }

    const iv         = Buffer.from(parts[0], 'hex');
    const authTag    = Buffer.from(parts[1], 'hex');
    const ciphertext = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};
