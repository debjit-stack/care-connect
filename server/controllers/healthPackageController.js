import HealthPackage from '../models/HealthPackage.js';
import audit         from '../utils/audit.js';

// GET /api/packages
const getHealthPackages = async (req, res) => {
    try {
        const packages = await HealthPackage.find({ deletedAt: null }).lean();
        res.json(packages);
    } catch (err) {
        console.error('[Package] getHealthPackages:', err.message);
        res.status(500).json({ message: 'Failed to fetch packages' });
    }
};

// POST /api/packages
const createHealthPackage = async (req, res) => {
    try {
        const { name, price, details } = req.body;

        const pkg = await HealthPackage.create({ name, price, details });

        audit(req, 'DATA_CREATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'HealthPackage',
            resourceId:   pkg._id,
        });

        res.status(201).json(pkg);
    } catch (err) {
        console.error('[Package] createHealthPackage:', err.message);
        res.status(500).json({ message: 'Failed to create package' });
    }
};

// PUT /api/packages/:id
const updateHealthPackage = async (req, res) => {
    try {
        const { name, price, details } = req.body;

        const pkg = await HealthPackage.findById(req.params.id);
        if (!pkg) return res.status(404).json({ message: 'Package not found' });

        if (name    !== undefined) pkg.name    = name;
        if (price   !== undefined) pkg.price   = price;
        if (details !== undefined) pkg.details = details;

        const updated = await pkg.save();

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'HealthPackage',
            resourceId:   updated._id,
        });

        res.json(updated);
    } catch (err) {
        console.error('[Package] updateHealthPackage:', err.message);
        res.status(500).json({ message: 'Failed to update package' });
    }
};

// DELETE /api/packages/:id
const deleteHealthPackage = async (req, res) => {
    try {
        const pkg = await HealthPackage.findById(req.params.id);
        if (!pkg) return res.status(404).json({ message: 'Package not found' });

        await pkg.deleteOne();

        audit(req, 'DATA_DELETE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'HealthPackage',
            resourceId:   req.params.id,
        });

        res.json({ message: 'Package removed' });
    } catch (err) {
        console.error('[Package] deleteHealthPackage:', err.message);
        res.status(500).json({ message: 'Failed to delete package' });
    }
};

export { getHealthPackages, createHealthPackage, updateHealthPackage, deleteHealthPackage };
