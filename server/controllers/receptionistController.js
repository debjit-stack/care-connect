import User           from '../models/User.js';
import Appointment    from '../models/Appointment.js';
import PackageBooking from '../models/PackageBooking.js';
import HealthPackage  from '../models/HealthPackage.js';
import Doctor         from '../models/Doctor.js';
import Membership     from '../models/Membership.js';
import Notification   from '../models/Notification.js';
import audit          from '../utils/audit.js';
import { sendMail, templates } from '../utils/mailer.js';
import { validateBookingSlot } from '../utils/bookingValidation.js';

// ─── POST /api/receptionist/register-patient ─────────────────────────────────
// PHASE M5 FIX: this is a full redesign, not an incremental patch — it
// implements the architecture doc's scenario 4 ("patient visits Hospital A,
// later wants to register at Hospital B") as a first-class, safe operation.
//
// The core behavioural shift: a patient is now looked up GLOBALLY by email
// (one identity, full stop — see architecture doc §2/§3), not scoped to
// req.orgId. What differs per-organisation is only whether a Membership
// exists for THIS org, not whether a separate User document exists.
//
// Three possible outcomes:
//
//   (a) No User exists anywhere for this email
//       → create a brand-new User (this org's receptionist becomes the
//         first point of contact for this identity) + an active Membership
//         for this org.
//
//   (b) A User already exists, but has NO Membership at this org yet
//       → this is the actual "same person, new hospital" case. The
//         EXISTING identity (password, MFA enrollment, everything) is
//         reused as-is. A NEW Membership is created for this org. The
//         User document itself — name, password — is NEVER modified here.
//         This is a deliberate security boundary: if this org's
//         receptionist's submitted password/name were allowed to
//         overwrite an existing identity's real credentials, any
//         receptionist could hijack any patient's account by "registering"
//         them at their own hospital with a guessed/known email. The
//         person keeps signing in with the password they already have.
//
//   (c) A User already exists AND already has a Membership at this org
//       → depends on that Membership's role/status:
//         - active, role 'patient'   → 409, already registered here.
//         - active, role != 'patient' → 409, this identity already has a
//           different role at this specific organisation; a role change
//           within one org is a distinct, deliberate operation and is not
//           performed silently by patient registration.
//         - removed, role 'patient'  → reactivate this Membership
//           (status → active). Matches the pre-Membership "restore" case,
//           now scoped correctly to ONE org's relationship rather than
//           the whole identity.
//         - removed, role != 'patient' → 409, same reasoning as the active
//           different-role case — this is the exact scenario the
//           role-continuity gate was built to catch, now expressed at the
//           Membership level (where it belongs) instead of the User level.
//
// NOTE (scope): this fixes the STAFF-ASSISTED registration path only.
// Patient SELF-registration (requestRegistrationOtp/verifyRegistrationOtp
// in authController.js) still performs an org-scoped existence check and
// will create a second, disconnected User for the same email at a
// different org — it has not yet been migrated to this identity-reuse
// model. Flagged as a required M5 follow-up, not silently left as if it
// were already handled.
const registerPatient = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Global identity lookup — no organisationId in this query at all.
        const matches = await User.find({ email }).skipTenantFilter();

        if (matches.length > 1) {
            // Defensive: should not occur (Phase M1's audit found zero
            // cross-org duplicate emails in production at the time this
            // was written), but a generic algorithm must not silently
            // guess which of several same-email identities is "the" one.
            console.error(`[Receptionist] registerPatient: multiple global User documents share email ${email} — manual resolution required.`, matches.map((m) => m._id));
            return res.status(409).json({
                message: 'Multiple accounts exist for this email. Please contact support to resolve this before registering.',
            });
        }

        const existingUser = matches[0] ?? null;

        // ── Outcome (a): brand-new identity ─────────────────────────────────
        if (!existingUser) {
            const patient = await User.create({ name, email, password, role: 'patient' });

            await Membership.create({
                userId:         patient._id,
                organisationId: req.orgId,
                role:           'patient',
                status:         'active',
                joinedAt:       new Date(),
                invitedBy:      req.user._id,
            });

            audit(req, 'DATA_CREATE', {
                actorId:      req.user._id,
                actorRole:    req.user.role,
                resourceType: 'User',
                resourceId:   patient._id,
                meta:         { createdRole: 'patient', orgId: req.orgId },
            });

            return res.status(201).json({ _id: patient._id, name: patient.name, email: patient.email });
        }

        // Existing identity found — check this org's Membership.
        const membership = await Membership.findOne({
            userId:         existingUser._id,
            organisationId: req.orgId,
        });

        // ── Outcome (b): existing identity, new to THIS org ─────────────────
        if (!membership) {
            await Membership.create({
                userId:         existingUser._id,
                organisationId: req.orgId,
                role:           'patient',
                status:         'active',
                joinedAt:       new Date(),
                invitedBy:      req.user._id,
            });

            audit(req, 'DATA_CREATE', {
                actorId:      req.user._id,
                actorRole:    req.user.role,
                resourceType: 'Membership',
                resourceId:   existingUser._id,
                meta:         { event: 'existing_identity_added_to_org', role: 'patient', orgId: req.orgId },
            });

            return res.status(201).json({
                message: 'This person already has an account and has been added as a patient at your organisation.',
                _id:     existingUser._id,
                name:    existingUser.name,
                email:   existingUser.email,
            });
        }

        // ── Outcome (c): existing Membership at this org ─────────────────────
        if (membership.status === 'active') {
            return res.status(409).json({
                message: membership.role === 'patient'
                    ? 'A patient with this email already exists at this organisation.'
                    : 'This email belongs to an account with a different active role at this organisation. Restore or convert it through account management instead of patient registration.',
            });
        }

        // membership.status === 'removed' from here down.
        if (membership.role !== 'patient') {
            return res.status(409).json({
                message: 'This email belongs to a deleted account with a different role at this organisation. ' +
                          'Restore or convert it through account management instead of patient registration.',
            });
        }

        membership.status    = 'active';
        membership.removedAt = null;
        await membership.save();

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Membership',
            resourceId:   existingUser._id,
            meta:         { action: 'restore', role: 'patient', orgId: req.orgId },
        });

        return res.status(200).json({
            message: 'Patient restored successfully',
            patient: { _id: existingUser._id, name: existingUser.name, email: existingUser.email },
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
