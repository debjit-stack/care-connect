import Doctor      from '../models/Doctor.js';
import Appointment from '../models/Appointment.js';
import audit       from '../utils/audit.js';

// ─── Public ───────────────────────────────────────────────────────────────────

// GET /api/doctors
const getDoctors = async (req, res) => {
    try {
        const doctors = await Doctor.find()
            .populate({
                path: 'user',
                select: 'name email',
                match: {
                    $or: [
                        { deletedAt: null },
                        { deletedAt: { $exists: false } }
                    ]
                }
            })
            .lean();

        const activeDoctors = doctors.filter(
            (doctor) => doctor.user
        );

        res.json(activeDoctors);
    } catch (err) {
        console.error('[Doctor] getDoctors:', err.message);
        res.status(500).json({
            message: 'Failed to fetch doctors'
        });
    }
};

// GET /api/doctors/:id
const getDoctorById = async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.params.id)
            .populate({
                path: 'user',
                select: 'name email',
                match: {
                    $or: [
                        { deletedAt: null },
                        { deletedAt: { $exists: false } }
                    ]
                }
            })
            .lean();

        if (!doctor) return res.status(404).json({ message: 'Doctor not found' });
        res.json(doctor);
    } catch (err) {
        console.error('[Doctor] getDoctorById:', err.message);
        res.status(500).json({ message: 'Failed to fetch doctor' });
    }
};

// GET /api/doctors/:id/availability?date=YYYY-MM-DD
const getDoctorAvailability = async (req, res) => {
    try {
        const { date } = req.query; // already validated as YYYY-MM-DD by Zod

        const doctor = await Doctor.findById(req.params.id).lean();
        if (!doctor) return res.status(404).json({ message: 'Doctor not found' });

        // Determine the day of week for the requested date
        const requestedDate = new Date(date);
        const dayOfWeek     = requestedDate.toLocaleString('en-US', { weekday: 'long' });

        const workHours = doctor.availability?.find(
            (a) => a.day.toLowerCase() === dayOfWeek.toLowerCase()
        );

        if (!workHours?.startTime || !workHours?.endTime) {
            return res.json([]);
        }

        // Fetch booked slots for this doctor on this date
        const startOfDay = new Date(date);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setUTCHours(23, 59, 59, 999);

        const existing = await Appointment.find({
            doctor:          doctor._id,
            appointmentDate: { $gte: startOfDay, $lte: endOfDay },
            status:          { $ne: 'Cancelled' },
        })
            .select('appointmentTime')
            .lean();

        const bookedSlots = new Set(existing.map((a) => a.appointmentTime));

        // Generate 30-minute slots within working hours
        const slots = [];
        const [startH, startM] = workHours.startTime.split(':').map(Number);
        const [endH,   endM]   = workHours.endTime.split(':').map(Number);

        const cursor = new Date(requestedDate);
        cursor.setHours(startH, startM, 0, 0);

        const limit = new Date(requestedDate);
        limit.setHours(endH, endM, 0, 0);

        while (cursor < limit) {
            const label = cursor.toLocaleTimeString('en-US', {
                hour:   '2-digit',
                minute: '2-digit',
                hour12: true,
            });
            if (!bookedSlots.has(label)) slots.push(label);
            cursor.setMinutes(cursor.getMinutes() + 30);
        }

        res.json(slots);
    } catch (err) {
        console.error('[Doctor] getDoctorAvailability:', err.message);
        res.status(500).json({ message: 'Failed to fetch availability' });
    }
};

// ─── Protected — Doctor only ──────────────────────────────────────────────────

// GET /api/doctors/my-appointments
const getMyAssignedAppointments = async (req, res) => {
    try {
        const doctorProfile = await Doctor.findOne({ user: req.user._id }).lean();
        if (!doctorProfile) {
            return res.status(404).json({ message: 'Doctor profile not found' });
        }

        const appointments = await Appointment.find({
                doctor: doctorProfile._id,
                status: { $ne: 'Cancelled' }
            })
            .populate({
                path: 'patient',
                match: {
                    deletedAt: null
                },
                select: 'name email'
            })
            .sort({ appointmentDate: -1 })
            .lean();

            const activeAppointments = appointments.filter(
                appointment => appointment.patient
            );

            return res.json(activeAppointments);
    } catch (err) {
        console.error('[Doctor] getMyAssignedAppointments:', err.message);
        res.status(500).json({ message: 'Failed to fetch appointments' });
    }
};

// GET /api/doctors/patient-history/:patientId
// ─── OBJECT-LEVEL AUTH FIX ───────────────────────────────────────────────────
// Previously: any authenticated doctor could fetch any patient's full history.
// Fixed:      the requesting doctor must have at least one existing appointment
//             with this patient before accessing their records.
const getPatientHistory = async (req, res) => {
    try {
        const { patientId } = req.params;

        // Resolve the Doctor document for the requesting user
        const doctorProfile = await Doctor.findOne({ user: req.user._id }).lean();
        if (!doctorProfile) {
            return res.status(404).json({ message: 'Doctor profile not found' });
        }

        // ── Authorization check ───────────────────────────────────────────────
        // Verify there is at least one appointment linking THIS doctor to THIS patient.
        const hasRelationship = await Appointment.exists({
            doctor:  doctorProfile._id,
            patient: patientId,
        });

        if (!hasRelationship) {
            // Return 403 (not 404) so the doctor knows access was denied, not missing
            audit(req, 'DATA_READ', {
                actorId:      req.user._id,
                actorRole:    req.user.role,
                resourceType: 'PatientHistory',
                resourceId:   patientId,
                success:      false,
                meta:         { reason: 'no_existing_relationship' },
            });
            return res.status(403).json({
                message: 'Access denied. You can only view history for your own patients.',
            });
        }

        // ── Fetch history ─────────────────────────────────────────────────────
        const history = await Appointment.find({
            patient: patientId,
            status:  'Completed',
        })
            .populate({ path: 'doctor', populate: { path: 'user', select: 'name' } })
            .sort({ appointmentDate: -1 })
            .lean();

        audit(req, 'DATA_READ', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'PatientHistory',
            resourceId:   patientId,
            success:      true,
        });

        res.json(history);
    } catch (err) {
        console.error('[Doctor] getPatientHistory:', err.message);
        res.status(500).json({ message: 'Failed to fetch patient history' });
    }
};

// PUT /api/doctors/appointments/:appointmentId
const updateAppointment = async (req, res) => {
    try {
        const { notes, prescription, status } = req.body;

        const appointment = await Appointment.findById(req.params.appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found' });
        }

        // Verify this appointment belongs to the requesting doctor
        const doctorProfile = await Doctor.findOne({ user: req.user._id }).lean();
        if (
            !doctorProfile ||
            appointment.doctor.toString() !== doctorProfile._id.toString()
        ) {
            return res.status(403).json({ message: 'Not authorised to update this appointment' });
        }

        if (notes        !== undefined) appointment.notes        = notes;
        if (prescription !== undefined) appointment.prescription = prescription;
        if (status       !== undefined) appointment.status       = status;

        const updated = await appointment.save();

        audit(req, 'DATA_UPDATE', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'Appointment',
            resourceId:   updated._id,
        });

        res.json(updated);
    } catch (err) {
        console.error('[Doctor] updateAppointment:', err.message);
        res.status(500).json({ message: 'Failed to update appointment' });
    }
};

// PUT /api/doctors/my-availability
const updateMyAvailability = async (req, res) => {
    try {
        const { availability } = req.body;

        const doctorProfile = await Doctor.findOne({ user: req.user._id });
        if (!doctorProfile) {
            return res.status(404).json({ message: 'Doctor profile not found' });
        }

        doctorProfile.availability = availability;
        const updated = await doctorProfile.save();

        res.json(updated);
    } catch (err) {
        console.error('[Doctor] updateMyAvailability:', err.message);
        res.status(500).json({ message: 'Failed to update availability' });
    }
};

export {
    getDoctors,
    getDoctorById,
    getDoctorAvailability,
    getMyAssignedAppointments,
    getPatientHistory,
    updateAppointment,
    updateMyAvailability,
};
