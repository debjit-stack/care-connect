import React, { useState, useRef, useEffect, useCallback } from 'react';
import { validateMfa } from '../../api/mfa.js';

/**
 * MFAVerifyStep
 * ─────────────
 * Shown after successful password entry when mfaEnabled = true (Scenario 2).
 * Accepts the 6-digit TOTP, calls /api/auth/mfa/validate,
 * and calls onSuccess({ accessToken, user }) on pass.
 *
 * Polish items applied:
 *   • Auto-submit when all 6 digits filled
 *   • Loading spinner inside button
 *   • Clear expired-session message with auto-redirect countdown
 *   • Mobile numeric keypad (inputMode="numeric")
 */
const MFAVerifyStep = ({ mfaPending, onSuccess, onCancel }) => {
    const [digits,      setDigits]      = useState(['', '', '', '', '', '']);
    const [error,       setError]       = useState('');
    const [loading,     setLoading]     = useState(false);
    const [expiredCountdown, setExpiredCountdown] = useState(null); // null | number
    const inputRefs = useRef([]);

    // Auto-focus first input on mount
    useEffect(() => {
        inputRefs.current[0]?.focus();
    }, []);

    // ── Submit ─────────────────────────────────────────────────────────────────
    const handleSubmit = useCallback(async (overrideDigits) => {
        const token = (overrideDigits ?? digits).join('');
        if (token.length !== 6) return;

        setError('');
        setLoading(true);

        try {
            const { data } = await validateMfa({ token, mfaPending });
            onSuccess(data);
        } catch (err) {
            const status = err?.response?.status;
            const msg    = err?.response?.data?.message || '';

            if (status === 401 && (msg.includes('expired') || msg.includes('session'))) {
                // Polish item: show countdown before redirecting back to login
                setError('Your login session has expired. Returning to login…');
                let count = 3;
                setExpiredCountdown(count);
                const interval = setInterval(() => {
                    count -= 1;
                    setExpiredCountdown(count);
                    if (count <= 0) {
                        clearInterval(interval);
                        onCancel();
                    }
                }, 1000);
            } else {
                setError(msg || 'Invalid code. Please try again.');
                setDigits(['', '', '', '', '', '']);
                inputRefs.current[0]?.focus();
            }
        } finally {
            setLoading(false);
        }
    }, [digits, mfaPending, onSuccess, onCancel]);

    // ── Auto-submit when all 6 digits entered ──────────────────────────────────
    // Polish item: fires automatically — user doesn't need to press the button.
    useEffect(() => {
        if (digits.join('').length === 6 && !loading && expiredCountdown === null) {
            handleSubmit(digits);
        }
    }, [digits]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Digit input handling ───────────────────────────────────────────────────
    const handleChange = (index, value) => {
        // Handle paste of full 6-digit code
        if (value.length > 1) {
            const cleaned = value.replace(/\D/g, '').slice(0, 6);
            if (cleaned.length === 6) {
                setDigits(cleaned.split(''));
                inputRefs.current[5]?.focus();
                return;
            }
        }

        const digit = value.replace(/\D/g, '').slice(-1);
        const next  = [...digits];
        next[index] = digit;
        setDigits(next);

        if (digit && index < 5) inputRefs.current[index + 1]?.focus();
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const isExpired     = expiredCountdown !== null;
    const allFilled     = digits.join('').length === 6;

    return (
        <div className="max-w-md mx-auto mt-10">
            <div className="bg-white p-8 rounded-lg shadow-md text-center">
                {/* Shield icon */}
                <div className="flex justify-center mb-4">
                    <div className={`rounded-full p-4 ${loading ? 'bg-blue-50' : 'bg-blue-100'}`}>
                        {loading ? (
                            <svg className="w-10 h-10 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                            </svg>
                        ) : (
                            <svg className="w-10 h-10 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                                />
                            </svg>
                        )}
                    </div>
                </div>

                <h2 className="text-2xl font-bold mb-2">Two-Factor Authentication</h2>
                <p className="text-gray-500 text-sm mb-6">
                    {loading
                        ? 'Verifying your code…'
                        : 'Enter the 6-digit code from your authenticator app.'}
                </p>

                {error && (
                    <div className={`p-3 rounded mb-4 text-sm ${
                        isExpired
                            ? 'bg-amber-50 border border-amber-200 text-amber-700'
                            : 'bg-red-50 border border-red-200 text-red-700'
                    }`}>
                        {error}
                        {isExpired && expiredCountdown > 0 && (
                            <span className="ml-1 font-bold">({expiredCountdown})</span>
                        )}
                    </div>
                )}

                {/* 6-digit inputs */}
                <div className="flex justify-center gap-2 mb-2">
                    {digits.map((digit, i) => (
                        <input
                            key={i}
                            ref={(el) => (inputRefs.current[i] = el)}
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={digit}
                            onChange={(e) => handleChange(i, e.target.value)}
                            onKeyDown={(e) => handleKeyDown(i, e)}
                            disabled={loading || isExpired}
                            className={`
                                w-11 h-14 text-center text-xl font-bold border-2 rounded-lg
                                focus:outline-none focus:border-blue-500 transition-colors
                                ${digit ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}
                                ${(loading || isExpired) ? 'opacity-50 cursor-not-allowed' : ''}
                            `}
                        />
                    ))}
                </div>

                {/* Polish item: auto-submit hint */}
                {!loading && !isExpired && (
                    <p className="text-center text-xs text-gray-400 mb-4">
                        Code submits automatically when all 6 digits are entered.
                    </p>
                )}

                {!isExpired && (
                    <>
                        <button
                            type="button"
                            onClick={() => handleSubmit()}
                            disabled={loading || !allFilled}
                            className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-3"
                        >
                            {loading ? 'Verifying…' : 'Verify Code'}
                        </button>

                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={loading}
                            className="w-full text-gray-500 hover:text-gray-700 text-sm py-1 transition-colors disabled:opacity-50"
                        >
                            ← Back to login
                        </button>
                    </>
                )}

                <p className="text-xs text-gray-400 mt-4">
                    Code refreshes every 30 seconds. Make sure your device clock is accurate.
                </p>
            </div>
        </div>
    );
};

export default MFAVerifyStep;
