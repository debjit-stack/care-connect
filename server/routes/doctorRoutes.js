import express from 'express';
import {
    getDoctors,
    getDoctorById,
    getDoctorAvailability,
    getMyAssignedAppointments,
    getPatientHistory,
    updateAppointment,
    updateMyAvailability,
} from '../controllers/doctorController.js';
import { protect, doctor } from '../middleware/authMiddleware.js';
import {
    validate,
    getDoctorByIdSchema,
    getDoctorAvailabilitySchema,
    patientHistorySchema,
    updateAppointmentSchema,
    updateMyAvailabilitySchema,
} from '../validators/doctorValidators.js';

const router = express.Router();

// ─── Protected Doctor-only routes (must come before /:id) ────────────────────
router.get('/my-appointments',
    protect, doctor,
    getMyAssignedAppointments
);

router.get('/patient-history/:patientId',
    protect, doctor,
    validate(patientHistorySchema),
    getPatientHistory
);

router.put('/appointments/:appointmentId',
    protect, doctor,
    validate(updateAppointmentSchema),
    updateAppointment
);

router.put('/my-availability',
    protect, doctor,
    validate(updateMyAvailabilitySchema),
    updateMyAvailability
);

// ─── Public routes ────────────────────────────────────────────────────────────
router.get('/', getDoctors);

router.get('/:id',
    validate(getDoctorByIdSchema),
    getDoctorById
);

router.get('/:id/availability',
    validate(getDoctorAvailabilitySchema),
    getDoctorAvailability
);

export default router;
