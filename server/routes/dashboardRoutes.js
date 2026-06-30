import express from 'express';
import { getDashboardStats, exportAppointments } from '../controllers/dashboardController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect, admin);

router.get('/stats',  getDashboardStats);
router.get('/export', exportAppointments);   // WS3: CSV download

export default router;
