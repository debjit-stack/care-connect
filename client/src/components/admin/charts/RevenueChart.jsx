import React, { useMemo } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer,
} from 'recharts';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const fillMonths = (data) => {
    const now    = new Date();
    const result = [];

    for (let i = 11; i >= 0; i--) {
        const d     = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year  = d.getFullYear();
        const month = d.getMonth() + 1;
        const found = data.find((r) => r.year === year && r.month === month);
        result.push({
            label:    `${MONTH_NAMES[month - 1]} ${year !== now.getFullYear() ? year : ''}`.trim(),
            revenue:  found?.revenue  ?? 0,
            bookings: found?.bookings ?? 0,
        });
    }

    return result;
};

const formatINR = (v) => {
    if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
    if (v >= 1000)   return `₹${(v / 1000).toFixed(1)}K`;
    return `₹${v}`;
};

const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3">
            <p className="text-sm font-semibold text-gray-700 mb-1">{label}</p>
            <p className="text-sm text-green-600">
                Revenue: <span className="font-bold">₹{payload[0]?.value?.toLocaleString('en-IN')}</span>
            </p>
            {payload[1] && (
                <p className="text-xs text-gray-500">
                    Bookings: <span className="font-medium">{payload[1].value}</span>
                </p>
            )}
        </div>
    );
};

const RevenueChart = ({ data = [] }) => {
    const chartData = useMemo(() => fillMonths(data), [data]);
    const hasData   = chartData.some((d) => d.revenue > 0);

    const totalRevenue = data.reduce((sum, d) => sum + (d.revenue || 0), 0);

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex justify-between items-start mb-4">
                <div>
                    <h3 className="text-base font-semibold text-gray-800">
                        Revenue Trend
                        <span className="ml-2 text-xs font-normal text-gray-400">Package bookings</span>
                    </h3>
                </div>
                {hasData && (
                    <div className="text-right">
                        <p className="text-xs text-gray-400">Last 12 months</p>
                        <p className="text-lg font-bold text-green-600">
                            {formatINR(totalRevenue)}
                        </p>
                    </div>
                )}
            </div>

            {!hasData ? (
                <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
                    No revenue data yet
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis
                            dataKey="label"
                            tick={{ fontSize: 11, fill: '#9ca3af' }}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            tickFormatter={formatINR}
                            tick={{ fontSize: 11, fill: '#9ca3af' }}
                            tickLine={false}
                            axisLine={false}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Area
                            type="monotone"
                            dataKey="revenue"
                            stroke="#10b981"
                            strokeWidth={2.5}
                            fill="url(#revenueGrad)"
                            dot={{ r: 3, fill: '#10b981', strokeWidth: 0 }}
                            activeDot={{ r: 5 }}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            )}
        </div>
    );
};

export default RevenueChart;
