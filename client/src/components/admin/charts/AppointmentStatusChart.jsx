import React from 'react';
import {
    PieChart, Pie, Cell, Tooltip,
    ResponsiveContainer, Legend,
} from 'recharts';

const STATUS_COLORS = {
    Scheduled:  '#f59e0b',
    Completed:  '#10b981',
    Cancelled:  '#ef4444',
};

const TYPE_COLORS = {
    Online:  '#6366f1',
    Offline: '#8b5cf6',
};

const RADIAN = Math.PI / 180;

const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
    if (percent < 0.05) return null; // skip tiny slices
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
        <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central"
            fontSize={11} fontWeight={600}>
            {`${(percent * 100).toFixed(0)}%`}
        </text>
    );
};

const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const { name, value } = payload[0];
    return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3">
            <p className="text-sm font-semibold text-gray-700">{name}</p>
            <p className="text-sm text-gray-600">{value} appointments</p>
        </div>
    );
};

const AppointmentStatusChart = ({ statusData = [], typeData = [] }) => {
    const statusChartData = statusData.map((d) => ({ name: d.status, value: d.count }));
    const typeChartData   = typeData.map((d)   => ({ name: d.type,   value: d.count }));
    const hasData = statusChartData.some((d) => d.value > 0);

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-4">
                Appointment Breakdown
            </h3>

            {!hasData ? (
                <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
                    No appointment data yet
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-4">
                    {/* By status */}
                    <div>
                        <p className="text-xs text-gray-400 text-center mb-2">By Status</p>
                        <ResponsiveContainer width="100%" height={180}>
                            <PieChart>
                                <Pie
                                    data={statusChartData}
                                    cx="50%" cy="50%"
                                    outerRadius={70}
                                    labelLine={false}
                                    label={renderCustomLabel}
                                    dataKey="value"
                                >
                                    {statusChartData.map((entry) => (
                                        <Cell key={entry.name}
                                            fill={STATUS_COLORS[entry.name] || '#9ca3af'} />
                                    ))}
                                </Pie>
                                <Tooltip content={<CustomTooltip />} />
                                <Legend
                                    iconType="circle"
                                    iconSize={8}
                                    formatter={(v) => <span className="text-xs text-gray-600">{v}</span>}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>

                    {/* By type */}
                    <div>
                        <p className="text-xs text-gray-400 text-center mb-2">By Type</p>
                        <ResponsiveContainer width="100%" height={180}>
                            <PieChart>
                                <Pie
                                    data={typeChartData}
                                    cx="50%" cy="50%"
                                    innerRadius={35}
                                    outerRadius={70}
                                    labelLine={false}
                                    label={renderCustomLabel}
                                    dataKey="value"
                                >
                                    {typeChartData.map((entry) => (
                                        <Cell key={entry.name}
                                            fill={TYPE_COLORS[entry.name] || '#9ca3af'} />
                                    ))}
                                </Pie>
                                <Tooltip content={<CustomTooltip />} />
                                <Legend
                                    iconType="circle"
                                    iconSize={8}
                                    formatter={(v) => <span className="text-xs text-gray-600">{v}</span>}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AppointmentStatusChart;
