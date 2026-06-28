import React, { useState } from 'react';
import { searchPatients } from '../../api/receptionist';

/**
 * FIX #9: Added error handling on searchPatients API call.
 * Previously a network error / 401 silently left results empty with no
 * user feedback.  We now show an inline error message and clear it on
 * the next successful keystroke.
 */
const PatientSearch = ({ onPatientSelect }) => {
    const [query,   setQuery]   = useState('');
    const [results, setResults] = useState([]);
    const [error,   setError]   = useState('');

    const handleSearch = async (e) => {
        const newQuery = e.target.value;
        setQuery(newQuery);
        setError('');

        if (newQuery.length > 2) {
            try {
                const { data } = await searchPatients(newQuery);
                setResults(data);
            } catch (err) {
                console.error('Patient search failed:', err);
                setResults([]);
                setError('Search failed. Please check your connection and try again.');
            }
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
                className={`w-full p-2 border rounded ${error ? 'border-red-400' : 'border-gray-300'}`}
            />

            {error && (
                <p className="text-red-500 text-sm mt-1">{error}</p>
            )}

            {results.length > 0 && (
                <ul className="border rounded mt-2 bg-white max-h-40 overflow-y-auto shadow-sm">
                    {results.map((patient) => (
                        <li
                            key={patient._id}
                            onClick={() => {
                                onPatientSelect(patient);
                                setQuery(patient.name);
                                setResults([]);
                                setError('');
                            }}
                            className="p-2 hover:bg-gray-100 cursor-pointer"
                        >
                            {patient.name} ({patient.email})
                        </li>
                    ))}
                </ul>
            )}

            {query.length > 2 && results.length === 0 && !error && (
                <p className="text-gray-400 text-sm mt-1">No patients found.</p>
            )}
        </div>
    );
};

export default PatientSearch;
