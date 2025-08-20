import API from './index.js';

export const bookAppointment = (appointmentData) => API.post('/patient/book-appointment', appointmentData);
export const getMyHistory = () => API.get('/patient/my-history');