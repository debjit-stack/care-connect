import API from './index.js';

export const getMfaStatus   = ()            => API.get('/auth/mfa/status');
export const setupMfa = (mfaPending)        =>     API.get("/auth/mfa/setup", {headers: {Authorization: `Bearer ${mfaPending}`,},});
export const verifyMfaSetup = (payload, mfaPending) => API.post("/auth/mfa/verify-setup", payload, {headers: {Authorization: `Bearer ${mfaPending}`,},});
export const validateMfa    = (data)        => API.post('/auth/mfa/validate', data);
export const disableMfa     = (data)        => API.post('/auth/mfa/disable', data);
