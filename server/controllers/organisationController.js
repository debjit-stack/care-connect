import mongoose      from 'mongoose';
import Organisation from '../models/Organisation.js';
import User         from '../models/User.js';
import audit        from '../utils/audit.js';
import { revokeAllRefreshTokens } from '../utils/tokens.js';

// ─── GET /api/organisations (super-admin only) ────────────────────────────────
export const getAllOrganisations = async (req, res) => {
    try {
        const orgs = await Organisation.find({ deletedAt: null })
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
// the request body (see organisationValidators.js's adminUserSchema).
//
// Before this fix, hospital onboarding was a two-step, non-atomic process:
// super_admin creates the org here, then separately has to create a staff
// user for it via a different endpoint/flow scoped to that org. If anything
// went wrong between those two steps (or nobody remembered to do the
// second step at all), the result was an organisation that exists but that
// literally nobody can log into — recoverable only via direct database
// intervention, since there is no "invite the first admin" flow and
// self-registration only ever creates patients (see authController.js).
//
// Both documents are created in a single MongoDB transaction: either both
// succeed, or neither is persisted. The admin user's organisationId is set
// EXPLICITLY to the newly created org's _id (not left to tenantPlugin's
// ambient-context pre-save hook — there is no ambient tenant context for
// this request, by design; see tenantMiddleware.js's TENANT_OPTIONAL_PREFIXES
// for /api/organisations). No email-uniqueness precheck is needed for the
// admin user beyond ordinary schema validation: since the organisation is
// brand new, no (email, organisationId) collision is possible for it.
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

        // Duplicate slug can also surface here under a race between the
        // precheck above and a concurrent request — same defensive pattern
        // used in adminController.updateUser for the analogous email race.
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
        // PHASE3-3C FOLLOW-UP FIX (part 2): must explicitly load
        // settings.smtp.pass here despite its select:false default.
        // Without this, the deep-merge below would build its base object
        // from an smtp sub-object that never had `pass` loaded in the first
        // place (not merely blank — genuinely absent from the fetched
        // document), so reassigning org.settings.smtp and saving would
        // erase the stored password on ANY smtp update that doesn't resend
        // it — exactly the bug this fix set out to prevent, just one layer
        // deeper. `pass` is stripped back out of the response before
        // res.json() below so this internal load never actually exposes the
        // credential back over the API.
        const org = await Organisation
            .findOne({ _id: req.params.id, deletedAt: null })
            .select('+settings.smtp.pass');
        if (!org) return res.status(404).json({ message: 'Organisation not found' });

        // Org-admin can only update their own org, and cannot change plan or features
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

        // PHASE3-3C FOLLOW-UP FIX: `settings.smtp` is the one nested object
        // under `settings` (see models/Organisation.js). A plain shallow
        // merge here — `{ ...org.settings, ...settings }` — only merges
        // TOP-LEVEL keys of `settings`; if the incoming `settings` payload
        // includes a partial `smtp` object (e.g. just `{ host: '...' }` to
        // update one field), the shallow merge REPLACES the entire existing
        // `smtp` sub-object wholesale, silently discarding any previously
        // saved `user`/`pass`/`from` that weren't resent. This merges
        // `smtp` one level deeper than the rest of `settings`, so a partial
        // `smtp` update only overwrites the keys actually provided. All
        // other `settings` fields keep the existing flat shallow-merge
        // behavior (unchanged, and correct for them, since none of them
        // are nested objects).
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

        // Only super-admin can toggle feature flags
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

        // PHASE3-3C FOLLOW-UP FIX (part 2, continued): `updated` was loaded
        // with settings.smtp.pass explicitly selected (see the fetch above)
        // so the deep-merge could preserve it correctly on save. It must
        // NOT be echoed back in the API response — same credential-hygiene
        // intent as the model's select:false default, just enforced by hand
        // here since this one code path deliberately overrides that default
        // for internal merge correctness. toObject() + delete avoids
        // mutating the in-memory Mongoose document itself.
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

// ─── DELETE /api/organisations/:id (super-admin only — soft delete) ───────────
// PHASE4 FIX: suspension side-effect — deactivating an organisation now also
// revokes every active refresh-token session for every user belonging to
// it. Before this fix, soft-deleting/deactivating an org (isActive: false,
// deletedAt set) had no effect on already-issued sessions: any staff member
// or patient of that org with a still-valid access/refresh token pair could
// keep using the app completely normally until their access token's normal
// 15-minute expiry, and — worse — could keep silently refreshing past that
// point too, since refreshAccessToken (authController.js) never checks
// whether the user's organisation is still accessible, only whether the
// user document itself exists and isn't individually deleted. A suspended
// hospital's staff/patients effectively retained full access for as long as
// they kept their tab open and refreshing.
//
// Uses .skipTenantFilter() + an explicit organisationId filter (consistent
// with the Phase 3B pattern) since this route has no ambient tenant context
// at all — see tenantMiddleware.js's TENANT_OPTIONAL_PREFIXES.
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
// PHASE4 addition: a basic platform-wide rollup, distinct from
// getOrganisationStats above (which is scoped to one org). Kept
// deliberately simple — total/active org counts plus global user-role
// counts — as a starting point rather than a full analytics surface.
export const getPlatformStats = async (req, res) => {
    try {
        const [totalOrganisations, activeOrganisations, totalUsers, totalDoctors, totalPatients] = await Promise.all([
            Organisation.countDocuments({ deletedAt: null }),
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
