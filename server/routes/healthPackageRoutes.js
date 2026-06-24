import express from 'express';
import {
    getHealthPackages,
    createHealthPackage,
    updateHealthPackage,
    deleteHealthPackage,
} from '../controllers/healthPackageController.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import {
    validate,
    createPackageSchema,
    updatePackageSchema,
    deletePackageSchema,
} from '../validators/packageValidators.js';

const router = express.Router();

router.get('/', getHealthPackages);

router.post('/',    protect, admin, validate(createPackageSchema), createHealthPackage);
router.put('/:id',  protect, admin, validate(updatePackageSchema), updateHealthPackage);
router.delete('/:id', protect, admin, validate(deletePackageSchema), deleteHealthPackage);

export default router;
