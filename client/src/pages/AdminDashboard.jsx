import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getDashboardStats, getAllUsers, deleteUser, createStaff, createDoctor, updateUser, registerPatientByAdmin, updateDoctorAvailability, resetPassword } from '../api/admin';
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
    const [packages, setPackages] = useState([]);
    const [loading, setLoading] = useState(true);
    
    const [doctorSearch, setDoctorSearch] = useState('');
    const [patientSearch, setPatientSearch] = useState('');
    const [staffSearch, setStaffSearch] = useState('');

    const [modal, setModal] = useState({ type: null, data: null });
    const [activeTab, setActiveTab] = useState('doctors');

    const loadDashboardData = useCallback(async () => {
        try {
            setLoading(true);
            const [statsData, usersData, packagesData] = await Promise.all([
                getDashboardStats(),
                getAllUsers(),
                fetchPackages()
            ]);
            setStats(statsData.data);
            setUsers(usersData.data);
            setPackages(packagesData.data);
        } catch (error) {
            console.error("Failed to load dashboard data:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDashboardData();
    }, [loadDashboardData]);

    const handleSave = async (type, data) => {
        switch (type) {
            case 'staff': await createStaff(data); break;
            case 'doctor': await createDoctor(data); break;
            case 'patient': await registerPatientByAdmin(data); break;
            case 'package': await createPackage(data); break;
            case 'editUser': await updateUser(modal.data._id, data); break;
            case 'editPackage': await updatePackage(modal.data._id, data); break;
            case 'resetPassword': await resetPassword(modal.data._id, data.newPassword); break;
            case 'availability': await updateDoctorAvailability(modal.data._id, data); break;
            default: break;
        }
        setModal({ type: null, data: null });
        loadDashboardData();
    };

    const handleDelete = (type, id) => {
        const confirmAction = async () => {
            if (type === 'user') await deleteUser(id);
            if (type === 'package') await deletePackage(id);
            setModal({ type: null, data: null });
            loadDashboardData();
        };
        setModal({ type: 'confirm', data: { title: `Delete ${type}`, message: 'Are you sure?', onConfirm: confirmAction } });
    };

    const filteredDoctors = useMemo(() => 
        users.filter(u => u.role === 'doctor' && (u.name.toLowerCase().includes(doctorSearch.toLowerCase()) || u.email.toLowerCase().includes(doctorSearch.toLowerCase()))),
        [users, doctorSearch]
    );

    const filteredPatients = useMemo(() =>
        users.filter(u => u.role === 'patient' && (u.name.toLowerCase().includes(patientSearch.toLowerCase()) || u.email.toLowerCase().includes(patientSearch.toLowerCase()))),
        [users, patientSearch]
    );

    const filteredStaff = useMemo(() =>
        users.filter(u => (u.role === 'admin' || u.role === 'receptionist') && (u.name.toLowerCase().includes(staffSearch.toLowerCase()) || u.email.toLowerCase().includes(staffSearch.toLowerCase()))),
        [users, staffSearch]
    );


    if (loading) return <p>Loading Dashboard...</p>;

    const TabButton = ({ tabName, label }) => (
        <button
            onClick={() => setActiveTab(tabName)}
            className={`py-2 px-4 font-semibold rounded-t-lg ${activeTab === tabName ? 'bg-white text-blue-600' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
        >
            {label}
        </button>
    );

    return (
        <div>
            <h1 className="text-3xl font-bold mb-6">Admin Dashboard</h1>
            {stats && (
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <StatsCard title="Total Patients" value={stats.kpi.totalPatients} />
                    <StatsCard title="Total Doctors" value={stats.kpi.totalDoctors} />
                    <StatsCard title="Total Appointments" value={stats.kpi.totalAppointments} />
                    <StatsCard title="Simulated Revenue" value={`₹${stats.kpi.totalRevenue.toLocaleString('en-IN')}`} />
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
                                <button onClick={() => setModal({ type: 'doctor' })} className="bg-purple-500 text-white py-2 px-4 rounded hover:bg-purple-600">Add Doctor</button>
                            </div>
                            <input type="text" placeholder="Search doctors..." value={doctorSearch} onChange={(e) => setDoctorSearch(e.target.value)} className="w-full p-2 border rounded mb-4" />
                            <DoctorList 
                                doctors={filteredDoctors} 
                                onEdit={(user) => setModal({ type: 'editUser', data: user })} 
                                onDelete={(id) => handleDelete('user', id)} 
                                onSetAvailability={(doctor) => setModal({ type: 'availability', data: doctor })}
                                onResetPassword={(user) => setModal({ type: 'resetPassword', data: user })}
                            />
                        </div>
                    )}

                    {activeTab === 'patients' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-2xl font-semibold">Patients</h2>
                                <button onClick={() => setModal({ type: 'patient' })} className="bg-cyan-500 text-white py-2 px-4 rounded hover:bg-cyan-600">Add Patient</button>
                            </div>
                            <input type="text" placeholder="Search patients..." value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} className="w-full p-2 border rounded mb-4" />
                            <PatientList 
                                patients={filteredPatients} 
                                onEdit={(user) => setModal({ type: 'editUser', data: user })} 
                                onDelete={(id) => handleDelete('user', id)}
                                onResetPassword={(user) => setModal({ type: 'resetPassword', data: user })}
                            />
                        </div>
                    )}

                    {activeTab === 'staff' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-2xl font-semibold">Staff</h2>
                                <button onClick={() => setModal({ type: 'staff' })} className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600">Add Staff</button>
                            </div>
                            <input type="text" placeholder="Search staff..." value={staffSearch} onChange={(e) => setStaffSearch(e.target.value)} className="w-full p-2 border rounded mb-4" />
                            <UserList 
                                users={filteredStaff} 
                                loggedInUser={loggedInUser} 
                                onEdit={(user) => setModal({ type: 'editUser', data: user })} 
                                onDelete={(id) => handleDelete('user', id)}
                                onResetPassword={(user) => setModal({ type: 'resetPassword', data: user })}
                            />
                        </div>
                    )}

                    {activeTab === 'packages' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-2xl font-semibold">Health Packages</h2>
                                <button onClick={() => setModal({ type: 'package' })} className="bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600">Add Package</button>
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
            {modal.type === 'staff' && <AddStaffModal onClose={() => setModal({ type: null })} onSave={(data) => handleSave('staff', data)} />}
            {modal.type === 'doctor' && <AddDoctorModal onClose={() => setModal({ type: null })} onSave={(data) => handleSave('doctor', data)} />}
            {modal.type === 'patient' && <AddPatientModal onClose={() => setModal({ type: null })} onSave={(data) => handleSave('patient', data)} />}
            {modal.type === 'package' && <AddPackageModal onClose={() => setModal({ type: null })} onSave={(data) => handleSave('package', data)} />}
            {modal.type === 'editUser' && <EditUserModal user={modal.data} onClose={() => setModal({ type: null })} onSave={(data) => handleSave('editUser', data)} />}
            {modal.type === 'editPackage' && <EditPackageModal pkg={modal.data} onClose={() => setModal({ type: null })} onSave={(data) => handleSave('editPackage', data)} />}
            {modal.type === 'resetPassword' && <ResetPasswordModal user={modal.data} onClose={() => setModal({ type: null })} onSave={(data) => handleSave('resetPassword', data)} />}
            {modal.type === 'availability' && <SetAvailabilityModal doctor={modal.data} onClose={() => setModal({ type: null })} onSave={(data) => handleSave('availability', data)} />}
            {modal.type === 'confirm' && <ConfirmModal title={modal.data.title} message={modal.data.message} onConfirm={modal.data.onConfirm} onCancel={() => setModal({ type: null })} />}
        </div>
    );
};

export default AdminDashboard;