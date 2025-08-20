import React, { useState, useEffect } from 'react';
import { getPatientHistory, updateAppointment } from '../../api/doctors';

const ConsultationModal = ({ appointment, onClose }) => {
    const [history, setHistory] = useState([]);
    const [notes, setNotes] = useState('');
    const [prescription, setPrescription] = useState('');
    const [loadingHistory, setLoadingHistory] = useState(true);

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const { data } = await getPatientHistory(appointment.patient._id);
                setHistory(data);
            } catch (error) {
                console.error("Failed to fetch patient history:", error);
            } finally {
                setLoadingHistory(false);
            }
        };
        fetchHistory();
    }, [appointment.patient._id]);

    const handleSave = async () => {
        try {
            await updateAppointment(appointment._id, { notes, prescription, status: 'Completed' });
            onClose();
        } catch (error) {
            console.error("Failed to update appointment:", error);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
                <h2 className="text-2xl font-bold mb-4">Consultation for: {appointment.patient.name}</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto flex-grow">
                    {/* Patient History */}
                    <div className="pr-4 border-r">
                        <h3 className="font-semibold text-lg mb-2">Patient History</h3>
                        {loadingHistory ? <p>Loading history...</p> : (
                            <div className="space-y-4">
                                {history.length > 0 ? history.map(h => (
                                    <div key={h._id} className="bg-gray-100 p-3 rounded">
                                        <p className="font-bold">{new Date(h.appointmentDate).toLocaleDateString()}</p>
                                        <p><strong>Notes:</strong> {h.notes || 'N/A'}</p>
                                        <p><strong>Prescription:</strong> {h.prescription || 'N/A'}</p>
                                    </div>
                                )) : <p>No past records found.</p>}
                            </div>
                        )}
                    </div>

                    {/* Current Consultation */}
                    <div>
                        <h3 className="font-semibold text-lg mb-2">This Session</h3>
                        <div className="mb-4">
                            <label className="block text-gray-700">Consultation Notes</label>
                            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full p-2 border rounded h-32" />
                        </div>
                        <div>
                            <label className="block text-gray-700">Prescription</label>
                            <textarea value={prescription} onChange={(e) => setPrescription(e.target.value)} className="w-full p-2 border rounded h-32" />
                        </div>
                    </div>
                </div>

                {/* Action buttons */}
                <div className="flex justify-end space-x-4 mt-6 pt-4 border-t">
                    <button type="button" onClick={onClose} className="bg-gray-300 text-gray-800 py-2 px-4 rounded">Cancel</button>
                    <button onClick={handleSave} className="bg-green-500 text-white py-2 px-4 rounded">Save & Mark as Completed</button>
                </div>
            </div>
        </div>
    );
};

export default ConsultationModal;