import mongoose from 'mongoose';
import tenantPlugin from '../plugins/tenantPlugin.js';

const auditLogSchema = mongoose.Schema(
    {
        actorId: {
            type:    mongoose.Schema.Types.ObjectId,
            ref:     'User',
            default: null,
        },
        actorRole: {
            type:    String,
            enum:    ['patient', 'doctor', 'receptionist', 'admin', 'super_admin', 'system', 'anonymous'],
            default: 'anonymous',
        },
        action: {
            type:     String,
            required: true,
            enum: [
            'AUTH_LOGIN_SUCCESS',
            'AUTH_LOGIN_FAILED',
            'AUTH_LOGOUT',
            'AUTH_TOKEN_REFRESHED',
            'AUTH_PASSWORD_CHANGED',
            'AUTH_ACCOUNT_LOCKED',

            // MFA
            'AUTH_MFA_SETUP_STARTED',
            'AUTH_MFA_SETUP_COMPLETED',
            'AUTH_MFA_VERIFIED',
            'AUTH_MFA_DISABLED',

            // Data
            'DATA_READ',
            'DATA_CREATE',
            'DATA_UPDATE',
            'DATA_DELETE',
        ],
        },
        resourceType: { type: String,  default: null },
        resourceId:   { type: String,  default: null },
        ipAddress:    { type: String,  default: null },
        userAgent:    { type: String,  default: null },
        success:      { type: Boolean, default: true },
        meta:         { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    { timestamps: true }
);

// AuditLog is tenant-scoped too — org admins can see their own audit trail
auditLogSchema.plugin(tenantPlugin);

auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action:  1, createdAt: -1 });
auditLogSchema.index({ organisationId: 1, createdAt: -1 });
auditLogSchema.index({ resourceType: 1, resourceId: 1 });
// 7-year retention for healthcare compliance
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 365 * 24 * 60 * 60 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
