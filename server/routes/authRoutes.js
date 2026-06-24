import express from 'express';
import {
    registerUser,
    loginUser,
    refreshAccessToken,
    logoutUser,
    logoutAllDevices,
    changePassword,
    getMe,
} from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';
import {
    loginRateLimiter,
    registerRateLimiter,
    refreshRateLimiter,
} from '../middleware/rateLimiter.js';
import {
    validate,
    registerSchema,
    loginSchema,
    changePasswordSchema,
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

router.post('/refresh',
    refreshRateLimiter,
    refreshAccessToken          // reads httpOnly cookie — no body validation needed
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
