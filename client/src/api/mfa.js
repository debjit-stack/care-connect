import API from './index.js';

export const getMfaStatus   = ()           => API.get('/auth/mfa/status');
export const setupMfa       = ()           => API.get('/auth/mfa/setup');
export const verifyMfaSetup = (data)       => API.post('/auth/mfa/verify-setup', data);
export const validateMfa    = (data)       => API.post('/auth/mfa/validate', data);
export const disableMfa     = (data)       => API.post('/auth/mfa/disable', data);
