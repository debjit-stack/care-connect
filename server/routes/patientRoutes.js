import express from 'express';
const router = express.Router();
import {
    bookMyAppointment,
    bookMyHealthPackage,
    getMyHistory
} from '../controllers/patientController.js';
import { protect, isPatient } from '../middleware/authMiddleware.js';

// All routes in this file are protected and for patients only
router.use(protect, isPatient);

router.route('/book-appointment').post(bookMyAppointment);
router.route('/book-package').post(bookMyHealthPackage);
router.route('/my-history').get(getMyHistory);

export default router;
