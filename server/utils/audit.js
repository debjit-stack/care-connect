import AuditLog from '../models/AuditLog.js';

/**
 * Write an audit log entry.
 * Fire-and-forget — never awaited in request handlers so it never
 * delays a response or crashes a route if the DB write fails.
 *
 * Usage:
 *   audit(req, 'AUTH_LOGIN_SUCCESS', { actorId: user._id, actorRole: user.role });
 *   audit(req, 'AUTH_LOGIN_FAILED',  { meta: { email: req.body.email } });
 *
 * PHASE3-3A FIX: cross-org attribution marker.
 * ──────────────────────────────────────────────
 * AuditLog.organisationId is set by tenantPlugin's pre('save') hook from the
 * AMBIENT request org (whatever resolveTenant resolved via runWithTenant) —
 * never from the acting user's own organisationId explicitly. Since Phase 1
 * added a binding check requiring req.user.organisationId === req.orgId for
 * every non-super_admin request, ambient org and actor org now always match
 * for ordinary staff/patient actions — that part of the original audit
 * concern is closed as a side effect of Phase 1.
 *
 * The one case where they can still legitimately differ is a super_admin
 * acting on organisationRoutes (their own organisationId is always null, by
 * design, since they belong to no single org). Before this fix, an audit
 * entry for such an action looked identical in shape to an ordinary
 * same-org action — a reviewer had to already know to cross-reference the
 * actor's own org (not stored on the log at all) against the log's
 * organisationId to notice the actor doesn't belong to it.
 *
 * This adds an automatic marker computed from `req` on every call, rather
 * than requiring every call site to remember to pass it: when the acting
 * user's own organisationId differs from the ambient org (covers both the
 * super_admin case, and defensively any future/unexpected mismatch that
 * would itself indicate a bug worth being able to find in the audit trail),
 * meta gains `actingCrossOrg: true` and `actorOrgId: <actor's own org or
 * null>`. No schema change — meta is already a Mixed field on AuditLog.
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

    // ── PHASE3-3A: automatic cross-org attribution marker ─────────────────────
    // req.orgId reflects the ambient tenant context for this request (set by
    // resolveTenant/runWithTenant), which is what tenantPlugin's pre-save
    // hook will use for AuditLog.organisationId itself. req.user reflects
    // the actual authenticated actor, if any — anonymous actions (failed
    // logins before a user is resolved, etc.) have no req.user and are
    // correctly left unmarked, since there's no actor org to compare.
    const ambientOrgId = req.orgId ? String(req.orgId) : null;
    const actorOrgId   = req.user?.organisationId ? String(req.user.organisationId) : null;

    const actingCrossOrg =
        !!req.user &&
        ambientOrgId !== null &&
        actorOrgId !== ambientOrgId; // covers both super_admin (actorOrgId null) and any unexpected mismatch

    const enrichedMeta = actingCrossOrg
        ? { ...meta, actingCrossOrg: true, actorOrgId }
        : meta;

    AuditLog.create({
        actorId,
        actorRole,
        action,
        resourceType,
        resourceId: resourceId ? String(resourceId) : null,
        ipAddress,
        userAgent,
        success,
        meta: enrichedMeta,
    }).catch((err) => {
        // Audit log write failure must never crash the app — log and continue
        console.error('[AuditLog] write failed:', err.message);
    });
};

export default audit;
