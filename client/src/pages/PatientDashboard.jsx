import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getMyHistory } from '../api/patient';
import AppointmentHistory   from '../components/patient/AppointmentHistory';
import PackageHistory       from '../components/patient/PackageHistory';
import UpcomingAppointments from '../components/patient/UpcomingAppointments';

const TABS = [
    { key: 'overview', label: 'Overview',  icon: '🏠' },
    { key: 'history',  label: 'History',   icon: '📋' },
    { key: 'packages', label: 'Packages',  icon: '📦' },
];

const PatientDashboard = () => {
    const [history,   setHistory]   = useState({ appointments: [], packageBookings: [] });
    const [loading,   setLoading]   = useState(true);
    const [error,     setError]     = useState('');
    const [activeTab, setActiveTab] = useState('overview');

    const fetchHistory = useCallback(async () => {
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
    }, []);

    useEffect(() => { fetchHistory(); }, [fetchHistory]);

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

    const upcomingCount = history.appointments.filter((a) => a.status === 'Scheduled').length;

    return (
        <div>
            <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
                <h1 className="text-3xl font-bold">My Dashboard</h1>
                <Link
                    to="/patient/profile"
                    className="flex items-center gap-1.5 text-sm bg-white border border-gray-200 hover:border-blue-300 hover:text-blue-600 text-gray-600 font-medium py-2 px-4 rounded-lg transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    My Profile
                </Link>
            </div>

            {/* Tab navigation */}
            <div className="flex gap-1 border-b border-gray-200 mb-6">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`flex items-center gap-1.5 py-2 px-4 font-medium text-sm rounded-t-lg transition-colors ${
                            activeTab === tab.key
                                ? 'bg-white text-blue-600 border-b-2 border-blue-500'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <span>{tab.icon}</span>
                        {tab.label}
                        {tab.key === 'overview' && upcomingCount > 0 && (
                            <span className="ml-1 bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded-full">
                                {upcomingCount}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div className="space-y-8">
                {activeTab === 'overview' && (
                    <UpcomingAppointments
                        appointments={history.appointments}
                        onCancelled={fetchHistory}
                    />
                )}

                {activeTab === 'history' && (
                    <AppointmentHistory appointments={history.appointments} />
                )}

                {activeTab === 'packages' && (
                    <PackageHistory packages={history.packageBookings} />
                )}
            </div>
        </div>
    );
};

export default PatientDashboard;
