import Organisation from '../models/Organisation.js';
import { runWithTenant } from '../plugins/tenantPlugin.js';

// ── Paths that bypass tenant resolution completely ────────────────────────────
// isPublicPath() is METHOD-AWARE: every public entry declares which HTTP
// method(s) it applies to, so a mutating route added under a "public" prefix
// never inherits the bypass by accident.

// Exact-match public routes: { method, path }
const PUBLIC_EXACT = [
    { method: 'POST', path: '/api/auth/login' },
    { method: 'POST', path: '/api/auth/register' },
    { method: 'POST', path: '/api/auth/refresh' },
    { method: 'POST', path: '/api/auth/logout' },
    { method: 'POST', path: '/api/auth/logout-all' },
    { method: 'GET',  path: '/api/health' },

    // MFA pending-token routes: all four authenticate via the short-lived
    // mfaPending JWT (as a Bearer header for setup/verify-setup, or in the
    // request body for validate/recover) — they resolve their own user
    // context from that token and never need an X-Organisation-Slug header.
    // B6 FIX: /mfa/setup and /mfa/verify-setup were missing from this list.
    // In any multi-org deployment where the client doesn't send an org slug
    // header (a very plausible situation — different tab, cleared session
    // storage, etc.), these two routes would 400 with "Organisation not
    // specified" before ever reaching requireMfaPending/the controller,
    // breaking staff MFA setup entirely outside single-org deployments.
    { method: 'GET',  path: '/api/auth/mfa/setup' },
    { method: 'POST', path: '/api/auth/mfa/verify-setup' },
    { method: 'POST', path: '/api/auth/mfa/validate' },
    { method: 'POST', path: '/api/auth/mfa/recover' },

    // OTP FEATURE: patient self-registration / forgot-password — resolve org
    // internally (same pattern as /register above) and are the pre-auth
    // flows themselves, so no authenticated session or org header applies.
    { method: 'POST', path: '/api/auth/register/request-otp' },
    { method: 'POST', path: '/api/auth/register/resend-otp' },
    { method: 'POST', path: '/api/auth/register/verify-otp' },
    { method: 'POST', path: '/api/auth/forgot-password' },
    { method: 'POST', path: '/api/auth/forgot-password/resend-otp' },
    { method: 'POST', path: '/api/auth/forgot-password/verify-otp' },
    { method: 'POST', path: '/api/auth/forgot-password/reset' },
];

// Prefixes where a SPECIFIC method is public for all sub-paths.
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
const PUBLIC_DOCTOR_DETAIL_GET = /^\/api\/doctors\/[a-f\d]{24}(\/availability)?$/i;

const isPublicPath = (method, url) => {
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
