import Appointment from '../models/Appointment.js';

// @desc    Create a new appointment
// @route   POST /api/appointments
// @access  Private (Patient)
const createAppointment = async (req, res) => {
    const { doctorId, appointmentDate, appointmentTime, type } = req.body;

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
