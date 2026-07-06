import User from '../models/User.js';
import { verifyAccessToken } from '../utils/tokens.js';

// ─── protect ──────────────────────────────────────────────────────────────────
// PHASE1-C1/C2 FIX: tenant-binding enforcement.
//
// Previously this middleware verified the JWT signature and loaded the user
// by ID (correctly using skipTenantFilter() for the ID lookup), but never
// compared the resolved organisation for the request (req.orgId, set by
// resolveTenant from the client-supplied X-Organisation-Slug/-Id header or
// subdomain) against the authenticated user's OWN organisationId. That meant
// a valid token for a Hospital A user, combined with a header claiming
// Hospital B, was accepted end-to-end: every subsequent tenant-scoped query
// in the request ran under Hospital B's AsyncLocalStorage context while
// req.user (and all audit attribution) reflected the Hospital A identity.
//
// Two checks are added below, in order:
//   1. Token-vs-live-user drift check — the access token's `organisationId`
//      claim (set at issuance, see tokens.js) is compared against the LIVE
//      user document's organisationId. A mismatch means the user's org
//      assignment changed after this token was issued (e.g. admin
//      reassignment, or a future "move user between orgs" feature) — the
//      token is stale and must not be trusted for tenant-scoped work, even
//      though its signature is valid and the user still exists.
//   2. Header-vs-user binding check — for any non-super_admin user, the
//      resolved req.orgId (from resolveTenant, based on client-supplied
//      metadata) must equal the user's own organisationId, or the request
//      is rejected. This is the actual fix for C1: it makes tenant scoping
//      a verified server-side invariant instead of an unenforced convention
//      that only held because well-behaved clients always sent the header
//      matching the org they authenticated against.
//
// super_admin is exempt from check #2 by design — a super_admin's own
// organisationId is null, and legitimately operating across organisations
// (e.g. via organisationRoutes) is an intended capability of that role.
// Both checks are skipped entirely when req.orgId is not set (e.g. routes
// that bypass resolveTenant, like /api/auth/logout — see
// tenantMiddleware.js's PUBLIC_EXACT list), since there is no tenant context
// to bind against on those routes.
const protect = async (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer ')
    ) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ message: 'Not authorised — no token provided' });
    }

    try {
        const decoded = verifyAccessToken(token);

        const user = await User
            .findById(decoded.id)
            .select('+passwordChangedAt')
            .skipTenantFilter();

        if (!user || user.deletedAt) {
            return res.status(401).json({ message: 'User no longer exists' });
        }

        if (user.isTokenIssuedBeforePasswordChange(decoded.iat)) {
            return res.status(401).json({
                message: 'Password recently changed. Please log in again.',
            });
        }

        // ── PHASE1-C2: token-vs-live-user org drift check ──────────────────
        // Tokens issued before this fix shipped won't carry an
        // organisationId claim at all (decoded.organisationId === undefined).
        // Those are treated as stale/untrusted here too — the user is forced
        // to log in again and receive a token with the claim, rather than
        // silently being granted an unverified pass. This is an intentional,
        // one-time break of pre-existing sessions as part of closing a
        // critical tenant-isolation gap.
        if (user.role !== 'super_admin') {
            const tokenOrgId = decoded.organisationId ? String(decoded.organisationId) : null;
            const liveOrgId  = user.organisationId    ? String(user.organisationId)    : null;

            if (tokenOrgId !== liveOrgId) {
                return res.status(401).json({
                    message: 'Session is out of date. Please log in again.',
                });
            }
        }

        // ── PHASE1-C1: header-resolved org vs. user's own org ──────────────
        if (req.orgId && user.role !== 'super_admin') {
            if (String(user.organisationId ?? '') !== String(req.orgId)) {
                return res.status(403).json({
                    message: 'Access denied. This session is not valid for the requested organisation.',
                });
            }
        }

        req.user = user;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Session expired. Please refresh your token.' });
        }
        return res.status(401).json({ message: 'Not authorised — invalid token' });
    }
};

// ─── Role guards ──────────────────────────────────────────────────────────────
const requireRole = (...roles) => (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ message: 'Not authorised' });
    }
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({
            message: `Access denied. Required role: ${roles.join(' or ')}`,
        });
    }
    next();
};

// C2 FIX: admin guard now includes super_admin so super-admins can access
// all admin routes and the frontend /admin dashboard.
const admin                 = requireRole('admin', 'super_admin');
const doctor                = requireRole('doctor');
const isPatient             = requireRole('patient');
const isReceptionistOrAdmin = requireRole('receptionist', 'admin', 'super_admin');

export { protect, admin, doctor, isPatient, isReceptionistOrAdmin, requireRole };
