import User from '../models/User.js';
import Doctor from '../models/Doctor.js';

// --- User Management ---

const getUsers = async (req, res) => {
    const { role } = req.query;
    const filter = role ? { role } : {};
    const users = await User.find(filter).select('-password');
    res.json(users);
};

const getUserById = async (req, res) => {
    const user = await User.findById(req.params.id).select('-password');
    if (user) {
        res.json(user);
    } else {
        res.status(404).json({ message: 'User not found' });
    }
};

const updateUser = async (req, res) => {
    const user = await User.findById(req.params.id);
    if (user) {
        user.name = req.body.name || user.name;
        user.email = req.body.email || user.email;
        user.role = req.body.role || user.role;
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

const deleteUser = async (req, res) => {
    const user = await User.findById(req.params.id);
    if (user) {
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

const createDoctor = async (req, res) => {
    const { name, email, password, specialty, qualifications, experienceYears } = req.body;
    const userExists = await User.findOne({ email });
    if (userExists) {
        return res.status(400).json({ message: 'A user with this email already exists' });
    }
    const user = await User.create({ name, email, password, role: 'doctor' });
    if (!user) {
        return res.status(400).json({ message: 'Failed to create user for the doctor' });
    }
    const doctor = await Doctor.create({ user: user._id, specialty, qualifications, experienceYears });
    if (doctor) {
        res.status(201).json({ message: 'Doctor created successfully', user, doctor });
    } else {
        await User.findByIdAndDelete(user._id);
        res.status(400).json({ message: 'Failed to create doctor profile' });
    }
};

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

const createStaff = async (req, res) => {
    const { name, email, password, role } = req.body;
    if (!['receptionist', 'admin'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role specified.' });
    }
    const userExists = await User.findOne({ email });
    if (userExists) {
        return res.status(400).json({ message: 'A user with this email already exists' });
    }
    const user = await User.create({ name, email, password, role });
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
        user.password = newPassword;
        await user.save();
        res.json({ message: 'Password updated successfully' });
    } else {
        res.status(404).json({ message: 'User not found' });
    }
};

// NEW: Returns full Doctor documents (with user populated) so frontend
// can get the real Doctor._id for availability updates
const getDoctorsWithProfiles = async (req, res) => {
    try {
        const doctors = await Doctor.find({}).populate('user', 'name email');
        res.json(doctors);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
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
    resetPassword,
    getDoctorsWithProfiles,
};