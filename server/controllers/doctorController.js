import Doctor      from '../models/Doctor.js';
import Appointment from '../models/Appointment.js';
import audit       from '../utils/audit.js';

// GET /api/doctors
// L4 FIX: select only 'name' on public doctor list — email no longer exposed
const getDoctors = async (req, res) => {
    try {
        const doctors = await Doctor.find({ deletedAt: null })
            .populate({
                path:   'user',
                select: 'name',          // L4 FIX: removed 'email' from public list
                match:  {
                    $or: [
                        { deletedAt: null },
                        { deletedAt: { $exists: false } },
                    ],
                },
            })
            .lean();

        res.json(doctors.filter((d) => d.user));
    } catch (err) {
        console.error('[Doctor] getDoctors:', err.message);
        res.status(500).json({ message: 'Failed to fetch doctors' });
    }
};

// GET /api/doctors/:id
const getDoctorById = async (req, res) => {
    try {
        const doctor = await Doctor.findOne({ _id: req.params.id, deletedAt: null })
            .populate({
                path:   'user',
                select: 'name',
                match:  {
                    $or: [
                        { deletedAt: null },
                        { deletedAt: { $exists: false } },
                    ],
                },
            })
            .lean();

        if (!doctor || !doctor.user) {
            return res.status(404).json({ message: 'Doctor not found' });
        }
        res.json(doctor);
    } catch (err) {
        console.error('[Doctor] getDoctorById:', err.message);
        res.status(500).json({ message: 'Failed to fetch doctor' });
    }
};

// GET /api/doctors/:id/availability?date=YYYY-MM-DD
// BUG-7 FIX: use UTC throughout to prevent IST/UTC boundary bleed
const getDoctorAvailability = async (req, res) => {
    try {
        const { date } = req.query;

        const doctor = await Doctor.findOne({ _id: req.params.id, deletedAt: null }).lean();
        if (!doctor) return res.status(404).json({ message: 'Doctor not found' });

        // Parse as UTC midnight to get correct day-of-week on the server
        const requestedDate = new Date(`${date}T00:00:00Z`);
        const dayOfWeek     = requestedDate.toLocaleString('en-US', {
            weekday:  'long',
            timeZone: 'UTC',
        });

        const workHours = doctor.availability?.find(
            (a) => a.day.toLowerCase() === dayOfWeek.toLowerCase()
        );
        if (!workHours?.startTime || !workHours?.endTime) {
            return res.json([]);
        }

        const startOfDay = new Date(`${date}T00:00:00Z`);
        const endOfDay   = new Date(`${date}T23:59:59Z`);

        const existing = await Appointment.find({
            doctor:          doctor._id,
            appointmentDate: { $gte: startOfDay, $lte: endOfDay },
            status:          { $ne: 'Cancelled' },
        })
            .select('appointmentTime')
            .lean();

        const bookedSlots = new Set(existing.map((a) => a.appointmentTime));

        const slots = [];
        const [startH, startM] = workHours.startTime.split(':').map(Number);
        const [endH,   endM]   = workHours.endTime.split(':').map(Number);

        const cursor = new Date(requestedDate);
        cursor.setUTCHours(startH, startM, 0, 0);

        const limit = new Date(requestedDate);
        limit.setUTCHours(endH, endM, 0, 0);

        while (cursor < limit) {
            const label = cursor.toLocaleTimeString('en-US', {
                hour:     '2-digit',
                minute:   '2-digit',
                hour12:   true,
                timeZone: 'UTC',
            });
            if (!bookedSlots.has(label)) slots.push(label);
            cursor.setUTCMinutes(cursor.getUTCMinutes() + 30);
        }

        res.json(slots);
    } catch (err) {
        console.error('[Doctor] getDoctorAvailability:', err.message);
        res.status(500).json({ message: 'Failed to fetch availability' });
    }
};

// GET /api/doctors/my-appointments
const getMyAssignedAppointments = async (req, res) => {
    try {
        const doctorProfile = await Doctor.findOne({ user: req.user._id, deletedAt: null }).lean();
        if (!doctorProfile) {
            return res.status(404).json({ message: 'Doctor profile not found' });
        }

        const appointments = await Appointment.find({
            doctor: doctorProfile._id,
            status: { $ne: 'Cancelled' },
        })
            .populate({ path: 'patient', match: { deletedAt: null }, select: 'name email' })
            .sort({ appointmentDate: -1 })
            .lean();

        res.json(appointments.filter((a) => a.patient));
    } catch (err) {
        console.error('[Doctor] getMyAssignedAppointments:', err.message);
        res.status(500).json({ message: 'Failed to fetch appointments' });
    }
};

// GET /api/doctors/my-profile  ← M8 FIX: new endpoint
// Returns the Doctor document for the authenticated doctor user.
// Used by ScheduleManager so new doctors (with 0 appointments) can
// load and edit their schedule without guessing from appointment history.
const getMyProfile = async (req, res) => {
    try {
        const doctorProfile = await Doctor.findOne({ user: req.user._id, deletedAt: null })
            .populate('user', 'name email')
            .lean();

        if (!doctorProfile) {
            return res.status(404).json({ message: 'Doctor profile not found' });
        }

        res.json(doctorProfile);
    } catch (err) {
        console.error('[Doctor] getMyProfile:', err.message);
        res.status(500).json({ message: 'Failed to fetch doctor profile' });
    }
};

// GET /api/doctors/patient-history/:patientId
const getPatientHistory = async (req, res) => {
    try {
        const { patientId } = req.params;

        const doctorProfile = await Doctor.findOne({ user: req.user._id, deletedAt: null }).lean();
        if (!doctorProfile) {
            return res.status(404).json({ message: 'Doctor profile not found' });
        }

        const hasRelationship = await Appointment.exists({
            doctor:  doctorProfile._id,
            patient: patientId,
        });

        if (!hasRelationship) {
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

        const history = await Appointment.find({ patient: patientId, status: 'Completed' })
            .populate({ path: 'doctor', populate: { path: 'user', select: 'name' } })
            .sort({ appointmentDate: -1 })
            .lean();

        audit(req, 'DATA_READ', {
            actorId:      req.user._id,
            actorRole:    req.user.role,
            resourceType: 'PatientHistory',
            resourceId:   patientId,
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
        if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

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

        const doctorProfile = await Doctor.findOne({ user: req.user._id, deletedAt: null });
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
    getMyProfile,
    getPatientHistory,
    updateAppointment,
    updateMyAvailability,
};
