import React, { useState, useEffect } from 'react';
import { updateMyAvailability } from '../../api/doctors';
import API from '../../api/index.js';

const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const ScheduleManager = () => {
    const [availability, setAvailability] = useState(
        daysOfWeek.map((day) => ({ day, startTime: '', endTime: '' }))
    );
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchMyProfile = async () => {
            try {
                // Reuse the doctor appointments endpoint to get doctor profile
                // Actually we need a /api/doctors/my-profile — use my-appointments
                // to get the doctor's profile id, then fetch availability from it
                // Best approach: add GET /api/doctors/my-profile on backend
                // For now, call the my-appointments endpoint and pull the doctor id,
                // then fetch the doctor by id to get availability
                const apptRes = await API.get('/doctors/my-appointments');
                if (apptRes.data && apptRes.data.length > 0) {
                    const doctorId = apptRes.data[0].doctor;
                    const profileRes = await API.get(`/doctors/${doctorId}`);
                    const existingAvailability = profileRes.data.availability || [];
                    setAvailability(
                        daysOfWeek.map((day) => {
                            const existing = existingAvailability.find(
                                (a) => a.day.toLowerCase() === day.toLowerCase()
                            );
                            return { day, startTime: existing?.startTime || '', endTime: existing?.endTime || '' };
                        })
                    );
                } else {
                    // No appointments yet — try fetching profile via my-availability endpoint
                    // We'll just show empty schedule which is fine for new doctors
                    setAvailability(daysOfWeek.map((day) => ({ day, startTime: '', endTime: '' })));
                }
            } catch (err) {
                console.error('Could not load current schedule:', err);
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
        // Only send days that have both start and end time set
        const toSave = availability.filter((d) => d.startTime && d.endTime);
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
                <p
                    className={`mb-4 font-semibold ${
                        message.includes('Failed') ? 'text-red-600' : 'text-green-600'
                    }`}
                >
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