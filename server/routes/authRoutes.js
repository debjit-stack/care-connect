import express from 'express';
import asyncHandler from '../middleware/asyncHandler.js';

const router = express.Router();
import { registerUser, loginUser } from '../controllers/authController.js';

router.post('/register', asyncHandler(registerUser));
router.post('/login', asyncHandler(loginUser));

export default router;
