import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchDoctors } from '../api/doctors';

const DoctorsPage = () => {
    const [doctors, setDoctors] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const getDoctors = async () => {
            try {
                const { data } = await fetchDoctors();
                setDoctors(data);
            } catch (error) {
                console.error("Failed to fetch doctors:", error);
            } finally {
                setLoading(false);
            }
        };
        getDoctors();
    }, []);

    if (loading) return <p>Loading doctors...</p>;

    return (
        <div>
            <h1 className="text-3xl font-bold mb-6">Our Specialists</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {doctors.map(doctor => (
                    <div key={doctor._id} className="bg-white rounded-lg shadow-lg p-6 text-center">
                        <h2 className="text-xl font-bold text-gray-800">{doctor.user.name}</h2>
                        <p className="text-gray-600 my-2">{doctor.specialty}</p>
                        <Link to={`/doctors/${doctor._id}`} className="text-blue-500 hover:underline">
                            View Profile & Book
                        </Link>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default DoctorsPage;