import User       from '../models/User.js';
import Membership from '../models/Membership.js';
import { verifyAccessToken } from '../utils/tokens.js';

// ─── protect ──────────────────────────────────────────────────────────────────
// PHASE1-C1/C2 FIX: tenant-binding enforcement. (unchanged — see below)
//
// PHASE M3 FIX: Membership becomes an additional, independent source of
// truth for "is this specific org relationship still active" on every
// request — layered ON TOP of the existing Phase 1 checks below, not
// replacing them.
//
// Why this is needed in addition to the existing User-field checks: those
// checks compare the token against the LIVE User document's own
// organisationId/role. That was sufficient when a User could only ever
// have one organisation relationship at a time. Once Membership exists
// (Phase M2) and a person can have several — or their relationship with
// ONE specific org can be revoked (Membership.status → 'removed') without
// touching the User document or any of their OTHER org relationships at
// all — the User-field checks alone can no longer express "was THIS
// specific relationship revoked." Membership can.
//
// Backward compatible: a token with no `membershipId` claim (issued before
// this phase deployed, or issued for super_admin, who never has one) skips
// this new check entirely and relies solely on the pre-existing Phase 1
// checks — identical behaviour to before this phase. Access tokens are
// short-lived (15 min), so every token in circulation naturally carries
// the new claim within one expiry window of deployment; no forced mass
// logout required.
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

        // ── PHASE M5 FIX: Membership supersedes the legacy single-org
        // checks when present. ──────────────────────────────────────────────
        //
        // Why this can no longer just run "alongside" the Phase 1 checks:
        // Phase 1's checks (C1/C2, directly below) assume a person has AT
        // MOST ONE organisation relationship, encoded in the single
        // User.organisationId field. That assumption is exactly what the
        // Membership model exists to remove (Phase M2 onward) — a person
        // can now hold active Memberships at several organisations
        // concurrently (architecture doc scenario 3/4). For such a person,
        // User.organisationId holds only ONE of their orgs (whichever was
        // written there most recently by legacy code) — so the old check
        // would incorrectly reject a perfectly valid session for any OTHER
        // org they're a member of.
        //
        // The Membership check (added in Phase M3, below) is strictly more
        // precise: it verifies the EXACT relationship this token was
        // issued for, by its own dedicated identifier, not by a single
        // shared field that can only describe one relationship at a time.
        // Once that has been verified, re-running the coarser legacy check
        // on top adds no safety and actively breaks the multi-org case
        // this phase exists to support.
        //
        // A token with no membershipId claim (pre-Phase-M3, or
        // super_admin, who never has one) still runs the original Phase 1
        // checks unchanged — full backward compatibility preserved for
        // anything not yet migrated.
        if (decoded.membershipId) {
            const membership = await Membership.findById(decoded.membershipId).lean();

            if (!membership || membership.status !== 'active') {
                return res.status(401).json({
                    message: 'Your access to this organisation has been revoked or is no longer active. Please log in again.',
                });
            }

            if (String(membership.userId) !== String(user._id)) {
                return res.status(401).json({ message: 'Session is invalid. Please log in again.' });
            }

            // The membership's own organisationId is the authoritative org
            // for this session — compare THAT against the request's
            // resolved org, not User.organisationId.
            if (req.orgId && String(membership.organisationId) !== String(req.orgId)) {
                return res.status(403).json({
                    message: 'Access denied. This session is not valid for the requested organisation.',
                });
            }

            // ── PHASE M7 PREREQUISITE FIX: effective role/org overlay ──────
            // req.user.role (the raw User document field) is a SINGLE
            // global value — it cannot correctly represent a person who
            // holds different roles at different organisations (exactly
            // the case Phase M5/M6 now allow: doctor at Org A, patient at
            // Org B, concurrently). Every role guard in this app
            // (requireRole/admin/doctor/isPatient/isReceptionistOrAdmin)
            // reads req.user.role directly, and audit.js reads
            // req.user.organisationId for its cross-org attribution
            // marker — both need to reflect the CAPACITY this specific
            // session is acting in, not whichever org happened to be
            // written to the User document last.
            //
            // This mutates the in-memory `user` document's role/
            // organisationId to match the resolved membership — NEVER
            // persisted (no .save() call), scoped to this one request
            // only. This is the correct place for it: `protect` has
            // already proven the membership is valid and belongs to this
            // user, so overlaying its role/org here is the single point
            // every downstream guard, controller, and audit call
            // transparently benefits from, with no per-controller changes
            // required.
            user.role           = membership.role;
            user.organisationId = membership.organisationId;

            req.membership = membership;
            req.user = user;
            return next();
        }

        // ── Everything below this line only runs for tokens WITHOUT a
        // membershipId claim — i.e. not yet migrated to Phase M3/M5. ───────

        // ── PHASE1-C2: token-vs-live-user org drift check (unchanged) ──────
        if (user.role !== 'super_admin') {
            const tokenOrgId = decoded.organisationId ? String(decoded.organisationId) : null;
            const liveOrgId  = user.organisationId    ? String(user.organisationId)    : null;

            if (tokenOrgId !== liveOrgId) {
                return res.status(401).json({
                    message: 'Session is out of date. Please log in again.',
                });
            }
        }

        // ── PHASE1-C1: header-resolved org vs. user's own org (unchanged) ──
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
