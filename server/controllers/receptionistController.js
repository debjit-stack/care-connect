import User         from '../models/User.js';
import Appointment  from '../models/Appointment.js';
import PackageBooking from '../models/PackageBooking.js';
import audit        from '../utils/audit.js';

// ─── POST /api/receptionist/register-patient ─────────────────────────────────
const registerPatient = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const existingUser = await User.findOne({ email });

    if (existingUser && existingUser.deletedAt) {
        existingUser.name = name;
        existingUser.password = password;
        existingUser.role = 'patient';
        existingUser.deletedAt = undefined;

        await existingUser.save();

        return res.status(200).json({
            message: 'Patient restored successfully',
            patient: existingUser,
        });
    }

    if (existingUser) {
        return res.status(409).json({
            message: 'A patient with this email already exists',
        });
    }

        const patient = await User.create({ name, email, password, role: 'patient' });

        audit(req, 'DATA_CREATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   patient._id,
            meta:         { createdRole: 'patient' },
        });

        res.status(201).json({
            _id:   patient._id,
            name:  patient.name,
            email: patient.email,
        });
    } catch (err) {
        console.error('[Receptionist] registerPatient:', err.message);
        res.status(500).json({ message: 'Failed to register patient' });
    }
};

// ─── POST /api/receptionist/book-appointment ─────────────────────────────────
const bookOfflineAppointment = async (req, res) => {
    try {
        const { patientId, doctorId, appointmentDate, appointmentTime } = req.body;

        const patient = await User.findOne({ _id: patientId, role: 'patient', deletedAt: null }).lean();
        if (!patient) {
            return res.status(404).json({ message: 'Patient not found' });
        }

        const appointment = await Appointment.create({
            doctor:          doctorId,
            patient:         patientId,
            appointmentDate: new Date(appointmentDate),
            appointmentTime,
            type:            'Offline',
            status:          'Scheduled',
        });

        audit(req, 'DATA_CREATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Appointment',
            resourceId:   appointment._id,
            meta:         { bookedFor: patientId, type: 'Offline' },
        });

        res.status(201).json(appointment);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({
                message: 'This slot was just booked. Please choose another time.',
            });
        }
        console.error('[Receptionist] bookOfflineAppointment:', err.message);
        res.status(500).json({ message: 'Failed to book appointment' });
    }
};

// ─── GET /api/receptionist/search-patients?q= ────────────────────────────────
// The query string `q` arrives here already regex-escaped by the Zod validator.
// We use it directly — no additional escaping needed.
const searchPatients = async (req, res) => {
    try {
        const { q } = req.query; // pre-sanitised by receptionistValidators.js

        const patients = await User.find({
            role:      'patient',
            deletedAt: null,
            $or: [
                { name:  { $regex: q, $options: 'i' } },
                { email: { $regex: q, $options: 'i' } },
            ],
        })
            .select('_id name email')
            .limit(10)
            .lean();

        res.json(patients);
    } catch (err) {
        console.error('[Receptionist] searchPatients:', err.message);
        res.status(500).json({ message: 'Search failed' });
    }
};

// ─── GET /api/receptionist/appointments?date= ────────────────────────────────
const getAppointmentsByDate = async (req, res) => {
    try {
        const { date } = req.query;

        const startOfDay = new Date(date);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setUTCHours(23, 59, 59, 999);

        const appointments = await Appointment.find({
            appointmentDate: { $gte: startOfDay, $lte: endOfDay },
            status: { $ne: 'Cancelled' }
        })
            .populate('patient', 'name')
            .populate({
                path:     'doctor',
                populate: { path: 'user', select: 'name' },
                select:   'specialty',
            })
            .sort({ appointmentTime: 1 })
            .lean();
            const activeAppointments = appointments.filter(
            appointment =>
                appointment.patient &&
                appointment.doctor &&
                appointment.doctor.user
        );

        res.json(activeAppointments);
    } catch (err) {
        console.error('[Receptionist] getAppointmentsByDate:', err.message);
        res.status(500).json({ message: 'Failed to fetch appointments' });
    }
};

// ─── POST /api/receptionist/book-package ─────────────────────────────────────
const bookHealthPackageForPatient = async (req, res) => {
    try {
        const { patientId, packageId } = req.body;

        const patient = await User.findOne({ _id: patientId, role: 'patient', deletedAt: null }).lean();
        if (!patient) {
            return res.status(404).json({ message: 'Patient not found' });
        }

        const booking = await PackageBooking.create({
            patient:       patientId,
            healthPackage: packageId,
            bookedBy:      req.user._id,
        });

        audit(req, 'DATA_CREATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'PackageBooking',
            resourceId:   booking._id,
            meta:         { bookedFor: patientId },
        });

        res.status(201).json(booking);
    } catch (err) {
        console.error('[Receptionist] bookHealthPackageForPatient:', err.message);
        res.status(500).json({ message: 'Failed to book package' });
    }
};

export {
    registerPatient,
    bookOfflineAppointment,
    searchPatients,
    getAppointmentsByDate,
    bookHealthPackageForPatient,
};
