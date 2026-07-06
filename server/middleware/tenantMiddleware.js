import Organisation from '../models/Organisation.js';
import env from '../config/env.js';
import { runWithTenant } from '../plugins/tenantPlugin.js';
import { extractOrgIdentifier } from '../utils/orgIdentifier.js';

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

// ── PHASE1B / PHASE4 FIX ────────────────────────────────────────────────────────
// Routes under these prefixes manage the `Organisation` collection itself.
// `Organisation` is NOT a tenant-scoped model (it has no organisationId field
// of its own — it IS the tenant), and organisationController.js already does
// its own explicit authorization (super_admin-only for global list/create/
// delete/stats; `req.user.organisationId === org._id` for org-admin's own-org
// read/update — see getOrganisationById/updateOrganisation). None of these
// controllers read req.org or req.orgId at all.
//
// PHASE1B covered the "no header sent" branch: a super_admin calling
// `GET /api/organisations` (list all orgs) or `POST /api/organisations`
// (create a brand new org) has no reason to send an X-Organisation-Slug
// header, and previously got a 400 once a second org existed (H2-adjacent
// trap). That fix only handled the case where NO org resolves at all.
//
// PHASE4 FIX (this addition): the client's axios layer (see
// client/src/api/index.js) attaches whatever org slug is currently in
// sessionStorage/memory to essentially every outgoing request once one is
// known — including a super_admin's own requests, whose "current" org
// context is really just whichever org they last looked at, not a
// meaningful scope for platform-wide actions. If that remembered org
// happens to be SUSPENDED, the org-found branch below used to still 403
// with "organisation account is suspended" — blocking a super_admin from
// listing or managing ALL organisations (including ones completely
// unrelated to the suspended one) purely because of stale client-side
// context. Since these routes don't depend on the resolved org being
// accessible (they don't use req.org for anything but incidental context),
// the isAccessible check is now skipped for tenant-optional paths too, not
// just the "no header" case. The 404 "org not found" check is deliberately
// UNCHANGED for these paths — a header pointing at a nonexistent org is a
// genuine client error worth surfacing, unlike suspension status, which is
// simply irrelevant to what these routes do.
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
export const resolveTenant = async (req, res, next) => {
    if (isPublicPath(req.method, req.originalUrl)) return next();

    const tenantOptional = isTenantOptionalPath(req.originalUrl);

    // PHASE2 FIX: the old inline resolveSlug() extraction logic has been
    // replaced with the shared, DB-free extractOrgIdentifier() utility (see
    // server/utils/orgIdentifier.js). Same extraction rules as before, now
    // shared with rateLimiter.js so the two can never silently diverge on
    // "what counts as the client's claimed org" for the one thing they both
    // need it for.
    const resolved = extractOrgIdentifier(req);

    if (!resolved) {
        // PHASE1B FIX: super-admin Organisation-management routes proceed
        // with no ambient tenant context rather than being forced to 400 —
        // see the TENANT_OPTIONAL_PREFIXES comment above for why this is
        // safe for this specific route family.
        if (tenantOptional) return next();

        try {
            const count = await Organisation.countDocuments({ deletedAt: null, isActive: true });

            // PHASE2-H2 FIX: the single-active-org auto-pick is now gated
            // behind ALLOW_SINGLE_ORG_AUTO_RESOLVE (default false — see
            // env.js). Previously this branch ran unconditionally whenever
            // count === 1, regardless of environment, which meant a
            // deployment's behavior for any header-less client silently
            // changed the moment a second hospital was onboarded (H2 in the
            // multi-tenant audit) — a breaking change occurring at exactly
            // the moment multi-tenancy starts to matter. With the flag off
            // (the production default), a header-less request is now
            // rejected with 400 regardless of how many orgs currently exist
            // (count === 0 is still a pass-through — nothing to scope
            // against), so onboarding hospital #2 changes nothing about this
            // middleware's behavior for existing, well-behaved clients.
            if (env.ALLOW_SINGLE_ORG_AUTO_RESOLVE && count === 1) {
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

        // PHASE4 FIX: tenant-optional paths (organisation management routes)
        // proceed regardless of the resolved org's accessibility — see the
        // TENANT_OPTIONAL_PREFIXES comment above. Every other route keeps
        // the existing strict behavior: a suspended/trial-expired org's
        // members cannot proceed at all.
        if (!org.isAccessible && !tenantOptional) {
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
