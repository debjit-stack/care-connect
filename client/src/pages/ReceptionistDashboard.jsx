// =================================================================
// >> G-ll: client/src/pages/ReceptionistDashboard.jsx
// UPDATED - To include the new "Book Health Package" button and its modal.
// =================================================================
import React, { useState, useEffect, useCallback } from 'react';
import { getAppointmentsByDate, registerPatientByReceptionist, bookOfflineAppointment, bookPackageForPatient } from '../api/receptionist';
import DailySchedule from '../components/receptionist/DailySchedule';
import BookAppointmentModal from '../components/receptionist/BookAppointmentModal';
import AddPatientModal from '../components/receptionist/AddPatientModal';
import BookPackageModal from '../components/receptionist/BookPackageModal'; // <-- NEW IMPORT

const ReceptionistDashboard = () => {
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    
    // Modal states
    const [isBookingModalOpen, setBookingModalOpen] = useState(false);
    const [isPatientModalOpen, setPatientModalOpen] = useState(false);
    const [isPackageModalOpen, setPackageModalOpen] = useState(false); // <-- NEW STATE

    const fetchAppointments = useCallback(async () => {
        try {
            setLoading(true);
            const { data } = await getAppointmentsByDate(selectedDate);
            setAppointments(data);
        } catch (error) {
            console.error("Failed to fetch appointments:", error);
        } finally {
            setLoading(false);
        }
    }, [selectedDate]);

    useEffect(() => {
        fetchAppointments();
    }, [fetchAppointments]);
    
    const handleAppointmentSave = async (bookingData) => {
        try {
            await bookOfflineAppointment(bookingData);
            setBookingModalOpen(false);
            fetchAppointments(); // Refresh the schedule
        } catch (error) {
            console.error("Failed to book appointment:", error);
        }
    };

    const handlePatientSave = async (patientData) => {
        try {
            await registerPatientByReceptionist(patientData);
            setPatientModalOpen(false);
        } catch (error) {
            console.error("Failed to register patient:", error);
        }
    };

    const handlePackageSave = async (packageBookingData) => {
        try {
            await bookPackageForPatient(packageBookingData);
            setPackageModalOpen(false);
            // You might want to add a success message here
        } catch (error) {
            console.error("Failed to book package:", error);
        }
    };

    return (
        <div>
            <h1 className="text-3xl font-bold mb-6">Receptionist Dashboard</h1>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Actions */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white p-6 rounded-lg shadow-md">
                        <h2 className="text-xl font-semibold mb-4">Actions</h2>
                        <div className="space-y-4">
                           <button onClick={() => setPatientModalOpen(true)} className="w-full bg-blue-500 text-white py-3 rounded-lg hover:bg-blue-600">Register New Patient</button>
                           <button onClick={() => setBookingModalOpen(true)} className="w-full bg-green-500 text-white py-3 rounded-lg hover:bg-green-600">Book Appointment</button>
                           <button onClick={() => setPackageModalOpen(true)} className="w-full bg-purple-500 text-white py-3 rounded-lg hover:bg-purple-600">Book Health Package</button>
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

            {isPatientModalOpen && <AddPatientModal onClose={() => setPatientModalOpen(false)} onSave={handlePatientSave} />}
            {isBookingModalOpen && <BookAppointmentModal onClose={() => setBookingModalOpen(false)} onSave={handleAppointmentSave} />}
            {isPackageModalOpen && <BookPackageModal onClose={() => setPackageModalOpen(false)} onSave={handlePackageSave} />}
        </div>
    );
};

export default ReceptionistDashboard;