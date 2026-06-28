import express from 'express';
import {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
} from '../controllers/notificationController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All notification routes require authentication
router.use(protect);

router.get('/',                  getNotifications);
router.get('/unread-count',      getUnreadCount);
router.put('/read-all',          markAllAsRead);
router.put('/:id/read',          markAsRead);
router.delete('/:id',            deleteNotification);

export default router;
