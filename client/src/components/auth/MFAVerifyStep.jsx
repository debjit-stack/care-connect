import React, { useState, useRef, useEffect } from 'react';
import { validateMfa } from '../../api/mfa.js';

/**
 * MFAVerifyStep
 * ─────────────
 * Shown after successful password entry when mfaEnabled = true.
 * Accepts the 6-digit TOTP, calls /api/auth/mfa/validate,
 * and calls onSuccess({ accessToken, user }) on pass.
 *
 * Props:
 *   mfaPending  — the short-lived JWT from the login response
 *   onSuccess   — callback({ accessToken, user }) called on valid TOTP
 *   onCancel    — callback to go back to password step
 */
const MFAVerifyStep = ({ mfaPending, onSuccess, onCancel }) => {
    const [digits,  setDigits]  = useState(['', '', '', '', '', '']);
    const [error,   setError]   = useState('');
    const [loading, setLoading] = useState(false);
    const inputRefs = useRef([]);

    // Auto-focus first input on mount
    useEffect(() => {
        inputRefs.current[0]?.focus();
    }, []);

    const handleChange = (index, value) => {
        // Accept only digits, handle paste of full 6-digit code
        if (value.length > 1) {
            const cleaned = value.replace(/\D/g, '').slice(0, 6);
            if (cleaned.length === 6) {
                const newDigits = cleaned.split('');
                setDigits(newDigits);
                inputRefs.current[5]?.focus();
                return;
            }
        }

        const digit = value.replace(/\D/g, '').slice(-1);
        const newDigits = [...digits];
        newDigits[index] = digit;
        setDigits(newDigits);

        // Auto-advance to next input
        if (digit && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        const token = digits.join('');
        if (token.length !== 6) {
            setError('Please enter all 6 digits.');
            return;
        }

        setLoading(true);
        try {
            const { data } = await validateMfa({ token, mfaPending });
            onSuccess(data);
        } catch (err) {
            const msg = err?.response?.data?.message;
            if (err?.response?.status === 401 && msg?.includes('expired')) {
                setError('Session expired. Please log in again.');
                setTimeout(onCancel, 2000);
            } else {
                setError(msg || 'Invalid code. Please try again.');
                // Clear digits on failure for easy retry
                setDigits(['', '', '', '', '', '']);
                inputRefs.current[0]?.focus();
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-md mx-auto mt-10">
            <div className="bg-white p-8 rounded-lg shadow-md text-center">
                {/* Shield icon */}
                <div className="flex justify-center mb-4">
                    <div className="bg-blue-100 rounded-full p-4">
                        <svg className="w-10 h-10 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                            />
                        </svg>
                    </div>
                </div>

                <h2 className="text-2xl font-bold mb-2">Two-Factor Authentication</h2>
                <p className="text-gray-500 text-sm mb-6">
                    Enter the 6-digit code from your authenticator app.
                </p>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    {/* 6 individual digit inputs */}
                    <div className="flex justify-center gap-2 mb-6">
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
                                disabled={loading}
                                className={`
                                    w-11 h-14 text-center text-xl font-bold border-2 rounded-lg
                                    focus:outline-none focus:border-blue-500 transition-colors
                                    ${digit ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}
                                    ${loading ? 'opacity-50' : ''}
                                `}
                            />
                        ))}
                    </div>

                    <button
                        type="submit"
                        disabled={loading || digits.join('').length !== 6}
                        className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-3"
                    >
                        {loading ? 'Verifying…' : 'Verify Code'}
                    </button>

                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={loading}
                        className="w-full text-gray-500 hover:text-gray-700 text-sm py-1 transition-colors"
                    >
                        ← Back to login
                    </button>
                </form>

                <p className="text-xs text-gray-400 mt-4">
                    Code refreshes every 30 seconds. Make sure your device clock is accurate.
                </p>
            </div>
        </div>
    );
};

export default MFAVerifyStep;
