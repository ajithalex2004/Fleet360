'use client';

import { useEffect, useState } from 'react';
import { Alert, ActionStatus } from '@/types/maintenance';
import { getAlerts } from '@/services/mockData';
import AlertCard from '@/components/ActionCentre/AlertCard';
import FilterBar from '@/components/Maintenance/FilterBar';

export default function ActionCentrePage() {
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [loading, setLoading] = useState(true);
    const [filteredAlerts, setFilteredAlerts] = useState<Alert[]>([]);
    const [assigningAlert, setAssigningAlert] = useState<Alert | null>(null);
    const [escalatingAlert, setEscalatingAlert] = useState<Alert | null>(null);
    const [assignEmail, setAssignEmail] = useState('');
    const [escalateEmail, setEscalateEmail] = useState('');
    const [escalateReason, setEscalateReason] = useState('');

    useEffect(() => {
        getAlerts().then((data) => {
            setAlerts(data);
            setFilteredAlerts(data);
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

        // Status
        if (statuses.length > 0) {
            result = result.filter(a => statuses.includes(a.status));
        }

        setFilteredAlerts(result);
    };

    const handleAction = (id: string, action: ActionStatus) => {
        const updateAlerts = (prev: Alert[]) => prev.map((alert) =>
            alert.id === id ? { ...alert, status: action } : alert
        );

        setAlerts(prev => {
            const updated = updateAlerts(prev);
            // We should re-apply filters here, but for simplicity we'll just update the filtered list similarly
            // Ideally, we would separate 'data' and 'view' more cleanly or use a useMemo for filtering
            setFilteredAlerts(prevFiltered => updateAlerts(prevFiltered));
            return updated;
        });
    };

    const handleAssignClick = (alert: Alert) => {
        setAssigningAlert(alert);
        setAssignEmail('');
    };

    const handleEscalateClick = (alert: Alert) => {
        setEscalatingAlert(alert);
        setEscalateEmail('');
        setEscalateReason('');
    };

    const handleAssignSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (assigningAlert && assignEmail) {
            handleAction(assigningAlert.id, ActionStatus.ASSIGNED);
            setAssigningAlert(null);
            setAssignEmail('');
        }
    };

    const handleEscalateSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (escalatingAlert && escalateEmail) {
            handleAction(escalatingAlert.id, ActionStatus.ESCALATED);
            setEscalatingAlert(null);
            setEscalateEmail('');
            setEscalateReason('');
        }
    };

    if (loading) return <div className="p-8 text-center">Loading alerts...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Action Centre</h1>
                    <p className="mt-1 text-slate-500">Monitor and respond to fleet alerts.</p>
                </div>
            </div>

            <FilterBar
                onSearch={(term) => handleFilter(term, { start: '', end: '' }, [])}
                onDateRangeChange={(start, end) => handleFilter('', { start, end }, [])}
                onStatusChange={(statuses) => handleFilter('', { start: '', end: '' }, statuses)}
                statusOptions={[ActionStatus.PENDING, ActionStatus.ACKNOWLEDGED, ActionStatus.ASSIGNED, ActionStatus.ESCALATED, ActionStatus.RESOLVED]}
                placeholder="Search alerts..."
            />

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {filteredAlerts.map((alert) => (
                    <AlertCard
                        key={alert.id}
                        alert={alert}
                        onAction={handleAction}
                        onAssign={handleAssignClick}
                        onEscalate={handleEscalateClick}
                    />
                ))}
            </div>

            {filteredAlerts.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center">
                    <p className="text-slate-500">No alerts found for this filter.</p>
                </div>
            )}

            {/* Assignment Modal */}
            {assigningAlert && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-900">Assign Alert</h3>
                            <button onClick={() => setAssigningAlert(null)} className="text-slate-400 hover:text-slate-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Alert Details */}
                        <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
                            <h4 className="font-semibold text-slate-900 mb-3">Alert Details</h4>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="font-medium text-slate-600">Title:</span>
                                    <span className="text-slate-900">{assigningAlert.title}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-medium text-slate-600">Type:</span>
                                    <span className="text-slate-900">{assigningAlert.type}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-medium text-slate-600">Severity:</span>
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${assigningAlert.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                                        assigningAlert.severity === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                                            assigningAlert.severity === 'MEDIUM' ? 'bg-amber-100 text-amber-700' :
                                                'bg-blue-100 text-blue-700'
                                        }`}>
                                        {assigningAlert.severity}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-medium text-slate-600">Created:</span>
                                    <span className="text-slate-900">{new Date(assigningAlert.dateCreated).toLocaleString()}</span>
                                </div>
                                <div className="pt-2 border-t border-slate-200">
                                    <span className="font-medium text-slate-600">Description:</span>
                                    <p className="mt-1 text-slate-900">{assigningAlert.description}</p>
                                </div>
                            </div>
                        </div>

                        {/* Assignment Form */}
                        <form onSubmit={handleAssignSubmit}>
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Assign To (Email) *
                                </label>
                                <input
                                    type="email"
                                    required
                                    className="block w-full rounded-lg border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="Enter email address"
                                    value={assignEmail}
                                    onChange={(e) => setAssignEmail(e.target.value)}
                                />
                                <p className="mt-1 text-xs text-slate-500">
                                    The alert will be assigned to this person and they will receive a notification.
                                </p>
                            </div>

                            <div className="flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setAssigningAlert(null)}
                                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                >
                                    Assign Alert
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Escalation Modal */}
            {escalatingAlert && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-900">Escalate Alert</h3>
                            <button onClick={() => setEscalatingAlert(null)} className="text-slate-400 hover:text-slate-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Alert Details */}
                        <div className="mb-6 rounded-lg border border-orange-200 bg-orange-50 p-4">
                            <h4 className="font-semibold text-orange-900 mb-3">Alert Details</h4>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="font-medium text-orange-700">Title:</span>
                                    <span className="text-orange-900">{escalatingAlert.title}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-medium text-orange-700">Type:</span>
                                    <span className="text-orange-900">{escalatingAlert.type}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-medium text-orange-700">Severity:</span>
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${escalatingAlert.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                                        escalatingAlert.severity === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                                            escalatingAlert.severity === 'MEDIUM' ? 'bg-amber-100 text-amber-700' :
                                                'bg-blue-100 text-blue-700'
                                        }`}>
                                        {escalatingAlert.severity}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-medium text-orange-700">Created:</span>
                                    <span className="text-orange-900">{new Date(escalatingAlert.dateCreated).toLocaleString()}</span>
                                </div>
                                <div className="pt-2 border-t border-orange-200">
                                    <span className="font-medium text-orange-700">Description:</span>
                                    <p className="mt-1 text-orange-900">{escalatingAlert.description}</p>
                                </div>
                            </div>
                        </div>

                        {/* Escalation Form */}
                        <form onSubmit={handleEscalateSubmit}>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Escalate To (Email) *
                                </label>
                                <input
                                    type="email"
                                    required
                                    className="block w-full rounded-lg border border-slate-300 px-3 py-2 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                                    placeholder="Enter supervisor/manager email address"
                                    value={escalateEmail}
                                    onChange={(e) => setEscalateEmail(e.target.value)}
                                />
                                <p className="mt-1 text-xs text-slate-500">
                                    This alert will be escalated to the specified person with high priority.
                                </p>
                            </div>

                            <div className="mb-6">
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Escalation Reason
                                </label>
                                <textarea
                                    rows={3}
                                    className="block w-full rounded-lg border border-slate-300 px-3 py-2 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                                    placeholder="Explain why this alert needs to be escalated..."
                                    value={escalateReason}
                                    onChange={(e) => setEscalateReason(e.target.value)}
                                />
                            </div>

                            <div className="flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setEscalatingAlert(null)}
                                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="rounded-lg bg-orange-600 px-6 py-2 text-sm font-medium text-white hover:bg-orange-700"
                                >
                                    Escalate Alert
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
