import React, { useState, useEffect } from 'react';
import PatientSearch from './PatientSearch';
import { fetchPackages } from '../../api/packages';

const BookPackageModal = ({ onClose, onSave }) => {
    const [step, setStep] = useState(1);
    const [selectedPatient, setSelectedPatient] = useState(null);
    const [packages, setPackages] = useState([]);
    const [selectedPackage, setSelectedPackage] = useState('');

    useEffect(() => {
        const getPackages = async () => {
            const { data } = await fetchPackages();
            setPackages(data);
        };
        getPackages();
    }, []);
    
    const handleSave = () => {
        if (!selectedPatient || !selectedPackage) {
            alert("Please select a patient and a package.");
            return;
        }
        const bookingData = {
            patientId: selectedPatient._id,
            packageId: selectedPackage,
        };
        onSave(bookingData);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-lg">
                <h2 className="text-2xl font-bold mb-6">Book Health Package</h2>
                
                {/* Step 1: Select Patient */}
                {step === 1 && (
                    <div>
                        <label className="block text-gray-700 mb-2">Search and Select Patient</label>
                        <PatientSearch onPatientSelect={setSelectedPatient} />
                        {selectedPatient && <p className="mt-2 text-green-600">Selected: {selectedPatient.name}</p>}
                        <div className="flex justify-end mt-6">
                            <button onClick={onClose} className="bg-gray-300 text-gray-800 py-2 px-4 rounded mr-4">Cancel</button>
                            <button onClick={() => setStep(2)} disabled={!selectedPatient} className="bg-blue-500 text-white py-2 px-4 rounded disabled:bg-gray-400">Next</button>
                        </div>
                    </div>
                )}

                {/* Step 2: Select Package & Confirm */}
                {step === 2 && (
                    <div>
                        <div>
                            <label className="block text-gray-700 mb-2">Select Health Package</label>
                            <select value={selectedPackage} onChange={(e) => setSelectedPackage(e.target.value)} className="w-full p-2 border rounded">
                                <option value="">Choose a package</option>
                                {packages.map(pkg => <option key={pkg._id} value={pkg._id}>{pkg.name} - ₹{pkg.price}</option>)}
                            </select>
                        </div>
                        <div className="flex justify-between mt-6">
                            <button onClick={() => setStep(1)} className="bg-gray-300 text-gray-800 py-2 px-4 rounded">Back</button>
                            <button onClick={handleSave} disabled={!selectedPackage} className="bg-purple-500 text-white py-2 px-4 rounded disabled:bg-gray-400">Confirm Booking</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BookPackageModal;