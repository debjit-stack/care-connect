import React, { useMemo } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * Fills in zero-count months so the line chart doesn't skip gaps.
 * Server returns only months with data — we need a full 12-month series.
 */
const fillMonths = (data) => {
    const now   = new Date();
    const result = [];

    for (let i = 11; i >= 0; i--) {
        const d     = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year  = d.getFullYear();
        const month = d.getMonth() + 1; // 1-indexed
        const found = data.find((r) => r.year === year && r.month === month);
        result.push({
            label: `${MONTH_NAMES[month - 1]} ${year !== now.getFullYear() ? year : ''}`.trim(),
            count: found?.count ?? 0,
        });
    }

    return result;
};

const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3">
            <p className="text-sm font-semibold text-gray-700 mb-1">{label}</p>
            <p className="text-sm text-blue-600">
                <span className="font-bold">{payload[0].value}</span> appointments
            </p>
        </div>
    );
};

const AppointmentTrendChart = ({ data = [] }) => {
    const chartData = useMemo(() => fillMonths(data), [data]);
    const hasData   = chartData.some((d) => d.count > 0);

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-4">
                Appointment Trend
                <span className="ml-2 text-xs font-normal text-gray-400">Last 12 months</span>
            </h3>

            {!hasData ? (
                <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
                    No appointment data yet
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis
                            dataKey="label"
                            tick={{ fontSize: 11, fill: '#9ca3af' }}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            tick={{ fontSize: 11, fill: '#9ca3af' }}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Line
                            type="monotone"
                            dataKey="count"
                            name="Appointments"
                            stroke="#3b82f6"
                            strokeWidth={2.5}
                            dot={{ r: 3, fill: '#3b82f6', strokeWidth: 0 }}
                            activeDot={{ r: 5, fill: '#1d4ed8' }}
                        />
                    </LineChart>
                </ResponsiveContainer>
            )}
        </div>
    );
};

export default AppointmentTrendChart;
