import Appointment    from '../models/Appointment.js';
import PackageBooking from '../models/PackageBooking.js';
import Doctor         from '../models/Doctor.js';
import audit          from '../utils/audit.js';

// ─── POST /api/patient/book-appointment ──────────────────────────────────────
// ─── RACE CONDITION FIX ───────────────────────────────────────────────────────
// The old implementation: findOne (check slot free) → save (create appointment).
// Two concurrent requests could both pass the findOne check and both save,
// creating a double-booking.
//
// Fix: use a unique compound index on (doctor + appointmentDate + appointmentTime)
// so MongoDB itself rejects the second insert with a duplicate key error (E11000).
// We catch that specific error and return a 409 instead of a 500.
const bookMyAppointment = async (req, res) => {
    try {
        const { doctorId, appointmentDate, appointmentTime, type } = req.body;

        // Verify the doctor exists
        const doctor = await Doctor.findById(doctorId).lean();
        if (!doctor) {
            return res.status(404).json({ message: 'Doctor not found' });
        }

        const appointment = await Appointment.create({
            doctor:          doctorId,
            patient:         req.user._id,
            appointmentDate: new Date(appointmentDate),
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
        // MongoDB duplicate key — slot was taken between validation and insert
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
