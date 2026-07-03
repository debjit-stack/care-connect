import Organisation from '../models/Organisation.js';
import { runWithTenant } from '../plugins/tenantPlugin.js';

// ── Paths that bypass tenant resolution completely ────────────────────────────
// IMPORTANT: each entry here must be an EXACT path or a prefix that is safe
// to expose without an organisation context.
//
// C1/M3 FIX: isPublicPath() is now METHOD-AWARE. The previous implementation
// matched on path only, which meant any prefix marked "public" (e.g.
// '/api/packages' for anonymous browsing) silently bypassed tenant resolution
// for EVERY verb under that prefix — including POST/PUT/DELETE routes that are
// guarded by `protect, admin` at the route level. That let admin package
// mutations skip runWithTenant() entirely, so new HealthPackage docs were
// never stamped with organisationId and became visible/writable across every
// tenant. The same class of bug was previously fixed for '/api/doctors' by
// switching to exact/regex matches — this fix extends that pattern and makes
// it structural: every public entry below declares which HTTP method(s) it
// applies to, so a future mutating route added under a "public" prefix does
// NOT inherit the bypass by accident.

// Exact-match public routes: { method, path }
const PUBLIC_EXACT = [
    { method: 'POST', path: '/api/auth/login' },
    { method: 'POST', path: '/api/auth/register' },
    { method: 'POST', path: '/api/auth/refresh' },
    { method: 'POST', path: '/api/auth/logout' },
    { method: 'POST', path: '/api/auth/logout-all' },
    { method: 'GET',  path: '/api/health' },
    // /validate and /recover both use an mfaPending JWT in the request body,
    // not an access token — they resolve their own user context from the
    // pending token, so no X-Organisation-Slug is required from the client.
    // C3 FIX: /recover was missing here, so in any multi-org deployment
    // without a cached org slug, resolveTenant would 400 before the recovery
    // controller ever ran — making the "lost your authenticator" recovery
    // flow unreachable exactly when it's needed most.
    { method: 'POST', path: '/api/auth/mfa/validate' },
    { method: 'POST', path: '/api/auth/mfa/recover' },
];

// Prefixes where a SPECIFIC method is public for all sub-paths.
// Keep this list minimal, and always pair a prefix with the one verb that's
// actually safe — never leave it method-agnostic.
const PUBLIC_METHOD_PREFIXES = [
    // GET /api/packages — public catalog listing only.
    // POST/PUT/DELETE under this prefix (create/update/delete package) are
    // NOT public and must go through tenant resolution + admin auth.
    { method: 'GET', prefix: '/api/packages' },
];

// Individual public doctor paths — using exact matches to avoid catching
// /api/doctors/my-appointments, /api/doctors/my-profile, etc.
const PUBLIC_DOCTOR_EXACT_GET = new Set([
    '/api/doctors',       // GET /api/doctors  (list)
]);
// /api/doctors/:id and /api/doctors/:id/availability are also public but
// matched via regex to avoid false-positives against authenticated sub-routes.
const PUBLIC_DOCTOR_DETAIL_GET = /^\/api\/doctors\/[a-f\d]{24}(\/availability)?$/i;

const isPublicPath = (method, url) => {
    // Strip query string for matching
    const path = url.split('?')[0];
    const m = (method || 'GET').toUpperCase();

    if (PUBLIC_EXACT.some((e) => e.method === m && e.path === path)) return true;

    if (m === 'GET') {
        if (PUBLIC_DOCTOR_EXACT_GET.has(path)) return true;
        if (PUBLIC_DOCTOR_DETAIL_GET.test(path)) return true;
    }

    for (const { method: pm, prefix } of PUBLIC_METHOD_PREFIXES) {
        if (pm !== m) continue;
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
    // C1/M3 FIX: pass req.method so only the intended verb(s) bypass resolution.
    if (isPublicPath(req.method, req.originalUrl)) return next();

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
