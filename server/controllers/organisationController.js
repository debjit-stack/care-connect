import Organisation from '../models/Organisation.js';
import User         from '../models/User.js';
import audit        from '../utils/audit.js';

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
export const createOrganisation = async (req, res) => {
    try {
        const { name, slug, contactEmail, contactPhone, address, plan, settings } = req.body;

        const slugExists = await Organisation.findOne({ slug, deletedAt: null });
        if (slugExists) {
            return res.status(409).json({ message: `Slug "${slug}" is already taken` });
        }

        const org = await Organisation.create({
            name, slug, contactEmail, contactPhone, address,
            plan:      plan ?? 'trial',
            settings:  settings ?? {},
            createdBy: req.user._id,
        });

        audit(req, 'DATA_CREATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Organisation',
            resourceId:   org._id,
        });

        res.status(201).json(org);
    } catch (err) {
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
        // saved `user`/`pass`/`from` that weren't resent. Since `smtp.pass`
        // is `select: false` on the model, a client fetching current
        // settings to build an update payload will never even see the
        // existing password to include it — making accidental credential
        // loss on any partial SMTP update the default outcome, not an edge
        // case. This merges `smtp` one level deeper than the rest of
        // `settings`, so a partial `smtp` update only overwrites the keys
        // actually provided. All other `settings` fields keep the existing
        // flat shallow-merge behavior (unchanged, and correct for them,
        // since none of them are nested objects).
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
export const deleteOrganisation = async (req, res) => {
    try {
        const org = await Organisation.findOne({ _id: req.params.id, deletedAt: null });
        if (!org) return res.status(404).json({ message: 'Organisation not found' });

        org.deletedAt  = new Date();
        org.isActive   = false;
        await org.save();

        audit(req, 'DATA_DELETE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Organisation',
            resourceId:   org._id,
        });

        res.json({ message: 'Organisation deactivated successfully' });
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
