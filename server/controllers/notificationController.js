/**
 * server/controllers/notificationController.js
 * ─────────────────────────────────────────────
 * In-app notification CRUD for authenticated users.
 *
 * All routes are scoped to req.user._id so users can only
 * see and manage their own notifications.
 */

import Notification from '../models/Notification.js';

// ─── GET /api/notifications ───────────────────────────────────────────────────
// Returns paginated notifications for the authenticated user.
// Unread notifications appear first, then sorted by createdAt desc.
// Query params: page (default 1), limit (default 20, max 50)
export const getNotifications = async (req, res) => {
    try {
        const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
        const limit = Math.min(50, parseInt(req.query.limit || '20', 10));
        const skip  = (page - 1) * limit;

        const [notifications, total, unreadCount] = await Promise.all([
            Notification.find({ user: req.user._id })
                .sort({ read: 1, createdAt: -1 })   // unread first, then newest
                .skip(skip)
                .limit(limit)
                .lean(),

            Notification.countDocuments({ user: req.user._id }),

            Notification.countDocuments({ user: req.user._id, read: false }),
        ]);

        res.json({
            notifications,
            unreadCount,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('[Notification] getNotifications:', err.message);
        res.status(500).json({ message: 'Failed to fetch notifications' });
    }
};

// ─── GET /api/notifications/unread-count ─────────────────────────────────────
// Lightweight endpoint for the notification bell badge.
// Called on mount and after any notification action.
export const getUnreadCount = async (req, res) => {
    try {
        const count = await Notification.countDocuments({
            user: req.user._id,
            read: false,
        });
        res.json({ count });
    } catch (err) {
        console.error('[Notification] getUnreadCount:', err.message);
        res.status(500).json({ message: 'Failed to fetch unread count' });
    }
};

// ─── PUT /api/notifications/:id/read ─────────────────────────────────────────
export const markAsRead = async (req, res) => {
    try {
        const notification = await Notification.findOne({
            _id:  req.params.id,
            user: req.user._id,   // ensures user can only mark their own
        });

        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }

        notification.read = true;
        await notification.save();

        res.json({ message: 'Marked as read', notification });
    } catch (err) {
        console.error('[Notification] markAsRead:', err.message);
        res.status(500).json({ message: 'Failed to mark as read' });
    }
};

// ─── PUT /api/notifications/read-all ─────────────────────────────────────────
export const markAllAsRead = async (req, res) => {
    try {
        const result = await Notification.updateMany(
            { user: req.user._id, read: false },
            { $set: { read: true } }
        );

        res.json({ message: 'All notifications marked as read', updated: result.modifiedCount });
    } catch (err) {
        console.error('[Notification] markAllAsRead:', err.message);
        res.status(500).json({ message: 'Failed to mark all as read' });
    }
};

// ─── DELETE /api/notifications/:id ───────────────────────────────────────────
export const deleteNotification = async (req, res) => {
    try {
        const result = await Notification.deleteOne({
            _id:  req.params.id,
            user: req.user._id,
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Notification not found' });
        }

        res.json({ message: 'Notification deleted' });
    } catch (err) {
        console.error('[Notification] deleteNotification:', err.message);
        res.status(500).json({ message: 'Failed to delete notification' });
    }
};
