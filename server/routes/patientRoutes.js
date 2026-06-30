import express from 'express';
import {
    bookMyAppointment,
    cancelMyAppointment,
    bookMyHealthPackage,
    getMyHistory,
    getMyProfile,
    updateMyProfile,
} from '../controllers/patientController.js';
import { protect, isPatient } from '../middleware/authMiddleware.js';
import { requireFeature }     from '../middleware/tenantMiddleware.js';
import {
    validate,
    bookAppointmentSchema,
    bookPackageSchema,
    updateProfileSchema,
    cancelAppointmentSchema,
} from '../validators/patientValidators.js';

const router = express.Router();

router.use(protect, isPatient);

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

// WS4: Profile management
router.get('/profile', getMyProfile);
router.put('/profile', validate(updateProfileSchema), updateMyProfile);

// WS4: Self-cancellation with 24hr cutoff
router.delete('/appointments/:id', validate(cancelAppointmentSchema), cancelMyAppointment);

export default router;
