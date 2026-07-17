import express from 'express';
import {
    registerUser,
    loginUser,
    platformLoginUser,
    refreshAccessToken,
    logoutUser,
    logoutAllDevices,
    changePassword,
    getMe,
    stepUpVerify,
    // OTP FEATURE
    requestRegistrationOtp,
    resendRegistrationOtp,
    verifyRegistrationOtp,
    forgotPassword,
    resendForgotPasswordOtp,
    verifyForgotPasswordOtp,
    resetPasswordWithToken,
} from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';
import { requireStepUp } from '../middleware/stepUpMiddleware.js';
import {
    loginRateLimiter,
    registerRateLimiter,
    refreshRateLimiter,
    registerOtpRateLimiter,
    forgotPasswordRateLimiter,
    stepUpRateLimiter,
} from '../middleware/rateLimiter.js';
import {
    validate,
    registerSchema,
    loginSchema,
    changePasswordSchema,
    requestRegistrationOtpSchema,
    verifyRegistrationOtpSchema,
    resendRegistrationOtpSchema,
    forgotPasswordSchema,
    verifyForgotPasswordOtpSchema,
    resetPasswordWithTokenSchema,
    stepUpVerifySchema,
} from '../validators/authValidators.js';

const router = express.Router();

// ─── Public routes ────────────────────────────────────────────────────────────
router.post('/register',
    registerRateLimiter,
    validate(registerSchema),
    registerUser
);

router.post('/login',
    loginRateLimiter,
    validate(loginSchema),
    loginUser
);

// PHASE-E addition (Bug #1 fix): dedicated platform login endpoint — the
// only route that can ever authenticate a super_admin. Reuses loginSchema
// (email/password only — no extra field needed; the distinction is the
// route itself, not a client-supplied flag) and the same loginRateLimiter
// (same protective purpose; the rate-limit key naturally becomes a
// 'no-org' bucket for these attempts, since this endpoint never resolves
// an organisation — see rateLimiter.js's extractOrgIdentifier usage).
router.post('/platform-login',
    loginRateLimiter,
    validate(loginSchema),
    platformLoginUser
);

router.post('/refresh',
    refreshRateLimiter,
    refreshAccessToken          // reads httpOnly cookie — no body validation needed
);

// ─── OTP FEATURE: Patient self-registration ───────────────────────────────────
router.post('/register/request-otp',
    registerOtpRateLimiter,
    validate(requestRegistrationOtpSchema),
    requestRegistrationOtp
);

router.post('/register/resend-otp',
    registerOtpRateLimiter,
    validate(resendRegistrationOtpSchema),
    resendRegistrationOtp
);

router.post('/register/verify-otp',
    registerOtpRateLimiter,
    validate(verifyRegistrationOtpSchema),
    verifyRegistrationOtp
);

// ─── OTP FEATURE: Forgot password ─────────────────────────────────────────────
router.post('/forgot-password',
    forgotPasswordRateLimiter,
    validate(forgotPasswordSchema),
    forgotPassword
);

router.post('/forgot-password/resend-otp',
    forgotPasswordRateLimiter,
    validate(forgotPasswordSchema),
    resendForgotPasswordOtp
);

router.post('/forgot-password/verify-otp',
    forgotPasswordRateLimiter,
    validate(verifyForgotPasswordOtpSchema),
    verifyForgotPasswordOtp
);

router.post('/forgot-password/reset',
    forgotPasswordRateLimiter,
    validate(resetPasswordWithTokenSchema),
    resetPasswordWithToken
);

// ─── Protected routes ─────────────────────────────────────────────────────────
router.post('/logout',       protect, logoutUser);
router.post('/logout-all',   protect, logoutAllDevices);

// A2: step-up verification itself only requires a valid access token
// (protect) — it is how the caller PROVES freshness for the routes below,
// so it can't itself require what it's trying to produce. Rate-limited per
// authenticated user (see rateLimiter.js) since this is exactly the kind
// of endpoint a compromised-but-not-fully-logged-in session might hammer
// trying to guess a password.
router.post('/step-up/verify',
    protect,
    stepUpRateLimiter,
    validate(stepUpVerifySchema),
    stepUpVerify
);

// A2: change-password now requires a fresh step-up token in addition to a
// valid access token — an attacker who stole a live access token (e.g. via
// an XSS on some other page, or a shoulder-surfed unlocked device) can no
// longer silently change the account password without re-proving the
// current password or TOTP code moments beforehand.
router.put('/change-password',
    protect,
    requireStepUp,
    validate(changePasswordSchema),
    changePassword
);

router.get('/me',            protect, getMe);

export default router;
