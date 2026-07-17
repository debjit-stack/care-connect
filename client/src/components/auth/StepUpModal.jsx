import React, { useState } from 'react';
import { stepUpVerify } from '../../api/auth.js';
import { setStepUpToken } from '../../api/stepUp.js';

/**
 * StepUpModal
 * ───────────
 * A2: reusable identity re-verification prompt for sensitive actions
 * (change password, disable MFA, org security-policy changes). Shown when
 * a request comes back with `stepUpRequired: true` (see requireStepUp on
 * the backend), or proactively before firing a request the caller already
 * knows is gated.
 *
 * Accepts either the user's current password or a 6-digit TOTP code —
 * mirrors stepUpVerifySchema on the backend, which requires at least one.
 * On success, caches the returned token via setStepUpToken() so it's
 * automatically attached (via the axios interceptor in api/index.js) to
 * every request for the next ~5 minutes — the caller does not need to
 * manually retry their original action immediately; onVerified() lets them
 * decide whether to auto-retry or just let the user click "save" again.
 *
 * Usage:
 *   const [showStepUp, setShowStepUp] = useState(false);
 *   ...
 *   catch (err) {
 *     if (err?.response?.data?.stepUpRequired) { setShowStepUp(true); return; }
 *     ...
 *   }
 *   ...
 *   {showStepUp && (
 *     <StepUpModal
 *       onVerified={() => { setShowStepUp(false); retryOriginalAction(); }}
 *       onCancel={() => setShowStepUp(false)}
 *     />
 *   )}
 */
const StepUpModal = ({ onVerified, onCancel, title = 'Confirm It\u2019s You' }) => {
    const [mode, setMode]         = useState('password'); // 'password' | 'totp'
    const [password, setPassword] = useState('');
    const [totp, setTotp]         = useState('');
    const [error, setError]       = useState('');
    const [loading, setLoading]   = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        const payload = mode === 'password' ? { password } : { token: totp };
        if (mode === 'password' && !password) return;
        if (mode === 'totp' && totp.length !== 6) return;

        setLoading(true);
        try {
            const { data } = await stepUpVerify(payload);
            setStepUpToken(data.stepUpToken, data.expiresIn);
            onVerified?.();
        } catch (err) {
            const status = err?.response?.status;
            const msg    = err?.response?.data?.message;
            if (status === 429) {
                setError(msg || 'Too many attempts. Please wait before trying again.');
            } else {
                setError(msg || 'Verification failed. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    const switchMode = (next) => {
        setMode(next);
        setError('');
        setPassword('');
        setTotp('');
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-sm">
                <div className="flex justify-center mb-4">
                    <div className="bg-blue-100 rounded-full p-3">
                        <svg className="w-7 h-7 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                    </div>
                </div>
                <h2 className="text-lg font-bold mb-1 text-center">{title}</h2>
                <p className="text-sm text-gray-500 text-center mb-5">
                    This action requires a quick re-verification of your identity.
                </p>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    {mode === 'password' ? (
                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="stepup-password">
                                Current Password
                            </label>
                            <input
                                id="stepup-password"
                                type="password"
                                autoComplete="current-password"
                                autoFocus
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full py-2 px-3 border rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                                disabled={loading}
                            />
                        </div>
                    ) : (
                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="stepup-totp">
                                6-Digit Authenticator Code
                            </label>
                            <input
                                id="stepup-totp"
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                autoFocus
                                value={totp}
                                onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                className="w-full py-2 px-3 border rounded text-center font-mono text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-400"
                                disabled={loading}
                            />
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || (mode === 'password' ? !password : totp.length !== 6)}
                        className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-3"
                    >
                        {loading ? 'Verifying…' : 'Verify'}
                    </button>

                    <button
                        type="button"
                        onClick={() => switchMode(mode === 'password' ? 'totp' : 'password')}
                        disabled={loading}
                        className="w-full text-blue-500 hover:text-blue-700 text-sm py-1 transition-colors disabled:opacity-50 mb-1"
                    >
                        {mode === 'password'
                            ? 'Use an authenticator code instead'
                            : 'Use my password instead'}
                    </button>

                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={loading}
                        className="w-full text-gray-500 hover:text-gray-700 text-sm py-1 transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                </form>
            </div>
        </div>
    );
};

export default StepUpModal;
