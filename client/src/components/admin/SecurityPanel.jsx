import React, { useState, useEffect, useCallback } from 'react';
import {
    getSecuritySettings,
    updateSecuritySettings,
    getUserSecurity,
    updateUserSecurity,
    resetUserMfa,
} from '../../api/admin.js';
import StepUpModal from '../auth/StepUpModal.jsx';

// ── Status badge ───────────────────────────────────────────────────────────────
const MfaBadge = ({ enabled }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${
        enabled
            ? 'bg-green-100 text-green-700'
            : 'bg-gray-100 text-gray-500'
    }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
        {enabled ? 'Enabled' : 'Not set up'}
    </span>
);

// ── Toggle switch ──────────────────────────────────────────────────────────────
const Toggle = ({ checked, onChange, disabled, label }) => (
    <label className={`relative inline-flex items-center ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
        <input
            type="checkbox"
            checked={checked}
            onChange={(e) => !disabled && onChange(e.target.checked)}
            disabled={disabled}
            className="sr-only peer"
        />
        <div className={`w-9 h-5 rounded-full transition-colors peer-checked:bg-blue-500 bg-gray-300`} />
        <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
        {label && <span className="ml-2 text-sm text-gray-700">{label}</span>}
    </label>
);

// ── Row-level security state ───────────────────────────────────────────────────
// Fetched lazily when the Security tab opens — not fetched during initial dashboard load.
const UserSecurityRow = ({ user, orgMfaRequired, onChanged }) => {
    const [security,    setSecurity]    = useState(null);
    const [loadingSec,  setLoadingSec]  = useState(true);
    const [savingForce, setSavingForce] = useState(false);
    const [resetting,   setResetting]   = useState(false);
    const [rowError,    setRowError]    = useState('');

    useEffect(() => {
        getUserSecurity(user._id)
            .then(({ data }) => setSecurity(data))
            .catch(() => setRowError('Failed to load'))
            .finally(() => setLoadingSec(false));
    }, [user._id]);

    const handleForceMfaToggle = async (value) => {
        setSavingForce(true);
        setRowError('');
        try {
            const { data } = await updateUserSecurity(user._id, { forceMfa: value });
            setSecurity(data.security);
            onChanged?.();
        } catch (err) {
            setRowError(err?.response?.data?.message || 'Failed to update');
        } finally {
            setSavingForce(false);
        }
    };

    const handleResetMfa = async () => {
        if (!window.confirm(`Reset MFA for ${user.name}? They will need to re-enroll.`)) return;
        setResetting(true);
        setRowError('');
        try {
            await resetUserMfa(user._id);
            setSecurity((prev) => ({ ...prev, mfaEnabled: false, lastMfaResetAt: new Date().toISOString() }));
            onChanged?.();
        } catch (err) {
            setRowError(err?.response?.data?.message || 'Failed to reset');
        } finally {
            setResetting(false);
        }
    };

    return (
        <tr className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
            <td className="py-3 px-4">
                <p className="font-medium text-gray-800 text-sm">{user.name}</p>
                <p className="text-xs text-gray-400">{user.email}</p>
            </td>
            <td className="py-3 px-4">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                    user.role === 'admin'       ? 'bg-purple-100 text-purple-700' :
                    user.role === 'doctor'      ? 'bg-blue-100 text-blue-700'    :
                    user.role === 'receptionist'? 'bg-teal-100 text-teal-700'    :
                    'bg-gray-100 text-gray-600'
                }`}>{user.role}</span>
            </td>
            <td className="py-3 px-4">
                {loadingSec ? (
                    <div className="w-16 h-5 bg-gray-100 animate-pulse rounded" />
                ) : (
                    <MfaBadge enabled={security?.mfaEnabled ?? false} />
                )}
            </td>
            <td className="py-3 px-4">
                {loadingSec ? (
                    <div className="w-10 h-5 bg-gray-100 animate-pulse rounded" />
                ) : (
                    <Toggle
                        checked={security?.forceMfa ?? false}
                        onChange={handleForceMfaToggle}
                        disabled={savingForce || orgMfaRequired}
                        label=""
                    />
                )}
                {/* When org requires MFA, forceMfa is redundant */}
                {orgMfaRequired && (
                    <span className="text-xs text-gray-400 ml-1">(org policy)</span>
                )}
            </td>
            <td className="py-3 px-4 text-xs text-gray-400">
                {security?.lastMfaResetAt
                    ? new Date(security.lastMfaResetAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })
                    : '—'}
            </td>
            <td className="py-3 px-4">
                {security?.mfaEnabled ? (
                    <button
                        onClick={handleResetMfa}
                        disabled={resetting}
                        className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50 transition-colors"
                    >
                        {resetting ? 'Resetting…' : 'Reset MFA'}
                    </button>
                ) : (
                    <span className="text-xs text-gray-300">—</span>
                )}
                {rowError && <p className="text-xs text-red-500 mt-1">{rowError}</p>}
            </td>
        </tr>
    );
};

// ── Main panel ─────────────────────────────────────────────────────────────────
const SecurityPanel = ({ users }) => {
    const [orgPolicy,      setOrgPolicy]      = useState(null);
    const [loadingPolicy,  setLoadingPolicy]  = useState(true);
    const [savingPolicy,   setSavingPolicy]   = useState(false);
    const [policyError,    setPolicyError]    = useState('');
    const [policySuccess,  setPolicySuccess]  = useState('');
    const [userFilter,     setUserFilter]     = useState('');
    const [refreshKey,     setRefreshKey]     = useState(0);

    // A2: when updateSecuritySettings comes back with stepUpRequired (the
    // caller's last step-up token is missing/expired), we stash the value
    // the user was trying to set and show StepUpModal instead of an error.
    // On successful verification, the modal's onVerified callback re-fires
    // the same toggle with the same pending value — the user only sees a
    // brief extra prompt, not a failed action they have to retry manually.
    const [showStepUp, setShowStepUp] = useState(false);
    const [pendingPolicyValue, setPendingPolicyValue] = useState(null);

    // Load org-level security settings
    const fetchPolicy = useCallback(async () => {
        try {
            const { data } = await getSecuritySettings();
            setOrgPolicy(data);
        } catch (err) {
            setPolicyError('Failed to load security settings.');
        } finally {
            setLoadingPolicy(false);
        }
    }, []);

    useEffect(() => { fetchPolicy(); }, [fetchPolicy]);

    const applyPolicyToggle = async (value) => {
        setSavingPolicy(true);
        setPolicyError('');
        setPolicySuccess('');
        try {
            const { data } = await updateSecuritySettings({ mfaRequired: value });
            setOrgPolicy({ mfaRequired: data.settings.mfaRequired });
            setPolicySuccess(
                value
                    ? 'MFA is now required for all staff accounts in this organisation.'
                    : 'Organisation-wide staff MFA requirement removed.'
            );
            setTimeout(() => setPolicySuccess(''), 4000);
        } catch (err) {
            // A2: distinguish "needs step-up" from every other failure —
            // the former opens the re-verification modal instead of just
            // showing an error the user can't act on.
            if (err?.response?.data?.stepUpRequired) {
                setPendingPolicyValue(value);
                setShowStepUp(true);
            } else {
                setPolicyError(err?.response?.data?.message || 'Failed to update policy.');
            }
        } finally {
            setSavingPolicy(false);
        }
    };

    const handlePolicyToggle = (value) => applyPolicyToggle(value);

    const handleStepUpVerified = () => {
        setShowStepUp(false);
        if (pendingPolicyValue !== null) {
            const value = pendingPolicyValue;
            setPendingPolicyValue(null);
            applyPolicyToggle(value);
        }
    };

    const handleStepUpCancel = () => {
        setShowStepUp(false);
        setPendingPolicyValue(null);
    };

    // Only show staff, doctors, admins — not patients (patients no longer use
    // MFA at all; see authController.loginUser's centralized patient bypass).
    const staffUsers = users
        .filter((u) => ['admin', 'super_admin', 'doctor', 'receptionist'].includes(u.role))
        .filter((u) => {
            if (!userFilter) return true;
            return (
                u.name.toLowerCase().includes(userFilter.toLowerCase()) ||
                u.email.toLowerCase().includes(userFilter.toLowerCase())
            );
        });

    return (
        <div className="space-y-8">
            {/* ── Org-level policy ─────────────────────────────────────────── */}
            <div className="bg-white border border-gray-200 rounded-xl p-6">
                <div className="flex items-start justify-between mb-2">
                    <div>
                        <h3 className="text-base font-semibold text-gray-800">
                            Require MFA for Staff
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">
                            When enabled, all admin, doctor, and receptionist accounts must set
                            up two-factor authentication before accessing the system.
                            Patients never use MFA — this setting does not affect them.
                        </p>
                    </div>
                    {loadingPolicy ? (
                        <div className="w-16 h-6 bg-gray-100 animate-pulse rounded" />
                    ) : (
                        <Toggle
                            checked={orgPolicy?.mfaRequired ?? false}
                            onChange={handlePolicyToggle}
                            disabled={savingPolicy}
                        />
                    )}
                </div>

                {orgPolicy?.mfaRequired && (
                    <div className="mt-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                        <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <p className="text-sm text-amber-700">
                            MFA is currently required for all staff logins. Staff members without
                            MFA will be prompted to set it up on next login. Patients are unaffected.
                        </p>
                    </div>
                )}

                {policyError   && <p className="text-sm text-red-600 mt-2">{policyError}</p>}
                {policySuccess && (
                    <p className="text-sm text-green-600 mt-2 flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        {policySuccess}
                    </p>
                )}
            </div>

            {/* ── Per-user MFA management ───────────────────────────────────── */}
            <div>
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h3 className="text-base font-semibold text-gray-800">Staff MFA Status</h3>
                        <p className="text-sm text-gray-500">
                            Manage MFA enforcement per staff member. "Force MFA" requires a specific
                            user to set up MFA regardless of org policy. Patients are not listed here
                            since they no longer use MFA.
                        </p>
                    </div>
                    <input
                        type="text"
                        placeholder="Search staff…"
                        value={userFilter}
                        onChange={(e) => setUserFilter(e.target.value)}
                        className="text-sm p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-400 w-52"
                    />
                </div>

                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">MFA Status</th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Force MFA</th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Reset</th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {staffUsers.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="py-10 text-center text-gray-400 text-sm">
                                        No staff members found
                                    </td>
                                </tr>
                            ) : (
                                staffUsers.map((user) => (
                                    <UserSecurityRow
                                        key={`${user._id}-${refreshKey}`}
                                        user={user}
                                        orgMfaRequired={orgPolicy?.mfaRequired ?? false}
                                        onChanged={() => setRefreshKey((k) => k + 1)}
                                    />
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* A2: step-up re-verification prompt for the org policy toggle */}
            {showStepUp && (
                <StepUpModal
                    title="Confirm It's You"
                    onVerified={handleStepUpVerified}
                    onCancel={handleStepUpCancel}
                />
            )}
        </div>
    );
};

export default SecurityPanel;
