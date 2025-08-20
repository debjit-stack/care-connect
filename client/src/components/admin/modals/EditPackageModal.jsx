import React, { useState } from 'react';

const EditPackageModal = ({ pkg, onClose, onSave }) => {
    const [formData, setFormData] = useState({ 
        name: pkg.name, 
        price: pkg.price, 
        details: pkg.details 
    });

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
                <h2 className="text-2xl font-bold mb-6">Edit Health Package</h2>
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-gray-700">Package Name</label>
                        <input name="name" value={formData.name} onChange={handleChange} className="w-full p-2 border rounded" required />
                    </div>
                    <div className="mb-4">
                        <label className="block text-gray-700">Price</label>
                        <input name="price" type="number" value={formData.price} onChange={handleChange} className="w-full p-2 border rounded" required />
                    </div>
                    <div className="mb-6">
                        <label className="block text-gray-700">Details</label>
                        <textarea name="details" value={formData.details} onChange={handleChange} className="w-full p-2 border rounded h-24" required />
                    </div>
                    <div className="flex justify-end space-x-4">
                        <button type="button" onClick={onClose} className="bg-gray-300 text-gray-800 py-2 px-4 rounded">Cancel</button>
                        <button type="submit" className="bg-green-500 text-white py-2 px-4 rounded">Save Changes</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditPackageModal;