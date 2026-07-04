import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    requestRegistrationOtp,
    resendRegistrationOtp,
    verifyRegistrationOtp,
} from '../api/auth.js';
import OtpInput from '../components/common/OtpInput.jsx';

const DASHBOARD_ROUTES = {
    admin:        '/admin',
    doctor:       '/doctor',
    receptionist: '/receptionist',
    patient:      '/patient',
};

const RESEND_COOLDOWN_SECONDS = 60;

const RegisterPage = () => {
    const [step, setStep] = useState('details'); // 'details' | 'otp'

    const [formData, setFormData] = useState({ name: '', email: '', password: '', confirmPassword: '' });
    const [error,    setError]    = useState('');
    const [loading,  setLoading]  = useState(false);

    // OTP step state
    const [registrationId, setRegistrationId] = useState(null);
    const [digits,         setDigits]         = useState(['', '', '', '', '', '']);
    const [otpError,       setOtpError]       = useState('');
    const [otpLoading,     setOtpLoading]     = useState(false);
    const [resendCooldown, setResendCooldown] = useState(0);
    const [resendMessage,  setResendMessage]  = useState('');

    const cooldownRef = useRef(null);

    const { isAuthenticated, user, completeLogin } = useAuth();
    const navigate = useNavigate();

    // Already logged in — redirect to dashboard
    if (isAuthenticated && user) {
        return <Navigate to={DASHBOARD_ROUTES[user.role] ?? '/'} replace />;
    }

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

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    // ── Step 1: request OTP ─────────────────────────────────────────────────────
    const handleDetailsSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (formData.password !== formData.confirmPassword) {
            setError('Passwords do not match.');
            return;
        }
        if (formData.password.length < 8) {
            setError('Password must be at least 8 characters.');
            return;
        }

        setLoading(true);
        try {
            const { data } = await requestRegistrationOtp({
                name:     formData.name,
                email:    formData.email,
                password: formData.password,
            });
            setRegistrationId(data.registrationId);
            setStep('otp');
            startCooldown();
        } catch (err) {
            const status  = err?.response?.status;
            const message = err?.response?.data?.message;

            if (status === 409) {
                setError('An account with this email already exists.');
            } else if (status === 403) {
                setError(message || 'Registration is not available for this organisation.');
            } else {
                setError(message || 'Failed to send verification code. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    // ── Step 2: verify OTP → auto-login ─────────────────────────────────────────
    const handleVerify = useCallback(async (overrideDigits) => {
        const otp = (overrideDigits ?? digits).join('');
        if (otp.length !== 6) return;

        setOtpError('');
        setOtpLoading(true);
        try {
            const { data } = await verifyRegistrationOtp({ registrationId, otp });
            completeLogin(data);
            navigate(DASHBOARD_ROUTES[data.user.role] ?? '/', { replace: true });
        } catch (err) {
            const status  = err?.response?.status;
            const message = err?.response?.data?.message;

            if (status === 400 && message?.includes('expired')) {
                setOtpError(message);
            } else if (status === 409) {
                setOtpError(message);
            } else {
                setOtpError(message || 'Invalid code. Please try again.');
                setDigits(['', '', '', '', '', '']);
            }
        } finally {
            setOtpLoading(false);
        }
    }, [digits, registrationId, completeLogin, navigate]);

    // ── Resend ───────────────────────────────────────────────────────────────────
    const handleResend = async () => {
        if (resendCooldown > 0) return;
        setResendMessage('');
        setOtpError('');
        try {
            await resendRegistrationOtp({ registrationId });
            setResendMessage('A new code has been sent to your email.');
            setDigits(['', '', '', '', '', '']);
            startCooldown();
        } catch (err) {
            setOtpError(err?.response?.data?.message || 'Failed to resend code.');
        }
    };

    const handleBackToDetails = () => {
        setStep('details');
        setRegistrationId(null);
        setDigits(['', '', '', '', '', '']);
        setOtpError('');
        setResendMessage('');
        if (cooldownRef.current) clearInterval(cooldownRef.current);
        setResendCooldown(0);
    };

    // ── Step 2 UI: OTP verification ─────────────────────────────────────────────
    if (step === 'otp') {
        return (
            <div className="max-w-md mx-auto mt-10">
                <div className="bg-white p-8 rounded-lg shadow-md text-center">
                    <div className="flex justify-center mb-4">
                        <div className="bg-blue-100 rounded-full p-4">
                            <svg className="w-10 h-10 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Verify Your Email</h2>
                    <p className="text-gray-500 text-sm mb-6">
                        We sent a 6-digit code to <strong>{formData.email}</strong>.
                    </p>

                    {otpError && (
                        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
                            {otpError}
                        </div>
                    )}
                    {resendMessage && !otpError && (
                        <div className="bg-green-50 border border-green-200 text-green-700 p-3 rounded mb-4 text-sm">
                            {resendMessage}
                        </div>
                    )}

                    <div className="mb-4">
                        <OtpInput
                            value={digits}
                            onChange={setDigits}
                            onComplete={() => handleVerify()}
                            disabled={otpLoading}
                        />
                    </div>

                    <p className="text-center text-xs text-gray-400 mb-4">
                        Code submits automatically when all 6 digits are entered.
                    </p>

                    <button
                        type="button"
                        onClick={() => handleVerify()}
                        disabled={otpLoading || digits.join('').length !== 6}
                        className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-3"
                    >
                        {otpLoading ? 'Verifying…' : 'Verify & Create Account'}
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
                        onClick={handleBackToDetails}
                        disabled={otpLoading}
                        className="w-full text-gray-500 hover:text-gray-700 text-sm py-1 transition-colors disabled:opacity-50"
                    >
                        ← Use a different email
                    </button>
                </div>
            </div>
        );
    }

    // ── Step 1 UI: details form ──────────────────────────────────────────────────
    return (
        <div className="max-w-md mx-auto mt-10">
            <div className="bg-white p-8 rounded-lg shadow-md">
                <h2 className="text-2xl font-bold mb-6 text-center">Create Account</h2>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleDetailsSubmit}>
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="name">
                            Full Name
                        </label>
                        <input
                            id="name"
                            name="name"
                            type="text"
                            autoComplete="name"
                            value={formData.name}
                            onChange={handleChange}
                            className="w-full py-2 px-3 border rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                            required
                            disabled={loading}
                        />
                    </div>

                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="email">
                            Email
                        </label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            autoComplete="email"
                            value={formData.email}
                            onChange={handleChange}
                            className="w-full py-2 px-3 border rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                            required
                            disabled={loading}
                        />
                    </div>

                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="password">
                            Password
                        </label>
                        <input
                            id="password"
                            name="password"
                            type="password"
                            autoComplete="new-password"
                            value={formData.password}
                            onChange={handleChange}
                            className="w-full py-2 px-3 border rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                            required
                            disabled={loading}
                        />
                    </div>

                    <div className="mb-6">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="confirmPassword">
                            Confirm Password
                        </label>
                        <input
                            id="confirmPassword"
                            name="confirmPassword"
                            type="password"
                            autoComplete="new-password"
                            value={formData.confirmPassword}
                            onChange={handleChange}
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
                        {loading ? 'Sending code…' : 'Send Verification Code'}
                    </button>
                </form>

                <p className="text-center text-sm text-gray-600 mt-4">
                    Already have an account?{' '}
                    <Link to="/login" className="text-blue-500 hover:underline">
                        Sign in
                    </Link>
                </p>
            </div>
        </div>
    );
};

export default RegisterPage;
