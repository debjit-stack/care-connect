import HealthPackage from '../models/HealthPackage.js';

// @desc    Get all health packages
// @route   GET /api/packages
// @access  Public
const getHealthPackages = async (req, res) => {
    const packages = await HealthPackage.find({});
    res.json(packages);
};

// @desc    Create a health package
// @route   POST /api/packages
// @access  Private (Admin)
const createHealthPackage = async (req, res) => {
    const { name, price, details } = req.body;
    const healthPackage = new HealthPackage({
        name,
        price,
        details,
    });
    const createdPackage = await healthPackage.save();
    res.status(201).json(createdPackage);
};

// @desc    Update a health package
// @route   PUT /api/packages/:id
// @access  Private (Admin)
const updateHealthPackage = async (req, res) => {
    const { name, price, details } = req.body;
    const healthPackage = await HealthPackage.findById(req.params.id);

    if (healthPackage) {
        healthPackage.name = name || healthPackage.name;
        healthPackage.price = price || healthPackage.price;
        healthPackage.details = details || healthPackage.details;

        const updatedPackage = await healthPackage.save();
        res.json(updatedPackage);
    } else {
        res.status(404).json({ message: 'Health package not found' });
    }
};

// @desc    Delete a health package
// @route   DELETE /api/packages/:id
// @access  Private (Admin)
const deleteHealthPackage = async (req, res) => {
    const healthPackage = await HealthPackage.findById(req.params.id);

    if (healthPackage) {
        await healthPackage.deleteOne();
        res.json({ message: 'Health package removed' });
    } else {
        res.status(404).json({ message: 'Health package not found' });
    }
};


export {
    getHealthPackages,
    createHealthPackage,
    updateHealthPackage,
    deleteHealthPackage
};
