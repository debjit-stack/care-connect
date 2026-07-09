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
import {
    loginRateLimiter,
    registerRateLimiter,
    refreshRateLimiter,
    registerOtpRateLimiter,
    forgotPasswordRateLimiter,
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
router.put('/change-password',
    protect,
    validate(changePasswordSchema),
    changePassword
);
router.get('/me',            protect, getMe);

export default router;
