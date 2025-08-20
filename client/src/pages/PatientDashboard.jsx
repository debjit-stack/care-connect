import React, { useState, useEffect } from 'react';
import { getMyHistory } from '../api/patient';
import AppointmentHistory from '../components/patient/AppointmentHistory';
import PackageHistory from '../components/patient/PackageHistory';

const PatientDashboard = () => {
    const [history, setHistory] = useState({ appointments: [], packageBookings: [] });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const { data } = await getMyHistory();
                setHistory(data);
            } catch (error) {
                console.error("Failed to fetch patient history:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchHistory();
    }, []);

    if (loading) {
        return <p>Loading your dashboard...</p>;
    }

    return (
        <div>
            <h1 className="text-3xl font-bold mb-6">My Dashboard</h1>
            <div className="space-y-8">
                <AppointmentHistory appointments={history.appointments} />
                <PackageHistory packages={history.packageBookings} />
            </div>
        </div>
    );
};

export default PatientDashboard;