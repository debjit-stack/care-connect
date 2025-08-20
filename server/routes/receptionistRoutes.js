import express from 'express';
const router = express.Router();
import {
    registerPatient,
    bookOfflineAppointment,
    searchPatients,
    getAppointmentsByDate,
    bookHealthPackageForPatient,
} from '../controllers/receptionistController.js';
import { protect } from '../middleware/authMiddleware.js';

// Middleware to check if user is Receptionist or Admin
const isReceptionistOrAdmin = (req, res, next) => {
    if (req.user && (req.user.role === 'receptionist' || req.user.role === 'admin')) {
        next();
    } else {
        res.status(401).json({ message: 'Not authorized for this role' });
    }
};

// All routes in this file are protected
router.use(protect, isReceptionistOrAdmin);

router.route('/register-patient').post(registerPatient);
router.route('/book-appointment').post(bookOfflineAppointment);
router.route('/search-patients').get(searchPatients);
router.route('/appointments').get(getAppointmentsByDate);
router.route('/book-package').post(bookHealthPackageForPatient);

export default router;
