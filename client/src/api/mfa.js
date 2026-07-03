import API from './index.js';

export const getMfaStatus   = ()            => API.get('/auth/mfa/status');
export const setupMfa = (mfaPending)        =>     API.get("/auth/mfa/setup", {headers: {Authorization: `Bearer ${mfaPending}`,},});
export const verifyMfaSetup = (payload, mfaPending) => API.post("/auth/mfa/verify-setup", payload, {headers: {Authorization: `Bearer ${mfaPending}`,},});
export const validateMfa    = (data)        => API.post('/auth/mfa/validate', data);
export const disableMfa     = (data)        => API.post('/auth/mfa/disable', data);

// C2 FIX: these two endpoints already existed on the server
// (mfaController.recoverWithCode / regenerateCodes, wired in mfaRoutes.js)
// but had no client-side callers, so the "lost your authenticator" recovery
// flow was unreachable from the UI. Added here and wired into
// MFAVerifyStep.jsx.
export const recoverWithCode  = (data) => API.post('/auth/mfa/recover', data);
export const regenerateCodes  = (data) => API.post('/auth/mfa/regenerate-codes', data);
