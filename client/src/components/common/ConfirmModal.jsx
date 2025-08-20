import React from 'react';

const ConfirmModal = ({ title, message, onConfirm, onCancel }) => {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-sm">
                <h2 className="text-xl font-bold mb-4">{title}</h2>
                <p className="text-gray-600 mb-6">{message}</p>
                <div className="flex justify-end space-x-4">
                    <button onClick={onCancel} className="bg-gray-300 text-gray-800 py-2 px-4 rounded hover:bg-gray-400">
                        Cancel
                    </button>
                    <button onClick={onConfirm} className="bg-red-500 text-white py-2 px-4 rounded hover:bg-red-600">
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;