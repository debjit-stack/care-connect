import React, { useState } from 'react';

// Password must satisfy the same rules as the server's passwordField validator:
//   min 8 chars, at least one uppercase, one number, one special character.
const validatePassword = (pwd) => {
    const errors = [];
    if (pwd.length < 8)            errors.push('at least 8 characters');
    if (!/[A-Z]/.test(pwd))        errors.push('one uppercase letter');
    if (!/[0-9]/.test(pwd))        errors.push('one number');
    if (!/[^A-Za-z0-9]/.test(pwd)) errors.push('one special character');
    return errors;
};

const ResetPasswordModal = ({ user, onClose, onSave }) => {
    const [newPassword,   setNewPassword]   = useState('');
    const [clientErrors,  setClientErrors]  = useState([]);

    const handleChange = (e) => {
        const val = e.target.value;
        setNewPassword(val);
        // Live validation so the user sees requirements as they type
        setClientErrors(val ? validatePassword(val) : []);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const errors = validatePassword(newPassword);
        if (errors.length > 0) {
            setClientErrors(errors);
            return;
        }
        onSave({ newPassword });
    };

    const isValid = newPassword.length > 0 && clientErrors.length === 0;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-md">
                <h2 className="text-2xl font-bold mb-6">Reset Password for {user.name}</h2>
                <form onSubmit={handleSubmit}>
                    <div className="mb-2">
                        <label className="block text-gray-700">New Password</label>
                        <input
                            type="password"
                            value={newPassword}
                            onChange={handleChange}
                            className={`w-full p-2 border rounded mt-1 ${
                                clientErrors.length > 0 ? 'border-red-400' : 'border-gray-300'
                            }`}
                            required
                            autoComplete="new-password"
                        />
                    </div>

                    {/* Password requirements hint — always visible */}
                    <ul className="text-xs mb-6 space-y-1 mt-2">
                        {[
                            { label: 'At least 8 characters',    pass: newPassword.length >= 8 },
                            { label: 'One uppercase letter',      pass: /[A-Z]/.test(newPassword) },
                            { label: 'One number',                pass: /[0-9]/.test(newPassword) },
                            { label: 'One special character',     pass: /[^A-Za-z0-9]/.test(newPassword) },
                        ].map(({ label, pass }) => (
                            <li
                                key={label}
                                className={`flex items-center gap-1 ${
                                    newPassword.length === 0
                                        ? 'text-gray-400'
                                        : pass
                                            ? 'text-green-600'
                                            : 'text-red-500'
                                }`}
                            >
                                <span>{pass && newPassword.length > 0 ? '✓' : '○'}</span>
                                {label}
                            </li>
                        ))}
                    </ul>

                    <div className="flex justify-end space-x-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="bg-gray-300 text-gray-800 py-2 px-4 rounded"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!isValid}
                            className="bg-yellow-500 text-white py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Save New Password
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ResetPasswordModal;
