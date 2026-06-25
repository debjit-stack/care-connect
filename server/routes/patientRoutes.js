import express from 'express';
import {
    bookMyAppointment,
    bookMyHealthPackage,
    getMyHistory,
} from '../controllers/patientController.js';
import { protect, isPatient } from '../middleware/authMiddleware.js';
import { requireFeature }     from '../middleware/tenantMiddleware.js';
import {
    validate,
    bookAppointmentSchema,
    bookPackageSchema,
} from '../validators/patientValidators.js';

const router = express.Router();

router.use(protect, isPatient);

// M3 FIX: enforce feature flags so disabled orgs cannot book
router.post('/book-appointment',
    requireFeature('onlineBooking'),
    validate(bookAppointmentSchema),
    bookMyAppointment
);

router.post('/book-package',
    requireFeature('healthPackages'),
    validate(bookPackageSchema),
    bookMyHealthPackage
);

router.get('/my-history', getMyHistory);

export default router;
