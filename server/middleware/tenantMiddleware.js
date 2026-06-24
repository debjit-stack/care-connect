/**
 * tenantMiddleware.js
 * ───────────────────
 * Resolves the current organisation from the incoming request and
 * wraps the rest of the request lifecycle in the tenant context so
 * the Mongoose plugin can auto-filter every query.
 *
 * Resolution order (first match wins):
 *   1. Subdomain:  hospital-abc.careconnect.in  → slug = "hospital-abc"
 *   2. Header:     X-Organisation-Slug: hospital-abc  (dev / API clients)
 *   3. Header:     X-Organisation-ID: <mongoId>       (internal service calls)
 *
 * Public routes (login, register, public doctor list) bypass tenant resolution
 * via the PUBLIC_PATHS list below — they don't need org scoping.
 *
 * Super-admin routes bypass via the isSuperAdmin check — they operate
 * across all orgs using Model.withOrg() or .skipTenantFilter().
 */

import Organisation from '../models/Organisation.js';
import { runWithTenant } from '../plugins/tenantPlugin.js';

// ── Paths that work without a tenant context ──────────────────────────────────
const PUBLIC_PATHS = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/refresh',
    '/api/health',
    // Public doctor browse — handled separately with org slug in query
];

// ── Resolve slug from request ─────────────────────────────────────────────────
const resolveSlug = (req) => {
    // 1. Subdomain in production: hospital-abc.careconnect.in
    const host = req.headers.host || '';
    const parts = host.split('.');
    // e.g. ["hospital-abc", "careconnect", "in"] — take first part if not "www"
    if (
        parts.length >= 3 &&
        parts[0] !== 'www' &&
        parts[0] !== 'api' &&
        parts[0] !== 'careconnect'
    ) {
        return { type: 'slug', value: parts[0] };
    }

    // 2. Header slug (dev / Postman / mobile apps)
    const headerSlug = req.headers['x-organisation-slug'];
    if (headerSlug) return { type: 'slug', value: headerSlug.toLowerCase().trim() };

    // 3. Header ID (internal service-to-service)
    const headerId = req.headers['x-organisation-id'];
    if (headerId) return { type: 'id', value: headerId.trim() };

    return null;
};



// ── Main middleware ───────────────────────────────────────────────────────────
export const resolveTenant = async (req, res, next) => {
    // Skip public paths
    //if (PUBLIC_PATHS.some((p) => req.path.startsWith(p))) {
    if (PUBLIC_PATHS.some((p) => req.originalUrl.startsWith(p))) {
        // console.log("originalUrl:", req.originalUrl);
        // console.log("path:", req.path);
        return next();
    }

    // Super-admins bypass tenant resolution entirely
    // (req.user is set by protect() middleware which runs before this)
    if (req.user?.role === 'super_admin') {
        return next();
    }

    const resolved = resolveSlug(req);

    if (!resolved) {
        // No tenant signal — block non-public, non-super-admin requests
        return res.status(400).json({
            message: 'Organisation not specified. Include X-Organisation-Slug header or use your subdomain.',
        });
    }

    try {
        // Look up the organisation
        let org;
        if (resolved.type === 'slug') {
            org = await Organisation.findOne({ slug: resolved.value, deletedAt: null });
        } else {
            org = await Organisation.findOne({ _id: resolved.value, deletedAt: null });
        }

        if (!org) {
            return res.status(404).json({ message: 'Organisation not found' });
        }

        // Check if the org is accessible (active plan / valid trial)
        if (!org.isAccessible) {
            return res.status(403).json({
                message: 'Your organisation account is suspended or your trial has ended. Please contact support.',
            });
        }

        // Attach org to request for use in controllers (e.g. feature flag checks)
        req.org   = org;
        req.orgId = org._id;

        // Wrap the rest of the request in the AsyncLocalStorage context
        // so the Mongoose plugin can read orgId without being passed explicitly
        runWithTenant(org._id, () => next());

    } catch (err) {
        console.error('[Tenant] resolution error:', err.message);
        res.status(500).json({ message: 'Failed to resolve organisation' });
    }
};

// ── Feature flag guard factory ────────────────────────────────────────────────

//   requireFeature('onlineBooking')
//   Route-level middleware that blocks access if the org has the feature disabled.
//   Usage:

    // router.post('/book-appointment',
    //   protect, isPatient,
    //   requireFeature('onlineBooking'),  //org's flag checked here
    //   validate(bookAppointmentSchema),
    //   bookMyAppointment
    // );
 
export const requireFeature = (featureKey) => (req, res, next) => {
    const org = req.org;
    if (!org) return next(); // no org context — allow (super-admin)

    if (!org.features?.[featureKey]) {
        return res.status(403).json({
            message: `This feature (${featureKey}) is not enabled for your organisation.`,
        });
    }
    next();
};
