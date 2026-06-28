import Organisation from '../models/Organisation.js';
import { runWithTenant } from '../plugins/tenantPlugin.js';

// ── Paths that bypass tenant resolution completely ────────────────────────────
// IMPORTANT: each entry here must be an EXACT path or a prefix that is safe
// to expose without an organisation context.
//
// FIX: '/api/doctors' was previously matching '/api/doctors/my-appointments'
// and other protected sub-paths via startsWith(), bypassing tenant resolution
// for authenticated doctor routes.  We now list only the two truly-public
// doctor endpoints so sub-routes remain tenant-scoped.
const PUBLIC_EXACT = new Set([
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/refresh',
    '/api/auth/logout',
    '/api/auth/logout-all',
    '/api/health',
    // /validate uses mfaPending JWT in the request body, not an access token.
    // It resolves its own user context from the pending token.
    '/api/auth/mfa/validate',
]);

// Prefixes where ALL sub-paths are public (anonymous browsing).
// Keep this list minimal — only paths where NO sub-route requires auth.
const PUBLIC_PREFIXES = [
    '/api/packages',      // GET /api/packages  (list only, no sub-routes need auth)
];

// Individual public doctor paths — using exact matches to avoid catching
// /api/doctors/my-appointments, /api/doctors/my-profile, etc.
const PUBLIC_DOCTOR_PATHS = new Set([
    '/api/doctors',       // GET /api/doctors  (list)
]);
// /api/doctors/:id and /api/doctors/:id/availability are also public but
// matched via the regex below to avoid false-positives.
const PUBLIC_DOCTOR_DETAIL = /^\/api\/doctors\/[a-f\d]{24}(\/availability)?$/i;

const isPublicPath = (url) => {
    // Strip query string for matching
    const path = url.split('?')[0];

    if (PUBLIC_EXACT.has(path)) return true;
    if (PUBLIC_DOCTOR_PATHS.has(path)) return true;
    if (PUBLIC_DOCTOR_DETAIL.test(path)) return true;

    for (const prefix of PUBLIC_PREFIXES) {
        if (path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')) {
            return true;
        }
    }

    return false;
};

// ── Resolve org slug/id from request ─────────────────────────────────────────
const resolveSlug = (req) => {
    const headerSlug = req.headers['x-organisation-slug'];
    if (headerSlug) return { type: 'slug', value: headerSlug.toLowerCase().trim() };

    const headerId = req.headers['x-organisation-id'];
    if (headerId) return { type: 'id', value: headerId.trim() };

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
    if (isPublicPath(req.originalUrl)) return next();

    const resolved = resolveSlug(req);

    if (!resolved) {
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
                return next();
            }

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

        runWithTenant(org._id, () => next());
    } catch (err) {
        console.error('[Tenant] resolution error:', err.message);
        res.status(500).json({ message: 'Failed to resolve organisation' });
    }
};

// ── Feature flag guard ────────────────────────────────────────────────────────
export const requireFeature = (featureKey) => (req, res, next) => {
    const org = req.org;
    if (!org) return next();
    if (!org.features?.[featureKey]) {
        return res.status(403).json({
            message: `This feature (${featureKey}) is not enabled for your organisation.`,
        });
    }
    next();
};
