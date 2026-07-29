import mongoose      from 'mongoose';
import User          from '../models/User.js';
import Doctor        from '../models/Doctor.js';
import Appointment   from '../models/Appointment.js';
import HealthPackage from '../models/HealthPackage.js';
import Membership    from '../models/Membership.js';
import Notification  from '../models/Notification.js';
import audit         from '../utils/audit.js';
import { revokeAllRefreshTokens } from '../utils/tokens.js';
import { sendMail, templates }    from '../utils/mailer.js';

// ─── PHASE M6/M7 FOLLOW-UP FIX: shared Membership-aware identity resolver ────
// Every admin endpoint that acts on a target user by _id (getUserById,
// updateUser, deleteUser, resetPassword) previously resolved that user via
// User.findOne({ _id, deletedAt: null }) with NO explicit organisationId —
// relying entirely on tenantPlugin's implicit ambient-org filter, which
// compares against the legacy, single-value User.organisationId field.
//
// That was accidentally providing tenant isolation ("this admin can only
// touch users belonging to their own org") as a SIDE EFFECT of an
// assumption — one User belongs to one org — that died with the M5/M6
// Identity/Membership redesign. For an identity with an active Membership
// at a SECOND org, that implicit filter now does the wrong thing entirely:
// it either hides the user completely (if req.orgId happens not to match
// their stale field) or, worse, is simply irrelevant to whether they
// actually belong to the org the admin is acting from.
//
// This helper explicitly REPLACES that protection with the correct check:
// does an ACTIVE Membership exist for (userId, orgId)? Only if so does it
// resolve the underlying User identity, via .skipTenantFilter() — safe to
// bypass the legacy implicit filter here ONLY because the Membership check
// has already independently proven this user belongs to this org.
//
// Returns { user, membership } or null if either check fails. Accepts an
// optional Mongoose session for use inside a transaction (see deleteUser).
const findOrgScopedUser = async (userId, orgId, session = null) => {
    const membershipQuery = Membership.findOne({
        userId,
        organisationId: orgId,
        status:         'active',
    });
    if (session) membershipQuery.session(session);
    const membership = await membershipQuery;

    if (!membership) return null;

    const userQuery = User.findOne({ _id: userId, deletedAt: null }).skipTenantFilter();
    if (session) userQuery.session(session);
    const user = await userQuery;

    if (!user) return null;

    return { user, membership };
};

// ─── GET /api/admin/users ──────────────────────────────────────────────────
// PHASE M6/M7 FOLLOW-UP FIX: redesigned to be Membership-first.
//
// The old implementation queried User.find({ deletedAt, role }) directly,
// relying on tenantPlugin's implicit ambient-org filter (comparing against
// User.organisationId — a single, legacy field) to scope the list to this
// organisation. That assumption — "one User belongs to one organisation" —
// is exactly what died with the M5/M6 Identity/Membership redesign: an
// existing identity's User.organisationId only ever reflects wherever they
// were FIRST created, and is deliberately never updated when they're added
// to a second org. Under the old query, any such person became permanently
// invisible to every org EXCEPT whichever one happened to still match that
// stale field — which is precisely what caused the admin dashboard to lose
// the second-hospital doctor in this investigation.
//
// The corrected model: Membership is the authoritative source for "who
// belongs to this organisation, in what capacity." This now queries
// Membership first (scoped to req.orgId + status:'active', optionally
// filtered by the requested role — which is the per-org role, not the
// legacy global one), then resolves the underlying User identities by
// explicit _id (via .skipTenantFilter(), for the same reason as the
// doctorController fixes above — identity resolution by _id must not be
// re-filtered by the User's own stale organisationId once org-scoping has
// already been correctly established on the Membership side).
//
// Response shape is deliberately kept compatible with every existing
// frontend consumer (AdminDashboard.jsx's users.filter(u => u.role ===
// 'doctor'/'patient'/...) and DoctorList/PatientList/UserList component
// props) — each returned object still has a flat `role` field, EXCEPT it
// is now the correct, per-organisation Membership role rather than the
// vestigial User.role. No frontend changes required.
const getUsers = async (req, res) => {
    try {
        const { role } = req.query;

        const membershipFilter = { organisationId: req.orgId, status: 'active' };
        if (role) membershipFilter.role = role;

        const memberships = await Membership.find(membershipFilter).lean();

        if (memberships.length === 0) {
            return res.json([]);
        }

        const userIds = memberships.map((m) => m.userId);

        const users = await User.find({ _id: { $in: userIds }, deletedAt: null })
            .select('-password')
            .skipTenantFilter()
            .lean();

        const userById = new Map(users.map((u) => [u._id.toString(), u]));

        const result = memberships
            .filter((m) => userById.has(m.userId.toString()))
            .map((m) => {
                const u = userById.get(m.userId.toString());
                return {
                    ...u,
                    role:         m.role,   // authoritative for THIS org — overrides the legacy User.role field
                    membershipId: m._id,
                };
            });

        res.json(result);
    } catch (err) {
        console.error('[Admin] getUsers:', err.message);
        res.status(500).json({ message: 'Failed to fetch users' });
    }
};

// ─── GET /api/admin/users/:id ─────────────────────────────────────────────────
const getUserById = async (req, res) => {
    try {
        const resolved = await findOrgScopedUser(req.params.id, req.orgId);
        if (!resolved) return res.status(404).json({ message: 'User not found' });

        const { user, membership } = resolved;
        const plain = user.toObject();
        delete plain.password;

        // role reflects THIS org's Membership — authoritative, not the
        // vestigial global User.role field. Matches getUsers()'s shape.
        res.json({ ...plain, role: membership.role });
    } catch (err) {
        console.error('[Admin] getUserById:', err.message);
        res.status(500).json({ message: 'Failed to fetch user' });
    }
};

// ─── PUT /api/admin/users/:id ─────────────────────────────────────────────────
// M4 FIX: previously relied entirely on the DB's unique (email, organisationId)
// index to reject a duplicate email, which surfaces as a raw Mongo duplicate-key
// error caught by the generic try/catch and returned as an unhelpful 500
// "Failed to update user". This mirrors the same explicit-uniqueness-check
// pattern already used in registerUser/createStaff, so users now get a clean
// 409 with a clear message instead of a mysterious server error.
const updateUser = async (req, res) => {
    try {
        const { name, email } = req.body;

        const resolved = await findOrgScopedUser(req.params.id, req.orgId);
        if (!resolved) return res.status(404).json({ message: 'User not found' });
        const { user } = resolved;

        if (email && email.toLowerCase() !== user.email) {
            // PHASE M7 FOLLOW-UP: email is now globally unique (see
            // migration 009) — the duplicate check no longer needs (or
            // should use) organisationId at all.
            const duplicate = await User.findOne({
                email: email.toLowerCase(),
                deletedAt: null,
                _id: { $ne: user._id },
            }).skipTenantFilter();
            if (duplicate) {
                return res.status(409).json({ message: 'Another account with this email already exists' });
            }
        }

        if (name)  user.name  = name;
        if (email) user.email = email;

        let updated;
        try {
            updated = await user.save();
        } catch (saveErr) {
            if (saveErr.code === 11000) {
                return res.status(409).json({ message: 'Another account with this email already exists' });
            }
            throw saveErr;
        }

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   updated._id,
            meta:         { updatedFields: Object.keys(req.body), orgId: req.orgId },
        });

        res.json({ _id: updated._id, name: updated.name, email: updated.email, role: updated.role });
    } catch (err) {
        console.error('[Admin] updateUser:', err.message);
        res.status(500).json({ message: 'Failed to update user' });
    }
};

// ─── DELETE /api/admin/users/:id  (remove from THIS organisation) ────────────
// PHASE M6/M7 FOLLOW-UP FIX (closes the previously-flagged M6-1 issue):
// full redesign, not a patch.
//
// The old implementation resolved the target user via the same
// legacy-field-dependent lookup fixed elsewhere in this file, AND — more
// seriously — used `user.organisationId` (the single, stale legacy field)
// to decide which Membership to mark removed. For a multi-org identity,
// this was doubly wrong: it could fail to find the user at all when acting
// from a SECOND org, and even when it did find them, it could flip the
// WRONG org's Membership to removed — an admin at Hospital B intending to
// remove a doctor from Hospital B could, in principle, have silently
// affected their Hospital A relationship instead.
//
// It also unconditionally set `user.deletedAt` — treating "remove this
// person from my organisation" as equivalent to "erase this identity
// entirely," even though the person might still have a perfectly valid,
// active Membership at a completely different organisation that has
// nothing to do with this action. Per the Identity/Membership architecture
// principle established across this migration: User.deletedAt means the
// IDENTITY is gone (rare — e.g. a GDPR-style erasure request), and
// Membership.status is what "removed from THIS org" actually means. This
// endpoint should only ever touch the latter.
//
// Corrected behaviour:
//   1. Resolve the SPECIFIC active Membership for (userId, req.orgId) —
//      this IS the tenant-isolation check (replaces the old implicit one).
//   2. Cascade based on THAT membership's role, scoped to THIS org's data
//      only (appointments, and — for a doctor — the specific Doctor
//      profile linked to THIS membership via membershipId, never a bare
//      "any Doctor for this user" lookup, since a multi-org doctor can
//      have several).
//   3. Flip Membership.status to 'removed' — never touch User.deletedAt.
const deleteUser = async (req, res) => {
    if (req.params.id === req.user._id.toString()) {
        return res.status(400).json({ message: 'You cannot delete your own account' });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const resolved = await findOrgScopedUser(req.params.id, req.orgId, session);
        if (!resolved) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ message: 'User not found at this organisation' });
        }

        const { user, membership } = resolved;

        if (membership.role === 'patient') {
            await Appointment.updateMany(
                { patient: user._id, organisationId: req.orgId, status: 'Scheduled' },
                { $set: { status: 'Cancelled', notes: 'Cancelled: patient removed from organisation' } },
                { session }
            );
        }

        if (membership.role === 'doctor') {
            // Scoped to the SPECIFIC Doctor profile linked to THIS
            // membership — not a bare `{ user: user._id }` lookup, which
            // could match a DIFFERENT organisation's Doctor profile for a
            // multi-org doctor.
            const doctorProfile = await Doctor.findOne({ membershipId: membership._id, deletedAt: null }).session(session);
            if (doctorProfile) {
                await Appointment.updateMany(
                    { doctor: doctorProfile._id, organisationId: req.orgId, status: 'Scheduled' },
                    { $set: { status: 'Cancelled', notes: 'Cancelled: doctor removed from organisation' } },
                    { session }
                );
                doctorProfile.deletedAt = new Date();
                await doctorProfile.save({ session });
            }
        }

        membership.status    = 'removed';
        membership.removedAt = new Date();
        await membership.save({ session });

        await session.commitTransaction();
        session.endSession();

        // Conservative: revoke all of this identity's sessions, forcing
        // re-login. A fresh login correctly re-resolves whichever OTHER
        // active memberships (if any) still remain — this is not the same
        // as deleting the identity, it just ensures no stale token for
        // THIS removed relationship keeps working past this point.
        await revokeAllRefreshTokens(user._id);

        audit(req, 'DATA_DELETE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Membership',
            resourceId:   membership._id,
            meta:         { userId: user._id.toString(), role: membership.role, orgId: req.orgId },
        });

        res.json({ message: 'User removed from this organisation successfully' });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error('[Admin] deleteUser:', err.message);
        res.status(500).json({ message: 'Failed to delete user' });
    }
};

// ─── POST /api/admin/doctors ──────────────────────────────────────────────────
// ─── POST /api/admin/doctors ──────────────────────────────────────────────────
// PHASE M6 FIX: full redesign, same global-identity pattern as Phase M5's
// registerPatient, extended to cover the Doctor profile that must travel
// alongside a doctor's Membership.
//
// Four possible outcomes:
//
//   (a) No User exists anywhere for this email
//       → create User(role:'doctor') + Membership(active, role:'doctor') +
//         Doctor profile, all in one transaction. Identical to the
//         pre-M6 behaviour for a genuinely new person.
//
//   (b) A User already exists, but has NO Membership at this org yet
//       → THIS is scenario 1/3 from the architecture doc: a doctor moving
//         to a new hospital, or a doctor working at several hospitals
//         concurrently (the "celebrity doctor" case). The existing
//         identity (password, MFA) is reused untouched — same security
//         reasoning as registerPatient's outcome (b): this org's admin
//         must never be able to overwrite another org's doctor's real
//         password by "creating" them here. Only a NEW Membership + a NEW
//         Doctor profile (this org's own specialty/availability/etc,
//         independent of any other org's) are created.
//
//   (c) A User exists AND already has an active Membership at this org
//       → 409, distinguishing "already a doctor here" from "already has a
//         different active role here" (same pattern as registerPatient).
//
//   (d) A User exists AND has a REMOVED Membership at this org, previously
//       role 'doctor'
//       → reactivate the Membership, and reactivate-or-recreate the
//         corresponding Doctor profile for that membership (using the
//         newly submitted specialty/qualifications/experienceYears — this
//         is effectively "re-hiring," and the clinical details may well
//         have changed since they left). A removed Membership with a
//         DIFFERENT prior role still requires an explicit conversion
//         workflow, not silent creation.
const createDoctor = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { name, email, password, specialty, qualifications, experienceYears } = req.body;

        const matches = await User.find({ email }).session(session).skipTenantFilter();

        if (matches.length > 1) {
            await session.abortTransaction();
            session.endSession();
            console.error(`[Admin] createDoctor: multiple global User documents share email ${email} — manual resolution required.`, matches.map((m) => m._id));
            return res.status(409).json({
                message: 'Multiple accounts exist for this email. Please contact support to resolve this before onboarding.',
            });
        }

        const existingUser = matches[0] ?? null;

        // ── Outcome (a): brand-new identity ─────────────────────────────────
        if (!existingUser) {
            const [user] = await User.create([{ name, email, password, role: 'doctor' }], { session });

            const [membership] = await Membership.create(
                [{
                    userId:         user._id,
                    organisationId: req.orgId,
                    role:           'doctor',
                    status:         'active',
                    joinedAt:       new Date(),
                    invitedBy:      req.user._id,
                }],
                { session }
            );

            const [doctor] = await Doctor.create(
                [{
                    user:         user._id,
                    membershipId: membership._id,
                    specialty,
                    qualifications,
                    experienceYears,
                }],
                { session }
            );

            await session.commitTransaction();
            session.endSession();

            audit(req, 'DATA_CREATE', {
                actorId:      req.user._id,
                actorRole:    req.user.role,
                resourceType: 'Doctor',
                resourceId:   doctor._id,
                meta:         { orgId: req.orgId },
            });

            return res.status(201).json({ message: 'Doctor created successfully', userId: user._id, doctorId: doctor._id });
        }

        // Existing identity found — check this org's Membership.
        const membership = await Membership.findOne({
            userId:         existingUser._id,
            organisationId: req.orgId,
        }).session(session);

        // ── Outcome (b): existing identity, new to THIS org ─────────────────
        if (!membership) {
            const [newMembership] = await Membership.create(
                [{
                    userId:         existingUser._id,
                    organisationId: req.orgId,
                    role:           'doctor',
                    status:         'active',
                    joinedAt:       new Date(),
                    invitedBy:      req.user._id,
                }],
                { session }
            );

            const [doctor] = await Doctor.create(
                [{
                    user:         existingUser._id,
                    membershipId: newMembership._id,
                    specialty,
                    qualifications,
                    experienceYears,
                }],
                { session }
            );

            await session.commitTransaction();
            session.endSession();

            audit(req, 'DATA_CREATE', {
                actorId:      req.user._id,
                actorRole:    req.user.role,
                resourceType: 'Doctor',
                resourceId:   doctor._id,
                meta:         { event: 'existing_identity_added_to_org', orgId: req.orgId },
            });

            return res.status(201).json({
                message: 'This person already has an account and has been onboarded as a doctor at your organisation.',
                userId:  existingUser._id,
                doctorId: doctor._id,
            });
        }

        // ── Outcome (c): active Membership already at this org ──────────────
        if (membership.status === 'active') {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({
                message: membership.role === 'doctor'
                    ? 'A doctor with this email already exists at this organisation.'
                    : 'This email belongs to an account with a different active role at this organisation. Restore or convert it through account management instead of creating a new doctor.',
            });
        }

        // ── Outcome (d): removed Membership at this org ──────────────────────
        if (membership.role !== 'doctor') {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({
                message: 'This email belongs to a deleted account with a different role at this organisation. ' +
                          'Restore or convert it through account management instead of creating a new doctor.',
            });
        }

        membership.status    = 'active';
        membership.removedAt = null;
        await membership.save({ session });

        let doctor = await Doctor.findOne({ membershipId: membership._id }).session(session);

        if (doctor) {
            doctor.deletedAt        = null;
            doctor.specialty        = specialty;
            doctor.qualifications   = qualifications;
            doctor.experienceYears  = experienceYears;
            await doctor.save({ session });
        } else {
            // Defensive: should not happen given Phase M4's dual-write, but
            // fails toward creating a fresh profile rather than leaving the
            // reactivated Membership without any Doctor profile at all.
            [doctor] = await Doctor.create(
                [{
                    user:         existingUser._id,
                    membershipId: membership._id,
                    specialty,
                    qualifications,
                    experienceYears,
                }],
                { session }
            );
        }

        await session.commitTransaction();
        session.endSession();

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Doctor',
            resourceId:   doctor._id,
            meta:         { action: 'restore', orgId: req.orgId },
        });

        return res.status(200).json({
            message:  'Doctor restored successfully',
            userId:   existingUser._id,
            doctorId: doctor._id,
        });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error('[Admin] createDoctor:', err.message);
        res.status(500).json({ message: 'Failed to create doctor' });
    }
};

// ─── PUT /api/admin/doctors/:id ───────────────────────────────────────────────
const updateDoctorProfile = async (req, res) => {
    try {
        const { specialty, qualifications, experienceYears, availability } = req.body;
        const doctor = await Doctor.findById(req.params.id);
        if (!doctor) return res.status(404).json({ message: 'Doctor profile not found' });

        if (specialty       !== undefined) doctor.specialty       = specialty;
        if (qualifications  !== undefined) doctor.qualifications  = qualifications;
        if (experienceYears !== undefined) doctor.experienceYears = experienceYears;
        if (availability    !== undefined) doctor.availability    = availability;

        const updated = await doctor.save();

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Doctor',
            resourceId:   updated._id,
            meta:         { orgId: req.orgId },
        });

        res.json(updated);
    } catch (err) {
        console.error('[Admin] updateDoctorProfile:', err.message);
        res.status(500).json({ message: 'Failed to update doctor profile' });
    }
};

// ─── POST /api/admin/staff ────────────────────────────────────────────────────
// PHASE5-L2 FIX: the existence/restore check below previously ran
// `User.findOne({ email }).skipTenantFilter()` — fully global, with no
// organisationId in the filter. Same two bugs as registerPatient
// (receptionistController.js) had: (1) a soft-deleted staff member with
// this email in a DIFFERENT org could be matched and restored here,
// reactivating another org's user record and changing its role, entirely
// invisible to that org; (2) a legitimate same-email-different-org staff
// creation would incorrectly 409 even though the current org has no actual
// conflict. Scoping the filter to `organisationId: req.orgId` (kept
// explicit alongside .skipTenantFilter()) closes both.
// ─── POST /api/admin/staff ────────────────────────────────────────────────────
// PHASE M6 FIX: same global-identity redesign as createDoctor/registerPatient
// above — see those for the full outcome-by-outcome rationale. Applied here
// to receptionist/admin creation (scenario 5 from the architecture doc:
// "receptionist leaves Hospital A, later joins Hospital B").
const createStaff = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { name, email, password, role } = req.body;

        const matches = await User.find({ email }).session(session).skipTenantFilter();

        if (matches.length > 1) {
            await session.abortTransaction();
            session.endSession();
            console.error(`[Admin] createStaff: multiple global User documents share email ${email} — manual resolution required.`, matches.map((m) => m._id));
            return res.status(409).json({
                message: 'Multiple accounts exist for this email. Please contact support to resolve this before creating staff.',
            });
        }

        const existingUser = matches[0] ?? null;

        // ── Outcome (a): brand-new identity ─────────────────────────────────
        if (!existingUser) {
            const [user] = await User.create([{ name, email, password, role }], { session });

            await Membership.create(
                [{
                    userId:         user._id,
                    organisationId: req.orgId,
                    role,
                    status:         'active',
                    joinedAt:       new Date(),
                    invitedBy:      req.user._id,
                }],
                { session }
            );

            await session.commitTransaction();
            session.endSession();

            audit(req, 'DATA_CREATE', {
                actorId:      req.user._id,
                actorRole:    req.user.role,
                resourceType: 'User',
                resourceId:   user._id,
                meta:         { createdRole: role, orgId: req.orgId },
            });

            return res.status(201).json({ _id: user._id, name: user.name, email: user.email, role: user.role });
        }

        // Existing identity found — check this org's Membership.
        const membership = await Membership.findOne({
            userId:         existingUser._id,
            organisationId: req.orgId,
        }).session(session);

        // ── Outcome (b): existing identity, new to THIS org ─────────────────
        if (!membership) {
            await Membership.create(
                [{
                    userId:         existingUser._id,
                    organisationId: req.orgId,
                    role,
                    status:         'active',
                    joinedAt:       new Date(),
                    invitedBy:      req.user._id,
                }],
                { session }
            );

            await session.commitTransaction();
            session.endSession();

            audit(req, 'DATA_CREATE', {
                actorId:      req.user._id,
                actorRole:    req.user.role,
                resourceType: 'Membership',
                resourceId:   existingUser._id,
                meta:         { event: 'existing_identity_added_to_org', role, orgId: req.orgId },
            });

            return res.status(201).json({
                message: 'This person already has an account and has been added as staff at your organisation.',
                _id:     existingUser._id,
                name:    existingUser.name,
                email:   existingUser.email,
                role,
            });
        }

        // ── Outcome (c): active Membership already at this org ──────────────
        if (membership.status === 'active') {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({
                message: membership.role === role
                    ? 'A user with this email and role already exists at this organisation.'
                    : 'This email belongs to an account with a different active role at this organisation. Restore or convert it through account management instead of creating new staff.',
            });
        }

        // ── Outcome (d): removed Membership at this org ──────────────────────
        if (membership.role !== role) {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({
                message: 'This email belongs to a deleted account with a different role at this organisation. ' +
                          'Restore or convert it through account management instead of creating new staff.',
            });
        }

        membership.status    = 'active';
        membership.removedAt = null;
        await membership.save({ session });

        await session.commitTransaction();
        session.endSession();

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Membership',
            resourceId:   existingUser._id,
            meta:         { action: 'restore', role, orgId: req.orgId },
        });

        return res.status(200).json({
            message: 'Staff restored successfully',
            user:    { _id: existingUser._id, name: existingUser.name, email: existingUser.email, role },
        });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error('[Admin] createStaff:', err.message);
        res.status(500).json({ message: 'Failed to create staff member' });
    }
};

// ─── PUT /api/admin/users/:id/reset-password ─────────────────────────────────
const resetPassword = async (req, res) => {
    try {
        const { newPassword } = req.body;

        const resolved = await findOrgScopedUser(req.params.id, req.orgId);
        if (!resolved) return res.status(404).json({ message: 'User not found' });
        const { user } = resolved;

        user.password = newPassword;
        await user.save();

        await revokeAllRefreshTokens(user._id);

        audit(req, 'AUTH_PASSWORD_CHANGED', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   user._id,
            meta:         { resetBy: 'admin', orgId: req.orgId },
        });

        // ── WS2: Notify the affected user ─────────────────────────────────────
        const org = req.org ?? null;

        Notification.create({
            user:    user._id,
            type:    'password_reset',
            title:   'Password Reset',
            message: 'Your account password has been reset by an administrator. Please log in with your new password.',
            link:    '/login',
        }).catch((e) => console.error('[Notification] create failed:', e.message));

        sendMail({
            to:  user.email,
            org,
            ...templates.passwordResetByAdmin({ userName: user.name, org }),
        });

        res.json({ message: 'Password reset successfully. User must log in again.' });
    } catch (err) {
        console.error('[Admin] resetPassword:', err.message);
        res.status(500).json({ message: 'Failed to reset password' });
    }
};

// ─── GET /api/admin/doctors-full ─────────────────────────────────────────────
const getDoctorsWithProfiles = async (req, res) => {
    try {
        // FIX (this audit round): explicit organisationId filter —
        // defense-in-depth, matching the public doctor routes.

        const doctors = await Doctor.find({ organisationId: req.orgId, deletedAt: null })
            .populate('user', 'name email')
            .lean();


        res.json(doctors);
    } catch (err) {
        console.error('[Admin] getDoctorsWithProfiles:', err.message);
        res.status(500).json({ message: 'Failed to fetch doctor profiles' });
    }
};

// ─── GET /api/admin/packages-full (PHASE-F, Task 3) ───────────────────────────
// Mirrors getDoctorsWithProfiles above exactly: protected (adminRoutes.js
// mounts this behind `protect, admin`, which was never in any tenant
// bypass list), no explicit organisationId filter, relies entirely on
// tenantPlugin's implicit pre-find hook via the ambient context resolveTenant
// already established earlier in the middleware chain. HealthPackage has no
// refs to populate (unlike Doctor → user), so no .populate() call is needed
// here — otherwise identical shape/pattern.
//
// This exists specifically so AdminDashboard.jsx can stop depending on the
// PUBLIC GET /api/packages route (see PHASE-F Task 4) — that route is
// correctly tenant-resolved now too (see tenantMiddleware.js's
// PUBLIC_WITH_TENANT category), but it's still the PUBLIC catalog endpoint;
// giving admin its own dedicated route matches the separation of concerns
// /api/doctors vs /api/admin/doctors-full already established, rather than
// having the admin dashboard depend on a route whose primary purpose is
// serving anonymous public visitors.
const getPackagesFull = async (req, res) => {
    try {
        const packages = await HealthPackage.find({ deletedAt: null }).lean();
        res.json(packages);
    } catch (err) {
        console.error('[Admin] getPackagesFull:', err.message);
        res.status(500).json({ message: 'Failed to fetch package profiles' });
    }
};

export {
    getUsers, getUserById, updateUser, deleteUser,
    createDoctor, updateDoctorProfile, createStaff,
    resetPassword, getDoctorsWithProfiles, getPackagesFull,
};
