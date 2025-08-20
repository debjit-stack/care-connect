import React from 'react';

const StatsCard = ({ title, value }) => {
    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-gray-500 text-sm font-medium">{title}</h3>
            <p className="text-3xl font-bold text-gray-800 mt-2">{value}</p>
        </div>
    );
};

export default StatsCard;