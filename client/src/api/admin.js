import API from './index.js';

// ── Existing functions (unchanged) ────────────────────────────────────────────
export const getDashboardStats      = ()              => API.get('/dashboard/stats');
export const getAllUsers             = ()              => API.get('/admin/users');
export const getDoctorProfiles      = ()              => API.get('/admin/doctors-full');
export const createStaff            = (d)             => API.post('/admin/staff', d);
export const createDoctor           = (d)             => API.post('/admin/doctors', d);
export const updateUser             = (id, d)         => API.put(`/admin/users/${id}`, d);
export const resetPassword          = (id, newPassword) =>
    API.put(`/admin/users/${id}/reset-password`, { newPassword });
export const updateDoctorAvailability = (id, d)       =>
    API.put(`/admin/doctors/${id}`, { availability: d });
export const deleteUser             = (id)            => API.delete(`/admin/users/${id}`);
export const registerPatientByAdmin = (d)             => API.post('/receptionist/register-patient', d);

// WS3: CSV export
export const exportAppointments = async (from, to) => {
    const response = await API.get(
        `/dashboard/export?from=${from}&to=${to}`,
        { responseType: 'blob' }
    );
    const url  = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href  = url;
    link.setAttribute('download', `appointments_${from}_to_${to}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
};

// ── P3A: Security management functions ────────────────────────────────────────
// Org-level MFA policy
export const getSecuritySettings    = ()    => API.get('/admin/security');
export const updateSecuritySettings = (d)   => API.put('/admin/security', d);

// Per-user MFA security state
export const getUserSecurity        = (id)  => API.get(`/admin/users/${id}/security`);
export const updateUserSecurity     = (id, d) => API.put(`/admin/users/${id}/security`, d);
export const resetUserMfa           = (id)  => API.post(`/admin/users/${id}/reset-mfa`);
