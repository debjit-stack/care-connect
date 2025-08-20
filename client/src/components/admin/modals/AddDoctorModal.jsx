import React, { useState } from 'react';

const AddDoctorModal = ({ onClose, onSave }) => {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        specialty: '',
        qualifications: '',
        experienceYears: 0
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
                <h2 className="text-2xl font-bold mb-6">Add New Doctor</h2>
                <form onSubmit={handleSubmit}>
                    <input name="name" placeholder="Name" onChange={handleChange} className="w-full p-2 border rounded mb-4" required />
                    <input name="email" type="email" placeholder="Email" onChange={handleChange} className="w-full p-2 border rounded mb-4" required />
                    <input name="password" type="password" placeholder="Password" onChange={handleChange} className="w-full p-2 border rounded mb-4" required />
                    <input name="specialty" placeholder="Specialty" onChange={handleChange} className="w-full p-2 border rounded mb-4" required />
                    <input name="qualifications" placeholder="Qualifications" onChange={handleChange} className="w-full p-2 border rounded mb-4" />
                    <input name="experienceYears" type="number" placeholder="Experience (Years)" onChange={handleChange} className="w-full p-2 border rounded mb-6" />
                    <div className="flex justify-end space-x-4">
                        <button type="button" onClick={onClose} className="bg-gray-300 text-gray-800 py-2 px-4 rounded">Cancel</button>
                        <button type="submit" className="bg-purple-500 text-white py-2 px-4 rounded">Save Doctor</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddDoctorModal;
