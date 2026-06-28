import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchDoctors } from '../api/doctors';

/**
 * FIX #17: Added empty state (no doctors found) and error state (API failure).
 * Previously both cases rendered a blank grid with no feedback.
 */
const DoctorsPage = () => {
    const [doctors, setDoctors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState('');

    const loadDoctors = async () => {
        setLoading(true);
        setError('');
        try {
            const { data } = await fetchDoctors();
            setDoctors(data);
        } catch (err) {
            console.error('Failed to fetch doctors:', err);
            setError(
                err?.response?.data?.message ||
                'Could not load doctors. Please try again.'
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadDoctors();
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
                <span className="ml-3 text-gray-500">Loading doctors…</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-20">
                <p className="text-red-600 font-semibold mb-4">{error}</p>
                <button
                    onClick={loadDoctors}
                    className="bg-blue-500 text-white py-2 px-6 rounded hover:bg-blue-600"
                >
                    Retry
                </button>
            </div>
        );
    }

    if (doctors.length === 0) {
        return (
            <div className="text-center py-20">
                <svg
                    className="mx-auto h-16 w-16 text-gray-300 mb-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"
                    />
                </svg>
                <h2 className="text-xl font-semibold text-gray-500">No doctors available yet</h2>
                <p className="text-gray-400 mt-2">Please check back later.</p>
            </div>
        );
    }

    return (
        <div>
            <h1 className="text-3xl font-bold mb-6">Our Specialists</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {doctors.map((doctor) => (
                    <div
                        key={doctor._id}
                        className="bg-white rounded-lg shadow-lg p-6 text-center hover:shadow-xl transition-shadow"
                    >
                        <div className="bg-blue-50 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                            <span className="text-2xl font-bold text-blue-600">
                                {doctor.user.name.charAt(0).toUpperCase()}
                            </span>
                        </div>
                        <h2 className="text-xl font-bold text-gray-800">{doctor.user.name}</h2>
                        <p className="text-blue-600 font-medium my-1">{doctor.specialty}</p>
                        {doctor.experienceYears > 0 && (
                            <p className="text-sm text-gray-500 mb-3">
                                {doctor.experienceYears} year{doctor.experienceYears !== 1 ? 's' : ''} experience
                            </p>
                        )}
                        <Link
                            to={`/doctors/${doctor._id}`}
                            className="inline-block mt-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold py-2 px-5 rounded-full transition-colors"
                        >
                            View Profile & Book
                        </Link>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default DoctorsPage;
