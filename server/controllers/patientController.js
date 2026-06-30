import Appointment    from '../models/Appointment.js';
import PackageBooking from '../models/PackageBooking.js';
import HealthPackage  from '../models/HealthPackage.js';
import Doctor         from '../models/Doctor.js';
import User           from '../models/User.js';
import Notification   from '../models/Notification.js';
import audit           from '../utils/audit.js';
import { sendMail, templates } from '../utils/mailer.js';
import { validateBookingSlot } from '../utils/bookingValidation.js';

// 24-hour cancellation cutoff — patients cannot cancel within this window
const CANCELLATION_CUTOFF_HOURS = 24;

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

        // ── WS2: Notifications (unchanged) ────────────────────────────────────
        const org = req.org ?? null;

        Doctor.findById(doctorId).populate('user', 'name').lean().then((doc) => {
            const doctorName = doc?.user?.name ?? 'your doctor';
            const dateStr    = new Date(`${appointmentDate}T00:00:00Z`)
                .toLocaleDateString('en-IN', { dateStyle: 'medium' });

            Notification.create({
                user:    req.user._id,
                type:    'appointment_booked',
                title:   'Appointment Confirmed',
                message: `Your ${type} appointment with ${doctorName} on ${dateStr} at ${appointmentTime} is confirmed.`,
                link:    '/patient',
            }).catch((e) => console.error('[Notification] create failed:', e.message));

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

// ─── WS4: DELETE /api/patient/appointments/:id ───────────────────────────────
// Patient self-cancellation. Enforces a 24-hour cutoff — cannot cancel an
// appointment that starts within the next 24 hours. Only Scheduled appointments
// can be cancelled (cannot cancel a Completed or already-Cancelled one).
const cancelMyAppointment = async (req, res) => {
    try {
        const appointment = await Appointment.findOne({
            _id:     req.params.id,
            patient: req.user._id,   // can only cancel own appointments
        }).populate({ path: 'doctor', populate: { path: 'user', select: 'name' } });

        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found.' });
        }

        if (appointment.status === 'Cancelled') {
            return res.status(400).json({ message: 'This appointment is already cancelled.' });
        }

        if (appointment.status === 'Completed') {
            return res.status(400).json({ message: 'Completed appointments cannot be cancelled.' });
        }

        // ── 24-hour cutoff check ────────────────────────────────────────────────
        // Combine appointmentDate (UTC midnight) with the parsed appointmentTime
        // to get the exact appointment datetime, then compare against now + 24h.
        const toMinutes = (t) => {
            const match = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
            if (!match) return 0;
            let [, h, m, period] = match;
            h = parseInt(h, 10);
            m = parseInt(m, 10);
            if (period.toUpperCase() === 'PM' && h !== 12) h += 12;
            if (period.toUpperCase() === 'AM' && h === 12) h = 0;
            return h * 60 + m;
        };

        const appointmentDateTime = new Date(appointment.appointmentDate);
        const minutesFromMidnight = toMinutes(appointment.appointmentTime);
        appointmentDateTime.setUTCMinutes(appointmentDateTime.getUTCMinutes() + minutesFromMidnight);

        const cutoff = new Date(Date.now() + CANCELLATION_CUTOFF_HOURS * 60 * 60 * 1000);

        if (appointmentDateTime < cutoff) {
            return res.status(400).json({
                message: `Appointments can only be cancelled at least ${CANCELLATION_CUTOFF_HOURS} hours in advance. Please contact the hospital directly for urgent changes.`,
            });
        }

        appointment.status = 'Cancelled';
        appointment.notes  = appointment.notes
            ? `${appointment.notes}\n[Cancelled by patient]`
            : '[Cancelled by patient]';
        await appointment.save();

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Appointment',
            resourceId:   appointment._id,
            meta:         { action: 'patient_cancelled' },
        });

        // ── Notification + email on cancellation ────────────────────────────────
        const org        = req.org ?? null;
        const doctorName = appointment.doctor?.user?.name ?? 'your doctor';
        const dateStr    = new Date(appointment.appointmentDate)
            .toLocaleDateString('en-IN', { dateStyle: 'medium' });

        Notification.create({
            user:    req.user._id,
            type:    'appointment_cancelled',
            title:   'Appointment Cancelled',
            message: `Your appointment with ${doctorName} on ${dateStr} at ${appointment.appointmentTime} has been cancelled.`,
            link:    '/patient',
        }).catch((e) => console.error('[Notification] create failed:', e.message));

        sendMail({
            to:  req.user.email,
            org,
            ...templates.appointmentCancellation({
                patientName: req.user.name,
                doctorName,
                date:        dateStr,
                time:        appointment.appointmentTime,
                reason:      'Cancelled by patient',
                org,
            }),
        });

        res.json({ message: 'Appointment cancelled successfully.', appointment });
    } catch (err) {
        console.error('[Patient] cancelMyAppointment:', err.message);
        res.status(500).json({ message: 'Failed to cancel appointment. Please try again.' });
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

// ─── WS4: GET /api/patient/profile ───────────────────────────────────────────
const getMyProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('name email phone dateOfBirth bloodGroup allergies createdAt')
            .lean();

        if (!user) return res.status(404).json({ message: 'User not found' });

        res.json(user);
    } catch (err) {
        console.error('[Patient] getMyProfile:', err.message);
        res.status(500).json({ message: 'Failed to fetch profile' });
    }
};

// ─── WS4: PUT /api/patient/profile ───────────────────────────────────────────
const updateMyProfile = async (req, res) => {
    try {
        const { name, phone, dateOfBirth, bloodGroup, allergies } = req.body;

        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (name        !== undefined && name        !== '') user.name        = name;
        if (phone        !== undefined) user.phone       = phone        || null;
        if (dateOfBirth  !== undefined) user.dateOfBirth = dateOfBirth  ? new Date(`${dateOfBirth}T00:00:00Z`) : null;
        if (bloodGroup   !== undefined) user.bloodGroup  = bloodGroup   || null;
        if (allergies    !== undefined) user.allergies   = allergies   ?? '';

        const updated = await user.save();

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   updated._id,
            meta:         { action: 'profile_self_update', updatedFields: Object.keys(req.body) },
        });

        res.json({
            message: 'Profile updated successfully',
            user: {
                _id:         updated._id,
                name:        updated.name,
                email:       updated.email,
                phone:       updated.phone,
                dateOfBirth: updated.dateOfBirth,
                bloodGroup:  updated.bloodGroup,
                allergies:   updated.allergies,
            },
        });
    } catch (err) {
        console.error('[Patient] updateMyProfile:', err.message);
        res.status(500).json({ message: 'Failed to update profile' });
    }
};

export {
    bookMyAppointment,
    cancelMyAppointment,
    bookMyHealthPackage,
    getMyHistory,
    getMyProfile,
    updateMyProfile,
};
