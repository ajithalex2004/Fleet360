import React from 'react';
import { ServiceRequest, MaintenanceRequest } from '@/types/maintenance';

export interface TimelineItem {
    status: string;
    date: string;
    note?: string;
    actor?: string;
    source?: string;
}

interface TimelineModalProps {
    isOpen: boolean;
    onClose: () => void;
    request?: ServiceRequest;
    maintenanceRequest?: MaintenanceRequest;
    items?: TimelineItem[];
    title?: string;
}

export default function TimelineModal({ isOpen, onClose, request, maintenanceRequest, items, title = 'Activity Timeline' }: TimelineModalProps) {
    if (!isOpen) return null;

    let displayItems: TimelineItem[] = [];

    if (items) {
        displayItems = items;
    } else if (request) {
        const history = request.history || [];
        // Combine Service Request History with Maintenance Request Status Timeline
        let combinedHistory = history.map(h => ({ ...h, source: 'Service Request' }));

        if (maintenanceRequest) {
            // Support for legacy statusTimeline
            if (maintenanceRequest.statusTimeline && typeof maintenanceRequest.statusTimeline === 'object') {
                try {
                    const maintenanceHistory = Object.entries(maintenanceRequest.statusTimeline).map(([status, date]) => ({
                        status: status,
                        date: date as string,
                        note: `Maintenance Status Update`,
                        actor: 'Maintenance System',
                        source: 'Maintenance Request'
                    }));
                    combinedHistory = [...combinedHistory, ...maintenanceHistory];
                } catch (e) {
                    console.error('Error processing maintenance timeline', e);
                }
            }

            // Support for backend history array
            if (maintenanceRequest.history && Array.isArray(maintenanceRequest.history)) {
                const backendHistory = maintenanceRequest.history.map(h => ({
                    status: h.status,
                    date: h.date,
                    note: h.note || `Status updated to ${h.status}`,
                    actor: h.actor || 'System',
                    source: 'Maintenance Request'
                }));
                combinedHistory = [...combinedHistory, ...backendHistory];
            }
        }
        displayItems = combinedHistory;
    }

    // Sort history by date descending
    const sortedHistory = displayItems.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return (isNaN(dateB) ? 0 : dateB) - (isNaN(dateA) ? 0 : dateA);
    });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-slate-900">{title}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 max-h-[60vh] overflow-y-auto">
                    <div className="relative border-l border-slate-200 ml-3 space-y-8">
                        {sortedHistory.length === 0 ? (
                            <p className="text-slate-500 text-sm pl-6">No history available.</p>
                        ) : (
                            sortedHistory.map((entry, index) => (
                                <div key={index} className="relative pl-6">
                                    {/* Dot */}
                                    <div className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border border-white ring-1 ring-slate-200 ${index === 0 ? 'bg-blue-500 ring-blue-100' : 'bg-slate-300'
                                        }`}></div>

                                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-baseline gap-1">
                                        <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                                            {entry.status}
                                            {/* Source Badge */}
                                            {entry.source && (
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${entry.source === 'Service Request'
                                                    ? 'bg-blue-50 text-blue-600 border-blue-100'
                                                    : 'bg-purple-50 text-purple-600 border-purple-100'
                                                    }`}>
                                                    {entry.source === 'Service Request' ? 'SR' : 'MR'}
                                                </span>
                                            )}
                                        </h4>
                                        <span className="text-xs text-slate-500 font-mono">
                                            {entry.date ? new Date(entry.date).toLocaleString() : 'N/A'}
                                        </span>
                                    </div>

                                    {entry.note && (
                                        <p className="mt-1 text-sm text-slate-600">{entry.note}</p>
                                    )}

                                    {entry.actor && (
                                        <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-5.5-2.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM10 12a5.99 5.99 0 00-4.793 2.39A9.916 9.916 0 0010 18c2.695 0 5.13-1.07 6.793-2.61A5.99 5.99 0 0010 12z" clipRule="evenodd" />
                                            </svg>
                                            {entry.actor}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
