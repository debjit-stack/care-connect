import React, { useState, useEffect } from 'react';
import { updateMyAvailability } from '../../api/doctors';
import API from '../../api/index.js';

const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const emptySchedule = () =>
    daysOfWeek.map((day) => ({ day, startTime: '', endTime: '' }));

const ScheduleManager = () => {
    const [availability, setAvailability] = useState(emptySchedule());
    const [message,  setMessage]  = useState('');
    const [loading,  setLoading]  = useState(true);

    useEffect(() => {
        const fetchMyProfile = async () => {
            try {
                // M8 FIX: call /api/doctors/my-profile directly — do not rely on
                // the first appointment to find the doctor's own profile ID.
                // This works for brand-new doctors with zero appointments.
                const { data } = await API.get('/doctors/my-profile');
                const existingAvailability = data.availability || [];

                setAvailability(
                    daysOfWeek.map((day) => {
                        const existing = existingAvailability.find(
                            (a) => a.day.toLowerCase() === day.toLowerCase()
                        );
                        return {
                            day,
                            startTime: existing?.startTime || '',
                            endTime:   existing?.endTime   || '',
                        };
                    })
                );
            } catch (err) {
                console.error('Could not load current schedule:', err);
                // Show empty schedule — doctor can still save new availability
                setAvailability(emptySchedule());
            } finally {
                setLoading(false);
            }
        };

        fetchMyProfile();
    }, []);

    const handleTimeChange = (day, field, value) => {
        setAvailability((prev) =>
            prev.map((entry) =>
                entry.day === day ? { ...entry, [field]: value } : entry
            )
        );
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage('');

        // Only submit days that have BOTH start and end time set
        const toSave = availability.filter((d) => d.startTime && d.endTime);

        // Validate start < end for each filled day
        for (const entry of toSave) {
            if (entry.startTime >= entry.endTime) {
                setMessage(`Start time must be before end time for ${entry.day}.`);
                return;
            }
        }

        try {
            await updateMyAvailability(toSave);
            setMessage('Availability updated successfully!');
        } catch (error) {
            setMessage('Failed to update availability. Please try again.');
            console.error(error);
        }
    };

    if (loading) return <p>Loading your schedule...</p>;

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-semibold mb-4">Manage My Weekly Schedule</h2>
            <p className="text-sm text-gray-500 mb-4">
                Leave start/end time blank for days you are not available.
            </p>

            {message && (
                <p className={`mb-4 font-semibold ${message.includes('Failed') || message.includes('must be') ? 'text-red-600' : 'text-green-600'}`}>
                    {message}
                </p>
            )}

            <form onSubmit={handleSubmit}>
                <div className="space-y-4">
                    {availability.map(({ day, startTime, endTime }) => (
                        <div key={day} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                            <label className="font-semibold">{day}</label>
                            <div>
                                <label className="text-xs text-gray-500">Start Time</label>
                                <input
                                    type="time"
                                    value={startTime}
                                    onChange={(e) => handleTimeChange(day, 'startTime', e.target.value)}
                                    className="p-2 border rounded w-full"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-500">End Time</label>
                                <input
                                    type="time"
                                    value={endTime}
                                    onChange={(e) => handleTimeChange(day, 'endTime', e.target.value)}
                                    className="p-2 border rounded w-full"
                                />
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex justify-end mt-8">
                    <button
                        type="submit"
                        className="bg-blue-500 text-white py-2 px-6 rounded hover:bg-blue-600"
                    >
                        Save Changes
                    </button>
                </div>
            </form>
        </div>
    );
};

export default ScheduleManager;
