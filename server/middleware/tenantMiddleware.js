import Organisation from '../models/Organisation.js';
import { runWithTenant } from '../plugins/tenantPlugin.js';

// ── Paths that bypass tenant resolution completely ────────────────────────────
// M1 FIX: Added /api/doctors and /api/packages so public browsing works
// without an org header. Auth routes resolve their own org in authController.
const PUBLIC_PATHS = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/refresh',
    '/api/auth/logout',
    '/api/auth/logout-all',
    '/api/health',
    // Public browsing — no org context needed for anonymous visitors
    '/api/doctors',
    '/api/packages',
];

// ── Resolve org slug/id from request ─────────────────────────────────────────
const resolveSlug = (req) => {
    // 1. Header slug (dev / API clients / mobile apps)
    const headerSlug = req.headers['x-organisation-slug'];
    if (headerSlug) return { type: 'slug', value: headerSlug.toLowerCase().trim() };

    // 2. Header ID (internal service-to-service)
    const headerId = req.headers['x-organisation-id'];
    if (headerId) return { type: 'id', value: headerId.trim() };

    // 3. Subdomain (production: hospital-abc.careconnect.in)
    const host  = req.headers.host || '';
    const parts = host.split('.');
    if (
        parts.length >= 3 &&
        !['www', 'api', 'careconnect', 'localhost'].includes(parts[0])
    ) {
        return { type: 'slug', value: parts[0] };
    }

    return null;
};

// ── Main middleware ────────────────────────────────────────────────────────────
export const resolveTenant = async (req, res, next) => {
    // Skip all public paths (exact match or prefix)
    const isPublic = PUBLIC_PATHS.some(
        (p) => req.originalUrl === p || req.originalUrl.startsWith(p + '/') || req.originalUrl.startsWith(p + '?')
    );
    if (isPublic) return next();

    const resolved = resolveSlug(req);

    if (!resolved) {
        // No explicit org signal — try auto-fallback for single-org deployments.
        // C1 FIX: We do NOT check req.user here because protect() hasn't run yet.
        // Instead we check the DB directly for single-org auto-resolution.
        try {
            const count = await Organisation.countDocuments({ deletedAt: null, isActive: true });

            if (count === 1) {
                const org = await Organisation.findOne({ deletedAt: null, isActive: true });
                if (org && org.isAccessible) {
                    req.org   = org;
                    req.orgId = org._id;
                    return runWithTenant(org._id, () => next());
                }
            }

            if (count === 0) {
                // Pre-migration state — no orgs exist yet, allow requests through
                // without tenant scoping so the app still functions.
                return next();
            }

            // 2+ orgs and no slug provided — block
            return res.status(400).json({
                message: 'Organisation not specified. Include X-Organisation-Slug header or use your subdomain.',
            });
        } catch (err) {
            console.error('[Tenant] auto-resolve error:', err.message);
            return res.status(500).json({ message: 'Failed to resolve organisation' });
        }
    }

    try {
        const org = resolved.type === 'slug'
            ? await Organisation.findOne({ slug: resolved.value, deletedAt: null })
            : await Organisation.findOne({ _id: resolved.value, deletedAt: null });

        if (!org) {
            return res.status(404).json({ message: 'Organisation not found' });
        }

        if (!org.isAccessible) {
            return res.status(403).json({
                message: 'Your organisation account is suspended or your trial has ended. Please contact support.',
            });
        }

        req.org   = org;
        req.orgId = org._id;

        // C1 FIX: super_admin bypass happens AFTER org is resolved and set on req,
        // not before. This way super_admin still gets req.orgId if present but
        // is not blocked if the org lookup differs from their own org.
        // The actual cross-tenant access control is handled in individual controllers.
        runWithTenant(org._id, () => next());
    } catch (err) {
        console.error('[Tenant] resolution error:', err.message);
        res.status(500).json({ message: 'Failed to resolve organisation' });
    }
};

// ── Feature flag guard ────────────────────────────────────────────────────────
export const requireFeature = (featureKey) => (req, res, next) => {
    const org = req.org;
    if (!org) return next(); // no org context (public route or pre-migration)
    if (!org.features?.[featureKey]) {
        return res.status(403).json({
            message: `This feature (${featureKey}) is not enabled for your organisation.`,
        });
    }
    next();
};
