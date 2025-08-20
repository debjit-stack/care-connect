import User from '../models/User.js';
import Doctor from '../models/Doctor.js';

// --- User Management ---

// @desc    Get all users (can filter by role)
// @route   GET /api/admin/users
// @access  Private (Admin)
const getUsers = async (req, res) => {
    const { role } = req.query;
    const filter = role ? { role } : {};
    const users = await User.find(filter).select('-password');
    res.json(users);
};

// @desc    Get user by ID
// @route   GET /api/admin/users/:id
// @access  Private (Admin)
const getUserById = async (req, res) => {
    const user = await User.findById(req.params.id).select('-password');
    if (user) {
        res.json(user);
    } else {
        res.status(404).json({ message: 'User not found' });
    }
};

// @desc    Update user
// @route   PUT /api/admin/users/:id
// @access  Private (Admin)
const updateUser = async (req, res) => {
    const user = await User.findById(req.params.id);

    if (user) {
        user.name = req.body.name || user.name;
        user.email = req.body.email || user.email;
        user.role = req.body.role || user.role;
        // You might not want to allow password changes here for security reasons
        // but if you do, you'd handle it here.

        const updatedUser = await user.save();
        res.json({
            _id: updatedUser._id,
            name: updatedUser.name,
            email: updatedUser.email,
            role: updatedUser.role,
        });
    } else {
        res.status(404).json({ message: 'User not found' });
    }
};

// @desc    Delete user
// @route   DELETE /api/admin/users/:id
// @access  Private (Admin)
const deleteUser = async (req, res) => {
    const user = await User.findById(req.params.id);

    if (user) {
        // If the user is a doctor, also delete their doctor profile
        if (user.role === 'doctor') {
            await Doctor.deleteOne({ user: user._id });
        }
        await user.deleteOne();
        res.json({ message: 'User removed' });
    } else {
        res.status(404).json({ message: 'User not found' });
    }
};


// --- Doctor Profile Management ---

// @desc    Create a new doctor profile
// @route   POST /api/admin/doctors
// @access  Private (Admin)
const createDoctor = async (req, res) => {
    const { name, email, password, specialty, qualifications, experienceYears } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
        res.status(400).json({ message: 'A user with this email already exists' });
        return;
    }

    const user = await User.create({ name, email, password, role: 'doctor' });
    if (!user) {
        res.status(400).json({ message: 'Failed to create user for the doctor' });
        return;
    }

    const doctor = await Doctor.create({ user: user._id, specialty, qualifications, experienceYears });
    if (doctor) {
        res.status(201).json({ message: 'Doctor created successfully', user, doctor });
    } else {
        await User.findByIdAndDelete(user._id);
        res.status(400).json({ message: 'Failed to create doctor profile' });
    }
};

// @desc    Update a doctor's profile details
// @route   PUT /api/admin/doctors/:id
// @access  Private (Admin)
const updateDoctorProfile = async (req, res) => {
    const doctor = await Doctor.findById(req.params.id);

    if (doctor) {
        doctor.specialty = req.body.specialty || doctor.specialty;
        doctor.qualifications = req.body.qualifications || doctor.qualifications;
        doctor.experienceYears = req.body.experienceYears || doctor.experienceYears;
        doctor.availability = req.body.availability || doctor.availability;

        const updatedDoctor = await doctor.save();
        res.json(updatedDoctor);
    } else {
        res.status(404).json({ message: 'Doctor profile not found' });
    }
};

// @desc    Create a staff user (receptionist or admin)
// @route   POST /api/admin/staff
// @access  Private (Admin)
const createStaff = async (req, res) => {
    const { name, email, password, role } = req.body;

    // Ensure only valid staff roles can be created through this endpoint
    if (!['receptionist', 'admin'].includes(role)) {
        res.status(400).json({ message: 'Invalid role specified. Can only create receptionist or admin.' });
        return;
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
        res.status(400).json({ message: 'A user with this email already exists' });
        return;
    }

    const user = await User.create({
        name,
        email,
        password,
        role,
    });

    if (user) {
        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
        });
    } else {
        res.status(400).json({ message: 'Invalid user data' });
    }
};

const resetPassword = async (req, res) => {
    const { newPassword } = req.body;
    const user = await User.findById(req.params.id);

    if (user) {
        // The 'save' pre-hook in the User model will automatically hash the password
        user.password = newPassword;
        await user.save();
        res.json({ message: 'Password updated successfully' });
    } else {
        res.status(404).json({ message: 'User not found' });
    }
};



export {
    getUsers,
    getUserById,
    updateUser,
    deleteUser,
    createDoctor,
    updateDoctorProfile,
    createStaff,
    resetPassword
};