import User   from '../models/User.js';
import Doctor from '../models/Doctor.js';
import Appointment from '../models/Appointment.js';
import audit  from '../utils/audit.js';

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
const getUsers = async (req, res) => {
    try {
        const { role } = req.query;
        const filter = { deletedAt: null };
        if (role) filter.role = role;

        const users = await User.find(filter).select('-password').lean();
        res.json(users);
    } catch (err) {
        console.error('[Admin] getUsers:', err.message);
        res.status(500).json({ message: 'Failed to fetch users' });
    }
};

// ─── GET /api/admin/users/:id ─────────────────────────────────────────────────
const getUserById = async (req, res) => {
    try {
        const user = await User.findOne({ _id: req.params.id, deletedAt: null })
            .select('-password')
            .lean();

        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user);
    } catch (err) {
        console.error('[Admin] getUserById:', err.message);
        res.status(500).json({ message: 'Failed to fetch user' });
    }
};

// ─── PUT /api/admin/users/:id ─────────────────────────────────────────────────
const updateUser = async (req, res) => {
    try {
        const { name, email } = req.body;

        const user = await User.findOne({ _id: req.params.id, deletedAt: null });
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (name)  user.name  = name;
        if (email) user.email = email;

        const updated = await user.save();

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   updated._id,
            meta:         { updatedFields: Object.keys(req.body) },
        });

        res.json({ _id: updated._id, name: updated.name, email: updated.email, role: updated.role });
    } catch (err) {
        console.error('[Admin] updateUser:', err.message);
        res.status(500).json({ message: 'Failed to update user' });
    }
};

// ─── DELETE /api/admin/users/:id  (soft delete) ───────────────────────────────
const deleteUser = async (req, res) => {
    try {
        if (req.params.id === req.user._id.toString()) {
            return res.status(400).json({
                message: 'You cannot delete your own account'
            });
        }

        const user = await User.findOne({
            _id: req.params.id,
            deletedAt: null
        });

        if (!user) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        // If deleting a patient, cancel all scheduled appointments
        
        if (user.role === 'patient') {
            console.log('Cancelling appointments for patient:', user._id);
            const result = await Appointment.updateMany(
            {
                patient: user._id,
                status: 'Scheduled'
            },
            {
                $set: {
                    status: 'Cancelled',
                    notes: 'Cancelled automatically because patient account was deleted'
                }
            }
);

console.log(result);
        }

        // If deleting a doctor, cancel all scheduled appointments
        if (user.role === 'doctor') {
            const doctorProfile = await Doctor.findOne({
                user: user._id
            });

            if (doctorProfile) {
                await Appointment.updateMany(
                    {
                        doctor: doctorProfile._id,
                        status: 'Scheduled'
                    },
                    {
                        $set: {
                            status: 'Cancelled',
                            notes: 'Cancelled automatically because doctor account was deleted'
                        }
                    }
                );
            }
        }

        user.deletedAt = new Date();
        await user.save();

        audit(req, 'DATA_DELETE', {
            actorId: req.user._id,
            actorRole: req.user.role,
            resourceType: 'User',
            resourceId: user._id,
        });

        res.json({
            message: 'User deactivated successfully'
        });

    } catch (err) {
        console.error('[Admin] deleteUser:', err.message);
        res.status(500).json({
            message: 'Failed to delete user'
        });
    }
};

// ─── POST /api/admin/doctors ──────────────────────────────────────────────────
const createDoctor = async (req, res) => {
    try {
        const { name, email, password, specialty, qualifications, experienceYears } = req.body;

        const exists = await User.findOne({ email, deletedAt: null }).lean();
        if (exists) {
            return res.status(409).json({ message: 'A user with this email already exists' });
        }

        const user = await User.create({ name, email, password, role: 'doctor' });

        const doctor = await Doctor.create({
            user:            user._id,
            specialty,
            qualifications,
            experienceYears,
        });

        audit(req, 'DATA_CREATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Doctor',
            resourceId:   doctor._id,
        });

        res.status(201).json({ message: 'Doctor created successfully', userId: user._id, doctorId: doctor._id });
    } catch (err) {
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
        });

        res.json(updated);
    } catch (err) {
        console.error('[Admin] updateDoctorProfile:', err.message);
        res.status(500).json({ message: 'Failed to update doctor profile' });
    }
};

// ─── POST /api/admin/staff ────────────────────────────────────────────────────
const createStaff = async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        const existingUser = await User.findOne({ email });

        // restore soft-deleted user
        if (existingUser && existingUser.deletedAt) {
            existingUser.name = name;
            existingUser.password = password;
            existingUser.role = role;
            existingUser.deletedAt = undefined;

            await existingUser.save();

            return res.status(200).json({
                message: 'Staff restored successfully',
                user: existingUser,
            });
        }

        // active user already exists
        if (existingUser) {
            return res.status(409).json({
                message: 'A user with this email already exists',
            });
        }

        const user = await User.create({
            name,
            email,
            password,
            role,
        });

        res.status(201).json(user);

    } catch (err) {
        console.error('[Admin] createStaff:', err);

        res.status(500).json({
            message: err.message,
        });
    }
};

// ─── PUT /api/admin/users/:id/reset-password ─────────────────────────────────
const resetPassword = async (req, res) => {
    try {
        const { newPassword } = req.body;

        const user = await User.findOne({ _id: req.params.id, deletedAt: null });
        if (!user) return res.status(404).json({ message: 'User not found' });

        user.password = newPassword; // pre-save hook hashes it + sets passwordChangedAt
        await user.save();

        audit(req, 'AUTH_PASSWORD_CHANGED', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   user._id,
            meta:         { resetBy: 'admin' },
        });

        res.json({ message: 'Password reset successfully' });
    } catch (err) {
        console.error('[Admin] resetPassword:', err.message);
        res.status(500).json({ message: 'Failed to reset password' });
    }
};

// ─── GET /api/admin/doctors-full ─────────────────────────────────────────────
const getDoctorsWithProfiles = async (req, res) => {
    try {
        const doctors = await Doctor.find({})
            .populate('user', 'name email')
            .lean();
        res.json(doctors);
    } catch (err) {
        console.error('[Admin] getDoctorsWithProfiles:', err.message);
        res.status(500).json({ message: 'Failed to fetch doctor profiles' });
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
