import Doctor from '../models/Doctor.js';
import User from '../models/User.js';
import Appointment from '../models/Appointment.js';

// --- Public Routes ---

// @desc    Get all doctors
// @route   GET /api/doctors
// @access  Public
const getDoctors = async (req, res) => {
    // 'specialty' lives on Doctor model, NOT on User — removed from populate
    const doctors = await Doctor.find({}).populate('user', 'name email');
    res.json(doctors);
};

// @desc    Get single doctor by ID
// @route   GET /api/doctors/:id
// @access  Public
const getDoctorById = async (req, res) => {
    const doctor = await Doctor.findById(req.params.id).populate('user', 'name email');
    if (doctor) {
        res.json(doctor);
    } else {
        res.status(404).json({ message: 'Doctor not found' });
    }
};

// @desc    Get a doctor's available slots for a specific date
// @route   GET /api/doctors/:id/availability?date=YYYY-MM-DD
// @access  Public
const getDoctorAvailability = async (req, res) => {
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ message: 'Date query parameter is required' });
    }

    try {
        const doctor = await Doctor.findById(req.params.id);
        if (!doctor) {
            return res.status(404).json({ message: 'Doctor not found' });
        }

        const requestedDate = new Date(date);
        const dayOfWeek = requestedDate.toLocaleString('en-US', { weekday: 'long' });

        const workHours = doctor.availability.find(
            (a) => a.day.toLowerCase() === dayOfWeek.toLowerCase()
        );
        if (!workHours || !workHours.startTime || !workHours.endTime) {
            return res.json([]);
        }

        const startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);

        const existingAppointments = await Appointment.find({
            doctor: doctor._id,
            appointmentDate: { $gte: startDate, $lte: endDate },
        });
        const bookedSlots = existingAppointments.map((app) => app.appointmentTime);

        const availableSlots = [];
        const slotDuration = 30;
        const [startHour, startMinute] = workHours.startTime.split(':').map(Number);
        const [endHour, endMinute] = workHours.endTime.split(':').map(Number);

        let currentTime = new Date(requestedDate);
        currentTime.setHours(startHour, startMinute, 0, 0);

        let endTime = new Date(requestedDate);
        endTime.setHours(endHour, endMinute, 0, 0);

        while (currentTime < endTime) {
            const timeString = currentTime.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
            });
            if (!bookedSlots.includes(timeString)) {
                availableSlots.push(timeString);
            }
            currentTime.setMinutes(currentTime.getMinutes() + slotDuration);
        }

        res.json(availableSlots);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// --- Protected Doctor-Only Routes ---

// @desc    Get appointments assigned to the logged-in doctor
// @route   GET /api/doctors/my-appointments
// @access  Private (Doctor)
const getMyAssignedAppointments = async (req, res) => {
    const doctorProfile = await Doctor.findOne({ user: req.user._id });
    if (!doctorProfile) {
        return res.status(404).json({ message: 'Doctor profile not found for this user.' });
    }
    const appointments = await Appointment.find({ doctor: doctorProfile._id })
        .populate('patient', 'name email')
        .sort({ appointmentDate: -1 });
    res.json(appointments);
};

// @desc    Get a patient's medical history
// @route   GET /api/doctors/patient-history/:patientId
// @access  Private (Doctor)
const getPatientHistory = async (req, res) => {
    const appointments = await Appointment.find({
        patient: req.params.patientId,
        status: 'Completed',
    })
        .populate({ path: 'doctor', populate: { path: 'user', select: 'name' } })
        .sort({ appointmentDate: -1 });
    res.json(appointments);
};

// @desc    Update an appointment
// @route   PUT /api/doctors/appointments/:appointmentId
// @access  Private (Doctor)
const updateAppointment = async (req, res) => {
    const { notes, prescription, status } = req.body;
    const appointment = await Appointment.findById(req.params.appointmentId);

    if (!appointment) {
        return res.status(404).json({ message: 'Appointment not found' });
    }

    const doctorProfile = await Doctor.findOne({ user: req.user._id });
    if (!doctorProfile || appointment.doctor.toString() !== doctorProfile._id.toString()) {
        return res.status(401).json({ message: 'Not authorized to update this appointment' });
    }

    appointment.notes = notes || appointment.notes;
    appointment.prescription = prescription || appointment.prescription;
    appointment.status = status || appointment.status;

    const updatedAppointment = await appointment.save();
    res.json(updatedAppointment);
};

// @desc    Update the logged-in doctor's own availability
// @route   PUT /api/doctors/my-availability
// @access  Private (Doctor)
const updateMyAvailability = async (req, res) => {
    const { availability } = req.body;
    const doctorProfile = await Doctor.findOne({ user: req.user._id });

    if (doctorProfile) {
        doctorProfile.availability = availability;
        const updatedProfile = await doctorProfile.save();
        res.json(updatedProfile);
    } else {
        res.status(404).json({ message: 'Doctor profile not found' });
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