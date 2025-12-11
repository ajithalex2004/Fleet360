'use client';

import { useEffect, useState } from 'react';
import { Alert, ActionStatus, AlertSeverity } from '@/types/maintenance';
import { getAlerts } from '@/services/mockData';
import AlertCard from '@/components/ActionCentre/AlertCard';
import FilterBar from '@/components/Maintenance/FilterBar';
import Link from 'next/link';

export default function ActionCentreHistoryPage() {
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [loading, setLoading] = useState(true);
    const [filteredAlerts, setFilteredAlerts] = useState<Alert[]>([]);
    const [viewingAlert, setViewingAlert] = useState<Alert | null>(null);

    useEffect(() => {
        getAlerts().then((data) => {
            // Filter only resolved/closed alerts
            const historyAlerts = data.filter(a => a.status === ActionStatus.RESOLVED || a.status === 'Closed' as ActionStatus);
            setAlerts(historyAlerts);
            setFilteredAlerts(historyAlerts);
            setLoading(false);
        });
    }, []);

    const handleFilter = (term: string, dateRange: { start: string, end: string }, statuses: string[]) => {
        let result = alerts;

        // Search
        if (term) {
            const lowerTerm = term.toLowerCase();
            result = result.filter(a =>
                a.title.toLowerCase().includes(lowerTerm) ||
                a.description.toLowerCase().includes(lowerTerm) ||
                a.type.toLowerCase().includes(lowerTerm)
            );
        }

        // Date Range
        if (dateRange.start) {
            result = result.filter(a => a.dateCreated >= dateRange.start);
        }
        if (dateRange.end) {
            result = result.filter(a => a.dateCreated <= dateRange.end);
        }

        setFilteredAlerts(result);
    };

    // History page is read-only for actions, but we might want to allow viewing details
    const handleViewClick = (alert: Alert) => {
        setViewingAlert(alert);
    };

    if (loading) return <div className="p-8 text-center">Loading history...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <Link href="/maintenance/action-centre" className="text-slate-400 hover:text-slate-600 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                            </svg>
                        </Link>
                        <h1 className="text-2xl font-bold text-slate-900">Alert History</h1>
                    </div>
                    <p className="mt-1 text-slate-500 ml-8">View resolved and closed alerts.</p>
                </div>
            </div>

            <FilterBar
                onSearch={(term) => handleFilter(term, { start: '', end: '' }, [])}
                onDateRangeChange={(start, end) => handleFilter('', { start, end }, [])}
                onStatusChange={() => { }} // Status filter disabled for history (all resolved)
                statusOptions={[]}
                placeholder="Search history..."
            />

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {filteredAlerts.map((alert) => (
                    <AlertCard
                        key={alert.id}
                        alert={alert}
                        onAction={() => { }} // No actions in history
                        onAssign={() => { }}
                        onEscalate={() => { }}
                        onView={handleViewClick}
                        isHistory={true} // Optional: Pass a flag if AlertCard supports different rendering
                    />
                ))}
            </div>

            {filteredAlerts.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center">
                    <p className="text-slate-500">No resolved alerts found.</p>
                </div>
            )}

            {/* View Details Modal */}
            {viewingAlert && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-bold text-slate-900">Alert Details</h3>
                            <button onClick={() => setViewingAlert(null)} className="text-slate-400 hover:text-slate-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="space-y-6">
                            {/* Header Info */}
                            <div className="flex items-start justify-between">
                                <div>
                                    <h4 className="text-lg font-semibold text-slate-900">{viewingAlert.title}</h4>
                                    <p className="text-sm text-slate-500 mt-1">ID: {viewingAlert.id.toUpperCase()}</p>
                                </div>
                                <span className={`rounded-full px-3 py-1 text-xs font-medium bg-green-100 text-green-700`}>
                                    {viewingAlert.status}
                                </span>
                            </div>

                            {/* Main Details */}
                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Type</label>
                                    <p className="text-sm font-medium text-slate-900">{viewingAlert.type}</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Date Created</label>
                                    <p className="text-sm font-medium text-slate-900">{new Date(viewingAlert.dateCreated).toLocaleString()}</p>
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
                                    <p className="text-sm text-slate-900 bg-slate-50 p-3 rounded-lg border border-slate-100">
                                        {viewingAlert.description}
                                    </p>
                                </div>
                            </div>

                            {/* Assignment Details - Only if Assigned/Resolved */}
                            {viewingAlert.assignedTo && (
                                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                                    <h4 className="text-sm font-bold text-blue-900 mb-3 flex items-center gap-2">
                                        Assignment Details
                                    </h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-medium text-blue-700 mb-1">Assigned To</label>
                                            <p className="text-sm font-medium text-blue-900">{viewingAlert.assignedTo}</p>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-blue-700 mb-1">Assigned Date</label>
                                            <p className="text-sm font-medium text-blue-900">
                                                {viewingAlert.assignedDate ? new Date(viewingAlert.assignedDate).toLocaleString() : 'N/A'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="mt-8 flex justify-end">
                            <button
                                onClick={() => setViewingAlert(null)}
                                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
