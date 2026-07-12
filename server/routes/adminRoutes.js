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
    getPackagesFull,
} from '../controllers/adminController.js';

import {
    getSecuritySettings,
    updateSecuritySettings,
    getUserSecurity,
    updateUserSecurity,
    resetUserMfa,
} from '../controllers/adminSecurityController.js';

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

//
// USERS
//

router.get(
    '/users',
    validate(getUsersSchema),
    getUsers
);

router.get(
    '/users/:id',
    validate(idParam),
    getUserById
);

router.put(
    '/users/:id',
    validate(updateUserSchema),
    updateUser
);

router.delete(
    '/users/:id',
    validate(idParam),
    deleteUser
);

router.put(
    '/users/:id/reset-password',
    validate(resetPasswordSchema),
    resetPassword
);

//
// ORGANISATION SECURITY
//

router.get(
    '/security',
    getSecuritySettings
);

router.put(
    '/security',
    updateSecuritySettings
);

//
// USER SECURITY (Commit 5)
//

router.get(
    '/users/:id/security',
    validate(idParam),
    getUserSecurity
);

router.put(
    '/users/:id/security',
    validate(idParam),
    updateUserSecurity
);

router.post(
    '/users/:id/reset-mfa',
    validate(idParam),
    resetUserMfa
);

//
// DOCTORS
//

router.post(
    '/doctors',
    validate(createDoctorSchema),
    createDoctor
);

router.get(
    '/doctors-full',
    getDoctorsWithProfiles
);

router.put(
    '/doctors/:id',
    validate(updateDoctorProfileSchema),
    updateDoctorProfile
);

//
// PACKAGES (PHASE-F, Task 3)
//
// Mirrors the doctors-full pattern above exactly — protected, admin-only,
// no explicit organisationId filter, relies on tenantPlugin via the
// ambient context already established by `router.use(protect, admin)`
// (never in any tenant bypass list).
//

router.get(
    '/packages-full',
    getPackagesFull
);

//
// STAFF
//

router.post(
    '/staff',
    validate(createStaffSchema),
    createStaff
);

export default router;
