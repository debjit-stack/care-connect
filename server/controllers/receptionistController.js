import User           from '../models/User.js';
import Appointment    from '../models/Appointment.js';
import PackageBooking from '../models/PackageBooking.js';
import HealthPackage  from '../models/HealthPackage.js';
import Doctor         from '../models/Doctor.js';
import Notification   from '../models/Notification.js';
import audit          from '../utils/audit.js';
import { sendMail, templates } from '../utils/mailer.js';
import { validateBookingSlot } from '../utils/bookingValidation.js';

// ─── POST /api/receptionist/register-patient ─────────────────────────────────
// PHASE5-L2 FIX: the existence/restore check below previously ran
// `User.findOne({ email }).skipTenantFilter()` — fully global, with NO
// organisationId in the filter at all. This caused two distinct bugs:
//
//   1. Cross-tenant restore: if a patient with this email was soft-deleted
//      in a DIFFERENT organisation, this lookup would match that deleted
//      record and the code below would restore it — reactivating another
//      org's patient data, invisible to that org, triggered by an
//      unrelated org's receptionist action. organisationId was never
//      touched by the restore branch, compounding the confusion.
//   2. False conflict: the compound (email, organisationId) unique index
//      on User exists specifically so the same email CAN belong to
//      different orgs' patients. This global check returned 409 "already
//      exists" whenever ANY org had that email active, even when the
//      CURRENT org had no conflict — actively blocking a legitimate,
//      by-design multi-tenant scenario.
//
// Scoping the filter to `organisationId: req.orgId` (kept explicit
// alongside .skipTenantFilter(), same pattern as the Phase 3B fixes) closes
// both: restore now only ever matches a deleted record within the SAME
// org, and the same email in a different org no longer false-conflicts.
const registerPatient = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const existingUser = await User
            .findOne({ email, organisationId: req.orgId })
            .skipTenantFilter();

        if (existingUser && existingUser.deletedAt) {
            existingUser.name      = name;
            existingUser.password  = password;
            existingUser.role      = 'patient';
            existingUser.deletedAt = undefined;
            await existingUser.save();

            return res.status(200).json({
                message: 'Patient restored successfully',
                patient: { _id: existingUser._id, name: existingUser.name, email: existingUser.email },
            });
        }

        if (existingUser) {
            return res.status(409).json({ message: 'A patient with this email already exists' });
        }

        const patient = await User.create({ name, email, password, role: 'patient' });

        audit(req, 'DATA_CREATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'User',
            resourceId:   patient._id,
            meta:         { createdRole: 'patient', orgId: req.orgId },
        });

        res.status(201).json({ _id: patient._id, name: patient.name, email: patient.email });
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
        if (!patient) return res.status(404).json({ message: 'Patient not found' });

        const validation = await validateBookingSlot(doctorId, appointmentDate, appointmentTime);
        if (!validation.valid) {
            return res.status(validation.status).json({ message: validation.message });
        }

        const appointment = await Appointment.create({
            doctor:          doctorId,
            patient:         patientId,
            appointmentDate: new Date(`${appointmentDate}T00:00:00Z`),
            appointmentTime,
            type:            'Offline',
            status:          'Scheduled',
        });

        audit(req, 'DATA_CREATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Appointment',
            resourceId:   appointment._id,
            meta:         { bookedFor: patientId, type: 'Offline', orgId: req.orgId },
        });

        // ── WS2: Notifications ────────────────────────────────────────────────
        const org = req.org ?? null;

        Doctor.findById(doctorId).populate('user', 'name').lean().then((doc) => {
            const doctorName = doc?.user?.name ?? 'your doctor';
            const dateStr    = new Date(`${appointmentDate}T00:00:00Z`)
                .toLocaleDateString('en-IN', { dateStyle: 'medium' });

            Notification.create({
                user:    patientId,
                type:    'appointment_booked',
                title:   'Appointment Booked',
                message: `Your offline appointment with ${doctorName} on ${dateStr} at ${appointmentTime} has been booked.`,
                link:    '/patient',
            }).catch((e) => console.error('[Notification] create failed:', e.message));

            sendMail({
                to:  patient.email,
                org,
                ...templates.appointmentConfirmation({
                    patientName: patient.name,
                    doctorName,
                    date:        dateStr,
                    time:        appointmentTime,
                    type:        'Offline',
                    org,
                }),
            });
        }).catch((e) => console.error('[WS2] bookOfflineAppointment post-create:', e.message));

        res.status(201).json(appointment);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ message: 'This slot was just booked. Please choose another time.' });
        }
        console.error('[Receptionist] bookOfflineAppointment:', err.message);
        res.status(500).json({ message: 'Failed to book appointment' });
    }
};

// ─── GET /api/receptionist/search-patients?q= ────────────────────────────────
// PHASE3-3B FIX: previously relied SOLELY on tenantPlugin's implicit
// query-hook filtering to keep this search scoped to the receptionist's own
// organisation — no explicit organisationId anywhere in the query. That
// implicit filtering is real and (post-Phase-1) trustworthy for the request
// lifecycle that reaches this controller today, so this was not a live
// exploitable gap — but a search endpoint returning names/emails is exactly
// the kind of place where "trust the ambient context and nothing else" is
// worth hardening rather than just leaving as the only line of defense.
// Now explicit and self-contained: .skipTenantFilter() plus an explicit
// `organisationId: req.orgId` clause in the query itself. If req.orgId is
// somehow unset when this runs (it always should be — receptionistRoutes
// requires protect + isReceptionistOrAdmin, both of which run after
// resolveTenant has already succeeded or the request never reaches here),
// this fails CLOSED (returns an empty result) rather than falling through
// to an unscoped, cross-tenant search.
const searchPatients = async (req, res) => {
    try {
        const { q } = req.query;

        if (!req.orgId) {
            console.error('[Receptionist] searchPatients: req.orgId unexpectedly unset — refusing unscoped search.');
            return res.json([]);
        }

        const patients = await User.find({
            role:           'patient',
            deletedAt:      null,
            organisationId: req.orgId,
            $or: [
                { name:  { $regex: q, $options: 'i' } },
                { email: { $regex: q, $options: 'i' } },
            ],
        })
            .skipTenantFilter()
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

        const startOfDay = new Date(`${date}T00:00:00Z`);
        const endOfDay   = new Date(`${date}T23:59:59Z`);

        const appointments = await Appointment.find({
            appointmentDate: { $gte: startOfDay, $lte: endOfDay },
            status:          { $ne: 'Cancelled' },
        })
            .populate('patient', 'name')
            .populate({
                path:     'doctor',
                populate: { path: 'user', select: 'name' },
                select:   'specialty',
            })
            .sort({ appointmentTime: 1 })
            .lean();

        res.json(appointments.filter((a) => a.patient && a.doctor && a.doctor.user));
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
        if (!patient) return res.status(404).json({ message: 'Patient not found' });

        const pkg = await HealthPackage.findOne({ _id: packageId, deletedAt: null }).lean();
        if (!pkg) return res.status(404).json({ message: 'Health package not found or no longer available.' });

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
            meta:         { bookedFor: patientId, orgId: req.orgId },
        });

        // ── WS2: Notifications ────────────────────────────────────────────────
        const org = req.org ?? null;

        Notification.create({
            user:    patientId,
            type:    'package_booked',
            title:   'Health Package Booked',
            message: `The ${pkg.name} health package has been booked for you.`,
            link:    '/patient',
        }).catch((e) => console.error('[Notification] create failed:', e.message));

        sendMail({
            to:      patient.email,
            org,
            subject: `Health Package Booked — ${pkg.name}`,
            html:    `<p>Dear ${patient.name},</p><p>Your <strong>${pkg.name}</strong> health package has been booked successfully.</p>`,
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
