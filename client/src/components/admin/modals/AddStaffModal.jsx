import React, { useState } from 'react';

const AddStaffModal = ({ onClose, onSave }) => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('receptionist');

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave({ name, email, password, role });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-md">
                <h2 className="text-2xl font-bold mb-6">Add New Staff</h2>
                <form onSubmit={handleSubmit}>
                    {/* Form fields */}
                    <div className="mb-4">
                        <label className="block text-gray-700">Name</label>
                        <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full p-2 border rounded" required />
                    </div>
                    <div className="mb-4">
                        <label className="block text-gray-700">Email</label>
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full p-2 border rounded" required />
                    </div>
                    <div className="mb-4">
                        <label className="block text-gray-700">Password</label>
                        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-2 border rounded" required />
                    </div>
                    <div className="mb-6">
                        <label className="block text-gray-700">Role</label>
                        <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full p-2 border rounded">
                            <option value="receptionist">Receptionist</option>
                            <option value="admin">Admin</option>
                        </select>
                    </div>
                    {/* Action buttons */}
                    <div className="flex justify-end space-x-4">
                        <button type="button" onClick={onClose} className="bg-gray-300 text-gray-800 py-2 px-4 rounded">Cancel</button>
                        <button type="submit" className="bg-blue-500 text-white py-2 px-4 rounded">Save</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddStaffModal;