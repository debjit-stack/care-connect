import mongoose      from 'mongoose';
import User          from '../models/User.js';
import Doctor        from '../models/Doctor.js';
import Appointment   from '../models/Appointment.js';
import HealthPackage from '../models/HealthPackage.js';
import Notification  from '../models/Notification.js';
import audit         from '../utils/audit.js';
import { revokeAllRefreshTokens } from '../utils/tokens.js';
import { sendMail, templates }    from '../utils/mailer.js';

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
            .select('-password').lean();
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user);
    } catch (err) {
        console.error('[Admin] getUserById:', err.message);
        res.status(500).json({ message: 'Failed to fetch user' });
    }
};

// ─── PUT /api/admin/users/:id ─────────────────────────────────────────────────
// M4 FIX: previously relied entirely on the DB's unique (email, organisationId)
// index to reject a duplicate email, which surfaces as a raw Mongo duplicate-key
// error caught by the generic try/catch and returned as an unhelpful 500
// "Failed to update user". This mirrors the same explicit-uniqueness-check
// pattern already used in registerUser/createStaff, so users now get a clean
// 409 with a clear message instead of a mysterious server error.
const updateUser = async (req, res) => {
    try {
        const { name, email } = req.body;
        const user = await User.findOne({ _id: req.params.id, deletedAt: null });
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (email && email.toLowerCase() !== user.email) {
            const existsFilter = user.organisationId
                ? { email: email.toLowerCase(), organisationId: user.organisationId, deletedAt: null, _id: { $ne: user._id } }
                : { email: email.toLowerCase(), deletedAt: null, _id: { $ne: user._id } };

            const duplicate = await User.findOne(existsFilter).skipTenantFilter();
            if (duplicate) {
                return res.status(409).json({ message: 'Another account with this email already exists' });
            }
        }

        if (name)  user.name  = name;
        if (email) user.email = email;

        let updated;
        try {
            updated = await user.save();
        } catch (saveErr) {
            // Defensive fallback: a race between the precheck above and the
            // save (two concurrent requests) can still hit the unique index.
            if (saveErr.code === 11000) {
                return res.status(409).json({ message: 'Another account with this email already exists' });
            }
            throw saveErr;
        }

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   updated._id,
            meta:         { updatedFields: Object.keys(req.body), orgId: req.orgId },
        });

        res.json({ _id: updated._id, name: updated.name, email: updated.email, role: updated.role });
    } catch (err) {
        console.error('[Admin] updateUser:', err.message);
        res.status(500).json({ message: 'Failed to update user' });
    }
};

// ─── DELETE /api/admin/users/:id  (soft delete) ───────────────────────────────
const deleteUser = async (req, res) => {
    if (req.params.id === req.user._id.toString()) {
        return res.status(400).json({ message: 'You cannot delete your own account' });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const user = await User.findOne({ _id: req.params.id, deletedAt: null }).session(session);
        if (!user) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.role === 'patient') {
            await Appointment.updateMany(
                { patient: user._id, status: 'Scheduled' },
                { $set: { status: 'Cancelled', notes: 'Cancelled: patient account deleted' } },
                { session }
            );
        }

        if (user.role === 'doctor') {
            const doctorProfile = await Doctor.findOne({ user: user._id }).session(session);
            if (doctorProfile) {
                await Appointment.updateMany(
                    { doctor: doctorProfile._id, status: 'Scheduled' },
                    { $set: { status: 'Cancelled', notes: 'Cancelled: doctor account deleted' } },
                    { session }
                );
                doctorProfile.deletedAt = new Date();
                await doctorProfile.save({ session });
            }
        }

        user.deletedAt = new Date();
        await user.save({ session });

        await session.commitTransaction();
        session.endSession();

        await revokeAllRefreshTokens(user._id);

        audit(req, 'DATA_DELETE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   user._id,
            meta:         { orgId: req.orgId },
        });

        res.json({ message: 'User deactivated successfully' });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error('[Admin] deleteUser:', err.message);
        res.status(500).json({ message: 'Failed to delete user' });
    }
};

// ─── POST /api/admin/doctors ──────────────────────────────────────────────────
const createDoctor = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { name, email, password, specialty, qualifications, experienceYears } = req.body;

        // PHASE5-L2 FIX: scoped to the current org, same reasoning as
        // createStaff/registerPatient below — a global (no organisationId)
        // existence check here would both incorrectly block a legitimate
        // same-email-different-org doctor creation, and (though this
        // function has no soft-delete-restore branch, so no cross-tenant
        // restore risk specifically) would report a false 409 for an email
        // that has no actual conflict within this organisation.
        const exists = await User.findOne({ email, organisationId: req.orgId }).skipTenantFilter();
        if (exists) {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({ message: 'A user with this email already exists' });
        }

        const [user]   = await User.create([{ name, email, password, role: 'doctor' }], { session });
        const [doctor] = await Doctor.create(
            [{ user: user._id, specialty, qualifications, experienceYears }],
            { session }
        );

        await session.commitTransaction();
        session.endSession();

        audit(req, 'DATA_CREATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Doctor',
            resourceId:   doctor._id,
            meta:         { orgId: req.orgId },
        });

        res.status(201).json({ message: 'Doctor created successfully', userId: user._id, doctorId: doctor._id });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
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
            meta:         { orgId: req.orgId },
        });

        res.json(updated);
    } catch (err) {
        console.error('[Admin] updateDoctorProfile:', err.message);
        res.status(500).json({ message: 'Failed to update doctor profile' });
    }
};

// ─── POST /api/admin/staff ────────────────────────────────────────────────────
// PHASE5-L2 FIX: the existence/restore check below previously ran
// `User.findOne({ email }).skipTenantFilter()` — fully global, with no
// organisationId in the filter. Same two bugs as registerPatient
// (receptionistController.js) had: (1) a soft-deleted staff member with
// this email in a DIFFERENT org could be matched and restored here,
// reactivating another org's user record and changing its role, entirely
// invisible to that org; (2) a legitimate same-email-different-org staff
// creation would incorrectly 409 even though the current org has no actual
// conflict. Scoping the filter to `organisationId: req.orgId` (kept
// explicit alongside .skipTenantFilter()) closes both.
const createStaff = async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        const existingUser = await User
            .findOne({ email, organisationId: req.orgId })
            .skipTenantFilter();

        if (existingUser && existingUser.deletedAt) {
            const roleChanged      = existingUser.role !== role;
            existingUser.name      = name;
            existingUser.password  = password;
            existingUser.role      = role;
            existingUser.deletedAt = undefined;
            await existingUser.save();

            audit(req, 'DATA_UPDATE', {
                actorId:      req.user._id,
                actorRole:    req.user.role,
                resourceType: 'User',
                resourceId:   existingUser._id,
                meta:         { action: 'restore', roleChanged, newRole: role, orgId: req.orgId },
            });

            return res.status(200).json({
                message: roleChanged ? `Staff restored with role changed to ${role}` : 'Staff restored successfully',
                user:    { _id: existingUser._id, name: existingUser.name, email: existingUser.email, role: existingUser.role },
            });
        }

        if (existingUser) {
            return res.status(409).json({ message: 'A user with this email already exists' });
        }

        const user = await User.create({ name, email, password, role });

        audit(req, 'DATA_CREATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   user._id,
            meta:         { createdRole: role, orgId: req.orgId },
        });

        res.status(201).json({ _id: user._id, name: user.name, email: user.email, role: user.role });
    } catch (err) {
        console.error('[Admin] createStaff:', err.message);
        res.status(500).json({ message: 'Failed to create staff member' });
    }
};

// ─── PUT /api/admin/users/:id/reset-password ─────────────────────────────────
const resetPassword = async (req, res) => {
    try {
        const { newPassword } = req.body;
        const user = await User.findOne({ _id: req.params.id, deletedAt: null });
        if (!user) return res.status(404).json({ message: 'User not found' });

        user.password = newPassword;
        await user.save();

        await revokeAllRefreshTokens(user._id);

        audit(req, 'AUTH_PASSWORD_CHANGED', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   user._id,
            meta:         { resetBy: 'admin', orgId: req.orgId },
        });

        // ── WS2: Notify the affected user ─────────────────────────────────────
        const org = req.org ?? null;

        Notification.create({
            user:    user._id,
            type:    'password_reset',
            title:   'Password Reset',
            message: 'Your account password has been reset by an administrator. Please log in with your new password.',
            link:    '/login',
        }).catch((e) => console.error('[Notification] create failed:', e.message));

        sendMail({
            to:  user.email,
            org,
            ...templates.passwordResetByAdmin({ userName: user.name, org }),
        });

        res.json({ message: 'Password reset successfully. User must log in again.' });
    } catch (err) {
        console.error('[Admin] resetPassword:', err.message);
        res.status(500).json({ message: 'Failed to reset password' });
    }
};

// ─── GET /api/admin/doctors-full ─────────────────────────────────────────────
const getDoctorsWithProfiles = async (req, res) => {
    try {
        const doctors = await Doctor.find({ deletedAt: null })
            .populate('user', 'name email')
            .lean();
        res.json(doctors);
    } catch (err) {
        console.error('[Admin] getDoctorsWithProfiles:', err.message);
        res.status(500).json({ message: 'Failed to fetch doctor profiles' });
    }
};

export {
    getUsers, getUserById, updateUser, deleteUser,
    createDoctor, updateDoctorProfile, createStaff,
    resetPassword, getDoctorsWithProfiles,
};
