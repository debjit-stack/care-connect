import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getPlatformStats,
    getAllOrganisations,
    createOrganisation,
    suspendOrganisation,
    reactivateOrganisation,
} from '../api/organisations.js';
import { setOrgSlug } from '../api/index.js';
import StatsCard          from '../components/admin/StatsCard';
import ConfirmModal       from '../components/common/ConfirmModal';
import CreateOrganisationModal from '../components/admin/modals/CreateOrganisationModal';

// PHASE-B addition: super_admin's own dashboard — platform-wide overview
// plus organisation lifecycle management (create / suspend / reactivate)
// and the "switch into an org's admin view" entry point.
//
// Deliberately NOT built as a variant of AdminDashboard.jsx: that
// component's entire data model (org-scoped users/doctors/packages/stats)
// doesn't apply here at all — a super_admin with no organisationId of
// their own has nothing for those org-scoped endpoints to return before
// they've chosen a specific org to act within (see the "Manage" action
// below, which is exactly that choice).
const SuperAdminDashboard = () => {
    const navigate = useNavigate();

    const [stats,   setStats]   = useState(null);
    const [orgs,    setOrgs]    = useState([]);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState('');
    const [search,  setSearch]  = useState('');

    const [modal, setModal] = useState({ type: null, data: null });

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            const [statsRes, orgsRes] = await Promise.all([
                getPlatformStats(),
                getAllOrganisations(),
            ]);
            setStats(statsRes.data);
            setOrgs(orgsRes.data);
        } catch (err) {
            console.error('Failed to load super admin dashboard:', err);
            setError('Failed to load platform data. Please refresh.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const closeModal = () => setModal({ type: null, data: null });

    // ── Create organisation ─────────────────────────────────────────────────
    const handleCreateOrg = async (payload) => {
        await createOrganisation(payload); // lets CreateOrganisationModal show its own error on failure
        closeModal();
        loadData();
    };

    // ── Suspend (consequential — revokes every user's session in that org) ──
    const handleSuspendClick = (org) => {
        setModal({
            type: 'confirm',
            data: {
                title:   `Suspend ${org.name}?`,
                message: `This immediately signs out every user in ${org.name} and blocks new logins until reactivated. This cannot be undone by the organisation itself — only a super admin can reactivate it.`,
                onConfirm: async () => {
                    try {
                        await suspendOrganisation(org._id);
                        closeModal();
                        loadData();
                    } catch (err) {
                        alert(err?.response?.data?.message || 'Failed to suspend organisation.');
                    }
                },
            },
        });
    };

    // ── Reactivate (reversible, low-risk — no confirm needed) ──────────────
    const handleReactivate = async (org) => {
        try {
            await reactivateOrganisation(org._id);
            loadData();
        } catch (err) {
            alert(err?.response?.data?.message || 'Failed to reactivate organisation.');
        }
    };

    // ── Switch into this org's admin view ───────────────────────────────────
    const handleManage = (org) => {
        setOrgSlug(org.slug);
        navigate('/admin');
    };

    const filteredOrgs = orgs.filter((o) =>
        o.name.toLowerCase().includes(search.toLowerCase()) ||
        o.slug.toLowerCase().includes(search.toLowerCase())
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
            </div>
        );
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
                <h1 className="text-3xl font-bold">Super Admin — Platform Overview</h1>
                <div className="flex gap-3">
                    {/* PHASE-C addition: dedicated guided onboarding flow,
                        distinct from the quick-create modal below — see
                        HospitalOnboardingPage.jsx for why these are kept
                        as two separate paths rather than one. */}
                    <button
                        onClick={() => navigate('/super-admin/onboard')}
                        className="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded transition-colors"
                    >
                        Onboard New Hospital
                    </button>
                    <button
                        onClick={() => setModal({ type: 'create' })}
                        className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded transition-colors"
                    >
                        + Quick Create
                    </button>
                </div>
            </div>

            {error && <p className="bg-red-100 text-red-700 p-3 rounded mb-4">{error}</p>}

            {/* Platform KPIs */}
            {stats && (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
                    <StatsCard title="Total Organisations"     value={stats.totalOrganisations} />
                    <StatsCard title="Active Organisations"    value={stats.activeOrganisations} />
                    <StatsCard title="Suspended / Deactivated" value={stats.suspendedOrDeletedOrganisations} />
                    <StatsCard title="Total Doctors"           value={stats.totalDoctors} />
                    <StatsCard title="Total Patients"          value={stats.totalPatients} />
                </div>
            )}

            {/* Organisation list */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
                    <h2 className="text-xl font-semibold text-gray-800">Organisations</h2>
                    <input
                        type="text"
                        placeholder="Search by name or slug…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="p-2 border rounded text-sm w-64"
                    />
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full bg-white text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="py-2 px-3 text-left">Name</th>
                                <th className="py-2 px-3 text-left">Slug</th>
                                <th className="py-2 px-3 text-left">Plan</th>
                                <th className="py-2 px-3 text-left">Status</th>
                                <th className="py-2 px-3 text-left">Created</th>
                                <th className="py-2 px-3 text-left">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredOrgs.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="py-8 text-center text-gray-400">
                                        No organisations found.
                                    </td>
                                </tr>
                            ) : (
                                filteredOrgs.map((org) => {
                                    const isActive = org.isActive && !org.deletedAt;
                                    return (
                                        <tr key={org._id} className="border-b hover:bg-gray-50">
                                            <td className="py-2 px-3 font-medium">{org.name}</td>
                                            <td className="py-2 px-3 font-mono text-xs text-gray-500">{org.slug}</td>
                                            <td className="py-2 px-3 capitalize">{org.plan}</td>
                                            <td className="py-2 px-3">
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                                    isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                                }`}>
                                                    {isActive ? 'Active' : 'Suspended'}
                                                </span>
                                            </td>
                                            <td className="py-2 px-3 text-gray-500">
                                                {new Date(org.createdAt).toLocaleDateString()}
                                            </td>
                                            <td className="py-2 px-3 whitespace-nowrap">
                                                <button
                                                    onClick={() => handleManage(org)}
                                                    className="text-blue-500 hover:text-blue-700 font-medium mr-3"
                                                >
                                                    Manage
                                                </button>
                                                {isActive ? (
                                                    <button
                                                        onClick={() => handleSuspendClick(org)}
                                                        className="text-red-500 hover:text-red-700 font-medium"
                                                    >
                                                        Suspend
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleReactivate(org)}
                                                        className="text-green-600 hover:text-green-800 font-medium"
                                                    >
                                                        Reactivate
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {modal.type === 'create' && (
                <CreateOrganisationModal onClose={closeModal} onSave={handleCreateOrg} />
            )}
            {modal.type === 'confirm' && (
                <ConfirmModal
                    title={modal.data.title}
                    message={modal.data.message}
                    onConfirm={modal.data.onConfirm}
                    onCancel={closeModal}
                />
            )}
        </div>
    );
};

export default SuperAdminDashboard;
