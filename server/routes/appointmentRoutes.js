import express from 'express';
import asyncHandler from '../middleware/asyncHandler.js';

const router = express.Router();
import { createAppointment, getMyAppointments } from '../controllers/appointmentController.js';
import { protect } from '../middleware/authMiddleware.js';

router.route('/').post(protect, asyncHandler(createAppointment));
router.route('/my').get(protect, asyncHandler(getMyAppointments));

export default router;
