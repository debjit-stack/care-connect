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
} from '../api/admin';
import { fetchPackages, createPackage, deletePackage, updatePackage } from '../api/packages';
import { useAuth } from '../context/AuthContext';

import StatsCard from '../components/admin/StatsCard';
import UserList from '../components/admin/UserList';
import DoctorList from '../components/admin/DoctorList';
import PatientList from '../components/admin/PatientList';
import PackageList from '../components/admin/PackageList';
import AddStaffModal from '../components/admin/modals/AddStaffModal';
import AddDoctorModal from '../components/admin/modals/AddDoctorModal';
import AddPackageModal from '../components/admin/modals/AddPackageModal';
import EditPackageModal from '../components/admin/modals/EditPackageModal';
import AddPatientModal from '../components/receptionist/AddPatientModal';
import EditUserModal from '../components/admin/modals/EditUserModal';
import ResetPasswordModal from '../components/admin/modals/ResetPasswordModal';
import SetAvailabilityModal from '../components/admin/modals/SetAvailabilityModal';
import ConfirmModal from '../components/common/ConfirmModal';

const AdminDashboard = () => {
    const { user: loggedInUser } = useAuth();
    const [stats, setStats] = useState(null);
    const [users, setUsers] = useState([]);
    // doctorProfiles = full Doctor documents { _id, user: {name,email}, specialty, availability, ... }
    const [doctorProfiles, setDoctorProfiles] = useState([]);
    const [packages, setPackages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [doctorSearch, setDoctorSearch] = useState('');
    const [patientSearch, setPatientSearch] = useState('');
    const [staffSearch, setStaffSearch] = useState('');

    const [modal, setModal] = useState({ type: null, data: null });
    const [activeTab, setActiveTab] = useState('doctors');

    const loadDashboardData = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            const [statsData, usersData, packagesData, doctorProfilesData] = await Promise.all([
                getDashboardStats(),
                getAllUsers(),
                fetchPackages(),
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

    useEffect(() => {
        loadDashboardData();
    }, [loadDashboardData]);

    const closeModal = () => setModal({ type: null, data: null });

    const handleSave = async (type, data) => {
        try {
            switch (type) {
                case 'staff': await createStaff(data); break;
                case 'doctor': await createDoctor(data); break;
                case 'patient': await registerPatientByAdmin(data); break;
                case 'package': await createPackage(data); break;
                case 'editUser': await updateUser(modal.data._id, data); break;
                case 'editPackage': await updatePackage(modal.data._id, data); break;
                case 'resetPassword': await resetPassword(modal.data._id, data.newPassword); break;
                // modal.data here is a Doctor document, so modal.data._id = Doctor._id ✓
                case 'availability': await updateDoctorAvailability(modal.data._id, data); break;
                default: break;
            }
            closeModal();
            loadDashboardData();
        } catch (err) {
            console.error(`Failed to save (${type}):`, err);
            alert(err?.response?.data?.message || 'Save failed. Please try again.');
        }
    };

    const handleDelete = (type, id) => {
        const confirmAction = async () => {
            try {
                if (type === 'user') await deleteUser(id);
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
                title: `Delete ${type}`,
                message: `Are you sure you want to delete this ${type}? This cannot be undone.`,
                onConfirm: confirmAction,
            },
        });
    };

    // DoctorList needs: _id (User._id for edit/delete/resetPw), name, email
    // BUT SetAvailabilityModal needs Doctor._id → we pass the Doctor document as `doctorProfile`
    // We enrich each doctor user with their Doctor profile
    const enrichedDoctors = useMemo(() => {
        return users
            .filter((u) => u.role === 'doctor')
            .map((u) => {
                const profile = doctorProfiles.find(
                    (dp) => dp.user && dp.user._id === u._id
                );
                return { ...u, doctorProfile: profile || null };
            });
    }, [users, doctorProfiles]);

    const filteredDoctors = useMemo(
        () =>
            enrichedDoctors.filter(
                (u) =>
                    u.name.toLowerCase().includes(doctorSearch.toLowerCase()) ||
                    u.email.toLowerCase().includes(doctorSearch.toLowerCase())
            ),
        [enrichedDoctors, doctorSearch]
    );

    const filteredPatients = useMemo(
        () =>
            users
                .filter((u) => u.role === 'patient')
                .filter(
                    (u) =>
                        u.name.toLowerCase().includes(patientSearch.toLowerCase()) ||
                        u.email.toLowerCase().includes(patientSearch.toLowerCase())
                ),
        [users, patientSearch]
    );

    const filteredStaff = useMemo(
        () =>
            users
                .filter((u) => u.role === 'admin' || u.role === 'receptionist')
                .filter(
                    (u) =>
                        u.name.toLowerCase().includes(staffSearch.toLowerCase()) ||
                        u.email.toLowerCase().includes(staffSearch.toLowerCase())
                ),
        [users, staffSearch]
    );

    if (loading) return <p>Loading Dashboard...</p>;

    const TabButton = ({ tabName, label }) => (
        <button
            onClick={() => setActiveTab(tabName)}
            className={`py-2 px-4 font-semibold rounded-t-lg ${
                activeTab === tabName
                    ? 'bg-white text-blue-600'
                    : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
            }`}
        >
            {label}
        </button>
    );

    return (
        <div>
            <h1 className="text-3xl font-bold mb-6">Admin Dashboard</h1>

            {error && (
                <p className="bg-red-100 text-red-700 p-3 rounded mb-4">{error}</p>
            )}

            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <StatsCard title="Total Patients" value={stats.kpi.totalPatients} />
                    <StatsCard title="Total Doctors" value={stats.kpi.totalDoctors} />
                    <StatsCard title="Total Appointments" value={stats.kpi.totalAppointments} />
                    <StatsCard
                        title="Simulated Revenue"
                        value={`₹${stats.kpi.totalRevenue.toLocaleString('en-IN')}`}
                    />
                </div>
            )}

            <div className="mt-8">
                <div className="flex space-x-2 border-b border-gray-300">
                    <TabButton tabName="doctors" label="Doctor Management" />
                    <TabButton tabName="patients" label="Patient Management" />
                    <TabButton tabName="staff" label="Staff Management" />
                    <TabButton tabName="packages" label="Health Packages" />
                </div>

                <div className="bg-white p-6 rounded-b-lg rounded-r-lg shadow-md">
                    {activeTab === 'doctors' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-2xl font-semibold">Doctors</h2>
                                <button
                                    onClick={() => setModal({ type: 'doctor' })}
                                    className="bg-purple-500 text-white py-2 px-4 rounded hover:bg-purple-600"
                                >
                                    Add Doctor
                                </button>
                            </div>
                            <input
                                type="text"
                                placeholder="Search doctors..."
                                value={doctorSearch}
                                onChange={(e) => setDoctorSearch(e.target.value)}
                                className="w-full p-2 border rounded mb-4"
                            />
                            <DoctorList
                                doctors={filteredDoctors}
                                onEdit={(user) => setModal({ type: 'editUser', data: user })}
                                onDelete={(id) => handleDelete('user', id)}
                                // Pass the Doctor document so SetAvailabilityModal gets Doctor._id
                                onSetAvailability={(user) => {
                                    if (!user.doctorProfile) {
                                        alert('Doctor profile not found. Please refresh.');
                                        return;
                                    }
                                    setModal({ type: 'availability', data: user.doctorProfile });
                                }}
                                onResetPassword={(user) =>
                                    setModal({ type: 'resetPassword', data: user })
                                }
                            />
                        </div>
                    )}

                    {activeTab === 'patients' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-2xl font-semibold">Patients</h2>
                                <button
                                    onClick={() => setModal({ type: 'patient' })}
                                    className="bg-cyan-500 text-white py-2 px-4 rounded hover:bg-cyan-600"
                                >
                                    Add Patient
                                </button>
                            </div>
                            <input
                                type="text"
                                placeholder="Search patients..."
                                value={patientSearch}
                                onChange={(e) => setPatientSearch(e.target.value)}
                                className="w-full p-2 border rounded mb-4"
                            />
                            <PatientList
                                patients={filteredPatients}
                                onEdit={(user) => setModal({ type: 'editUser', data: user })}
                                onDelete={(id) => handleDelete('user', id)}
                                onResetPassword={(user) =>
                                    setModal({ type: 'resetPassword', data: user })
                                }
                            />
                        </div>
                    )}

                    {activeTab === 'staff' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-2xl font-semibold">Staff</h2>
                                <button
                                    onClick={() => setModal({ type: 'staff' })}
                                    className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
                                >
                                    Add Staff
                                </button>
                            </div>
                            <input
                                type="text"
                                placeholder="Search staff..."
                                value={staffSearch}
                                onChange={(e) => setStaffSearch(e.target.value)}
                                className="w-full p-2 border rounded mb-4"
                            />
                            <UserList
                                users={filteredStaff}
                                loggedInUser={loggedInUser}
                                onEdit={(user) => setModal({ type: 'editUser', data: user })}
                                onDelete={(id) => handleDelete('user', id)}
                                onResetPassword={(user) =>
                                    setModal({ type: 'resetPassword', data: user })
                                }
                            />
                        </div>
                    )}

                    {activeTab === 'packages' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-2xl font-semibold">Health Packages</h2>
                                <button
                                    onClick={() => setModal({ type: 'package' })}
                                    className="bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600"
                                >
                                    Add Package
                                </button>
                            </div>
                            <PackageList
                                packages={packages}
                                onEdit={(pkg) => setModal({ type: 'editPackage', data: pkg })}
                                onDelete={(id) => handleDelete('package', id)}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Modals */}
            {modal.type === 'staff' && (
                <AddStaffModal onClose={closeModal} onSave={(d) => handleSave('staff', d)} />
            )}
            {modal.type === 'doctor' && (
                <AddDoctorModal onClose={closeModal} onSave={(d) => handleSave('doctor', d)} />
            )}
            {modal.type === 'patient' && (
                <AddPatientModal onClose={closeModal} onSave={(d) => handleSave('patient', d)} />
            )}
            {modal.type === 'package' && (
                <AddPackageModal onClose={closeModal} onSave={(d) => handleSave('package', d)} />
            )}
            {modal.type === 'editUser' && (
                <EditUserModal
                    user={modal.data}
                    onClose={closeModal}
                    onSave={(d) => handleSave('editUser', d)}
                />
            )}
            {modal.type === 'editPackage' && (
                <EditPackageModal
                    pkg={modal.data}
                    onClose={closeModal}
                    onSave={(d) => handleSave('editPackage', d)}
                />
            )}
            {modal.type === 'resetPassword' && (
                <ResetPasswordModal
                    user={modal.data}
                    onClose={closeModal}
                    onSave={(d) => handleSave('resetPassword', d)}
                />
            )}
            {modal.type === 'availability' && (
                // modal.data is now a Doctor document with real _id and availability[]
                <SetAvailabilityModal
                    doctor={modal.data}
                    onClose={closeModal}
                    onSave={(d) => handleSave('availability', d)}
                />
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

export default AdminDashboard;