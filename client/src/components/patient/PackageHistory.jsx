import React from 'react';

const PackageHistory = ({ packages }) => {
    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-semibold mb-4">My Health Packages</h2>
            <div className="overflow-x-auto">
                <table className="min-w-full bg-white">
                    <thead>
                        <tr>
                            <th className="py-2 px-4 border-b text-left">Package Name</th>
                            <th className="py-2 px-4 border-b text-left">Price</th>
                            <th className="py-2 px-4 border-b text-left">Date Booked</th>
                        </tr>
                    </thead>
                    <tbody>
                        {packages.length > 0 ? packages.map(pkg => (
                            <tr key={pkg._id} className="hover:bg-gray-50">
                                <td className="py-2 px-4 border-b">{pkg.healthPackage.name}</td>
                                <td className="py-2 px-4 border-b">₹{pkg.healthPackage.price}</td>
                                <td className="py-2 px-4 border-b">{new Date(pkg.createdAt).toLocaleDateString()}</td>
                            </tr>
                        )) : (
                            <tr>
                                <td colSpan="3" className="py-4 text-center text-gray-500">You have not booked any health packages.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default PackageHistory;
