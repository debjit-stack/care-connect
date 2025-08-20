import express from 'express';
const router = express.Router();
import { getDashboardStats } from '../controllers/dashboardController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

// All routes in this file are protected and for admins only
router.use(protect, admin);

router.route('/stats').get(getDashboardStats);

export default router;