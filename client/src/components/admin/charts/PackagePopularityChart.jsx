import React from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const COLORS = ['#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#ede9fe', '#f5f3ff'];

const truncate = (str, n = 16) =>
    str?.length > n ? str.slice(0, n) + '…' : str;

const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3">
            <p className="text-sm font-semibold text-gray-800">{d.name}</p>
            <p className="text-xs text-gray-500 mb-1">
                ₹{d.price?.toLocaleString('en-IN')}
            </p>
            <p className="text-sm text-purple-600">
                <span className="font-bold">{d.count}</span> bookings
            </p>
        </div>
    );
};

const PackagePopularityChart = ({ data = [] }) => {
    const hasData = data.length > 0;

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-4">
                Package Popularity
                <span className="ml-2 text-xs font-normal text-gray-400">Top 6 by bookings</span>
            </h3>

            {!hasData ? (
                <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
                    No package bookings yet
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                        data={data}
                        margin={{ top: 5, right: 10, left: -10, bottom: 30 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                        <XAxis
                            dataKey="name"
                            tick={{ fontSize: 10, fill: '#6b7280' }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={truncate}
                            angle={-30}
                            textAnchor="end"
                            interval={0}
                        />
                        <YAxis
                            tick={{ fontSize: 11, fill: '#9ca3af' }}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f3f4f6' }} />
                        <Bar dataKey="count" name="Bookings" radius={[4, 4, 0, 0]} barSize={28}>
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

export default PackagePopularityChart;
