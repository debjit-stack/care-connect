import React, { useState } from 'react';

const ResetPasswordModal = ({ user, onClose, onSave }) => {
    const [newPassword, setNewPassword] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (newPassword.length < 6) {
            alert('Password must be at least 6 characters long.');
            return;
        }
        onSave({ newPassword });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-md">
                <h2 className="text-2xl font-bold mb-6">Reset Password for {user.name}</h2>
                <form onSubmit={handleSubmit}>
                    <div className="mb-6">
                        <label className="block text-gray-700">New Password</label>
                        <input 
                            type="password" 
                            value={newPassword} 
                            onChange={(e) => setNewPassword(e.target.value)} 
                            className="w-full p-2 border rounded" 
                            required 
                            minLength="6"
                        />
                    </div>
                    <div className="flex justify-end space-x-4">
                        <button type="button" onClick={onClose} className="bg-gray-300 text-gray-800 py-2 px-4 rounded">Cancel</button>
                        <button type="submit" className="bg-yellow-500 text-white py-2 px-4 rounded">Save New Password</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ResetPasswordModal;