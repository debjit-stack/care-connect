import User from '../models/User.js';
import Appointment from '../models/Appointment.js';
import PackageBooking from '../models/PackageBooking.js';

// @desc    Register a new patient
// @route   POST /api/receptionist/register-patient
// @access  Private (Receptionist/Admin)
const registerPatient = async (req, res) => {
    const { name, email, password } = req.body;

    // Check if patient already exists
    const patientExists = await User.findOne({ email });
    if (patientExists) {
        res.status(400).json({ message: 'Patient with this email already exists' });
        return;
    }

    // Create a new user with the 'patient' role
    const patient = await User.create({
        name,
        email,
        password, // In a real app, you might auto-generate a temporary password
        role: 'patient',
    });

    if (patient) {
        res.status(201).json({
            _id: patient._id,
            name: patient.name,
            email: patient.email,
        });
    } else {
        res.status(400).json({ message: 'Invalid patient data' });
    }
};

// @desc    Book an offline appointment for a patient
// @route   POST /api/receptionist/book-appointment
// @access  Private (Receptionist/Admin)
const bookOfflineAppointment = async (req, res) => {
    const { patientId, doctorId, appointmentDate, appointmentTime } = req.body;

    // Validate that the patient and doctor exist
    const patient = await User.findById(patientId);
    if (!patient || patient.role !== 'patient') {
        res.status(404).json({ message: 'Patient not found' });
        return;
    }
    // In a full implementation, you would also validate the doctorId

    const appointment = new Appointment({
        doctor: doctorId,
        patient: patientId,
        appointmentDate,
        appointmentTime,
        type: 'Offline', // Hardcoded for receptionist bookings
        status: 'Scheduled',
    });

    const createdAppointment = await appointment.save();
    res.status(201).json(createdAppointment);
};

// @desc    Search for patients by name or email
// @route   GET /api/receptionist/search-patients?q=...
// @access  Private (Receptionist/Admin)
const searchPatients = async (req, res) => {
    const keyword = req.query.q ? {
        role: 'patient', // Ensure we only search for patients
        $or: [
            { name: { $regex: req.query.q, $options: 'i' } },
            { email: { $regex: req.query.q, $options: 'i' } },
        ],
    } : { role: 'patient' };

    const users = await User.find(keyword).select('-password').limit(10);
    res.json(users);
};

// @desc    Get all appointments for a specific date
// @route   GET /api/receptionist/appointments?date=YYYY-MM-DD
// @access  Private (Receptionist/Admin)
const getAppointmentsByDate = async (req, res) => {
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ message: 'Date query parameter is required' });
    }

    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const appointments = await Appointment.find({
        appointmentDate: {
            $gte: startDate,
            $lte: endDate,
        },
    })
    .populate('patient', 'name')
    .populate({
        path: 'doctor',
        populate: {
            path: 'user',
            select: 'name'
        },
        select: 'specialty'
    })
    .sort({ appointmentTime: 1 });

    res.json(appointments);
};

// @desc    Book a health package for a patient
// @route   POST /api/receptionist/book-package
// @access  Private (Receptionist/Admin)
const bookHealthPackageForPatient = async (req, res) => {
    const { patientId, packageId } = req.body;

    // Validate patient exists
    const patient = await User.findById(patientId);
    if (!patient || patient.role !== 'patient') {
        return res.status(404).json({ message: 'Patient not found' });
    }

    const booking = new PackageBooking({
        patient: patientId,
        healthPackage: packageId,
        bookedBy: req.user._id, // The logged-in receptionist/admin
    });

    const createdBooking = await booking.save();
    res.status(201).json(createdBooking);
};


export {
    registerPatient,
    bookOfflineAppointment,
    searchPatients,
    getAppointmentsByDate,
    bookHealthPackageForPatient
};
