import React from 'react';
import Icon from '../common/Icon';

const DoctorList = ({ doctors, onEdit, onDelete, onSetAvailability, onResetPassword }) => {
    return (
        <div className="overflow-y-auto h-64 border rounded-lg">
            <table className="min-w-full bg-white">
                <thead className="sticky top-0 bg-gray-50">
                    <tr>
                        <th className="py-2 px-4 border-b text-left">Name</th>
                        <th className="py-2 px-4 border-b text-left">Email</th>
                        <th className="py-2 px-4 border-b text-left">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {doctors.map(doctor => (
                        <tr key={doctor._id} className="hover:bg-gray-50">
                            <td className="py-2 px-4 border-b">{doctor.name}</td>
                            <td className="py-2 px-4 border-b">{doctor.email}</td>
                            <td className="py-2 px-4 border-b whitespace-nowrap">
                                <button onClick={() => onEdit(doctor)} className="text-blue-500 hover:text-blue-700 p-1 rounded-full inline-flex items-center">
                                    <Icon path="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828zM5 14H3a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1v-2" />
                                    <span className="ml-1">Edit</span>
                                </button>
                                <button onClick={() => onResetPassword(doctor)} className="text-yellow-500 hover:text-yellow-700 p-1 rounded-full inline-flex items-center ml-2">
                                    <Icon path="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.629 5.858a6 6 0 01-8.23-8.23A6 6 0 0115 7zM15 7a2 2 0 00-2-2m0 0a2 2 0 00-2 2m2 2a2 2 0 00-2 2" />
                                    <span className="ml-1">Reset Password</span>
                                </button>
                                <button onClick={() => onSetAvailability(doctor)} className="text-green-500 hover:text-green-700 p-1 rounded-full inline-flex items-center ml-2">
                                    <Icon path="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    <span className="ml-1">Set Availability</span>
                                </button>
                                <button onClick={() => onDelete(doctor._id)} className="text-red-500 hover:text-red-700 p-1 rounded-full inline-flex items-center ml-2">
                                    <Icon path="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" />
                                    <span className="ml-1">Delete</span>
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default DoctorList;