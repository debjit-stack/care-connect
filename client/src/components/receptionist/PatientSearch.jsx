import React, { useState } from 'react';
import { searchPatients } from '../../api/receptionist';

const PatientSearch = ({ onPatientSelect }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);

    const handleSearch = async (e) => {
        const newQuery = e.target.value;
        setQuery(newQuery);
        if (newQuery.length > 2) {
            const { data } = await searchPatients(newQuery);
            setResults(data);
        } else {
            setResults([]);
        }
    };

    return (
        <div>
            <input
                type="text"
                value={query}
                onChange={handleSearch}
                placeholder="Search patient by name or email..."
                className="w-full p-2 border rounded"
            />
            {results.length > 0 && (
                <ul className="border rounded mt-2 bg-white max-h-40 overflow-y-auto">
                    {results.map(patient => (
                        <li 
                            key={patient._id} 
                            onClick={() => {
                                onPatientSelect(patient);
                                setQuery(patient.name);
                                setResults([]);
                            }}
                            className="p-2 hover:bg-gray-100 cursor-pointer"
                        >
                            {patient.name} ({patient.email})
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default PatientSearch;
