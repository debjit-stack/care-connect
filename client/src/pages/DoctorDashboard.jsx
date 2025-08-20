import React, { useState } from 'react';
import AppointmentManager from '../components/doctor/AppointmentManager';
import ScheduleManager from '../components/doctor/ScheduleManager';

const DoctorDashboard = () => {
    const [activeTab, setActiveTab] = useState('appointments');

    return (
        <div>
            <h1 className="text-3xl font-bold mb-6">Doctor Dashboard</h1>
            <div className="flex border-b mb-6">
                <button
                    onClick={() => setActiveTab('appointments')}
                    className={`py-2 px-6 text-lg ${activeTab === 'appointments' ? 'border-b-2 border-blue-500 font-semibold text-blue-600' : 'text-gray-500'}`}
                >
                    Appointments
                </button>
                <button
                    onClick={() => setActiveTab('schedule')}
                    className={`py-2 px-6 text-lg ${activeTab === 'schedule' ? 'border-b-2 border-blue-500 font-semibold text-blue-600' : 'text-gray-500'}`}
                >
                    My Schedule
                </button>
            </div>

            {activeTab === 'appointments' && <AppointmentManager />}
            {activeTab === 'schedule' && <ScheduleManager />}
        </div>
    );
};

export default DoctorDashboard;