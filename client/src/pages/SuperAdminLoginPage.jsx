import React, { useState, useEffect } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { clearOrgSlug } from '../api/index.js';
import MFAVerifyStep from '../components/auth/MFAVerifyStep.jsx';
import useBfcacheReload from '../hooks/useBfcacheReload.js';

// PHASE-D/E: dedicated Super Admin login entry point.
//
// PHASE-E FIX: no longer calls setPlatformMode() — that flag has been
// removed entirely. Authentication now goes through platformLogin()
// (AuthContext), which calls the dedicated POST /api/auth/platform-login
// endpoint — the ROUTE itself is what distinguishes this from hospital
// login, not a flag this page has to remember to set. completeLogin()
// (shared by both login paths) sets currentUserRole from the server's
// response, which is what getOrgSlug() actually checks — and because that
// happens inside AuthContext for BOTH a fresh login here AND a silent
// session restore, there's no code path left where it can fail to be set.
//
// clearOrgSlug() on mount is kept as defensive cleanup — if a stale
// EXPLICIT org slug happens to be sitting in sessionStorage from an
// earlier "Manage Hospital" click in this same browser session, this
// ensures a fresh platform-login attempt never accidentally inherits it.
const DASHBOARD_ROUTES = {
    admin:        '/admin',
    doctor:       '/doctor',
    receptionist: '/receptionist',
    patient:      '/patient',
    super_admin:  '/super-admin',
};

const SuperAdminLoginPage = () => {
    const [email,    setEmail]    = useState('');
    const [password, setPassword] = useState('');
    const [error,    setError]    = useState('');
    const [loading,  setLoading]  = useState(false);

    const [mfaStep,    setMfaStep]    = useState(null); // null | 'verify' | 'setup'
    const [mfaPending, setMfaPending] = useState('');

    const { platformLogin, isAuthenticated, user, completeLogin } = useAuth();
    const navigate = useNavigate();

    // A1 FIX: same bfcache-restoration guard as LoginPage.jsx — the
    // platform-admin login page carries the same risk of a browser
    // repainting a stale mid-MFA-verify snapshot on back/forward. See
    // useBfcacheReload's own comment for the full rationale.
    useBfcacheReload();

    useEffect(() => {
        clearOrgSlug();
    }, []);

    useEffect(() => {
        if (mfaStep === 'setup') {
            navigate(`/mfa-setup?required=true&mfaPending=${encodeURIComponent(mfaPending)}`, { replace: true });
        }
    }, [mfaStep, mfaPending, navigate]);

    if (isAuthenticated && user) {
        return <Navigate to={DASHBOARD_ROUTES[user.role] ?? '/'} replace />;
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const loggedInUser = await platformLogin(email, password);
            navigate(DASHBOARD_ROUTES[loggedInUser.role] ?? '/super-admin', { replace: true });
        } catch (err) {
            const status = err?.response?.status;
            const data   = err?.response?.data;

            if (status === 200 && data?.mfaRequired) {
                setMfaPending(data.mfaPending);
                setMfaStep(data.mfaSetupRequired ? 'setup' : 'verify');
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

    const handleMfaSuccess = ({ accessToken, user: mfaUser }) => {
        completeLogin({ accessToken, user: mfaUser });
        navigate(DASHBOARD_ROUTES[mfaUser.role] ?? '/super-admin', { replace: true });
    };

    const handleMfaCancel = () => {
        setMfaStep(null);
        setMfaPending('');
        setError('');
    };

    if (mfaStep === 'setup') return null;

    if (mfaStep === 'verify') {
        return (
            <MFAVerifyStep
                mfaPending={mfaPending}
                onSuccess={handleMfaSuccess}
                onCancel={handleMfaCancel}
            />
        );
    }

    return (
        <div className="max-w-md mx-auto mt-10">
            <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-md">
                <div className="flex justify-center mb-4">
                    <div className="bg-gray-800 rounded-full p-3">
                        <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                    </div>
                </div>
                <h2 className="text-2xl font-bold mb-1 text-center">Platform Admin Sign In</h2>
                <p className="text-center text-sm text-gray-400 mb-6">For CareConnect staff only</p>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}

                <div className="mb-4">
                    <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="email">Email</label>
                    <input
                        id="email" type="email" autoComplete="email"
                        value={email} onChange={(e) => setEmail(e.target.value)}
                        className="w-full py-2 px-3 border rounded focus:outline-none focus:ring-2 focus:ring-gray-400"
                        required disabled={loading}
                    />
                </div>

                <div className="mb-2">
                    <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="password">Password</label>
                    <input
                        id="password" type="password" autoComplete="current-password"
                        value={password} onChange={(e) => setPassword(e.target.value)}
                        className="w-full py-2 px-3 border rounded focus:outline-none focus:ring-2 focus:ring-gray-400"
                        required disabled={loading}
                    />
                </div>

                <button
                    type="submit" disabled={loading}
                    className="w-full mt-4 bg-gray-800 hover:bg-gray-900 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {loading ? 'Signing in…' : 'Sign In'}
                </button>

                <p className="text-center text-xs text-gray-400 mt-4">
                    <Link to="/login" className="hover:underline">← Hospital staff sign in</Link>
                </p>
            </form>
        </div>
    );
};

export default SuperAdminLoginPage;
