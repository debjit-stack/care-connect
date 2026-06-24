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
        const org = await Organisation.findOne({ _id: req.params.id, deletedAt: null });
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
        if (settings     !== undefined) org.settings     = { ...org.settings, ...settings };

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

        res.json(updated);
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
