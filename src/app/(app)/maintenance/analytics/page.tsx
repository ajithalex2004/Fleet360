'use client';

import { useState, useEffect } from 'react';
import {
    GaragePerformance,
    Garage,
    MaintenanceStatus
} from '@/types/maintenance';
import { getMaintenanceRequests } from '@/services/mockData';

export default function AnalyticsPage() {
    const [selectedPeriod, setSelectedPeriod] = useState('2024-Q4');

    // Mock analytics data
    const [fleetStats, setFleetStats] = useState({
        totalVehicles: 45,
        activeVehicles: 42,
        inService: 3,
        avgHealthScore: 78,
        totalMaintenanceCost: 125400,
        avgCostPerVehicle: 2787,
        totalDowntimeDays: 0,
        preventiveVsCorrective: { preventive: 65, corrective: 35 }
    });

    useEffect(() => {
        const calculateStats = async () => {
            const requests = await getMaintenanceRequests();

            // Calculate Total Downtime
            let totalDowntimeMs = 0;

            requests.forEach(req => {
                // Check if request is completed and has necessary timestamps
                if (req.status === MaintenanceStatus.MAINTENANCE_COMPLETED && req.statusTimeline) {
                    const startStr = req.statusTimeline[MaintenanceStatus.UNDER_MAINTENANCE];
                    const endStr = req.statusTimeline[MaintenanceStatus.MAINTENANCE_COMPLETED] || req.completionDate;

                    if (startStr && endStr) {
                        const start = new Date(startStr).getTime();
                        const end = new Date(endStr).getTime();
                        const duration = end - start;

                        if (duration > 0) {
                            totalDowntimeMs += duration;
                        }
                    }
                }
            });

            // Convert to days (rounded to 1 decimal place)
            const totalDowntimeDays = Math.round((totalDowntimeMs / (1000 * 60 * 60 * 24)) * 10) / 10;

            setFleetStats(prev => ({
                ...prev,
                totalDowntimeDays
            }));
        };

        calculateStats();
    }, []);

    const costTrends = [
        { month: 'Jul', cost: 18500 },
        { month: 'Aug', cost: 22000 },
        { month: 'Sep', cost: 19800 },
        { month: 'Oct', cost: 24100 },
        { month: 'Nov', cost: 21000 },
        { month: 'Dec', cost: 20000 }
    ];

    const topIssues = [
        { issue: 'Brake System', occurrences: 12, avgCost: 850 },
        { issue: 'Engine Oil Leak', occurrences: 8, avgCost: 450 },
        { issue: 'AC Malfunction', occurrences: 7, avgCost: 600 },
        { issue: 'Battery Replacement', occurrences: 6, avgCost: 200 },
        { issue: 'Tire Replacement', occurrences: 5, avgCost: 400 }
    ];

    const maxCost = Math.max(...costTrends.map(t => t.cost));

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Fleet Analytics</h1>
                    <p className="mt-1 text-slate-500">Comprehensive fleet performance insights</p>
                </div>
                <select
                    value={selectedPeriod}
                    onChange={(e) => setSelectedPeriod(e.target.value)}
                    className="rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                >
                    <option value="2024-Q4">Q4 2024</option>
                    <option value="2024-Q3">Q3 2024</option>
                    <option value="2024-Q2">Q2 2024</option>
                </select>
            </div>

            {/* Fleet Overview */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                    <p className="text-sm text-slate-500">Total Vehicles</p>
                    <p className="text-3xl font-bold text-white">{fleetStats.totalVehicles}</p>
                    <p className="text-xs text-green-600 mt-1">↑ {fleetStats.activeVehicles} active</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                    <p className="text-sm text-slate-500">Avg Health Score</p>
                    <p className="text-3xl font-bold text-green-600">{fleetStats.avgHealthScore}</p>
                    <p className="text-xs text-slate-500 mt-1">Out of 100</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                    <p className="text-sm text-slate-500">Total Cost (6mo)</p>
                    <p className="text-3xl font-bold text-white">AED {(fleetStats.totalMaintenanceCost / 1000).toFixed(0)}K</p>
                    <p className="text-xs text-slate-500 mt-1">AED {fleetStats.avgCostPerVehicle}/vehicle</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                    <p className="text-sm text-slate-500">Total Downtime</p>
                    <p className="text-3xl font-bold text-orange-600">{fleetStats.totalDowntimeDays}</p>
                    <p className="text-xs text-slate-500 mt-1">days</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Cost Trends */}
                <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-white mb-4">Cost Trends (Last 6 Months)</h3>
                    <div className="space-y-3">
                        {costTrends.map(trend => (
                            <div key={trend.month} className="flex items-center gap-3">
                                <span className="text-sm font-medium text-slate-300 w-12">{trend.month}</span>
                                <div className="flex-1 bg-slate-200 rounded-full h-8 relative">
                                    <div
                                        className="bg-blue-600 h-8 rounded-full flex items-center justify-end pr-3"
                                        style={{ width: `${(trend.cost / maxCost) * 100}%` }}
                                    >
                                        <span className="text-xs font-medium text-white">AED {(trend.cost / 1000).toFixed(1)}K</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Preventive vs Corrective */}
                <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-white mb-4">Maintenance Type Distribution</h3>
                    <div className="flex items-center justify-center h-48">
                        <div className="relative w-48 h-48">
                            <svg viewBox="0 0 100 100" className="transform -rotate-90">
                                <circle cx="50" cy="50" r="40" fill="none" stroke="#e2e8f0" strokeWidth="20" />
                                <circle
                                    cx="50"
                                    cy="50"
                                    r="40"
                                    fill="none"
                                    stroke="#3b82f6"
                                    strokeWidth="20"
                                    strokeDasharray={`${fleetStats.preventiveVsCorrective.preventive * 2.51} ${251 - fleetStats.preventiveVsCorrective.preventive * 2.51}`}
                                />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="text-center">
                                    <p className="text-3xl font-bold text-blue-600">{fleetStats.preventiveVsCorrective.preventive}%</p>
                                    <p className="text-xs text-slate-500">Preventive</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mt-4">
                        <div className="text-center">
                            <div className="flex items-center justify-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-blue-600" />
                                <span className="text-sm text-slate-300">Preventive</span>
                            </div>
                            <p className="text-lg font-bold text-white mt-1">{fleetStats.preventiveVsCorrective.preventive}%</p>
                        </div>
                        <div className="text-center">
                            <div className="flex items-center justify-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-slate-300" />
                                <span className="text-sm text-slate-300">Corrective</span>
                            </div>
                            <p className="text-lg font-bold text-white mt-1">{fleetStats.preventiveVsCorrective.corrective}%</p>
                        </div>
                    </div>
                </div>

                {/* Top Issues */}
                <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm lg:col-span-2">
                    <h3 className="text-lg font-bold text-white mb-4">Top Maintenance Issues</h3>
                    <div className="overflow-hidden rounded-lg border border-white/10">
                        <table className="min-w-full divide-y divide-white/10">
                            <thead className="bg-slate-800/50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Issue</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Occurrences</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Avg Cost</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Total Impact</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10 bg-slate-900">
                                {topIssues.map((issue, idx) => (
                                    <tr key={idx}>
                                        <td className="px-6 py-4 text-sm font-medium text-white">{issue.issue}</td>
                                        <td className="px-6 py-4 text-sm text-slate-300">{issue.occurrences}</td>
                                        <td className="px-6 py-4 text-sm text-slate-300">AED {issue.avgCost}</td>
                                        <td className="px-6 py-4 text-sm font-medium text-red-600">
                                            AED {(issue.occurrences * issue.avgCost).toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
