import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchDoctorById, fetchDoctorAvailability } from '../api/doctors';
import { bookAppointment } from '../api/patient';
import { useAuth } from '../context/AuthContext';

const DoctorDetailPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user, isAuthenticated } = useAuth();

    const [doctor, setDoctor] = useState(null);
    const [availability, setAvailability] = useState([]);
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [loading, setLoading] = useState(true);
    const [bookingStatus, setBookingStatus] = useState(''); // To show booking success/error messages

    useEffect(() => {
        const getDoctorDetails = async () => {
            try {
                setLoading(true);
                const { data } = await fetchDoctorById(id);
                setDoctor(data);
            } catch (error) {
                console.error("Failed to fetch doctor details:", error);
            } finally {
                setLoading(false);
            }
        };
        getDoctorDetails();
    }, [id]);

    useEffect(() => {
        const getAvailability = async () => {
            if (doctor) {
                try {
                    setBookingStatus(''); // Clear status on date change
                    const { data } = await fetchDoctorAvailability(id, selectedDate);
                    setAvailability(data);
                } catch (error) {
                    console.error("Failed to fetch availability:", error);
                    setAvailability([]);
                }
            }
        };
        getAvailability();
    }, [id, doctor, selectedDate]);

    const handleBooking = async (slot) => {
        if (!isAuthenticated) {
            navigate('/login');
            return;
        }

        if (user.role !== 'patient') {
            setBookingStatus('Only patients can book appointments.');
            return;
        }

        try {
            const appointmentData = {
                doctorId: doctor._id,
                appointmentDate: selectedDate,
                appointmentTime: slot,
                type: 'Online'
            };
            await bookAppointment(appointmentData);
            setBookingStatus(`Appointment successfully booked for ${slot}!`);
            // Refresh availability after booking
            const { data } = await fetchDoctorAvailability(id, selectedDate);
            setAvailability(data);
        } catch (error) {
            console.error("Booking failed:", error);
            setBookingStatus('Failed to book appointment. The slot may have just been taken.');
        }
    };

    if (loading) return <p>Loading profile...</p>;
    if (!doctor) return <p>Doctor not found.</p>;

    return (
        <div className="max-w-4xl mx-auto">
            <div className="bg-white p-8 rounded-lg shadow-lg">
                <h1 className="text-4xl font-bold">{doctor.user.name}</h1>
                <p className="text-xl text-gray-600 mt-2">{doctor.specialty}</p>
                <p className="mt-4"><strong>Qualifications:</strong> {doctor.qualifications}</p>
                <p><strong>Experience:</strong> {doctor.experienceYears} years</p>

                <div className="mt-8">
                    <h2 className="text-2xl font-bold mb-4">Book an Appointment</h2>
                    <input 
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        min={new Date().toISOString().split('T')[0]}
                        className="p-2 border rounded"
                    />

                    {bookingStatus && <p className="mt-4 text-green-600 font-semibold">{bookingStatus}</p>}

                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4 mt-4">
                        {availability.length > 0 ? (
                            availability.map(slot => (
                                <button 
                                    key={slot} 
                                    onClick={() => handleBooking(slot)}
                                    className="bg-blue-500 text-white p-2 rounded hover:bg-blue-700 transition-colors"
                                >
                                    {slot}
                                </button>
                            ))
                        ) : (
                            <p className="col-span-full text-gray-500 mt-4">No available slots for this date.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DoctorDetailPage;
