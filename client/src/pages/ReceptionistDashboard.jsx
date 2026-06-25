import React, { useState, useEffect, useCallback } from 'react';
import {
    getAppointmentsByDate,
    registerPatientByReceptionist,
    bookOfflineAppointment,
    bookPackageForPatient,
} from '../api/receptionist';
import DailySchedule       from '../components/receptionist/DailySchedule';
import BookAppointmentModal from '../components/receptionist/BookAppointmentModal';
import AddPatientModal      from '../components/receptionist/AddPatientModal';
import BookPackageModal     from '../components/receptionist/BookPackageModal';

// L5 FIX: simple toast component for visible user feedback
const Toast = ({ message, type, onClose }) => {
    if (!message) return null;
    const colors = type === 'success'
        ? 'bg-green-100 border-green-400 text-green-800'
        : 'bg-red-100 border-red-400 text-red-800';
    return (
        <div className={`fixed top-4 right-4 z-50 border px-4 py-3 rounded shadow-lg flex items-center gap-3 ${colors}`}>
            <span>{message}</span>
            <button onClick={onClose} className="font-bold text-lg leading-none">&times;</button>
        </div>
    );
};

const ReceptionistDashboard = () => {
    const [selectedDate,  setSelectedDate]  = useState(new Date().toISOString().split('T')[0]);
    const [appointments,  setAppointments]  = useState([]);
    const [loading,       setLoading]       = useState(true);
    const [toast,         setToast]         = useState({ message: '', type: 'success' });

    const [isBookingModalOpen, setBookingModalOpen] = useState(false);
    const [isPatientModalOpen, setPatientModalOpen] = useState(false);
    const [isPackageModalOpen, setPackageModalOpen] = useState(false);

    // L5 FIX: helper to show a toast that auto-dismisses after 4 seconds
    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast({ message: '', type: 'success' }), 4000);
    };

    const fetchAppointments = useCallback(async () => {
        try {
            setLoading(true);
            const { data } = await getAppointmentsByDate(selectedDate);
            setAppointments(data);
        } catch (error) {
            showToast('Failed to load schedule. Please refresh.', 'error');
        } finally {
            setLoading(false);
        }
    }, [selectedDate]);

    useEffect(() => {
        fetchAppointments();
    }, [fetchAppointments]);

    // L5 FIX: all handlers now surface errors to the user via toast
    const handleAppointmentSave = async (bookingData) => {
        try {
            await bookOfflineAppointment(bookingData);
            setBookingModalOpen(false);
            showToast('Appointment booked successfully.');
            fetchAppointments();
        } catch (error) {
            const msg = error?.response?.data?.message || 'Failed to book appointment.';
            showToast(msg, 'error');
        }
    };

    const handlePatientSave = async (patientData) => {
        try {
            await registerPatientByReceptionist(patientData);
            setPatientModalOpen(false);
            showToast('Patient registered successfully.');
        } catch (error) {
            const msg = error?.response?.data?.message || 'Failed to register patient.';
            showToast(msg, 'error');
        }
    };

    const handlePackageSave = async (packageBookingData) => {
        try {
            await bookPackageForPatient(packageBookingData);
            setPackageModalOpen(false);
            showToast('Health package booked successfully.');
        } catch (error) {
            const msg = error?.response?.data?.message || 'Failed to book package.';
            showToast(msg, 'error');
        }
    };

    return (
        <div>
            <Toast
                message={toast.message}
                type={toast.type}
                onClose={() => setToast({ message: '', type: 'success' })}
            />

            <h1 className="text-3xl font-bold mb-6">Receptionist Dashboard</h1>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Actions */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white p-6 rounded-lg shadow-md">
                        <h2 className="text-xl font-semibold mb-4">Actions</h2>
                        <div className="space-y-4">
                            <button
                                onClick={() => setPatientModalOpen(true)}
                                className="w-full bg-blue-500 text-white py-3 rounded-lg hover:bg-blue-600"
                            >
                                Register New Patient
                            </button>
                            <button
                                onClick={() => setBookingModalOpen(true)}
                                className="w-full bg-green-500 text-white py-3 rounded-lg hover:bg-green-600"
                            >
                                Book Appointment
                            </button>
                            <button
                                onClick={() => setPackageModalOpen(true)}
                                className="w-full bg-purple-500 text-white py-3 rounded-lg hover:bg-purple-600"
                            >
                                Book Health Package
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right Column: Daily Schedule */}
                <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-md">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold">Daily Schedule</h2>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="p-2 border rounded"
                        />
                    </div>
                    {loading ? <p>Loading schedule...</p> : <DailySchedule appointments={appointments} />}
                </div>
            </div>

            {isPatientModalOpen && (
                <AddPatientModal
                    onClose={() => setPatientModalOpen(false)}
                    onSave={handlePatientSave}
                />
            )}
            {isBookingModalOpen && (
                <BookAppointmentModal
                    onClose={() => setBookingModalOpen(false)}
                    onSave={handleAppointmentSave}
                />
            )}
            {isPackageModalOpen && (
                <BookPackageModal
                    onClose={() => setPackageModalOpen(false)}
                    onSave={handlePackageSave}
                />
            )}
        </div>
    );
};

export default ReceptionistDashboard;
