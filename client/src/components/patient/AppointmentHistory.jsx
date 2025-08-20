import React, { useState } from 'react';

const AppointmentHistory = ({ appointments }) => {
    const [expandedId, setExpandedId] = useState(null);

    const toggleExpand = (id) => {
        setExpandedId(expandedId === id ? null : id);
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-semibold mb-4">My Appointment History</h2>
            <div className="space-y-4">
                {appointments.length > 0 ? appointments.map(app => (
                    <div key={app._id} className="border rounded-lg p-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-center">
                            <div>
                                <p className="font-semibold">{new Date(app.appointmentDate).toLocaleDateString()}</p>
                                <p className="text-sm text-gray-500">{app.appointmentTime}</p>
                            </div>
                            <div>
                                <p className="font-semibold">{app.doctor.user.name}</p>
                                <p className="text-sm text-gray-500">{app.doctor.specialty || 'General'}</p>
                            </div>
                            <div>
                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${app.status === 'Scheduled' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                                    {app.status}
                                </span>
                            </div>
                            <div>
                                {app.status === 'Completed' && (
                                    <button onClick={() => toggleExpand(app._id)} className="text-blue-500 hover:underline">
                                        {expandedId === app._id ? 'Hide Details' : 'View Details'}
                                    </button>
                                )}
                            </div>
                        </div>
                        {expandedId === app._id && (
                            <div className="mt-4 pt-4 border-t bg-gray-50 p-4 rounded-b-lg">
                                <h4 className="font-semibold">Consultation Details</h4>
                                <p><strong>Notes:</strong> {app.notes || 'No notes provided.'}</p>
                                <p><strong>Prescription:</strong> {app.prescription || 'No prescription provided.'}</p>
                            </div>
                        )}
                    </div>
                )) : <p>You have no appointment history.</p>}
            </div>
        </div>
    );
};

export default AppointmentHistory;
