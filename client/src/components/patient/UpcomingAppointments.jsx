import React, { useState } from 'react';
import { cancelMyAppointment } from '../../api/patient.js';

const formatDate = (isoString) =>
    new Date(isoString).toLocaleDateString('en-IN', {
        year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
    });

// Parse "09:00 AM" into minutes from midnight for cutoff comparison
const toMinutes = (t) => {
    const match = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return 0;
    let [, h, m, period] = match;
    h = parseInt(h, 10);
    m = parseInt(m, 10);
    if (period.toUpperCase() === 'PM' && h !== 12) h += 12;
    if (period.toUpperCase() === 'AM' && h === 12) h = 0;
    return h * 60 + m;
};

// Returns true if appointment starts within the next 24 hours
const isWithinCutoff = (appointmentDate, appointmentTime) => {
    const dt = new Date(appointmentDate);
    dt.setUTCMinutes(dt.getUTCMinutes() + toMinutes(appointmentTime));
    const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return dt < cutoff;
};

const UpcomingAppointments = ({ appointments, onCancelled }) => {
    const [cancellingId, setCancellingId] = useState(null);
    const [confirmingId,  setConfirmingId]  = useState(null);
    const [errorById,     setErrorById]     = useState({});

    // Only future, Scheduled appointments
    const upcoming = appointments
        .filter((a) => a.status === 'Scheduled')
        .sort((a, b) => new Date(a.appointmentDate) - new Date(b.appointmentDate));

    const handleCancelClick = (id) => {
        setConfirmingId(id);
        setErrorById((prev) => ({ ...prev, [id]: null }));
    };

    const handleConfirmCancel = async (id) => {
        setCancellingId(id);
        try {
            await cancelMyAppointment(id);
            setConfirmingId(null);
            onCancelled?.();
        } catch (err) {
            setErrorById((prev) => ({
                ...prev,
                [id]: err?.response?.data?.message || 'Failed to cancel appointment.',
            }));
        } finally {
            setCancellingId(null);
        }
    };

    if (upcoming.length === 0) {
        return (
            <div className="bg-white p-8 rounded-lg shadow-md text-center">
                <div className="text-4xl mb-2">📅</div>
                <p className="text-gray-500">You have no upcoming appointments.</p>
            </div>
        );
    }

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-semibold mb-4">Upcoming Appointments</h2>
            <div className="space-y-4">
                {upcoming.map((app) => {
                    const withinCutoff = isWithinCutoff(app.appointmentDate, app.appointmentTime);
                    const isConfirming = confirmingId === app._id;
                    const isCancelling = cancellingId === app._id;
                    const error        = errorById[app._id];

                    return (
                        <div key={app._id} className="border rounded-lg p-4">
                            <div className="flex justify-between items-start flex-wrap gap-3">
                                <div>
                                    <p className="font-semibold text-gray-800">{formatDate(app.appointmentDate)}</p>
                                    <p className="text-sm text-gray-500">{app.appointmentTime}</p>
                                    <p className="font-medium mt-1">{app.doctor?.user?.name ?? 'Doctor'}</p>
                                    <p className="text-sm text-gray-500">{app.doctor?.specialty || 'General'}</p>
                                    <span className={`inline-block mt-2 px-2 py-0.5 text-xs font-semibold rounded-full ${
                                        app.type === 'Online' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                                    }`}>
                                        {app.type}
                                    </span>
                                </div>

                                <div className="flex flex-col items-end gap-2">
                                    {!isConfirming ? (
                                        <button
                                            onClick={() => handleCancelClick(app._id)}
                                            disabled={withinCutoff}
                                            className={`text-sm font-medium py-1.5 px-3 rounded transition-colors ${
                                                withinCutoff
                                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                    : 'bg-red-50 text-red-600 hover:bg-red-100'
                                            }`}
                                            title={withinCutoff ? 'Cannot cancel within 24 hours of appointment' : ''}
                                        >
                                            Cancel Appointment
                                        </button>
                                    ) : (
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleConfirmCancel(app._id)}
                                                disabled={isCancelling}
                                                className="text-sm font-medium bg-red-500 hover:bg-red-600 text-white py-1.5 px-3 rounded disabled:opacity-50 transition-colors"
                                            >
                                                {isCancelling ? 'Cancelling…' : 'Confirm Cancel'}
                                            </button>
                                            <button
                                                onClick={() => setConfirmingId(null)}
                                                disabled={isCancelling}
                                                className="text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 py-1.5 px-3 rounded transition-colors"
                                            >
                                                Keep It
                                            </button>
                                        </div>
                                    )}

                                    {withinCutoff && !isConfirming && (
                                        <p className="text-xs text-amber-600 max-w-[180px] text-right">
                                            Within 24hrs — contact hospital to cancel
                                        </p>
                                    )}
                                </div>
                            </div>

                            {error && (
                                <p className="text-sm text-red-600 mt-2 bg-red-50 px-3 py-2 rounded">{error}</p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default UpcomingAppointments;
