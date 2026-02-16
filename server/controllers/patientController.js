import Appointment from '../models/Appointment.js';
import PackageBooking from '../models/PackageBooking.js';
import Doctor from '../models/Doctor.js';

// @desc    Book an appointment for the logged-in patient
// @route   POST /api/patient/book-appointment
// @access  Private (Patient)
const bookMyAppointment = async (req, res) => {
    const { doctorId, appointmentDate, appointmentTime, type } = req.body;

    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
        return res.status(404).json({ message: 'Doctor not found' });
    }

    const existingAppointment = await Appointment.findOne({
        doctor: doctorId,
        appointmentDate,
        appointmentTime,
        status: { $ne: 'Cancelled' },
    });

    if (existingAppointment) {
        return res.status(409).json({ message: 'This time slot is already booked' });
    }

    const appointment = new Appointment({
        doctor: doctorId,
        patient: req.user._id, // from 'protect' middleware
        appointmentDate,
        appointmentTime,
        type,
    });

    const createdAppointment = await appointment.save();
    res.status(201).json(createdAppointment);
};

// @desc    Book a health package for the logged-in patient
// @route   POST /api/patient/book-package
// @access  Private (Patient)
const bookMyHealthPackage = async (req, res) => {
    const { packageId } = req.body;

    const booking = new PackageBooking({
        healthPackage: packageId,
        patient: req.user._id,
        bookedBy: req.user._id, // Patient booked it themselves
    });

    const createdBooking = await booking.save();
    res.status(201).json(createdBooking);
};

// @desc    Get medical history (appointments and packages) for the logged-in patient
// @route   GET /api/patient/my-history
// @access  Private (Patient)
const getMyHistory = async (req, res) => {
    const appointments = await Appointment.find({ patient: req.user._id })
        .populate({
            path: 'doctor',
            select: 'specialty',
            populate: { path: 'user', select: 'name' }
        })
        .sort({ appointmentDate: -1 });

    const packageBookings = await PackageBooking.find({ patient: req.user._id })
        .populate('healthPackage', 'name price')
        .sort({ createdAt: -1 });

    res.json({ appointments, packageBookings });
};

export { bookMyAppointment, bookMyHealthPackage, getMyHistory };
