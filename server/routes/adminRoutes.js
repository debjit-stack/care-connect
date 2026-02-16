import express from 'express';
import asyncHandler from '../middleware/asyncHandler.js';

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
router.route('/users').get(asyncHandler(getUsers));
router.route('/users/:id').get(asyncHandler(getUserById)).put(asyncHandler(updateUser)).delete(asyncHandler(deleteUser));
router.route('/users/:id/reset-password').put(asyncHandler(resetPassword));

// Routes for managing doctor-specific profiles
router.route('/doctors').post(asyncHandler(createDoctor));
router.route('/doctors/:id').put(asyncHandler(updateDoctorProfile));
router.route('/staff').post(asyncHandler(createStaff));

export default router;
