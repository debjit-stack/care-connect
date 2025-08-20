import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchPackages } from '../api/packages';
import { useAuth } from '../context/AuthContext';
// Assuming you will create a bookPackage API function in api/patient.js
// import { bookMyHealthPackage } from '../api/patient'; 

const PackagesPage = () => {
    const [packages, setPackages] = useState([]);
    const [loading, setLoading] = useState(true);
    const { isAuthenticated, user } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        const getPackages = async () => {
            try {
                const { data } = await fetchPackages();
                setPackages(data);
            } catch (error) {
                console.error("Failed to fetch packages:", error);
            } finally {
                setLoading(false);
            }
        };
        getPackages();
    }, []);

    const handleBookPackage = async (packageId) => {
        if (!isAuthenticated) {
            navigate('/login');
            return;
        }

        // Placeholder for booking logic
        alert(`Booking package ID: ${packageId}. \nThis would call the API to book the package for user: ${user.name}`);
        // try {
        //     await bookMyHealthPackage({ packageId });
        //     alert('Package booked successfully!');
        // } catch (error) {
        //     alert('Failed to book package.');
        //     console.error(error);
        // }
    };

    if (loading) return <p>Loading packages...</p>;

    return (
        <div>
            <h1 className="text-3xl font-bold text-center mb-8">Our Health Packages</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {packages.map(pkg => (
                    <div key={pkg._id} className="bg-white rounded-lg shadow-lg p-6 flex flex-col">
                        <div className="flex-grow">
                            <h2 className="text-xl font-bold text-gray-800">{pkg.name}</h2>
                            <p className="text-2xl font-light text-blue-600 my-3">₹{pkg.price.toLocaleString('en-IN')}</p>
                            <p className="text-gray-600 text-sm">{pkg.details}</p>
                        </div>
                        <button 
                            onClick={() => handleBookPackage(pkg._id)}
                            className="mt-6 w-full bg-green-500 text-white font-semibold py-2 rounded-lg hover:bg-green-600 transition-colors"
                        >
                            Book Now
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default PackagesPage;
