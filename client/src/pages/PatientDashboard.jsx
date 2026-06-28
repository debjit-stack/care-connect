import React, { useState, useEffect } from 'react';
import { getMyHistory } from '../api/patient';
import AppointmentHistory from '../components/patient/AppointmentHistory';
import PackageHistory from '../components/patient/PackageHistory';

/**
 * FIX #18: The catch block previously only called console.error, leaving the
 * user looking at an empty / perpetually-loading dashboard on API failure.
 * We now track an error string and render a visible message with a retry
 * button so the user knows what went wrong.
 */
const PatientDashboard = () => {
    const [history, setHistory] = useState({ appointments: [], packageBookings: [] });
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState('');

    const fetchHistory = async () => {
        setLoading(true);
        setError('');
        try {
            const { data } = await getMyHistory();
            setHistory(data);
        } catch (err) {
            console.error('Failed to fetch patient history:', err);
            setError(
                err?.response?.data?.message ||
                'Failed to load your dashboard. Please check your connection.'
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchHistory();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
                <span className="ml-3 text-gray-500">Loading your dashboard…</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-20">
                <p className="text-red-600 font-semibold mb-4">{error}</p>
                <button
                    onClick={fetchHistory}
                    className="bg-blue-500 text-white py-2 px-6 rounded hover:bg-blue-600"
                >
                    Retry
                </button>
            </div>
        );
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
