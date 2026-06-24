import express from 'express';
import {
    registerPatient,
    bookOfflineAppointment,
    searchPatients,
    getAppointmentsByDate,
    bookHealthPackageForPatient,
} from '../controllers/receptionistController.js';
import { protect, isReceptionistOrAdmin } from '../middleware/authMiddleware.js';
import {
    validate,
    registerPatientSchema,
    bookOfflineAppointmentSchema,
    bookPackageForPatientSchema,
    searchPatientsSchema,
    getAppointmentsByDateSchema,
} from '../validators/receptionistValidators.js';

const router = express.Router();

router.use(protect, isReceptionistOrAdmin);

router.post('/register-patient',  validate(registerPatientSchema),         registerPatient);
router.post('/book-appointment',  validate(bookOfflineAppointmentSchema),   bookOfflineAppointment);
router.post('/book-package',      validate(bookPackageForPatientSchema),    bookHealthPackageForPatient);
router.get('/search-patients',    validate(searchPatientsSchema),           searchPatients);
router.get('/appointments',       validate(getAppointmentsByDateSchema),    getAppointmentsByDate);

export default router;
