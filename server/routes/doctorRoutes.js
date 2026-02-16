import express from 'express';
import asyncHandler from '../middleware/asyncHandler.js';

const router = express.Router();
import {
    getDoctors,
    getDoctorById,
    getDoctorAvailability,
    getMyAssignedAppointments,
    getPatientHistory,
    updateAppointment,
    updateMyAvailability
} from '../controllers/doctorController.js';
import { protect, doctor } from '../middleware/authMiddleware.js';

// --- Protected Doctor-Only Routes ---
// These specific routes MUST come before the dynamic /:id routes
router.get('/my-appointments', protect, doctor, asyncHandler(getMyAssignedAppointments));
router.get('/patient-history/:patientId', protect, doctor, asyncHandler(getPatientHistory));
router.put('/appointments/:appointmentId', protect, doctor, asyncHandler(updateAppointment));
router.put('/my-availability', protect, doctor, asyncHandler(updateMyAvailability));

// --- Public Routes ---
router.route('/').get(asyncHandler(getDoctors));

// These dynamic routes with parameters MUST come LAST
router.route('/:id').get(asyncHandler(getDoctorById));
router.route('/:id/availability').get(asyncHandler(getDoctorAvailability));

export default router;
