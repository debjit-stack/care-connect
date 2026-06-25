import Appointment    from '../models/Appointment.js';
import PackageBooking from '../models/PackageBooking.js';
import HealthPackage  from '../models/HealthPackage.js';
import audit          from '../utils/audit.js';
import { validateBookingSlot } from '../utils/bookingValidation.js';

// ─── POST /api/patient/book-appointment ──────────────────────────────────────
const bookMyAppointment = async (req, res) => {
    try {
        const { doctorId, appointmentDate, appointmentTime, type } = req.body;

        // C3 + C4 FIX: full server-side validation
        const validation = await validateBookingSlot(doctorId, appointmentDate, appointmentTime);
        if (!validation.valid) {
            return res.status(validation.status).json({ message: validation.message });
        }

        const appointment = await Appointment.create({
            doctor:          doctorId,
            patient:         req.user._id,
            appointmentDate: new Date(`${appointmentDate}T00:00:00Z`),
            appointmentTime,
            type,
        });

        audit(req, 'DATA_CREATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Appointment',
            resourceId:   appointment._id,
        });

        res.status(201).json(appointment);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({
                message: 'This slot was just booked by someone else. Please choose another time.',
            });
        }
        console.error('[Patient] bookMyAppointment:', err.message);
        res.status(500).json({ message: 'Failed to book appointment. Please try again.' });
    }
};

// ─── POST /api/patient/book-package ──────────────────────────────────────────
const bookMyHealthPackage = async (req, res) => {
    try {
        const { packageId } = req.body;

        // C6 FIX: verify package exists and is not soft-deleted
        const pkg = await HealthPackage.findOne({ _id: packageId, deletedAt: null }).lean();
        if (!pkg) {
            return res.status(404).json({ message: 'Health package not found or no longer available.' });
        }

        const booking = await PackageBooking.create({
            healthPackage: packageId,
            patient:       req.user._id,
            bookedBy:      req.user._id,
        });

        audit(req, 'DATA_CREATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'PackageBooking',
            resourceId:   booking._id,
        });

        res.status(201).json(booking);
    } catch (err) {
        console.error('[Patient] bookMyHealthPackage:', err.message);
        res.status(500).json({ message: 'Failed to book package. Please try again.' });
    }
};

// ─── GET /api/patient/my-history ─────────────────────────────────────────────
const getMyHistory = async (req, res) => {
    try {
        const [appointments, packageBookings] = await Promise.all([
            Appointment.find({ patient: req.user._id })
                .populate({
                    path:     'doctor',
                    populate: { path: 'user', select: 'name' },
                })
                .sort({ appointmentDate: -1 })
                .lean(),

            PackageBooking.find({ patient: req.user._id })
                .populate('healthPackage', 'name price')
                .sort({ createdAt: -1 })
                .lean(),
        ]);

        audit(req, 'DATA_READ', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'PatientHistory',
            resourceId:   req.user._id,
        });

        res.json({ appointments, packageBookings });
    } catch (err) {
        console.error('[Patient] getMyHistory:', err.message);
        res.status(500).json({ message: 'Failed to fetch history' });
    }
};

export { bookMyAppointment, bookMyHealthPackage, getMyHistory };
