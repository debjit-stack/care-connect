import React from 'react';

const DailySchedule = ({ appointments }) => {
    if (appointments.length === 0) {
        return <p className="text-gray-500">No appointments scheduled for this date.</p>;
    }

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full bg-white">
                <thead>
                    <tr>
                        <th className="py-2 px-4 border-b text-left">Time</th>
                        <th className="py-2 px-4 border-b text-left">Patient</th>
                        <th className="py-2 px-4 border-b text-left">Doctor</th>
                        <th className="py-2 px-4 border-b text-left">Status</th>
                    </tr>
                </thead>
                <tbody>
                    {appointments.map(app => (
                        <tr key={app._id} className="hover:bg-gray-50">
                            <td className="py-2 px-4 border-b">{app.appointmentTime}</td>
                            <td className="py-2 px-4 border-b">{app.patient.name}</td>
                            <td className="py-2 px-4 border-b">{app.doctor.user.name}</td>
                            <td className="py-2 px-4 border-b">
                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${app.status === 'Scheduled' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                                    {app.status}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default DailySchedule;
