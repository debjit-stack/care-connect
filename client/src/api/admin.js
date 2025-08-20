import API from './index.js';

export const getDashboardStats = () => API.get('/dashboard/stats');
export const getAllUsers = () => API.get('/admin/users');
export const createStaff = (staffData) => API.post('/admin/staff', staffData);
export const createDoctor = (doctorData) => API.post('/admin/doctors', doctorData);
export const updateUser = (id, userData) => API.put(`/admin/users/${id}`, userData);
export const resetPassword = (id, newPassword) => API.put(`/admin/users/${id}/reset-password`, { newPassword });
export const updateDoctorAvailability = (id, availabilityData) => API.put(`/admin/doctors/${id}`, { availability: availabilityData });
export const deleteUser = (id) => API.delete(`/admin/users/${id}`);
export const registerPatientByAdmin = (patientData) => API.post('/receptionist/register-patient', patientData);