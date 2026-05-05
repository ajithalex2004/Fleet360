'use client';

import { useEffect, useState } from 'react';
import { Alert, ActionStatus, AlertSeverity } from '@/types/maintenance';
import { getAlerts } from '@/services/mockData';
import { sendNotification, sendEventNotification } from '@/utils/notifications';
import AlertCard from '@/components/ActionCentre/AlertCard';
import FilterBar from '@/components/Maintenance/FilterBar';
import Link from 'next/link';

export default function ActionCentrePage() {
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [loading, setLoading] = useState(true);
    const [filteredAlerts, setFilteredAlerts] = useState<Alert[]>([]);
    const [assigningAlert, setAssigningAlert] = useState<Alert | null>(null);
    const [escalatingAlert, setEscalatingAlert] = useState<Alert | null>(null);
    const [viewingAlert, setViewingAlert] = useState<Alert | null>(null);
    const [assignEmail, setAssignEmail] = useState('');
    const [escalateEmail, setEscalateEmail] = useState('');
    const [escalateReason, setEscalateReason] = useState('');

    useEffect(() => {
        getAlerts().then((data) => {
            // Filter out resolved/closed alerts for the main active view
            const activeAlerts = data.filter((a: Alert) => a.status !== ActionStatus.RESOLVED && a.status !== 'Closed' as ActionStatus);
            setAlerts(activeAlerts);
            setFilteredAlerts(activeAlerts);
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

    const handleAction = async (id: string, action: ActionStatus) => {
        // Optimistic update
        const updateAlerts = (prev: Alert[]) => prev.map((alert) =>
            alert.id === id ? { ...alert, status: action, ...(action === ActionStatus.ASSIGNED ? { assignedDate: new Date().toISOString() } : {}) } : alert
        );

        setAlerts(prev => {
            const updated = updateAlerts(prev);
            setFilteredAlerts(prevFiltered => updateAlerts(prevFiltered));
            return updated;
        });

        // Backend update
        try {
            const updates: Partial<Alert> = { status: action };
            if (action === ActionStatus.ASSIGNED) {
                updates.assignedDate = new Date().toISOString();
            }
            await import('@/services/mockData').then(m => m.updateAlert(id, updates));
        } catch (error) {
            console.error('Failed to persist alert action:', error);
            // In a real app, revert optimistic update here
        }
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

    const handleViewClick = (alert: Alert) => {
        setViewingAlert(alert);
    };

    const handleAssignSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        console.log('[ActionCentre] Handle Assign Submit clicked', { assigningAlert, assignEmail });
        if (assigningAlert && assignEmail) {
            // In a real app, we'd call an API here. For now, we update local state.
            // We also need to update the specific alert with the assignee email
            const updatedAlerts = alerts.map(a =>
                a.id === assigningAlert.id
                    ? { ...a, status: ActionStatus.ASSIGNED, assignedTo: assignEmail, assignedDate: new Date().toISOString() }
                    : a
            );
            setAlerts(updatedAlerts);
            setFilteredAlerts(updatedAlerts);

            // Persist assignment
            import('@/services/mockData').then(m =>
                m.updateAlert(assigningAlert.id, {
                    status: ActionStatus.ASSIGNED,
                    assignedTo: assignEmail,
                    assignedDate: new Date().toISOString()
                })
            ).catch(err => console.error('Failed to persist assignment:', err));

            setAssigningAlert(null);
            setAssignEmail('');

            // Send Notification
            console.log('[ActionCentre] Attempting to send configured notification...');

            // Try new system first (SR_ASSIGNED maps to "Assignment" concept here)
            const handled = await sendEventNotification(
                'SR_ASSIGNED',
                {
                    requestId: assigningAlert.id,
                    title: assigningAlert.title,
                    description: assigningAlert.description,
                    assignee: assignEmail,
                    severity: assigningAlert.severity
                },
                assignEmail
            );

            if (handled) {
                alert(`Alert assigned and configured notification sent.`);
            } else {
                console.log('[ActionCentre] No rule matched or enabled, falling back to legacy notification...');
                const success = await sendNotification(
                    assignEmail,
                    `Alert Assigned: ${assigningAlert.title}`,
                    `You have been assigned to handle the following alert:\n\nTitle: ${assigningAlert.title}\nSeverity: ${assigningAlert.severity}\nDescription: ${assigningAlert.description}\n\nPlease take necessary action.`,
                    'Email',
                    'Alert Assignment'
                );

                if (success) {
                    alert(`Alert assigned to ${assignEmail} and notification sent.`);
                } else {
                    alert(`Alert assigned to ${assignEmail}, but notification delivery failed. Please check system logs.`);
                }
            }
        } else {
            console.warn('[ActionCentre] Missing alert or email', { assigningAlert, assignEmail });
        }
    };

    const handleEscalateSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (escalatingAlert && escalateEmail) {
            handleAction(escalatingAlert.id, ActionStatus.ESCALATED); // This handles status update persistence

            // Pending: We should also persist 'escalateEmail' and 'escalateReason' if the backend supports it.
            // For now, assuming status update is sufficient for the main persistence issue.

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
                    <h1 className="text-2xl font-bold text-white">Action Centre</h1>
                    <p className="mt-1 text-slate-500">Monitor and respond to fleet alerts.</p>
                </div>
                <div>
                    <Link href="/maintenance/action-centre/history" className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 border border-white/15 rounded-lg text-sm font-medium text-slate-300 hover:bg-white/5 shadow-sm transition-all hover:shadow">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-slate-500">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                        View History
                    </Link>
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
                        onView={handleViewClick}
                    />
                ))}
            </div>

            {filteredAlerts.length === 0 && (
                <div className="rounded-xl border border-dashed border-white/15 p-12 text-center">
                    <p className="text-slate-500">No alerts found for this filter.</p>
                </div>
            )}

            {/* Assignment Modal */}
            {assigningAlert && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="w-full max-w-2xl rounded-xl bg-slate-900 p-6 shadow-2xl">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-white">Assign Alert</h3>
                            <button onClick={() => setAssigningAlert(null)} className="text-slate-400 hover:text-slate-300">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Alert Details */}
                        <div className="mb-6 rounded-lg border border-white/10 bg-slate-800/50 p-4">
                            <h4 className="font-semibold text-white mb-3">Alert Details</h4>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="font-medium text-slate-600">Title:</span>
                                    <span className="text-white">{assigningAlert.title}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-medium text-slate-600">Type:</span>
                                    <span className="text-white">{assigningAlert.type}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-medium text-slate-600">Severity:</span>
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${assigningAlert.severity === AlertSeverity.CRITICAL ? 'bg-red-500/20 text-red-700' :
                                        assigningAlert.severity === AlertSeverity.HIGH ? 'bg-orange-500/20 text-orange-700' :
                                            assigningAlert.severity === AlertSeverity.MEDIUM ? 'bg-amber-100 text-amber-700' :
                                                'bg-blue-500/20 text-blue-700'
                                        }`}>
                                        {assigningAlert.severity}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-medium text-slate-600">Created:</span>
                                    <span className="text-white">{new Date(assigningAlert.dateCreated).toLocaleString()}</span>
                                </div>
                                <div className="pt-2 border-t border-white/10">
                                    <span className="font-medium text-slate-600">Description:</span>
                                    <p className="mt-1 text-white">{assigningAlert.description}</p>
                                </div>
                            </div>
                        </div>

                        {/* Assignment Form */}
                        <form onSubmit={handleAssignSubmit}>
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Assign To (Email) *
                                </label>
                                <input
                                    type="email"
                                    required
                                    className="block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
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
                                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10"
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
                    <div className="w-full max-w-2xl rounded-xl bg-slate-900 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-white">Escalate Alert</h3>
                            <button onClick={() => setEscalatingAlert(null)} className="text-slate-400 hover:text-slate-300">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Alert Details */}
                        <div className="mb-6 rounded-lg border border-orange-200 bg-orange-500/10 p-4">
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
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${escalatingAlert.severity === AlertSeverity.CRITICAL ? 'bg-red-500/20 text-red-700' :
                                        escalatingAlert.severity === AlertSeverity.HIGH ? 'bg-orange-500/20 text-orange-700' :
                                            escalatingAlert.severity === AlertSeverity.MEDIUM ? 'bg-amber-100 text-amber-700' :
                                                'bg-blue-500/20 text-blue-700'
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
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Escalate To (Email) *
                                </label>
                                <input
                                    type="email"
                                    required
                                    className="block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 text-white"
                                    placeholder="Enter supervisor/manager email address"
                                    value={escalateEmail}
                                    onChange={(e) => setEscalateEmail(e.target.value)}
                                />
                                <p className="mt-1 text-xs text-slate-500">
                                    This alert will be escalated to the specified person with high priority.
                                </p>
                            </div>

                            <div className="mb-6">
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Escalation Reason
                                </label>
                                <textarea
                                    rows={3}
                                    className="block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 text-white"
                                    placeholder="Explain why this alert needs to be escalated..."
                                    value={escalateReason}
                                    onChange={(e) => setEscalateReason(e.target.value)}
                                />
                            </div>

                            <div className="flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setEscalatingAlert(null)}
                                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10"
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

            {/* View Details Modal */}
            {viewingAlert && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="w-full max-w-2xl rounded-xl bg-slate-900 p-6 shadow-2xl">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-bold text-white">Alert Details</h3>
                            <button onClick={() => setViewingAlert(null)} className="text-slate-400 hover:text-slate-300">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="space-y-6">
                            {/* Header Info */}
                            <div className="flex items-start justify-between">
                                <div>
                                    <h4 className="text-lg font-semibold text-white">{viewingAlert.title}</h4>
                                    <p className="text-sm text-slate-500 mt-1">ID: {viewingAlert.id.toUpperCase()}</p>
                                </div>
                                <span className={`rounded-full px-3 py-1 text-xs font-medium ${viewingAlert.severity === AlertSeverity.CRITICAL ? 'bg-red-500/20 text-red-700' :
                                    viewingAlert.severity === AlertSeverity.HIGH ? 'bg-orange-500/20 text-orange-700' :
                                        viewingAlert.severity === AlertSeverity.MEDIUM ? 'bg-amber-100 text-amber-700' :
                                            'bg-blue-500/20 text-blue-700'
                                    }`}>
                                    {viewingAlert.severity} Severity
                                </span>
                            </div>

                            {/* Main Details */}
                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Type</label>
                                    <p className="text-sm font-medium text-white">{viewingAlert.type}</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Date Created</label>
                                    <p className="text-sm font-medium text-white">{new Date(viewingAlert.dateCreated).toLocaleString()}</p>
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
                                    <p className="text-sm text-white bg-slate-800/50 p-3 rounded-lg border border-white/5">
                                        {viewingAlert.description}
                                    </p>
                                </div>
                            </div>

                            {/* Assignment Details - Only if Assigned */}
                            {viewingAlert.status === ActionStatus.ASSIGNED && (
                                <div className="rounded-xl border border-blue-200 bg-blue-500/10 p-4">
                                    <h4 className="text-sm font-bold text-blue-300 mb-3 flex items-center gap-2">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                            <path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 0 0-13.074.003Z" />
                                        </svg>
                                        Assignment Details
                                    </h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-medium text-blue-700 mb-1">Assigned To</label>
                                            <p className="text-sm font-medium text-blue-300">{viewingAlert.assignedTo || 'N/A'}</p>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-blue-700 mb-1">Assigned Date</label>
                                            <p className="text-sm font-medium text-blue-300">
                                                {viewingAlert.assignedDate ? new Date(viewingAlert.assignedDate).toLocaleString() : 'N/A'}
                                            </p>
                                        </div>
                                        {viewingAlert.assignmentNote && (
                                            <div className="col-span-2">
                                                <label className="block text-xs font-medium text-blue-700 mb-1">Note</label>
                                                <p className="text-sm text-blue-300 italic">"{viewingAlert.assignmentNote}"</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="mt-8 flex justify-end">
                            <button
                                onClick={() => setViewingAlert(null)}
                                className="rounded-lg bg-slate-700/40 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-200"
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
