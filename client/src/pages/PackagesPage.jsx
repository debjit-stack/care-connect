import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchPackages } from '../api/packages';
import { bookMyHealthPackage } from '../api/patient';
import { useAuth } from '../context/AuthContext';

const PackagesPage = () => {
    const [packages, setPackages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [bookingStatus, setBookingStatus] = useState({}); // { [pkgId]: 'loading'|'success'|'error' }
    const { isAuthenticated, user } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        const getPackages = async () => {
            try {
                const { data } = await fetchPackages();
                setPackages(data);
            } catch (error) {
                console.error('Failed to fetch packages:', error);
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
        if (user.role !== 'patient') {
            setBookingStatus((prev) => ({ ...prev, [packageId]: 'not-patient' }));
            return;
        }
        setBookingStatus((prev) => ({ ...prev, [packageId]: 'loading' }));
        try {
            await bookMyHealthPackage({ packageId });
            setBookingStatus((prev) => ({ ...prev, [packageId]: 'success' }));
        } catch (error) {
            console.error('Failed to book package:', error);
            setBookingStatus((prev) => ({ ...prev, [packageId]: 'error' }));
        }
    };

    const getButtonLabel = (pkgId) => {
        const status = bookingStatus[pkgId];
        if (status === 'loading') return 'Booking...';
        if (status === 'success') return 'Booked!';
        if (status === 'error') return 'Failed — Retry';
        if (status === 'not-patient') return 'Patients Only';
        return 'Book Now';
    };

    const getButtonClass = (pkgId) => {
        const status = bookingStatus[pkgId];
        const base = 'mt-6 w-full font-semibold py-2 rounded-lg transition-colors text-white ';
        if (status === 'success') return base + 'bg-blue-500 cursor-default';
        if (status === 'error') return base + 'bg-red-500 hover:bg-red-600';
        if (status === 'not-patient') return base + 'bg-gray-400 cursor-not-allowed';
        return base + 'bg-green-500 hover:bg-green-600';
    };

    if (loading) return <p>Loading packages...</p>;

    return (
        <div>
            <h1 className="text-3xl font-bold text-center mb-8">Our Health Packages</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {packages.map((pkg) => (
                    <div key={pkg._id} className="bg-white rounded-lg shadow-lg p-6 flex flex-col">
                        <div className="flex-grow">
                            <h2 className="text-xl font-bold text-gray-800">{pkg.name}</h2>
                            <p className="text-2xl font-light text-blue-600 my-3">
                                ₹{pkg.price.toLocaleString('en-IN')}
                            </p>
                            <p className="text-gray-600 text-sm">{pkg.details}</p>
                        </div>
                        {bookingStatus[pkg._id] === 'not-patient' && (
                            <p className="mt-2 text-sm text-red-500">Only patients can book packages.</p>
                        )}
                        <button
                            onClick={() => handleBookPackage(pkg._id)}
                            disabled={
                                bookingStatus[pkg._id] === 'loading' ||
                                bookingStatus[pkg._id] === 'success' ||
                                bookingStatus[pkg._id] === 'not-patient'
                            }
                            className={getButtonClass(pkg._id)}
                        >
                            {getButtonLabel(pkg._id)}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default PackagesPage;