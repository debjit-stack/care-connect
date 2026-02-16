import express from 'express';
import asyncHandler from '../middleware/asyncHandler.js';

const router = express.Router();
import {
    bookMyAppointment,
    bookMyHealthPackage,
    getMyHistory
} from '../controllers/patientController.js';
import { protect, isPatient } from '../middleware/authMiddleware.js';

// All routes in this file are protected and for patients only
router.use(protect, isPatient);

router.route('/book-appointment').post(asyncHandler(bookMyAppointment));
router.route('/book-package').post(asyncHandler(bookMyHealthPackage));
router.route('/my-history').get(asyncHandler(getMyHistory));

export default router;
