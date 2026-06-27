import React, { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { setAccessToken, setOrgSlug } from '../api/index.js';
import MFAVerifyStep from '../components/auth/MFAVerifyStep.jsx';

const DASHBOARD_ROUTES = {
    admin:        '/admin',
    doctor:       '/doctor',
    receptionist: '/receptionist',
    patient:      '/patient',
    super_admin:  '/admin',
};

const LoginPage = () => {
    const [email,      setEmail]      = useState('');
    const [password,   setPassword]   = useState('');
    const [error,      setError]      = useState('');
    const [loading,    setLoading]    = useState(false);

    // MFA state
    const [mfaStep,    setMfaStep]    = useState(null);  // null | 'verify' | 'setup'
    const [mfaPending, setMfaPending] = useState('');

    const { login, isAuthenticated, user, updateUser } = useAuth();
    const navigate = useNavigate();

    if (isAuthenticated && user) {
        return <Navigate to={DASHBOARD_ROUTES[user.role] ?? '/'} replace />;
    }

    // ── Normal login submit ────────────────────────────────────────────────────
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const loggedInUser = await login(email, password);

            // login() in AuthContext handles the normal success case
            // (sets accessToken in memory, sets user state).
            // If we get here without an MFA step, navigate to dashboard.
            navigate(DASHBOARD_ROUTES[loggedInUser.role] ?? '/', { replace: true });
        } catch (err) {
            const status  = err?.response?.status;
            const data    = err?.response?.data;

            if (status === 200 && data?.mfaRequired) {
                // Server returned 200 but requires MFA — not a real error
                setMfaPending(data.mfaPending);
                if (data.mfaSetupRequired) {
                    setMfaStep('setup');
                } else {
                    setMfaStep('verify');
                }
            } else if (status === 423) {
                setError(data?.message || 'Account locked. Please try again later.');
            } else if (status === 429) {
                setError('Too many login attempts. Please wait 15 minutes before trying again.');
            } else {
                setError(data?.message || 'Failed to log in. Please check your credentials.');
            }
        } finally {
            setLoading(false);
        }
    };

    // ── MFA verify success ─────────────────────────────────────────────────────
    const handleMfaSuccess = ({ accessToken, user: mfaUser }) => {
        setAccessToken(accessToken);
        if (mfaUser.organisation?.slug) setOrgSlug(mfaUser.organisation.slug);
        updateUser(mfaUser);
        navigate(DASHBOARD_ROUTES[mfaUser.role] ?? '/', { replace: true });
    };

    const handleMfaCancel = () => {
        setMfaStep(null);
        setMfaPending('');
        setError('');
    };

    // ── MFA forced setup — redirect to setup page with pending token ───────────
    if (mfaStep === 'setup') {
        navigate(`/mfa-setup?required=true&mfaPending=${encodeURIComponent(mfaPending)}`, { replace: true });
        return null;
    }

    // ── MFA verify step ────────────────────────────────────────────────────────
    if (mfaStep === 'verify') {
        return (
            <MFAVerifyStep
                mfaPending={mfaPending}
                onSuccess={handleMfaSuccess}
                onCancel={handleMfaCancel}
            />
        );
    }

    // ── Normal login form ──────────────────────────────────────────────────────
    return (
        <div className="max-w-md mx-auto mt-10">
            <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-md">
                <h2 className="text-2xl font-bold mb-6 text-center">Sign In</h2>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}

                <div className="mb-4">
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

                <div className="mb-6">
                    <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="password">
                        Password
                    </label>
                    <input
                        id="password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
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
                    {loading ? 'Signing in…' : 'Sign In'}
                </button>

                <p className="text-center text-sm text-gray-600 mt-4">
                    Don't have an account?{' '}
                    <Link to="/register" className="text-blue-500 hover:underline">
                        Register
                    </Link>
                </p>
            </form>
        </div>
    );
};

export default LoginPage;
