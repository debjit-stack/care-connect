// A2: in-memory step-up token cache.
//
// Mirrors this project's existing "access tokens live in memory only, never
// localStorage/sessionStorage" policy (see api/index.js's _accessToken) —
// a step-up token is exactly as sensitive (it's proof of a fresh
// password/TOTP check) and deserves the same treatment.
//
// The token is cached for its actual server-issued lifetime (expiresIn,
// normally 300s) minus a small safety margin, so a request that fires right
// at the boundary doesn't get rejected by the server a moment after the
// client considered it still valid.

let _stepUpToken = null;
let _stepUpExpiresAt = 0;

const SAFETY_MARGIN_MS = 5000;

export const setStepUpToken = (token, expiresInSeconds = 300) => {
    _stepUpToken = token;
    _stepUpExpiresAt = Date.now() + expiresInSeconds * 1000 - SAFETY_MARGIN_MS;
};

export const getValidStepUpToken = () => {
    if (_stepUpToken && Date.now() < _stepUpExpiresAt) {
        return _stepUpToken;
    }
    return null;
};

export const clearStepUpToken = () => {
    _stepUpToken = null;
    _stepUpExpiresAt = 0;
};
