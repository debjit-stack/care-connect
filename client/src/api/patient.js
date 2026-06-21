import API from './index.js';

export const bookAppointment = (appointmentData) =>
  API.post('/patient/book-appointment', appointmentData);

export const bookMyHealthPackage = (bookingData) =>
  API.post('/patient/book-package', bookingData);

export const getMyHistory = () => API.get('/patient/my-history');