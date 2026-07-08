import mongoose      from 'mongoose';
import Organisation from '../models/Organisation.js';
import User         from '../models/User.js';
import audit        from '../utils/audit.js';
import { revokeAllRefreshTokens } from '../utils/tokens.js';

// ─── GET /api/organisations/slug-availability/:slug (super-admin only) ───────
// PHASE-C addition: supports live slug-availability checking in the
// guided Hospital Onboarding flow (client/src/pages/HospitalOnboardingPage.jsx),
// so a conflict surfaces while the user is still typing rather than only on
// final submit (a 409 from createOrganisation). Deliberately checks
// EXISTENCE only (deletedAt: null) — a slug belonging to a suspended org is
// still "taken" and must not be reused, since reactivating that org later
// would then collide with whatever new org took its slug.
export const checkSlugAvailability = async (req, res) => {
    try {
        const slug = (req.params.slug || '').toLowerCase().trim();

        if (!/^[a-z0-9-]{3,63}$/.test(slug)) {
            return res.json({ available: false, reason: 'invalid_format' });
        }

        const exists = await Organisation.findOne({ slug, deletedAt: null }).select('_id').lean();
        res.json({ available: !exists });
    } catch (err) {
        console.error('[Org] checkSlugAvailability:', err.message);
        res.status(500).json({ message: 'Failed to check slug availability' });
    }
};

// ─── GET /api/organisations (super-admin only) ────────────────────────────────
// PHASE-B FIX: previously filtered to { deletedAt: null }, which silently
// excluded every suspended organisation from this list entirely. That was
// harmless before Phase A added reactivateOrganisation (there was no UI
// action a suspended org's row could ever need), but now that a super_admin
// needs to actually SEE a suspended org to reactivate it, filtering it out
// of the one endpoint that lists organisations makes reactivation
// unreachable through the UI — the only way to find a suspended org's ID
// would be a direct database query. This now returns every organisation
// regardless of status; the client is responsible for displaying status
// (see SuperAdminDashboard.jsx's Active/Suspended badge).
export const getAllOrganisations = async (req, res) => {
    try {
        const orgs = await Organisation.find({})
            .select('-__v')
            .sort({ createdAt: -1 })
            .lean();
        res.json(orgs);
    } catch (err) {
        console.error('[Org] getAllOrganisations:', err.message);
        res.status(500).json({ message: 'Failed to fetch organisations' });
    }
};

// ─── GET /api/organisations/:id ───────────────────────────────────────────────
export const getOrganisationById = async (req, res) => {
    try {
        const org = await Organisation.findOne({ _id: req.params.id, deletedAt: null }).lean();
        if (!org) return res.status(404).json({ message: 'Organisation not found' });

        // Org-admin can only read their own org
        if (req.user.role !== 'super_admin' &&
            org._id.toString() !== req.user.organisationId?.toString()) {
            return res.status(403).json({ message: 'Access denied' });
        }

        res.json(org);
    } catch (err) {
        console.error('[Org] getOrganisationById:', err.message);
        res.status(500).json({ message: 'Failed to fetch organisation' });
    }
};

// ─── POST /api/organisations (super-admin only) ───────────────────────────────
// PHASE4 FIX: optionally creates the organisation's first admin user
// ATOMICALLY with the organisation itself, when `adminUser` is provided in
// the request body (see organisationValidators.js's adminUserSchema). Both
// documents are created in a single MongoDB transaction: either both
// succeed, or neither is persisted.
export const createOrganisation = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { name, slug, contactEmail, contactPhone, address, plan, settings, adminUser } = req.body;

        const slugExists = await Organisation.findOne({ slug, deletedAt: null }).session(session);
        if (slugExists) {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({ message: `Slug "${slug}" is already taken` });
        }

        const [org] = await Organisation.create([{
            name, slug, contactEmail, contactPhone, address,
            plan:      plan ?? 'trial',
            settings:  settings ?? {},
            createdBy: req.user._id,
        }], { session });

        let createdAdmin = null;
        if (adminUser) {
            [createdAdmin] = await User.create([{
                name:           adminUser.name,
                email:          adminUser.email,
                password:       adminUser.password,
                role:           'admin',
                organisationId: org._id,
            }], { session });
        }

        await session.commitTransaction();
        session.endSession();

        audit(req, 'DATA_CREATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Organisation',
            resourceId:   org._id,
        });

        if (createdAdmin) {
            audit(req, 'DATA_CREATE', {
                actorId:      req.user._id,
                actorRole:    req.user.role,
                resourceType: 'User',
                resourceId:   createdAdmin._id,
                meta:         { createdRole: 'admin', orgId: org._id.toString(), event: 'org_onboarding_admin' },
            });
        }

        res.status(201).json({
            organisation: org,
            adminUser: createdAdmin ? {
                _id:   createdAdmin._id,
                name:  createdAdmin.name,
                email: createdAdmin.email,
            } : null,
        });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();

        if (err.code === 11000) {
            return res.status(409).json({ message: 'Slug is already taken' });
        }

        console.error('[Org] createOrganisation:', err.message);
        res.status(500).json({ message: 'Failed to create organisation' });
    }
};

// ─── PUT /api/organisations/:id ───────────────────────────────────────────────
export const updateOrganisation = async (req, res) => {
    try {
        const org = await Organisation
            .findOne({ _id: req.params.id, deletedAt: null })
            .select('+settings.smtp.pass');
        if (!org) return res.status(404).json({ message: 'Organisation not found' });

        const isSuperAdmin = req.user.role === 'super_admin';
        if (!isSuperAdmin &&
            org._id.toString() !== req.user.organisationId?.toString()) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const {
            name, contactEmail, contactPhone,
            address, settings, features,
        } = req.body;

        if (name         !== undefined) org.name         = name;
        if (contactEmail !== undefined) org.contactEmail = contactEmail;
        if (contactPhone !== undefined) org.contactPhone = contactPhone;
        if (address      !== undefined) org.address      = { ...org.address, ...address };

        if (settings !== undefined) {
            const { smtp: incomingSmtp, ...restSettings } = settings;

            org.settings = {
                ...org.settings,
                ...restSettings,
            };

            if (incomingSmtp !== undefined) {
                org.settings.smtp = {
                    ...(org.settings.smtp ?? {}),
                    ...incomingSmtp,
                };
            }
        }

        if (features !== undefined && isSuperAdmin) {
            org.features = { ...org.features, ...features };
        }

        const updated = await org.save();

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Organisation',
            resourceId:   updated._id,
        });

        const responseBody = updated.toObject();
        if (responseBody.settings?.smtp) {
            delete responseBody.settings.smtp.pass;
        }

        res.json(responseBody);
    } catch (err) {
        console.error('[Org] updateOrganisation:', err.message);
        res.status(500).json({ message: 'Failed to update organisation' });
    }
};

// ─── DELETE /api/organisations/:id (super-admin only — soft delete/suspend) ───
export const deleteOrganisation = async (req, res) => {
    try {
        const org = await Organisation.findOne({ _id: req.params.id, deletedAt: null });
        if (!org) return res.status(404).json({ message: 'Organisation not found' });

        org.deletedAt  = new Date();
        org.isActive   = false;
        await org.save();

        const orgUsers = await User
            .find({ organisationId: org._id, deletedAt: null })
            .select('_id')
            .skipTenantFilter()
            .lean();

        await Promise.all(orgUsers.map((u) => revokeAllRefreshTokens(u._id)));

        audit(req, 'DATA_DELETE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Organisation',
            resourceId:   org._id,
            meta:         { revokedSessionsForUserCount: orgUsers.length },
        });

        res.json({ message: 'Organisation deactivated successfully', revokedSessionsFor: orgUsers.length });
    } catch (err) {
        console.error('[Org] deleteOrganisation:', err.message);
        res.status(500).json({ message: 'Failed to delete organisation' });
    }
};

// ─── PATCH /api/organisations/:id/reactivate (super-admin only) ──────────────
// PHASE-A FIX: closes the gap identified during the Super Admin frontend
// readiness review — deleteOrganisation (above) could suspend an org, but
// nothing in the API could ever reverse it; the only path back to active
// was a direct database edit. Deliberately the narrow inverse of
// deleteOrganisation: clears deletedAt/isActive/suspendedAt only.
//
// Does NOT attempt to restore the sessions that were revoked at suspension
// time (see deleteOrganisation) — that revocation was correct and complete
// at the time it happened; reactivation just means the org's users CAN log
// in again going forward, not that their old sessions come back. They log
// in normally, same as any session-expired user.
//
// Does NOT touch billingStatus or plan/trialEndsAt — those are separate,
// billing-flow concerns (deleteOrganisation never set them either, so
// there's nothing for this endpoint to symmetrically undo there). If an
// org's `isAccessible` virtual is still false after reactivation because of
// an expired trial or a billing-side suspension, that's correct and
// intentional — this endpoint only reverses what deleteOrganisation does,
// not every possible reason an org could be inaccessible.
export const reactivateOrganisation = async (req, res) => {
    try {
        // Deliberately NOT filtering by deletedAt: null here — the whole
        // point is to find an org that IS currently deleted/suspended.
        const org = await Organisation.findOne({ _id: req.params.id });
        if (!org) return res.status(404).json({ message: 'Organisation not found' });

        if (org.isActive && !org.deletedAt) {
            return res.status(400).json({ message: 'Organisation is already active.' });
        }

        org.isActive    = true;
        org.deletedAt   = null;
        org.suspendedAt = null;
        await org.save();

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Organisation',
            resourceId:   org._id,
            meta:         { action: 'reactivate' },
        });

        res.json({ message: 'Organisation reactivated successfully.', organisation: org });
    } catch (err) {
        console.error('[Org] reactivateOrganisation:', err.message);
        res.status(500).json({ message: 'Failed to reactivate organisation' });
    }
};

// ─── GET /api/organisations/:id/stats (super-admin overview) ──────────────────
export const getOrganisationStats = async (req, res) => {
    try {
        const orgId = req.params.id;

        const [totalUsers, totalDoctors, totalPatients] = await Promise.all([
            User.countDocuments({ organisationId: orgId, deletedAt: null }).skipTenantFilter(),
            User.countDocuments({ organisationId: orgId, role: 'doctor', deletedAt: null }).skipTenantFilter(),
            User.countDocuments({ organisationId: orgId, role: 'patient', deletedAt: null }).skipTenantFilter(),
        ]);

        res.json({ orgId, totalUsers, totalDoctors, totalPatients });
    } catch (err) {
        console.error('[Org] getOrganisationStats:', err.message);
        res.status(500).json({ message: 'Failed to fetch stats' });
    }
};

// ─── GET /api/organisations/platform-stats (super-admin only) ────────────────
// PHASE-B FIX: totalOrganisations previously counted only { deletedAt: null }
// — but deleteOrganisation always sets deletedAt alongside isActive: false,
// so that filter silently excluded every suspended org from the total too.
// Since activeOrganisations was ALSO scoped to { deletedAt: null }, the two
// counts were almost always identical in practice, meaning
// suspendedOrDeletedOrganisations (computed as their difference) would show
// ~0 regardless of how many organisations were actually suspended — the
// same "deletedAt used as a combined delete+suspend flag, but read as if it
// only meant delete" mismatch that also affected getAllOrganisations (see
// that function's fix above). totalOrganisations now counts every
// organisation regardless of status; only activeOrganisations stays scoped
// to the accessible subset, so the subtraction is now meaningful.
export const getPlatformStats = async (req, res) => {
    try {
        const [totalOrganisations, activeOrganisations, totalUsers, totalDoctors, totalPatients] = await Promise.all([
            Organisation.countDocuments({}),
            Organisation.countDocuments({ deletedAt: null, isActive: true }),
            User.countDocuments({ deletedAt: null }).skipTenantFilter(),
            User.countDocuments({ deletedAt: null, role: 'doctor' }).skipTenantFilter(),
            User.countDocuments({ deletedAt: null, role: 'patient' }).skipTenantFilter(),
        ]);

        res.json({
            totalOrganisations,
            activeOrganisations,
            suspendedOrDeletedOrganisations: totalOrganisations - activeOrganisations,
            totalUsers,
            totalDoctors,
            totalPatients,
        });
    } catch (err) {
        console.error('[Org] getPlatformStats:', err.message);
        res.status(500).json({ message: 'Failed to fetch platform stats' });
    }
};
