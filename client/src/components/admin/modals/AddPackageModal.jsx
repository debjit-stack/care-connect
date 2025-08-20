import React, { useState } from 'react';

const AddPackageModal = ({ onClose, onSave }) => {
    const [formData, setFormData] = useState({ name: '', price: '', details: '' });

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-md">
                <h2 className="text-2xl font-bold mb-6">Add New Health Package</h2>
                <form onSubmit={handleSubmit}>
                    <input name="name" placeholder="Package Name" onChange={handleChange} className="w-full p-2 border rounded mb-4" required />
                    <input name="price" type="number" placeholder="Price" onChange={handleChange} className="w-full p-2 border rounded mb-4" required />
                    <textarea name="details" placeholder="Details" onChange={handleChange} className="w-full p-2 border rounded mb-6" required />
                    <div className="flex justify-end space-x-4">
                        <button type="button" onClick={onClose} className="bg-gray-300 text-gray-800 py-2 px-4 rounded">Cancel</button>
                        <button type="submit" className="bg-green-500 text-white py-2 px-4 rounded">Save Package</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddPackageModal;
