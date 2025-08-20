import React, { useState, useEffect } from 'react';

const SetAvailabilityModal = ({ doctor, onClose, onSave }) => {
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const [availability, setAvailability] = useState([]);

    useEffect(() => {
        // Find the doctor's full profile to get their current availability
        // This assumes the `doctor` prop passed in has the `availability` array
        // A more robust solution might fetch the full doctor profile here
        setAvailability(doctor.availability || []);
    }, [doctor]);

    const handleTimeChange = (day, field, value) => {
        const updatedAvailability = [...availability];
        let daySchedule = updatedAvailability.find(d => d.day === day);
        if (daySchedule) {
            daySchedule[field] = value;
        } else {
            updatedAvailability.push({ day, [field]: value });
        }
        setAvailability(updatedAvailability);
    };
    
    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(availability);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-lg">
                <h2 className="text-2xl font-bold mb-6">Set Availability for {doctor.name}</h2>
                <form onSubmit={handleSubmit}>
                    <div className="space-y-4">
                        {daysOfWeek.map(day => {
                            const schedule = availability.find(d => d.day === day) || {};
                            return (
                                <div key={day} className="grid grid-cols-3 gap-4 items-center">
                                    <label className="font-semibold">{day}</label>
                                    <input type="time" value={schedule.startTime || ''} onChange={(e) => handleTimeChange(day, 'startTime', e.target.value)} className="p-2 border rounded" />
                                    <input type="time" value={schedule.endTime || ''} onChange={(e) => handleTimeChange(day, 'endTime', e.target.value)} className="p-2 border rounded" />
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex justify-end space-x-4 mt-8">
                        <button type="button" onClick={onClose} className="bg-gray-300 text-gray-800 py-2 px-4 rounded">Cancel</button>
                        <button type="submit" className="bg-green-500 text-white py-2 px-4 rounded">Save Availability</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SetAvailabilityModal;
