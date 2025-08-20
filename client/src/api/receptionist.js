import API from './index.js';

export const searchPatients = (query) => API.get(`/receptionist/search-patients?q=${query}`);
export const getAppointmentsByDate = (date) => API.get(`/receptionist/appointments?date=${date}`);
export const registerPatientByReceptionist = (patientData) => API.post('/receptionist/register-patient', patientData);
export const bookOfflineAppointment = (appointmentData) => API.post('/receptionist/book-appointment', appointmentData);
export const bookPackageForPatient = (bookingData) => API.post('/receptionist/book-package', bookingData);