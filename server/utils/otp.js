/**
 * server/utils/otp.js
 * ────────────────────
 * Plain 6-digit numeric OTP generation + bcrypt hashing/verification.
 * Kept separate from totp.js (which is specifically TOTP/authenticator-app
 * and recovery-code logic) since these OTPs are simple email codes used for
 * registration and password-reset verification — a different mechanism
 * entirely, just sharing the "one-time code" vocabulary.
 *
 * Lockout/attempt-counting is intentionally NOT duplicated here — callers
 * reuse the existing generic Redis-backed helpers from totp.js:
 *   recordOtpFailure(key), checkOtpLockout(key), clearOtpFailures(key)
 * with their own key prefixes (e.g. `register:${registrationId}`,
 * `forgot:${userId}`).
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const OTP_LENGTH = 6;

/** Generates a random 6-digit numeric OTP as a string, e.g. "042817". */
export const generateOtp = () => {
    const min = 10 ** (OTP_LENGTH - 1);
    const max = 10 ** OTP_LENGTH;
    return String(crypto.randomInt(min, max));
};

/** Hashes a plain OTP for storage (never store plain codes anywhere). */
export const hashOtp = async (plainOtp) => bcrypt.hash(plainOtp, 10);

/** Verifies a submitted OTP against its stored hash. */
export const verifyOtpHash = async (submittedOtp, hash) => {
    if (!submittedOtp || !hash) return false;
    return bcrypt.compare(String(submittedOtp).trim(), hash);
};
