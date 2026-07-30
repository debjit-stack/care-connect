import mongoose      from 'mongoose';
import Organisation from '../models/Organisation.js';
import User         from '../models/User.js';
import Membership   from '../models/Membership.js';
import audit        from '../utils/audit.js';
import { revokeAllRefreshTokens } from '../utils/tokens.js';

// ─── GET /api/organisations/slug-availability/:slug (super-admin only) ───────
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

            // PHASE M6/M7 FOLLOW-UP FIX: this atomic onboarding path
            // creates a User directly (bypassing createStaff/registerPatient's
            // global-identity logic, correctly so — a brand-new organisation's
            // first admin should always be a fresh identity, never a reuse
            // decision). It was previously missing the corresponding
            // Membership document entirely, which every OTHER user-creation
            // path in the app has created since Phase M3's dual-write. That
            // gap would have made this admin invisible to every
            // Membership-based read (getUsers, getDashboardStats,
            // getPlatformStats, etc.) despite existing and being able to
            // log in.
            await Membership.create([{
                userId:         createdAdmin._id,
                organisationId: org._id,
                role:           'admin',
                status:         'active',
                joinedAt:       new Date(),
                invitedBy:      req.user._id,
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

        // PHASE M6/M7 FOLLOW-UP FIX: was resolving affected users via
        // User.find({ organisationId: org._id }) — the legacy, single-value
        // field. For a multi-org identity whose active relationship with
        // THIS org is real but whose stale User.organisationId points
        // elsewhere, that query would miss them entirely, leaving their
        // session for the now-suspended org still valid. Resolved via
        // Membership instead — the authoritative source for "who currently
        // has a relationship with this org."
        const affectedMemberships = await Membership
            .find({ organisationId: org._id, status: 'active' })
            .select('userId')
            .lean();

        await Promise.all(affectedMemberships.map((m) => revokeAllRefreshTokens(m.userId)));

        audit(req, 'DATA_DELETE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Organisation',
            resourceId:   org._id,
            meta:         { revokedSessionsForUserCount: affectedMemberships.length },
        });

        res.json({ message: 'Organisation deactivated successfully', revokedSessionsFor: affectedMemberships.length });
    } catch (err) {
        console.error('[Org] deleteOrganisation:', err.message);
        res.status(500).json({ message: 'Failed to delete organisation' });
    }
};

// ─── PATCH /api/organisations/:id/reactivate (super-admin only) ──────────────
export const reactivateOrganisation = async (req, res) => {
    try {
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
// PHASE M6/M7 FOLLOW-UP FIX: previously counted directly against User,
// filtered by { organisationId, role } — the same legacy single-value
// fields responsible for every other instance of this bug fixed in this
// investigation (doctor visibility, dashboard KPIs, admin user list). An
// identity whose active relationship with THIS org is real, but whose
// stale User.organisationId points elsewhere (added to this org via the
// M5/M6 identity-reuse flow), was silently excluded from every count here.
// Now counts Membership directly — the authoritative source since Phase M3.
export const getOrganisationStats = async (req, res) => {
    try {
        const orgId = req.params.id;

        const [totalUsers, totalDoctors, totalPatients] = await Promise.all([
            Membership.countDocuments({ organisationId: orgId, status: 'active' }),
            Membership.countDocuments({ organisationId: orgId, role: 'doctor',  status: 'active' }),
            Membership.countDocuments({ organisationId: orgId, role: 'patient', status: 'active' }),
        ]);

        res.json({ orgId, totalUsers, totalDoctors, totalPatients });
    } catch (err) {
        console.error('[Org] getOrganisationStats:', err.message);
        res.status(500).json({ message: 'Failed to fetch stats' });
    }
};

// ─── GET /api/organisations/platform-stats (super-admin only) ────────────────
// PHASE M6/M7 FOLLOW-UP FIX: same root cause as getOrganisationStats above,
// at platform scope. totalDoctors/totalPatients previously counted
// User.countDocuments({ role: 'doctor'/'patient' }) — a person's GLOBAL
// User.role field only ever reflects whichever role they had when their
// identity was first created. Someone created as a doctor at Hospital A
// who is ALSO an active patient at Hospital B (or vice versa) was
// permanently invisible to whichever count didn't match their original
// role, platform-wide, regardless of how many real, active relationships
// they actually have.
//
// Fixed by counting DISTINCT identities with at least one active
// Membership of that role (Membership.distinct('userId', ...)), rather
// than counting User documents by their single legacy role field. Note
// this deliberately counts PEOPLE, not memberships — a doctor active at
// three hospitals still counts once in totalDoctors, which is the
// meaningful platform-level metric (distinguishing "how many doctor
// relationships exist" from "how many distinct people are doctors
// somewhere" is a product decision; this implements the latter as the more
// intuitive one for a platform-wide KPI card).
export const getPlatformStats = async (req, res) => {
    try {
        const [
            totalOrganisations,
            activeOrganisations,
            totalUsers,
            doctorUserIds,
            patientUserIds,
        ] = await Promise.all([
            Organisation.countDocuments({}),
            Organisation.countDocuments({ deletedAt: null, isActive: true }),
            User.countDocuments({ deletedAt: null }).skipTenantFilter(),
            Membership.distinct('userId', { role: 'doctor',  status: 'active' }),
            Membership.distinct('userId', { role: 'patient', status: 'active' }),
        ]);

        res.json({
            totalOrganisations,
            activeOrganisations,
            suspendedOrDeletedOrganisations: totalOrganisations - activeOrganisations,
            totalUsers,
            totalDoctors:  doctorUserIds.length,
            totalPatients: patientUserIds.length,
        });
    } catch (err) {
        console.error('[Org] getPlatformStats:', err.message);
        res.status(500).json({ message: 'Failed to fetch platform stats' });
    }
};
