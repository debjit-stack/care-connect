import Appointment    from '../models/Appointment.js';
import PackageBooking from '../models/PackageBooking.js';
import HealthPackage  from '../models/HealthPackage.js';
import Doctor         from '../models/Doctor.js';
import User           from '../models/User.js';
import Notification   from '../models/Notification.js';
import audit          from '../utils/audit.js';
import { sendMail, templates } from '../utils/mailer.js';
import { validateBookingSlot } from '../utils/bookingValidation.js';

// ─── POST /api/patient/book-appointment ──────────────────────────────────────
const bookMyAppointment = async (req, res) => {
    try {
        const { doctorId, appointmentDate, appointmentTime, type } = req.body;

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

        // ── WS2: Notifications ────────────────────────────────────────────────
        // Fire-and-forget — never awaited so they cannot delay the HTTP response
        const org = req.org ?? null;

        // Fetch doctor name for notifications
        Doctor.findById(doctorId).populate('user', 'name').lean().then((doc) => {
            const doctorName = doc?.user?.name ?? 'your doctor';
            const dateStr    = new Date(`${appointmentDate}T00:00:00Z`)
                .toLocaleDateString('en-IN', { dateStyle: 'medium' });

            // In-app notification for patient
            Notification.create({
                user:    req.user._id,
                type:    'appointment_booked',
                title:   'Appointment Confirmed',
                message: `Your ${type} appointment with ${doctorName} on ${dateStr} at ${appointmentTime} is confirmed.`,
                link:    '/patient',
            }).catch((e) => console.error('[Notification] create failed:', e.message));

            // Email to patient
            sendMail({
                to:      req.user.email,
                org,
                ...templates.appointmentConfirmation({
                    patientName: req.user.name,
                    doctorName,
                    date:        dateStr,
                    time:        appointmentTime,
                    type,
                    org,
                }),
            });
        }).catch((e) => console.error('[WS2] bookMyAppointment post-create:', e.message));

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

        // ── WS2: Notifications ────────────────────────────────────────────────
        const org = req.org ?? null;

        Notification.create({
            user:    req.user._id,
            type:    'package_booked',
            title:   'Health Package Booked',
            message: `You have successfully booked the ${pkg.name} health package.`,
            link:    '/patient',
        }).catch((e) => console.error('[Notification] create failed:', e.message));

        sendMail({
            to:      req.user.email,
            org,
            subject: `Health Package Booked — ${pkg.name}`,
            html:    `<p>Dear ${req.user.name},</p><p>Your <strong>${pkg.name}</strong> health package has been booked successfully.</p>`,
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
