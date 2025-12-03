'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
    VehicleHistory,
    RecurringIssue,
    MaintenanceRequest,
    MaintenanceType,
    Vehicle
} from '@/types/maintenance';
import {
    getMaintenanceRequests,
    getVehicles
} from '@/services/mockData';

export default function VehicleHistoryPage() {
    const params = useParams();
    const vehicleId = params.id as string;

    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [history, setHistory] = useState<VehicleHistory | null>(null);
    const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            const [allVehicles, allRequests] = await Promise.all([
                getVehicles(),
                getMaintenanceRequests()
            ]);

            const foundVehicle = allVehicles.find(v => v.id === vehicleId);
            setVehicle(foundVehicle || null);

            const vehicleRequests = allRequests.filter(r => r.vehicleId === vehicleId);
            setRequests(vehicleRequests);

            // Calculate history
            const totalCost = vehicleRequests.reduce((sum, r) => sum + (r.actualCost || r.estimatedCost || 0), 0);
            const avgCost = vehicleRequests.length > 0 ? totalCost / vehicleRequests.length : 0;

            // Calculate downtime
            const totalDowntime = vehicleRequests.reduce((sum, r) => {
                if (r.completionDate && r.requestDate) {
                    const start = new Date(r.requestDate);
                    const end = new Date(r.completionDate);
                    const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
                    return sum + days;
                }
                return sum;
            }, 0);

            // Find recurring issues
            const issueMap = new Map<string, RecurringIssue>();
            vehicleRequests.forEach(r => {
                const issue = r.description.substring(0, 50); // Simplified
                if (issueMap.has(issue)) {
                    const existing = issueMap.get(issue)!;
                    existing.occurrences++;
                    existing.lastOccurrence = r.requestDate;
                    existing.averageCost = (existing.averageCost * (existing.occurrences - 1) + (r.actualCost || r.estimatedCost || 0)) / existing.occurrences;
                    existing.requestIds.push(r.id);
                } else {
                    issueMap.set(issue, {
                        issue,
                        category: r.maintenanceType || 'Unknown',
                        occurrences: 1,
                        lastOccurrence: r.requestDate,
                        averageCost: r.actualCost || r.estimatedCost || 0,
                        requestIds: [r.id]
                    });
                }
            });

            const recurringIssues = Array.from(issueMap.values()).filter(i => i.occurrences > 1);

            // Services by type
            const servicesByType = vehicleRequests.reduce((acc, r) => {
                const type = r.maintenanceType || MaintenanceType.CORRECTIVE;
                acc[type] = (acc[type] || 0) + 1;
                return acc;
            }, {} as Record<MaintenanceType, number>);

            // Cost by year
            const costByYear = vehicleRequests.reduce((acc, r) => {
                const year = new Date(r.requestDate).getFullYear().toString();
                acc[year] = (acc[year] || 0) + (r.actualCost || r.estimatedCost || 0);
                return acc;
            }, {} as Record<string, number>);

            // Calculate health score (0-100)
            let healthScore = 100;
            if (recurringIssues.length > 0) healthScore -= recurringIssues.length * 10;
            if (totalDowntime > 30) healthScore -= 20;
            if (avgCost > 1000) healthScore -= 15;
            healthScore = Math.max(0, Math.min(100, healthScore));

            const vehicleHistory: VehicleHistory = {
                vehicleId,
                totalMaintenanceRequests: vehicleRequests.length,
                totalCost,
                averageCostPerService: avgCost,
                totalDowntimeDays: totalDowntime,
                lastServiceDate: vehicleRequests[0]?.requestDate || '',
                nextScheduledService: 'TBD',
                recurringIssues,
                servicesByType,
                costByYear,
                healthScore
            };

            setHistory(vehicleHistory);
            setLoading(false);
        };
        fetchData();
    }, [vehicleId]);

    const getHealthScoreColor = (score: number) => {
        if (score >= 80) return 'text-green-600';
        if (score >= 60) return 'text-yellow-600';
        if (score >= 40) return 'text-orange-600';
        return 'text-red-600';
    };

    if (loading) return <div className="p-8 text-center text-slate-500">Loading vehicle history...</div>;
    if (!vehicle || !history) return <div className="p-8 text-center text-slate-500">Vehicle not found.</div>;

    return (
        <div className="mx-auto max-w-7xl pb-12 space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <Link href="/maintenance/vehicles" className="text-slate-400 hover:text-slate-600">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                            </svg>
                        </Link>
                        <h1 className="text-2xl font-bold text-slate-900">Vehicle History</h1>
                    </div>
                    <p className="text-slate-500 ml-8">
                        {vehicle.make} {vehicle.model} ({vehicle.licensePlate}) • {vehicle.year}
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-sm text-slate-500">Health Score</p>
                    <p className={`text-4xl font-bold ${getHealthScoreColor(history.healthScore)}`}>
                        {history.healthScore}
                    </p>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-sm text-slate-500">Total Services</p>
                    <p className="text-2xl font-bold text-slate-900">{history.totalMaintenanceRequests}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-sm text-slate-500">Total Cost</p>
                    <p className="text-2xl font-bold text-slate-900">${history.totalCost.toLocaleString()}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-sm text-slate-500">Avg Cost/Service</p>
                    <p className="text-2xl font-bold text-slate-900">${Math.round(history.averageCostPerService).toLocaleString()}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-sm text-slate-500">Total Downtime</p>
                    <p className="text-2xl font-bold text-slate-900">{Math.round(history.totalDowntimeDays)} days</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Service History Timeline */}
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-4">Service History</h3>
                    <div className="space-y-4 max-h-96 overflow-y-auto">
                        {requests.map(req => (
                            <div key={req.id} className="border-l-4 border-blue-500 pl-4 py-2">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <Link href={`/maintenance/requests/${encodeURIComponent(req.id)}`} className="text-sm font-medium text-blue-600 hover:underline">
                                            #{req.id.toUpperCase()}
                                        </Link>
                                        <p className="text-xs text-slate-500 mt-1">
                                            {new Date(req.requestDate).toLocaleDateString()} • {req.maintenanceType}
                                        </p>
                                        <p className="text-sm text-slate-700 mt-1">{req.description}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-medium text-slate-900">
                                            ${(req.actualCost || req.estimatedCost || 0).toLocaleString()}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Recurring Issues */}
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-4">Recurring Issues</h3>
                    {history.recurringIssues.length > 0 ? (
                        <div className="space-y-3">
                            {history.recurringIssues.map((issue, idx) => (
                                <div key={idx} className="rounded-lg border border-red-200 bg-red-50 p-4">
                                    <div className="flex items-start justify-between mb-2">
                                        <p className="text-sm font-medium text-red-900">{issue.issue}...</p>
                                        <span className="inline-flex items-center rounded-full bg-red-200 px-2 py-0.5 text-xs font-medium text-red-800">
                                            {issue.occurrences}x
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs text-red-700">
                                        <div>
                                            <span className="text-red-600">Category:</span> {issue.category}
                                        </div>
                                        <div>
                                            <span className="text-red-600">Avg Cost:</span> ${Math.round(issue.averageCost)}
                                        </div>
                                        <div className="col-span-2">
                                            <span className="text-red-600">Last:</span> {new Date(issue.lastOccurrence).toLocaleDateString()}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-slate-500 text-center py-8">No recurring issues detected</p>
                    )}
                </div>

                {/* Services by Type */}
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-4">Services by Type</h3>
                    <div className="space-y-3">
                        {Object.entries(history.servicesByType).map(([type, count]) => (
                            <div key={type} className="flex items-center justify-between">
                                <span className="text-sm text-slate-700">{type}</span>
                                <div className="flex items-center gap-3">
                                    <div className="w-32 bg-slate-200 rounded-full h-2">
                                        <div
                                            className="bg-blue-600 h-2 rounded-full"
                                            style={{ width: `${(count / history.totalMaintenanceRequests) * 100}%` }}
                                        />
                                    </div>
                                    <span className="text-sm font-medium text-slate-900 w-8 text-right">{count}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Cost by Year */}
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-4">Cost by Year</h3>
                    <div className="space-y-3">
                        {Object.entries(history.costByYear).sort((a, b) => b[0].localeCompare(a[0])).map(([year, cost]) => (
                            <div key={year} className="flex items-center justify-between">
                                <span className="text-sm font-medium text-slate-700">{year}</span>
                                <span className="text-sm font-bold text-slate-900">${cost.toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
