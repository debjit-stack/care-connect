import API from './index.js';

export const login          = (formData)    => API.post('/auth/login', formData);
export const register       = (formData)    => API.post('/auth/register', formData);
export const logout         = ()            => API.post('/auth/logout');
export const logoutAll      = ()            => API.post('/auth/logout-all');
export const refreshToken   = ()            => API.post('/auth/refresh');
export const getMe          = ()            => API.get('/auth/me');
export const changePassword = (formData)    => API.put('/auth/change-password', formData);
