import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    getDashboardStats,
    getAllUsers,
    deleteUser,
    createStaff,
    createDoctor,
    updateUser,
    registerPatientByAdmin,
    updateDoctorAvailability,
    resetPassword,
    getDoctorProfiles,
    exportAppointments,
} from '../api/admin';
import { createPackage, deletePackage, updatePackage, getAdminPackages } from '../api/packages';
import { useAuth } from '../context/AuthContext';

// Existing components
import StatsCard            from '../components/admin/StatsCard';
import UserList             from '../components/admin/UserList';
import DoctorList           from '../components/admin/DoctorList';
import PatientList          from '../components/admin/PatientList';
import PackageList          from '../components/admin/PackageList';
import AddStaffModal        from '../components/admin/modals/AddStaffModal';
import AddDoctorModal       from '../components/admin/modals/AddDoctorModal';
import AddPackageModal      from '../components/admin/modals/AddPackageModal';
import EditPackageModal     from '../components/admin/modals/EditPackageModal';
import AddPatientModal      from '../components/receptionist/AddPatientModal';
import EditUserModal        from '../components/admin/modals/EditUserModal';
import ResetPasswordModal   from '../components/admin/modals/ResetPasswordModal';
import SetAvailabilityModal from '../components/admin/modals/SetAvailabilityModal';
import ConfirmModal         from '../components/common/ConfirmModal';

// WS3: Chart components
import AppointmentTrendChart  from '../components/admin/charts/AppointmentTrendChart';
import AppointmentStatusChart from '../components/admin/charts/AppointmentStatusChart';
import DoctorLeaderboard      from '../components/admin/charts/DoctorLeaderboard';
import RevenueChart           from '../components/admin/charts/RevenueChart';
import PackagePopularityChart from '../components/admin/charts/PackagePopularityChart';

// P3A: Security panel
import SecurityPanel from '../components/admin/SecurityPanel';

// ── Date helpers ───────────────────────────────────────────────────────────────
const today    = () => new Date().toISOString().split('T')[0];
const monthAgo = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
};

const AdminDashboard = () => {
    const { user: loggedInUser } = useAuth();

    // ── Data state ─────────────────────────────────────────────────────────────
    const [stats,          setStats]          = useState(null);
    const [users,          setUsers]          = useState([]);
    const [doctorProfiles, setDoctorProfiles] = useState([]);
    const [packages,       setPackages]       = useState([]);
    const [loading,        setLoading]        = useState(true);
    const [error,          setError]          = useState('');

    // ── Search state ───────────────────────────────────────────────────────────
    const [doctorSearch,  setDoctorSearch]  = useState('');
    const [patientSearch, setPatientSearch] = useState('');
    const [staffSearch,   setStaffSearch]   = useState('');

    // ── Modal state ────────────────────────────────────────────────────────────
    const [modal, setModal] = useState({ type: null, data: null });

    // ── Tab state ──────────────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState('analytics');

    // ── WS3: Export state ──────────────────────────────────────────────────────
    const [exportFrom,  setExportFrom]  = useState(monthAgo());
    const [exportTo,    setExportTo]    = useState(today());
    const [exporting,   setExporting]   = useState(false);
    const [exportError, setExportError] = useState('');

    // ── Load dashboard data ────────────────────────────────────────────────────
    const loadDashboardData = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            // PHASE-F Task 4 FIX: was fetchPackages() (the PUBLIC catalog
            // route, GET /api/packages) — now getAdminPackages() (the
            // dedicated admin-scoped route, GET /api/admin/packages-full),
            // mirroring how doctorProfiles already uses getDoctorProfiles()
            // → /api/admin/doctors-full rather than the public /api/doctors
            // route. The public route is now correctly tenant-resolved too
            // (see tenantMiddleware.js), but the admin dashboard shouldn't
            // depend on the public catalog endpoint regardless — same
            // separation of concerns doctors already had.
            const [statsData, usersData, packagesData, doctorProfilesData] = await Promise.all([
                getDashboardStats(),
                getAllUsers(),
                getAdminPackages(),
                getDoctorProfiles(),
            ]);
            setStats(statsData.data);
            setUsers(usersData.data);
            setPackages(packagesData.data);
            setDoctorProfiles(doctorProfilesData.data);
        } catch (err) {
            console.error('Failed to load dashboard data:', err);
            setError('Failed to load dashboard data. Please refresh.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadDashboardData(); }, [loadDashboardData]);

    const closeModal = () => setModal({ type: null, data: null });

    // ── Save handler ───────────────────────────────────────────────────────────
    const handleSave = async (type, data) => {
        try {
            switch (type) {
                case 'staff':         await createStaff(data);                               break;
                case 'doctor':        await createDoctor(data);                              break;
                case 'patient':       await registerPatientByAdmin(data);                    break;
                case 'package':       await createPackage(data);                             break;
                case 'editUser':      await updateUser(modal.data._id, data);                break;
                case 'editPackage':   await updatePackage(modal.data._id, data);             break;
                case 'resetPassword': await resetPassword(modal.data._id, data.newPassword); break;
                case 'availability':  await updateDoctorAvailability(modal.data._id, data);  break;
                default: break;
            }
            closeModal();
            loadDashboardData();
        } catch (err) {
            console.error(`Failed to save (${type}):`, err);
            alert(err?.response?.data?.message || 'Save failed. Please try again.');
        }
    };

    // ── Delete handler ─────────────────────────────────────────────────────────
    const handleDelete = (type, id) => {
        const confirmAction = async () => {
            try {
                if (type === 'user')    await deleteUser(id);
                if (type === 'package') await deletePackage(id);
                closeModal();
                loadDashboardData();
            } catch (err) {
                console.error('Delete failed:', err);
                alert('Delete failed. Please try again.');
            }
        };
        setModal({
            type: 'confirm',
            data: {
                title:     `Delete ${type}`,
                message:   `Are you sure you want to delete this ${type}? This cannot be undone.`,
                onConfirm: confirmAction,
            },
        });
    };

    // ── WS3: CSV export ────────────────────────────────────────────────────────
    const handleExport = async () => {
        setExportError('');
        if (!exportFrom || !exportTo) { setExportError('Please select both from and to dates.'); return; }
        if (exportFrom > exportTo)    { setExportError('From date must be before to date.');     return; }
        setExporting(true);
        try {
            await exportAppointments(exportFrom, exportTo);
        } catch (err) {
            setExportError(err?.response?.data?.message || 'Export failed. Please try again.');
        } finally {
            setExporting(false);
        }
    };

    // ── Filtered lists ─────────────────────────────────────────────────────────
    const enrichedDoctors = useMemo(() =>
        users
            .filter((u) => u.role === 'doctor')
            .map((u) => {
                const profile = doctorProfiles.find((dp) => dp.user && dp.user._id === u._id);
                return { ...u, doctorProfile: profile || null };
            }),
        [users, doctorProfiles]
    );

    const filteredDoctors = useMemo(() =>
        enrichedDoctors.filter((u) =>
            u.name.toLowerCase().includes(doctorSearch.toLowerCase()) ||
            u.email.toLowerCase().includes(doctorSearch.toLowerCase())
        ), [enrichedDoctors, doctorSearch]);

    const filteredPatients = useMemo(() =>
        users
            .filter((u) => u.role === 'patient')
            .filter((u) =>
                u.name.toLowerCase().includes(patientSearch.toLowerCase()) ||
                u.email.toLowerCase().includes(patientSearch.toLowerCase())
            ), [users, patientSearch]);

    const filteredStaff = useMemo(() =>
        users
            .filter((u) => ['admin', 'receptionist', 'super_admin'].includes(u.role))
            .filter((u) =>
                u.name.toLowerCase().includes(staffSearch.toLowerCase()) ||
                u.email.toLowerCase().includes(staffSearch.toLowerCase())
            ), [users, staffSearch]);

    if (loading) return (
        <div className="flex items-center justify-center min-h-[60vh]">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
        </div>
    );

    const TabButton = ({ tabName, label, icon }) => (
        <button
            onClick={() => setActiveTab(tabName)}
            className={`py-2 px-4 font-semibold rounded-t-lg flex items-center gap-1.5 text-sm transition-colors ${
                activeTab === tabName
                    ? 'bg-white text-blue-600 border-b-2 border-blue-500'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
        >
            {icon && <span>{icon}</span>}
            {label}
        </button>
    );

    return (
        <div>
            <h1 className="text-3xl font-bold mb-6">Admin Dashboard</h1>

            {error && <p className="bg-red-100 text-red-700 p-3 rounded mb-4">{error}</p>}

            {/* KPI Cards */}
            {stats && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                    <StatsCard title="Total Patients"     value={stats.kpi.totalPatients} />
                    <StatsCard title="Total Doctors"      value={stats.kpi.totalDoctors} />
                    <StatsCard title="Total Appointments" value={stats.kpi.totalAppointments} />
                    <StatsCard title="Simulated Revenue"  value={`₹${stats.kpi.totalRevenue.toLocaleString('en-IN')}`} />
                </div>
            )}

            {/* Tabs */}
            <div className="mt-8">
                <div className="flex flex-wrap gap-1 border-b border-gray-200">
                    <TabButton tabName="analytics" label="Analytics" icon="📊" />
                    <TabButton tabName="doctors"   label="Doctors"   icon="👨‍⚕️" />
                    <TabButton tabName="patients"  label="Patients"  icon="👤" />
                    <TabButton tabName="staff"     label="Staff"     icon="🏥" />
                    <TabButton tabName="packages"  label="Packages"  icon="📦" />
                    {/* P3A: Security tab */}
                    <TabButton tabName="security"  label="Security"  icon="🔒" />
                </div>

                <div className="bg-white p-6 rounded-b-xl rounded-r-xl shadow-sm border border-gray-100 border-t-0">

                    {/* ── Analytics Tab ─────────────────────────────────────── */}
                    {activeTab === 'analytics' && stats && (
                        <div>
                            <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
                                <h2 className="text-xl font-semibold text-gray-800">Analytics Overview</h2>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <label className="text-sm text-gray-500">Export appointments:</label>
                                    <input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} max={exportTo} className="text-sm p-1.5 border rounded focus:outline-none focus:ring-2 focus:ring-blue-400" />
                                    <span className="text-gray-400 text-sm">to</span>
                                    <input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} min={exportFrom} max={today()} className="text-sm p-1.5 border rounded focus:outline-none focus:ring-2 focus:ring-blue-400" />
                                    <button onClick={handleExport} disabled={exporting} className="flex items-center gap-1.5 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium py-1.5 px-3 rounded transition-colors">
                                        {exporting ? <><svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Exporting…</> : <>⬇ CSV</>}
                                    </button>
                                    {exportError && <p className="text-xs text-red-500 w-full">{exportError}</p>}
                                </div>
                            </div>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <AppointmentTrendChart  data={stats.charts?.appointmentsByMonth ?? []} />
                                <RevenueChart           data={stats.charts?.revenueByMonth ?? []} />
                                <AppointmentStatusChart statusData={stats.charts?.appointmentsByStatus ?? []} typeData={stats.charts?.appointmentsByType ?? []} />
                                <DoctorLeaderboard      data={stats.charts?.topDoctors ?? []} />
                                <div className="lg:col-span-2"><PackagePopularityChart data={stats.charts?.packagePopularity ?? []} /></div>
                            </div>
                        </div>
                    )}

                    {/* ── Doctors Tab ───────────────────────────────────────── */}
                    {activeTab === 'doctors' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-semibold">Doctors</h2>
                                <button onClick={() => setModal({ type: 'doctor' })} className="bg-purple-500 text-white py-2 px-4 rounded hover:bg-purple-600">Add Doctor</button>
                            </div>
                            <input type="text" placeholder="Search doctors…" value={doctorSearch} onChange={(e) => setDoctorSearch(e.target.value)} className="w-full p-2 border rounded mb-4" />
                            <DoctorList
                                doctors={filteredDoctors}
                                loggedInUser={loggedInUser}
                                onEdit={(u)    => setModal({ type: 'editUser',  data: u })}
                                onDelete={(id) => handleDelete('user', id)}
                                onSetAvailability={(u) => {
                                    if (!u.doctorProfile) { alert('Doctor profile not found. Please refresh.'); return; }
                                    setModal({ type: 'availability', data: u.doctorProfile });
                                }}
                                onResetPassword={(u) => setModal({ type: 'resetPassword', data: u })}
                            />
                        </div>
                    )}

                    {/* ── Patients Tab ──────────────────────────────────────── */}
                    {activeTab === 'patients' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-semibold">Patients</h2>
                                <button onClick={() => setModal({ type: 'patient' })} className="bg-cyan-500 text-white py-2 px-4 rounded hover:bg-cyan-600">Add Patient</button>
                            </div>
                            <input type="text" placeholder="Search patients…" value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} className="w-full p-2 border rounded mb-4" />
                            <PatientList
                                patients={filteredPatients}
                                loggedInUser={loggedInUser}
                                onEdit={(u)    => setModal({ type: 'editUser',      data: u })}
                                onDelete={(id) => handleDelete('user', id)}
                                onResetPassword={(u) => setModal({ type: 'resetPassword', data: u })}
                            />
                        </div>
                    )}

                    {/* ── Staff Tab ─────────────────────────────────────────── */}
                    {activeTab === 'staff' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-semibold">Staff</h2>
                                <button onClick={() => setModal({ type: 'staff' })} className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600">Add Staff</button>
                            </div>
                            <input type="text" placeholder="Search staff…" value={staffSearch} onChange={(e) => setStaffSearch(e.target.value)} className="w-full p-2 border rounded mb-4" />
                            <UserList
                                users={filteredStaff}
                                loggedInUser={loggedInUser}
                                onEdit={(u)    => setModal({ type: 'editUser',      data: u })}
                                onDelete={(id) => handleDelete('user', id)}
                                onResetPassword={(u) => setModal({ type: 'resetPassword', data: u })}
                            />
                        </div>
                    )}

                    {/* ── Packages Tab ──────────────────────────────────────── */}
                    {activeTab === 'packages' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-semibold">Health Packages</h2>
                                <button onClick={() => setModal({ type: 'package' })} className="bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600">Add Package</button>
                            </div>
                            <PackageList
                                packages={packages}
                                onEdit={(pkg)  => setModal({ type: 'editPackage', data: pkg })}
                                onDelete={(id) => handleDelete('package', id)}
                            />
                        </div>
                    )}

                    {/* ── P3A: Security Tab ─────────────────────────────────── */}
                    {activeTab === 'security' && (
                        <div>
                            <div className="mb-6">
                                <h2 className="text-xl font-semibold text-gray-800">Security Management</h2>
                                <p className="text-sm text-gray-500 mt-1">
                                    Manage MFA policies, enforce two-factor authentication, and audit user security settings.
                                </p>
                            </div>
                            <SecurityPanel users={users} />
                        </div>
                    )}
                </div>
            </div>

            {/* Modals — unchanged */}
            {modal.type === 'staff'         && <AddStaffModal      onClose={closeModal} onSave={(d) => handleSave('staff',        d)} />}
            {modal.type === 'doctor'        && <AddDoctorModal     onClose={closeModal} onSave={(d) => handleSave('doctor',       d)} />}
            {modal.type === 'patient'       && <AddPatientModal    onClose={closeModal} onSave={(d) => handleSave('patient',      d)} />}
            {modal.type === 'package'       && <AddPackageModal    onClose={closeModal} onSave={(d) => handleSave('package',      d)} />}
            {modal.type === 'editUser'      && <EditUserModal      user={modal.data}    onClose={closeModal} onSave={(d) => handleSave('editUser',      d)} />}
            {modal.type === 'editPackage'   && <EditPackageModal   pkg={modal.data}     onClose={closeModal} onSave={(d) => handleSave('editPackage',   d)} />}
            {modal.type === 'resetPassword' && <ResetPasswordModal user={modal.data}    onClose={closeModal} onSave={(d) => handleSave('resetPassword', d)} />}
            {modal.type === 'availability'  && <SetAvailabilityModal doctor={modal.data} onClose={closeModal} onSave={(d) => handleSave('availability',  d)} />}
            {modal.type === 'confirm'       && (
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

export default AdminDashboard;
