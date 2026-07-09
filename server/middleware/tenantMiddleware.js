import { runWithTenant } from '../plugins/tenantPlugin.js';
import { extractOrgIdentifier } from '../utils/orgIdentifier.js';
import { resolveOrganisation } from '../utils/resolveOrg.js';

// ── Paths that bypass tenant resolution completely ────────────────────────────
// isPublicPath() is METHOD-AWARE: every public entry declares which HTTP
// method(s) it applies to, so a mutating route added under a "public" prefix
// never inherits the bypass by accident.

// Exact-match public routes: { method, path }
const PUBLIC_EXACT = [
    { method: 'POST', path: '/api/auth/login' },
    // PHASE-E addition: the new dedicated super_admin login endpoint.
    // Must bypass resolveTenant exactly like /api/auth/login — it never
    // sends or expects an X-Organisation-Slug header, by design (see
    // authController.platformLoginUser).
    { method: 'POST', path: '/api/auth/platform-login' },
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

// ── PHASE1B / PHASE4 FIX ────────────────────────────────────────────────────────
// Routes under these prefixes manage the `Organisation` collection itself.
// `Organisation` is NOT a tenant-scoped model (it has no organisationId field
// of its own — it IS the tenant), and organisationController.js already does
// its own explicit authorization (super_admin-only for global list/create/
// delete/stats; `req.user.organisationId === org._id` for org-admin's own-org
// read/update). None of these controllers read req.org or req.orgId at all.
//
// PHASE1B: a super_admin calling `GET /api/organisations` or
// `POST /api/organisations` has no reason to send an org header, and
// previously got a 400 once a second org existed. PHASE4: a super_admin's
// stale/remembered org header (attached automatically by the frontend's
// axios layer — see client/src/api/index.js) resolving to a SUSPENDED org
// used to still 403 these routes, blocking platform-wide management for a
// reason completely irrelevant to what these routes do. Both are handled by
// skipping the corresponding checks (ambiguity-as-400, and
// suspended-as-403) for this route family. A genuinely nonexistent org
// (bad header value) still 404s — that's a real client error worth
// surfacing, unlike ambiguity or suspension status.
const TENANT_OPTIONAL_PREFIXES = [
    '/api/organisations',
];

const isTenantOptionalPath = (url) => {
    const path = url.split('?')[0];
    return TENANT_OPTIONAL_PREFIXES.some(
        (prefix) => path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')
    );
};

// ── Main middleware ────────────────────────────────────────────────────────────
// PHASE5-L1 FIX: this function's own org-lookup and single-org-fallback
// logic has been extracted into the shared resolveOrganisation() utility
// (server/utils/resolveOrg.js), also used by authController.js. Behavior is
// unchanged from the pre-Phase-5 version — this is a pure consolidation,
// not a functional change — except for one deliberate efficiency
// preservation noted inline below.
export const resolveTenant = async (req, res, next) => {
    if (isPublicPath(req.method, req.originalUrl)) return next();

    const tenantOptional = isTenantOptionalPath(req.originalUrl);

    // Fast path: a tenant-optional route with no client-supplied identifier
    // at all (the common case — e.g. a super_admin listing/creating
    // organisations with no org header sent) skips the DB round-trip
    // entirely, matching this middleware's pre-consolidation behavior for
    // this specific case rather than paying for a countDocuments() call
    // whose result would just be discarded a moment later.
    if (tenantOptional && !extractOrgIdentifier(req)) {
        return next();
    }

    try {
        const result = await resolveOrganisation(req);

        if (result.status === 'resolved') {
            const { org } = result;

            // PHASE4 FIX: tenant-optional paths proceed regardless of the
            // resolved org's accessibility — see the TENANT_OPTIONAL_PREFIXES
            // comment above.
            if (!org.isAccessible && !tenantOptional) {
                return res.status(403).json({
                    message: 'Your organisation account is suspended or your trial has ended. Please contact support.',
                });
            }

            req.org   = org;
            req.orgId = org._id;
            return runWithTenant(org._id, () => next());
        }

        if (result.status === 'not_found') {
            return res.status(404).json({ message: 'Organisation not found' });
        }

        if (result.status === 'no_orgs') {
            return next();
        }

        // result.status === 'ambiguous'
        // PHASE1B FIX: tenant-optional routes proceed with no ambient
        // context instead of being forced to 400 here too.
        if (tenantOptional) return next();

        return res.status(400).json({
            message: 'Organisation not specified. Include X-Organisation-Slug header or use your subdomain.',
        });
    } catch (err) {
        console.error('[Tenant] resolution error:', err.message);
        return res.status(500).json({ message: 'Failed to resolve organisation' });
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
