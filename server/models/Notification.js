/**
 * server/models/Notification.js
 * ──────────────────────────────
 * In-app notification document.
 *
 * Each notification is scoped to a user + organisation via tenantPlugin.
 * Documents auto-expire after 90 days (TTL index on createdAt).
 *
 * Types:
 *   appointment_booked      — patient booked an appointment
 *   appointment_cancelled   — appointment was cancelled
 *   consultation_completed  — doctor marked appointment as completed
 *   password_reset          — admin reset the user's password
 *   package_booked          — health package was booked
 *   system                  — generic system message
 */

import mongoose      from 'mongoose';
import tenantPlugin  from '../plugins/tenantPlugin.js';

const notificationSchema = new mongoose.Schema(
    {
        user: {
            type:     mongoose.Schema.Types.ObjectId,
            ref:      'User',
            required: true,
        },
        type: {
            type:     String,
            required: true,
            enum: [
                'appointment_booked',
                'appointment_cancelled',
                'consultation_completed',
                'password_reset',
                'package_booked',
                'system',
            ],
        },
        title: {
            type:     String,
            required: true,
            maxlength: 120,
        },
        message: {
            type:     String,
            required: true,
            maxlength: 500,
        },
        // Optional deep-link — frontend uses this to navigate on click
        link: {
            type:    String,
            default: null,
        },
        read: {
            type:    Boolean,
            default: false,
        },
    },
    { timestamps: true }
);

// Apply multi-tenancy
notificationSchema.plugin(tenantPlugin);

// Performance indexes
notificationSchema.index({ user: 1, organisationId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ user: 1, organisationId: 1, createdAt: -1 });

// 90-day auto-expiry — old notifications are removed automatically
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
