import API from './index.js';

export const login          = (formData)    => API.post('/auth/login', formData);
export const register       = (formData)    => API.post('/auth/register', formData);
export const logout         = ()            => API.post('/auth/logout');
export const logoutAll      = ()            => API.post('/auth/logout-all');
export const refreshToken   = ()            => API.post('/auth/refresh');
export const getMe          = ()            => API.get('/auth/me');
export const changePassword = (formData)    => API.put('/auth/change-password', formData);

// ── OTP FEATURE: patient self-registration ─────────────────────────────────────
export const requestRegistrationOtp = (data) => API.post('/auth/register/request-otp', data);
export const resendRegistrationOtp  = (data) => API.post('/auth/register/resend-otp', data);
export const verifyRegistrationOtp  = (data) => API.post('/auth/register/verify-otp', data);

// ── OTP FEATURE: forgot password ────────────────────────────────────────────────
export const forgotPassword          = (data) => API.post('/auth/forgot-password', data);
export const resendForgotPasswordOtp = (data) => API.post('/auth/forgot-password/resend-otp', data);
export const verifyForgotPasswordOtp = (data) => API.post('/auth/forgot-password/verify-otp', data);
export const resetPasswordWithToken  = (data) => API.post('/auth/forgot-password/reset', data);
