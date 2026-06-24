import express from 'express';
import {
    bookMyAppointment,
    bookMyHealthPackage,
    getMyHistory,
} from '../controllers/patientController.js';
import { protect, isPatient } from '../middleware/authMiddleware.js';
import {
    validate,
    bookAppointmentSchema,
    bookPackageSchema,
} from '../validators/patientValidators.js';

const router = express.Router();

router.use(protect, isPatient);

router.post('/book-appointment', validate(bookAppointmentSchema), bookMyAppointment);
router.post('/book-package',     validate(bookPackageSchema),     bookMyHealthPackage);
router.get('/my-history',                                         getMyHistory);

export default router;
