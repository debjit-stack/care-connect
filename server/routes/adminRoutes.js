import express from 'express';
const router = express.Router();
import {
    getUsers,
    getUserById,
    updateUser,
    deleteUser,
    createDoctor,
    updateDoctorProfile,
    createStaff,
    resetPassword
} from '../controllers/adminController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

// All routes in this file are protected and require admin access
router.use(protect, admin);

// Routes for managing all user types (patients, receptionists, etc.)
router.route('/users').get(getUsers);
router.route('/users/:id').get(getUserById).put(updateUser).delete(deleteUser);
router.route('/users/:id/reset-password').put(resetPassword);

// Routes for managing doctor-specific profiles
router.route('/doctors').post(createDoctor);
router.route('/doctors/:id').put(updateDoctorProfile);
router.route('/staff').post(createStaff);

export default router;
