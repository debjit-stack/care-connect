import API from './index.js';

export const bookAppointment = (appointmentData) =>
  API.post('/patient/book-appointment', appointmentData);

export const bookMyHealthPackage = (bookingData) =>
  API.post('/patient/book-package', bookingData);

export const getMyHistory = () => API.get('/patient/my-history');

// WS4: Profile management
export const getMyProfile    = ()     => API.get('/patient/profile');
export const updateMyProfile = (data) => API.put('/patient/profile', data);

// WS4: Self-cancellation
export const cancelMyAppointment = (id) => API.delete(`/patient/appointments/${id}`);
