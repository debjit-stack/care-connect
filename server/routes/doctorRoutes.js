import express from 'express';
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
router.get('/my-appointments', protect, doctor, getMyAssignedAppointments);
router.get('/patient-history/:patientId', protect, doctor, getPatientHistory);
router.put('/appointments/:appointmentId', protect, doctor, updateAppointment);
router.put('/my-availability', protect, doctor, updateMyAvailability);

// --- Public Routes ---
router.route('/').get(getDoctors);

// These dynamic routes with parameters MUST come LAST
router.route('/:id').get(getDoctorById);
router.route('/:id/availability').get(getDoctorAvailability);

export default router;