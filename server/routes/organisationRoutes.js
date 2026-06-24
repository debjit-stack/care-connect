import express from 'express';
import {
    getAllOrganisations,
    getOrganisationById,
    createOrganisation,
    updateOrganisation,
    deleteOrganisation,
    getOrganisationStats,
} from '../controllers/organisationController.js';
import { protect, requireRole } from '../middleware/authMiddleware.js';
import {
    validate,
    createOrganisationSchema,
    updateOrganisationSchema,
    getOrganisationSchema,
} from '../validators/organisationValidators.js';
import { idParam } from '../validators/shared.js';

const router = express.Router();

const superAdmin = requireRole('super_admin');
const orgAdmin   = requireRole('super_admin', 'admin');

// All org routes require authentication
router.use(protect);

router.get('/',
    superAdmin,
    getAllOrganisations
);

router.post('/',
    superAdmin,
    validate(createOrganisationSchema),
    createOrganisation
);

router.get('/:id',
    orgAdmin,
    validate(getOrganisationSchema),
    getOrganisationById
);

router.put('/:id',
    orgAdmin,
    validate(updateOrganisationSchema),
    updateOrganisation
);

router.delete('/:id',
    superAdmin,
    validate(idParam),
    deleteOrganisation
);

router.get('/:id/stats',
    superAdmin,
    validate(idParam),
    getOrganisationStats
);

export default router;
