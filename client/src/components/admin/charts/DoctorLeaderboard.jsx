import React from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd'];

const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3">
            <p className="text-sm font-semibold text-gray-800">{d.name}</p>
            {d.specialty && (
                <p className="text-xs text-gray-500 mb-1">{d.specialty}</p>
            )}
            <p className="text-sm text-blue-600">
                <span className="font-bold">{d.count}</span> appointments
            </p>
        </div>
    );
};

// Truncate long names for axis label
const truncate = (str, n = 12) =>
    str?.length > n ? str.slice(0, n) + '…' : str;

const DoctorLeaderboard = ({ data = [] }) => {
    const hasData = data.length > 0;

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-4">
                Top Doctors
                <span className="ml-2 text-xs font-normal text-gray-400">By appointments</span>
            </h3>

            {!hasData ? (
                <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
                    No appointment data yet
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                        data={data}
                        layout="vertical"
                        margin={{ top: 0, right: 20, left: 10, bottom: 0 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                        <XAxis
                            type="number"
                            tick={{ fontSize: 11, fill: '#9ca3af' }}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                        />
                        <YAxis
                            type="category"
                            dataKey="name"
                            width={80}
                            tick={{ fontSize: 11, fill: '#374151' }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v) => truncate(v)}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f3f4f6' }} />
                        <Bar dataKey="count" name="Appointments" radius={[0, 4, 4, 0]} barSize={18}>
                            {data.map((_, i) => (
                                <Cell key={i} fill={COLORS[i % COLORS.length]} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            )}
        </div>
    );
};

export default DoctorLeaderboard;
