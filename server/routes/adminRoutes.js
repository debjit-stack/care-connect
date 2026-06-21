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
    resetPassword,
    getDoctorsWithProfiles,
} from '../controllers/adminController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

router.use(protect, admin);

router.route('/users').get(getUsers);
router.route('/users/:id').get(getUserById).put(updateUser).delete(deleteUser);
router.route('/users/:id/reset-password').put(resetPassword);

router.route('/doctors').post(createDoctor);
// NEW: fetch full doctor profiles (Doctor._id + user info)
router.route('/doctors-full').get(getDoctorsWithProfiles);
router.route('/doctors/:id').put(updateDoctorProfile);
router.route('/staff').post(createStaff);

export default router;