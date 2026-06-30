import React, { useState, useEffect } from 'react';
import { getMyProfile, updateMyProfile } from '../api/patient.js';
import { useAuth } from '../context/AuthContext.jsx';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// Convert stored ISO date to YYYY-MM-DD for <input type="date">
const toDateInputValue = (isoString) => {
    if (!isoString) return '';
    return new Date(isoString).toISOString().split('T')[0];
};

const PatientProfilePage = () => {
    const [formData, setFormData] = useState({
        name: '', phone: '', dateOfBirth: '', bloodGroup: '', allergies: '',
    });
    const [email,    setEmail]    = useState('');
    const [loading,  setLoading]  = useState(true);
    const [saving,   setSaving]   = useState(false);
    const [error,    setError]    = useState('');
    const [success,  setSuccess]  = useState('');

    const { updateUser } = useAuth();

    useEffect(() => {
        const fetchProfile = async () => {
            try {
                const { data } = await getMyProfile();
                setFormData({
                    name:        data.name || '',
                    phone:       data.phone || '',
                    dateOfBirth: toDateInputValue(data.dateOfBirth),
                    bloodGroup:  data.bloodGroup || '',
                    allergies:   data.allergies || '',
                });
                setEmail(data.email || '');
            } catch (err) {
                setError(err?.response?.data?.message || 'Failed to load your profile.');
            } finally {
                setLoading(false);
            }
        };
        fetchProfile();
    }, []);

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
        setSuccess('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setSaving(true);

        try {
            const { data } = await updateMyProfile(formData);
            setSuccess('Profile updated successfully.');
            updateUser({ name: data.user.name });
        } catch (err) {
            const respErrors = err?.response?.data?.errors;
            if (respErrors?.length) {
                setError(respErrors.map((e) => e.message).join(' '));
            } else {
                setError(err?.response?.data?.message || 'Failed to update profile.');
            }
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto">
            <h1 className="text-3xl font-bold mb-6">My Profile</h1>

            <div className="bg-white p-8 rounded-lg shadow-md">
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}
                {success && (
                    <div className="bg-green-50 border border-green-200 text-green-700 p-3 rounded mb-4 text-sm flex items-center gap-2">
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        {success}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    {/* Read-only email */}
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2">Email</label>
                        <input
                            type="email"
                            value={email}
                            disabled
                            className="w-full py-2 px-3 border rounded bg-gray-50 text-gray-500 cursor-not-allowed"
                        />
                        <p className="text-xs text-gray-400 mt-1">Email cannot be changed. Contact support if needed.</p>
                    </div>

                    {/* Name */}
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="name">
                            Full Name
                        </label>
                        <input
                            id="name"
                            name="name"
                            type="text"
                            value={formData.name}
                            onChange={handleChange}
                            className="w-full py-2 px-3 border rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                            disabled={saving}
                        />
                    </div>

                    {/* Phone */}
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="phone">
                            Phone Number
                        </label>
                        <input
                            id="phone"
                            name="phone"
                            type="tel"
                            placeholder="+91 98765 43210"
                            value={formData.phone}
                            onChange={handleChange}
                            className="w-full py-2 px-3 border rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                            disabled={saving}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        {/* Date of birth */}
                        <div>
                            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="dateOfBirth">
                                Date of Birth
                            </label>
                            <input
                                id="dateOfBirth"
                                name="dateOfBirth"
                                type="date"
                                max={new Date().toISOString().split('T')[0]}
                                value={formData.dateOfBirth}
                                onChange={handleChange}
                                className="w-full py-2 px-3 border rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                                disabled={saving}
                            />
                        </div>

                        {/* Blood group */}
                        <div>
                            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="bloodGroup">
                                Blood Group
                            </label>
                            <select
                                id="bloodGroup"
                                name="bloodGroup"
                                value={formData.bloodGroup}
                                onChange={handleChange}
                                className="w-full py-2 px-3 border rounded focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                                disabled={saving}
                            >
                                <option value="">Select…</option>
                                {BLOOD_GROUPS.map((bg) => (
                                    <option key={bg} value={bg}>{bg}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Allergies */}
                    <div className="mb-6">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="allergies">
                            Known Allergies
                        </label>
                        <textarea
                            id="allergies"
                            name="allergies"
                            rows={3}
                            placeholder="e.g. Penicillin, Peanuts, Latex (comma-separated)"
                            value={formData.allergies}
                            onChange={handleChange}
                            maxLength={500}
                            className="w-full py-2 px-3 border rounded focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                            disabled={saving}
                        />
                        <p className="text-xs text-gray-400 mt-1">
                            {formData.allergies.length}/500 — visible to your doctors during consultations
                        </p>
                    </div>

                    <button
                        type="submit"
                        disabled={saving}
                        className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {saving ? 'Saving…' : 'Save Changes'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default PatientProfilePage;
