import API from './index.js';

// --- Public Routes ---
export const fetchDoctors = () => API.get('/doctors');
export const fetchDoctorById = (id) => API.get(`/doctors/${id}`);
export const fetchDoctorAvailability = (id, date) => API.get(`/doctors/${id}/availability?date=${date}`);

// --- Protected Doctor Routes ---
export const getMyAssignedAppointments = () => API.get('/doctors/my-appointments');
export const getPatientHistory = (patientId) => API.get(`/doctors/patient-history/${patientId}`);
export const updateAppointment = (appointmentId, data) => API.put(`/doctors/appointments/${appointmentId}`, data);
export const updateMyAvailability = (availabilityData) => API.put('/doctors/my-availability', { availability: availabilityData });