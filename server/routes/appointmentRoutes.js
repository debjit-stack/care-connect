import express from 'express';
const router = express.Router();
import { createAppointment, getMyAppointments } from '../controllers/appointmentController.js';
import { protect } from '../middleware/authMiddleware.js';

router.route('/').post(protect, createAppointment);
router.route('/my').get(protect, getMyAppointments);

export default router;