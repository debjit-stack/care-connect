import express from 'express';
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
import {
    validate,
    getUsersSchema,
    createDoctorSchema,
    createStaffSchema,
    updateUserSchema,
    resetPasswordSchema,
    updateDoctorProfileSchema,
} from '../validators/adminValidators.js';
import { idParam } from '../validators/shared.js';

const router = express.Router();

router.use(protect, admin);

// Users
router.get('/users',          validate(getUsersSchema), getUsers);
router.get('/users/:id',      validate(idParam),        getUserById);
router.put('/users/:id',      validate(updateUserSchema),    updateUser);
router.delete('/users/:id',   validate(idParam),        deleteUser);
router.put('/users/:id/reset-password', validate(resetPasswordSchema), resetPassword);

// Doctors
router.post('/doctors',       validate(createDoctorSchema),        createDoctor);
router.get('/doctors-full',                                         getDoctorsWithProfiles);
router.put('/doctors/:id',    validate(updateDoctorProfileSchema),  updateDoctorProfile);

// Staff
router.post('/staff',         validate(createStaffSchema),         createStaff);

export default router;
