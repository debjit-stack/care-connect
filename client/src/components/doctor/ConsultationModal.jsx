import React, { useState, useEffect } from 'react';
import { getPatientHistory, updateAppointment } from '../../api/doctors';

// Calculate age from date of birth
const calculateAge = (dob) => {
    if (!dob) return null;
    const birth = new Date(dob);
    const now   = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age;
};

// WS4: Demographics header — shows blood group, allergies, age at a glance
// so the doctor sees critical info before opening the consultation form.
const PatientDemographics = ({ patient }) => {
    if (!patient) return null;

    const age = calculateAge(patient.dateOfBirth);
    const hasAllergies = patient.allergies && patient.allergies.trim().length > 0;

    return (
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-4">
            <div className="flex flex-wrap gap-x-6 gap-y-2 items-center">
                {age !== null && (
                    <div>
                        <span className="text-xs text-gray-500 uppercase tracking-wide">Age</span>
                        <p className="font-semibold text-gray-800">{age} yrs</p>
                    </div>
                )}
                {patient.bloodGroup && (
                    <div>
                        <span className="text-xs text-gray-500 uppercase tracking-wide">Blood Group</span>
                        <p className="font-semibold text-red-600">{patient.bloodGroup}</p>
                    </div>
                )}
                {patient.phone && (
                    <div>
                        <span className="text-xs text-gray-500 uppercase tracking-wide">Phone</span>
                        <p className="font-semibold text-gray-800">{patient.phone}</p>
                    </div>
                )}
            </div>

            {/* Allergies get their own prominent row — clinically important */}
            {hasAllergies && (
                <div className="mt-3 pt-3 border-t border-blue-200 flex items-start gap-2">
                    <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                        <span className="text-xs text-amber-600 font-semibold uppercase tracking-wide">Allergies</span>
                        <p className="text-sm text-amber-800 font-medium">{patient.allergies}</p>
                    </div>
                </div>
            )}
        </div>
    );
};

const ConsultationModal = ({ appointment, onClose }) => {
    const [history, setHistory] = useState([]);
    const [patient, setPatient] = useState(null);
    const [notes, setNotes] = useState('');
    const [prescription, setPrescription] = useState('');
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const { data } = await getPatientHistory(appointment.patient._id);
                // WS4: API now returns { history, patient } instead of a bare array
                setHistory(data.history || []);
                setPatient(data.patient || null);
            } catch (err) {
                console.error('Failed to fetch patient history:', err);
            } finally {
                setLoadingHistory(false);
            }
        };
        fetchHistory();
    }, [appointment.patient._id]);

    const handleSave = async () => {
        setError('');
        setSaving(true);
        try {
            await updateAppointment(appointment._id, { notes, prescription, status: 'Completed' });
            onClose();
        } catch (err) {
            console.error('Failed to update appointment:', err);
            setError(err?.response?.data?.message || 'Failed to save consultation. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
                <h2 className="text-2xl font-bold mb-2">Consultation for: {appointment.patient.name}</h2>

                {/* WS4: Demographics header */}
                {!loadingHistory && <PatientDemographics patient={patient} />}

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}

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
                            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full p-2 border rounded h-32" disabled={saving} />
                        </div>
                        <div>
                            <label className="block text-gray-700">Prescription</label>
                            <textarea value={prescription} onChange={(e) => setPrescription(e.target.value)} className="w-full p-2 border rounded h-32" disabled={saving} />
                        </div>
                    </div>
                </div>

                {/* Action buttons */}
                <div className="flex justify-end space-x-4 mt-6 pt-4 border-t">
                    <button type="button" onClick={onClose} disabled={saving} className="bg-gray-300 text-gray-800 py-2 px-4 rounded disabled:opacity-50">Cancel</button>
                    <button onClick={handleSave} disabled={saving} className="bg-green-500 text-white py-2 px-4 rounded disabled:opacity-50">
                        {saving ? 'Saving…' : 'Save & Mark as Completed'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConsultationModal;
