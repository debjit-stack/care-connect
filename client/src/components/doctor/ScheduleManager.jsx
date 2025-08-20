import React, { useState, useEffect } from 'react';
import { updateMyAvailability } from '../../api/doctors';
// We need a way to get the doctor's own profile, including current availability
// This might require a new API endpoint like GET /api/doctors/my-profile
// For now, we will simulate it. A real implementation would fetch this.

const ScheduleManager = () => {
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    // In a real app, this initial state would be fetched from the backend.
    const [availability, setAvailability] = useState([]); 
    const [message, setMessage] = useState('');

    // TODO: Add a useEffect to fetch the doctor's current availability and populate the state.

    const handleTimeChange = (day, field, value) => {
        const updatedAvailability = [...availability];
        let daySchedule = updatedAvailability.find(d => d.day === day);
        if (daySchedule) {
            daySchedule[field] = value;
        } else {
            updatedAvailability.push({ day, [field]: value });
        }
        setAvailability(updatedAvailability.filter(d => d.startTime && d.endTime)); // Keep only complete entries
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage('');
        try {
            await updateMyAvailability(availability);
            setMessage('Availability updated successfully!');
        } catch (error) {
            setMessage('Failed to update availability.');
            console.error(error);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-semibold mb-4">Manage My Weekly Schedule</h2>
            {message && <p className="mb-4 text-green-600">{message}</p>}
            <form onSubmit={handleSubmit}>
                <div className="space-y-4">
                    {daysOfWeek.map(day => {
                        const schedule = availability.find(d => d.day === day) || {};
                        return (
                            <div key={day} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                                <label className="font-semibold">{day}</label>
                                <input type="time" value={schedule.startTime || ''} onChange={(e) => handleTimeChange(day, 'startTime', e.target.value)} className="p-2 border rounded" />
                                <input type="time" value={schedule.endTime || ''} onChange={(e) => handleTimeChange(day, 'endTime', e.target.value)} className="p-2 border rounded" />
                            </div>
                        );
                    })}
                </div>
                <div className="flex justify-end mt-8">
                    <button type="submit" className="bg-blue-500 text-white py-2 px-6 rounded hover:bg-blue-600">Save Changes</button>
                </div>
            </form>
        </div>
    );
};

export default ScheduleManager;