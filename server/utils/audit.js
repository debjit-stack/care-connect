import AuditLog from '../models/AuditLog.js';

/**
 * Write an audit log entry.
 * Fire-and-forget — never awaited in request handlers so it never
 * delays a response or crashes a route if the DB write fails.
 *
 * Usage:
 *   audit(req, 'AUTH_LOGIN_SUCCESS', { actorId: user._id, actorRole: user.role });
 *   audit(req, 'AUTH_LOGIN_FAILED',  { meta: { email: req.body.email } });
 */
const audit = (req, action, options = {}) => {
    const {
        actorId      = null,
        actorRole    = 'anonymous',
        resourceType = null,
        resourceId   = null,
        success      = true,
        meta         = {},
    } = options;

    // Resolve real IP behind a proxy (Render, Netlify, AWS ALB all set x-forwarded-for)
    const ipAddress =
        (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
        req.socket?.remoteAddress ||
        null;

    const userAgent = req.headers['user-agent'] || null;

    AuditLog.create({
        actorId,
        actorRole,
        action,
        resourceType,
        resourceId: resourceId ? String(resourceId) : null,
        ipAddress,
        userAgent,
        success,
        meta,
    }).catch((err) => {
        // Audit log write failure must never crash the app — log and continue
        console.error('[AuditLog] write failed:', err.message);
    });
};

export default audit;
