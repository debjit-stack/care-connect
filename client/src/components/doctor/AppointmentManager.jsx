import React, { useState, useEffect, useCallback } from 'react';
import { getMyAssignedAppointments } from '../../api/doctors';
import ConsultationModal from './ConsultationModal';

const AppointmentManager = () => {
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedAppointment, setSelectedAppointment] = useState(null);

    const fetchAppointments = useCallback(async () => {
        try {
            setLoading(true);
            const { data } = await getMyAssignedAppointments();
            setAppointments(data);
        } catch (error) {
            console.error("Failed to fetch appointments:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAppointments();
    }, [fetchAppointments]);

    const handleModalClose = () => {
        setSelectedAppointment(null);
        fetchAppointments(); // Refresh list after modal closes
    };

    if (loading) return <p>Loading appointments...</p>;

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-semibold mb-4">My Appointments</h2>
            <div className="overflow-x-auto">
                <table className="min-w-full bg-white">
                    <thead>
                        <tr>
                            <th className="py-2 px-4 border-b text-left">Patient</th>
                            <th className="py-2 px-4 border-b text-left">Date</th>
                            <th className="py-2 px-4 border-b text-left">Time</th>
                            <th className="py-2 px-4 border-b text-left">Status</th>
                            <th className="py-2 px-4 border-b text-left">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {appointments.map(app => (
                            <tr key={app._id} className="hover:bg-gray-50">
                                <td className="py-2 px-4 border-b">{app.patient.name}</td>
                                <td className="py-2 px-4 border-b">{new Date(app.appointmentDate).toLocaleDateString()}</td>
                                <td className="py-2 px-4 border-b">{app.appointmentTime}</td>
                                <td className="py-2 px-4 border-b">
                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${app.status === 'Scheduled' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                                        {app.status}
                                    </span>
                                </td>
                                <td className="py-2 px-4 border-b">
                                    <button onClick={() => setSelectedAppointment(app)} className="text-blue-500 hover:underline" disabled={app.status === 'Completed'}>
                                        {app.status === 'Completed' ? 'Viewed' : 'Open Consultation'}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {selectedAppointment && <ConsultationModal appointment={selectedAppointment} onClose={handleModalClose} />}
        </div>
    );
};

export default AppointmentManager;