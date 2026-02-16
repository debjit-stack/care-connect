import Appointment from '../models/Appointment.js';
import Doctor from '../models/Doctor.js';

// @desc    Create a new appointment
// @route   POST /api/appointments
// @access  Private (Patient)
const createAppointment = async (req, res) => {
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

// @desc    Get appointments for logged-in patient
// @route   GET /api/appointments/my
// @access  Private (Patient)
const getMyAppointments = async (req, res) => {
    const appointments = await Appointment.find({ patient: req.user._id }).populate('doctor');
    res.json(appointments);
};

export { createAppointment, getMyAppointments };
