import React, { useState, useEffect } from 'react';
import PatientSearch from './PatientSearch';
import { fetchDoctors, fetchDoctorAvailability } from '../../api/doctors';

const BookAppointmentModal = ({ onClose, onSave }) => {
    const [step, setStep] = useState(1);
    const [selectedPatient, setSelectedPatient] = useState(null);
    const [doctors, setDoctors] = useState([]);
    const [selectedDoctor, setSelectedDoctor] = useState('');
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [availability, setAvailability] = useState([]);

    useEffect(() => {
        const getDoctors = async () => {
            const { data } = await fetchDoctors();
            setDoctors(data);
        };
        getDoctors();
    }, []);

    useEffect(() => {
        const getAvailability = async () => {
            if (selectedDoctor && selectedDate) {
                const { data } = await fetchDoctorAvailability(selectedDoctor, selectedDate);
                setAvailability(data);
            }
        };
        getAvailability();
    }, [selectedDoctor, selectedDate]);

    const handleSave = (slot) => {
        const bookingData = {
            patientId: selectedPatient._id,
            doctorId: selectedDoctor,
            appointmentDate: selectedDate,
            appointmentTime: slot
        };
        onSave(bookingData);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-lg">
                <h2 className="text-2xl font-bold mb-6">Book Offline Appointment</h2>
                
                {/* Step 1: Select Patient */}
                {step === 1 && (
                    <div>
                        <label className="block text-gray-700 mb-2">Search and Select Patient</label>
                        <PatientSearch onPatientSelect={setSelectedPatient} />
                        {selectedPatient && <p className="mt-2 text-green-600">Selected: {selectedPatient.name}</p>}
                        <div className="flex justify-end mt-6">
                            <button onClick={() => setStep(2)} disabled={!selectedPatient} className="bg-blue-500 text-white py-2 px-4 rounded disabled:bg-gray-400">Next</button>
                        </div>
                    </div>
                )}

                {/* Step 2: Select Doctor and Slot */}
                {step === 2 && (
                    <div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-gray-700 mb-2">Select Doctor</label>
                                <select value={selectedDoctor} onChange={(e) => setSelectedDoctor(e.target.value)} className="w-full p-2 border rounded">
                                    <option value="">Choose a doctor</option>
                                    {doctors.map(doc => <option key={doc._id} value={doc._id}>{doc.user.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-gray-700 mb-2">Select Date</label>
                                <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-full p-2 border rounded" />
                            </div>
                        </div>
                        <div className="mt-4">
                            <h3 className="font-semibold mb-2">Available Slots</h3>
                            <div className="grid grid-cols-4 gap-2">
                                {availability.length > 0 ? availability.map(slot => (
                                    <button key={slot} onClick={() => handleSave(slot)} className="bg-green-500 text-white p-2 rounded hover:bg-green-600">{slot}</button>
                                )) : <p>No slots available.</p>}
                            </div>
                        </div>
                        <div className="flex justify-between mt-6">
                            <button onClick={() => setStep(1)} className="bg-gray-300 text-gray-800 py-2 px-4 rounded">Back</button>
                            <button onClick={onClose} className="bg-red-500 text-white py-2 px-4 rounded">Cancel</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BookAppointmentModal;
