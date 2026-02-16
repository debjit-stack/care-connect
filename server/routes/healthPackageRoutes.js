import express from 'express';
import asyncHandler from '../middleware/asyncHandler.js';

const router = express.Router();
import {
    getHealthPackages,
    createHealthPackage,
    updateHealthPackage,
    deleteHealthPackage
} from '../controllers/healthPackageController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

router.route('/')
    .get(asyncHandler(getHealthPackages))
    .post(protect, admin, asyncHandler(createHealthPackage));

router.route('/:id')
    .put(protect, admin, asyncHandler(updateHealthPackage))
    .delete(protect, admin, asyncHandler(deleteHealthPackage));

export default router;
