import express from 'express';
const router = express.Router();
import {
    getHealthPackages,
    createHealthPackage,
    updateHealthPackage,
    deleteHealthPackage
} from '../controllers/healthPackageController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

router.route('/')
    .get(getHealthPackages)
    .post(protect, admin, createHealthPackage);

router.route('/:id')
    .put(protect, admin, updateHealthPackage)
    .delete(protect, admin, deleteHealthPackage);

export default router;