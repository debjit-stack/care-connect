import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    forgotPassword,
    resendForgotPasswordOtp,
    verifyForgotPasswordOtp,
    resetPasswordWithToken,
} from '../api/auth.js';
import OtpInput from '../components/common/OtpInput.jsx';

const RESEND_COOLDOWN_SECONDS = 60;

const ForgotPasswordPage = () => {
    const [step, setStep] = useState('email'); // 'email' | 'otp' | 'reset' | 'done'

    const [email,   setEmail]   = useState('');
    const [error,   setError]   = useState('');
    const [loading, setLoading] = useState(false);

    // OTP step
    const [digits,         setDigits]         = useState(['', '', '', '', '', '']);
    const [otpError,       setOtpError]       = useState('');
    const [otpLoading,     setOtpLoading]     = useState(false);
    const [resendCooldown, setResendCooldown] = useState(0);
    const [resendMessage,  setResendMessage]  = useState('');
    const cooldownRef = useRef(null);

    // Reset step
    const [resetToken,      setResetToken]      = useState(null);
    const [newPassword,     setNewPassword]     = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [resetError,      setResetError]      = useState('');
    const [resetLoading,    setResetLoading]    = useState(false);

    const navigate = useNavigate();

    useEffect(() => () => { if (cooldownRef.current) clearInterval(cooldownRef.current); }, []);

    const startCooldown = useCallback(() => {
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        if (cooldownRef.current) clearInterval(cooldownRef.current);
        cooldownRef.current = setInterval(() => {
            setResendCooldown((prev) => {
                if (prev <= 1) {
                    clearInterval(cooldownRef.current);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    }, []);

    // ── Step 1: request OTP ─────────────────────────────────────────────────────
    // The server always returns the same generic message regardless of whether
    // the email exists (enumeration-safe) — we move to the OTP step either way.
    const handleEmailSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await forgotPassword({ email });
            setStep('otp');
            startCooldown();
        } catch {
            // Even on an unexpected error, don't leak anything — just let the
            // user retry from the same screen.
            setError('Something went wrong. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // ── Step 2: verify OTP → get resetToken ─────────────────────────────────────
    const handleVerifyOtp = useCallback(async (overrideDigits) => {
        const otp = (overrideDigits ?? digits).join('');
        if (otp.length !== 6) return;

        setOtpError('');
        setOtpLoading(true);
        try {
            const { data } = await verifyForgotPasswordOtp({ email, otp });
            setResetToken(data.resetToken);
            setStep('reset');
        } catch (err) {
            const message = err?.response?.data?.message;
            setOtpError(message || 'Invalid code. Please try again.');
            setDigits(['', '', '', '', '', '']);
        } finally {
            setOtpLoading(false);
        }
    }, [digits, email]);

    const handleResend = async () => {
        if (resendCooldown > 0) return;
        setResendMessage('');
        setOtpError('');
        try {
            await resendForgotPasswordOtp({ email });
            setResendMessage('If an account exists, a new code has been sent.');
            setDigits(['', '', '', '', '', '']);
            startCooldown();
        } catch {
            setResendMessage('If an account exists, a new code has been sent.');
            startCooldown();
        }
    };

    // ── Step 3: set new password ─────────────────────────────────────────────────
    const handleResetSubmit = async (e) => {
        e.preventDefault();
        setResetError('');

        if (newPassword !== confirmPassword) {
            setResetError('Passwords do not match.');
            return;
        }
        if (newPassword.length < 8) {
            setResetError('Password must be at least 8 characters.');
            return;
        }

        setResetLoading(true);
        try {
            await resetPasswordWithToken({ resetToken, newPassword });
            setStep('done');
        } catch (err) {
            const message = err?.response?.data?.message;
            setResetError(message || 'Failed to reset password. Please request a new code.');
        } finally {
            setResetLoading(false);
        }
    };

    // ── Step 4: done ──────────────────────────────────────────────────────────────
    if (step === 'done') {
        return (
            <div className="max-w-md mx-auto mt-10 text-center">
                <div className="bg-white p-8 rounded-lg shadow-md">
                    <div className="flex justify-center mb-4">
                        <div className="bg-green-100 rounded-full p-4">
                            <svg className="w-12 h-12 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold mb-2 text-gray-800">Password Reset</h2>
                    <p className="text-gray-500 mb-6">
                        Your password has been changed. Please sign in with your new password.
                    </p>
                    <button
                        onClick={() => navigate('/login', { replace: true })}
                        className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors"
                    >
                        Go to Sign In
                    </button>
                </div>
            </div>
        );
    }

    // ── Step 3 UI: new password ───────────────────────────────────────────────────
    if (step === 'reset') {
        return (
            <div className="max-w-md mx-auto mt-10">
                <div className="bg-white p-8 rounded-lg shadow-md">
                    <h2 className="text-2xl font-bold mb-2 text-center">Set a New Password</h2>
                    <p className="text-gray-500 text-sm mb-6 text-center">
                        Choose a new password for your account.
                    </p>

                    {resetError && (
                        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
                            {resetError}
                        </div>
                    )}

                    <form onSubmit={handleResetSubmit}>
                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="newPassword">
                                New Password
                            </label>
                            <input
                                id="newPassword"
                                type="password"
                                autoComplete="new-password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full py-2 px-3 border rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                                required
                                disabled={resetLoading}
                            />
                        </div>

                        <div className="mb-6">
                            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="confirmNewPassword">
                                Confirm New Password
                            </label>
                            <input
                                id="confirmNewPassword"
                                type="password"
                                autoComplete="new-password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full py-2 px-3 border rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                                required
                                disabled={resetLoading}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={resetLoading}
                            className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {resetLoading ? 'Resetting…' : 'Reset Password'}
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    // ── Step 2 UI: OTP verification ───────────────────────────────────────────────
    if (step === 'otp') {
        return (
            <div className="max-w-md mx-auto mt-10">
                <div className="bg-white p-8 rounded-lg shadow-md text-center">
                    <div className="flex justify-center mb-4">
                        <div className="bg-blue-100 rounded-full p-4">
                            <svg className="w-10 h-10 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Enter Reset Code</h2>
                    <p className="text-gray-500 text-sm mb-6">
                        If an account exists for <strong>{email}</strong>, a 6-digit code has been sent.
                    </p>

                    {otpError && (
                        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
                            {otpError}
                        </div>
                    )}
                    {resendMessage && !otpError && (
                        <div className="bg-blue-50 border border-blue-200 text-blue-700 p-3 rounded mb-4 text-sm">
                            {resendMessage}
                        </div>
                    )}

                    <div className="mb-4">
                        <OtpInput
                            value={digits}
                            onChange={setDigits}
                            onComplete={() => handleVerifyOtp()}
                            disabled={otpLoading}
                        />
                    </div>

                    <p className="text-center text-xs text-gray-400 mb-4">
                        Code submits automatically when all 6 digits are entered.
                    </p>

                    <button
                        type="button"
                        onClick={() => handleVerifyOtp()}
                        disabled={otpLoading || digits.join('').length !== 6}
                        className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-3"
                    >
                        {otpLoading ? 'Verifying…' : 'Verify Code'}
                    </button>

                    <button
                        type="button"
                        onClick={handleResend}
                        disabled={resendCooldown > 0}
                        className="w-full text-blue-500 hover:text-blue-700 text-sm py-1 transition-colors disabled:opacity-50 disabled:text-gray-400 mb-1"
                    >
                        {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                    </button>

                    <button
                        type="button"
                        onClick={() => { setStep('email'); setDigits(['', '', '', '', '', '']); setOtpError(''); setResendMessage(''); }}
                        disabled={otpLoading}
                        className="w-full text-gray-500 hover:text-gray-700 text-sm py-1 transition-colors disabled:opacity-50"
                    >
                        ← Use a different email
                    </button>
                </div>
            </div>
        );
    }

    // ── Step 1 UI: email ───────────────────────────────────────────────────────────
    return (
        <div className="max-w-md mx-auto mt-10">
            <div className="bg-white p-8 rounded-lg shadow-md">
                <h2 className="text-2xl font-bold mb-2 text-center">Forgot Password</h2>
                <p className="text-gray-500 text-sm mb-6 text-center">
                    Enter your email and we'll send you a code to reset your password.
                </p>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleEmailSubmit}>
                    <div className="mb-6">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="email">
                            Email
                        </label>
                        <input
                            id="email"
                            type="email"
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full py-2 px-3 border rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                            required
                            disabled={loading}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {loading ? 'Sending…' : 'Send Reset Code'}
                    </button>
                </form>

                <p className="text-center text-sm text-gray-600 mt-4">
                    Remembered your password?{' '}
                    <Link to="/login" className="text-blue-500 hover:underline">
                        Sign in
                    </Link>
                </p>
            </div>
        </div>
    );
};

export default ForgotPasswordPage;
