import { runWithTenant } from '../plugins/tenantPlugin.js';
import { extractOrgIdentifier } from '../utils/orgIdentifier.js';
import { resolveOrganisation } from '../utils/resolveOrg.js';

// ── PHASE-F FIX: PUBLIC_NO_TENANT vs PUBLIC_WITH_TENANT ────────────────────────
// Previously this file had one concept — "public" — implemented as "skip
// tenant resolution entirely." That collapsed two genuinely different
// kinds of routes into one bypass list:
//
//   (a) routes that truly have no tenant at all (login, refresh, MFA
//       pending-token flows, OTP registration/forgot-password) — these
//       authenticate a specific user or none at all, independent of any
//       organisation, and correctly never touch runWithTenant().
//
//   (b) routes that have NO authenticated USER but absolutely DO have a
//       TENANT — the public doctor listing and public package catalog are
//       always being viewed as a specific hospital's public site. Lumping
//       these into the same bypass as (a) meant runWithTenant() never ran
//       for them, tenantPlugin's implicit pre-find hook had no ambient
//       orgId to inject, and Doctor.find(...)/HealthPackage.find(...)
//       silently executed across every organisation — regardless of
//       whatever X-Organisation-Slug header the client correctly sent,
//       since the header was never even read for these routes.
//
// The fix separates these into PUBLIC_NO_TENANT (authentication AND tenant
// resolution both skipped) and PUBLIC_WITH_TENANT (authentication skipped,
// tenant resolution runs exactly as it does for any protected route).
// Category B requires no new resolution logic at all — resolveTenant()'s
// existing header/subdomain lookup, resolveOrganisation() call, and
// runWithTenant() wrapping already do precisely what these routes need;
// they only needed to stop being short-circuited before reaching it.

// ── Category A: PUBLIC_NO_TENANT — routes with genuinely no tenant ────────────
// isPublicNoTenantPath() is METHOD-AWARE: every entry declares which HTTP
// method(s) it applies to, so a mutating route added under a "public"
// prefix never inherits the bypass by accident.
const PUBLIC_NO_TENANT_EXACT = [
    { method: 'POST', path: '/api/auth/login' },
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
    { method: 'GET',  path: '/api/auth/mfa/setup' },
    { method: 'POST', path: '/api/auth/mfa/verify-setup' },
    { method: 'POST', path: '/api/auth/mfa/validate' },
    { method: 'POST', path: '/api/auth/mfa/recover' },

    // OTP FEATURE: patient self-registration / forgot-password — resolve
    // org internally (same pattern as /register above) and are the
    // pre-auth flows themselves, so no authenticated session or org header
    // applies.
    { method: 'POST', path: '/api/auth/register/request-otp' },
    { method: 'POST', path: '/api/auth/register/resend-otp' },
    { method: 'POST', path: '/api/auth/register/verify-otp' },
    { method: 'POST', path: '/api/auth/forgot-password' },
    { method: 'POST', path: '/api/auth/forgot-password/resend-otp' },
    { method: 'POST', path: '/api/auth/forgot-password/verify-otp' },
    { method: 'POST', path: '/api/auth/forgot-password/reset' },
];

const isPublicNoTenantPath = (method, url) => {
    const path = url.split('?')[0];
    const m = (method || 'GET').toUpperCase();
    return PUBLIC_NO_TENANT_EXACT.some((e) => e.method === m && e.path === path);
};

// ── Category B: PUBLIC_WITH_TENANT — documented here for clarity ──────────────
// These routes require NO code in this file — that's the point. They are
// simply absent from PUBLIC_NO_TENANT_EXACT above (so resolveTenant() runs
// its normal resolution logic for them, exactly as it does for any
// protected route) AND have no `protect` middleware attached at the route
// level in doctorRoutes.js / healthPackageRoutes.js (so no authenticated
// user is required). Listed here purely so it's explicit which routes rely
// on this behaviour:
//
//   GET /api/doctors
//   GET /api/doctors/:id
//   GET /api/doctors/:id/availability
//   GET /api/packages
//
// PHASE-F consequence, stated explicitly (not a regression): a request to
// any of these with no X-Organisation-Slug header/subdomain, in a system
// with 2+ organisations, now receives the same 400 "Organisation not
// specified" that any other ambiguous request gets — these routes resolve
// tenant context "exactly like authenticated routes" (skipping only the
// authentication requirement, not the tenant requirement), which is the
// explicit goal of this fix.

// ── TENANT_OPTIONAL_PREFIXES — unrelated, pre-existing mechanism (Phase 1b/4) ──
// Routes under /api/organisations manage the Organisation collection
// itself and already do their own explicit authorization
// (organisationController.js) — they proceed with no ambient tenant
// context when none resolves, AND proceed even when the resolved org is
// suspended (a super_admin managing a suspended org must not be blocked by
// its own suspension status). This is orthogonal to the PUBLIC_NO_TENANT/
// PUBLIC_WITH_TENANT split above and is left completely unchanged by this
// phase.
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
    if (isPublicNoTenantPath(req.method, req.originalUrl)) return next();

    const tenantOptional = isTenantOptionalPath(req.originalUrl);

    // Fast path: a tenant-optional route with no client-supplied
    // identifier at all skips the DB round-trip entirely.
    if (tenantOptional && !extractOrgIdentifier(req)) {
        return next();
    }

    try {
        const result = await resolveOrganisation(req);

        if (result.status === 'resolved') {
            const { org } = result;

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
