'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getMaintenanceRequests, getServiceRequests, getVehicles, getDrivers } from '@/services/mockData';
import { MaintenanceRequest, MaintenanceStatus, ServiceRequest } from '@/types/maintenance';
import FilterBar from '@/components/Maintenance/FilterBar';
import TimelineModal, { TimelineItem } from '@/components/Maintenance/TimelineModal';

// Unified type for display
type HistoryItem = MaintenanceRequest | ServiceRequest;

function isServiceRequest(item: HistoryItem): item is ServiceRequest {
    return (item as ServiceRequest).serviceType !== undefined;
}

export default function MaintenanceHistoryPage() {
    const router = useRouter();
    const [requests, setRequests] = useState<HistoryItem[]>([]);
    const [filteredRequests, setFilteredRequests] = useState<HistoryItem[]>([]);
    const [vehicles, setVehicles] = useState<any[]>([]);
    const [drivers, setDrivers] = useState<any[]>([]);

    // Filter State
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const todayStr = today.toISOString().split('T')[0];
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const [searchTerm, setSearchTerm] = useState('');
    const [dateRange, setDateRange] = useState({ start: '', end: '' }); // Default empty to show all history

    // Timeline Modal State
    const [selectedRequestForTimeline, setSelectedRequestForTimeline] = useState<HistoryItem | null>(null);
    const [isTimelineOpen, setIsTimelineOpen] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            try {
                const [mReqsRes, sReqsRes, vehsRes, drvsRes] = await Promise.all([
                    fetch('http://localhost:8080/api/v1/maintenance/requests'),
                    fetch('http://localhost:8080/api/v1/service/requests'),
                    fetch('http://localhost:8080/api/v1/fleet/vehicles'),
                    fetch('http://localhost:8080/api/v1/fleet/drivers')
                ]);

                const mReqs = await mReqsRes.json();
                const sReqs = await sReqsRes.json();
                const vehs = await vehsRes.json();
                const drvs = await drvsRes.json();

                // Filter Closed/Rejected Maintenance Requests
                const closedMaintenance = mReqs.filter((r: MaintenanceRequest) =>
                    [MaintenanceStatus.CLOSED, MaintenanceStatus.MAINTENANCE_COMPLETED, MaintenanceStatus.REJECTED].includes(r.status)
                );

                // Filter Closed/Rejected Service Requests
                // Note: Ensure status strings match backend
                const closedService = sReqs.filter((r: any) =>
                    ['Resolved', 'Completed', 'Rejected', 'Closed'].includes(r.status)
                );

                // Merge and sort by date (descending)
                const allHistory = [...closedMaintenance, ...closedService].sort((a: any, b: any) => {
                    const dateA = isServiceRequest(a) ? a.date : a.requestDate;
                    const dateB = isServiceRequest(b) ? b.date : b.requestDate;
                    return new Date(dateB).getTime() - new Date(dateA).getTime();
                });

                setRequests(allHistory);
                setVehicles(vehs);
                setDrivers(drvs);
            } catch (error) {
                console.error("Failed to load history data:", error);
            }
        };
        loadData();
    }, []);

    useEffect(() => {
        let result = requests;

        if (searchTerm) {
            const lowerTerm = searchTerm.toLowerCase();
            result = result.filter(r => {
                const desc = isServiceRequest(r) ? r.description : r.description;
                const id = r.id;
                const workOrder = !isServiceRequest(r) ? r.workOrderNo : '';
                return (
                    id.toLowerCase().includes(lowerTerm) ||
                    (workOrder && workOrder.toLowerCase().includes(lowerTerm)) ||
                    desc.toLowerCase().includes(lowerTerm)
                );
            });
        }

        if (dateRange.start) {
            result = result.filter(r => {
                const date = isServiceRequest(r) ? r.date : r.requestDate;
                return date >= dateRange.start;
            });
        }
        if (dateRange.end) {
            result = result.filter(r => {
                const date = isServiceRequest(r) ? r.date : r.requestDate;
                return date <= dateRange.end;
            });
        }

        setFilteredRequests(result);
    }, [requests, searchTerm, dateRange]);

    const getStatusColor = (status: string) => {
        switch (status) {
            case MaintenanceStatus.CLOSED:
            case MaintenanceStatus.MAINTENANCE_COMPLETED:
            case 'Completed':
            case 'Resolved':
                return 'bg-green-500/20 text-green-600 border-green-500/50';
            case MaintenanceStatus.REJECTED:
            case 'Rejected':
                return 'bg-red-500/20 text-red-600 border-red-500/50';
            default:
                return 'bg-slate-500/20 text-slate-500 border-slate-500/50';
        }
    };

    const handleViewTimeline = (request: HistoryItem) => {
        setSelectedRequestForTimeline(request);
        setIsTimelineOpen(true);
    };

    const getTimelineItems = (request: HistoryItem): TimelineItem[] => {
        if (request.history) {
            return request.history.map(h => ({
                status: h.status,
                date: h.date,
                note: h.note || '',
                actor: h.actor || 'System',
                source: isServiceRequest(request) ? 'Service Request' : 'Maintenance Request'
            }));
        }
        if (!isServiceRequest(request) && request.statusTimeline) {
            return Object.entries(request.statusTimeline).map(([status, date]) => ({
                status: status,
                date: date as string,
                note: 'Status updated',
                actor: 'System',
                source: 'Maintenance Request'
            }));
        }
        return [];
    };

    return (
        <div className="space-y-8">
            <div>
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <button
                                onClick={() => router.back()}
                                className="text-slate-400 hover:text-slate-300 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                                </svg>
                            </button>
                            <h1 className="text-2xl font-bold text-white tracking-tight">History</h1>
                        </div>
                        <p className="mt-1 text-slate-500 ml-7">View closed and rejected requests (Service & Maintenance).</p>
                    </div>
                </div>

                <div className="mb-6">
                    <FilterBar
                        onSearch={setSearchTerm}
                        onDateRangeChange={(start, end) => setDateRange({ start, end })}
                        onStatusChange={() => { }}
                        statusOptions={[]}
                        placeholder="Search by ID, Work Order..."
                        defaultStartDate={''}
                        defaultEndDate={''}
                    />
                </div>

                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {filteredRequests.length === 0 ? (
                        <div className="col-span-full text-center py-12 text-slate-500 bg-slate-800/50 rounded-lg border border-dashed border-white/15">
                            No history found.
                        </div>
                    ) : (
                        filteredRequests.map((request) => {
                            const isSR = isServiceRequest(request);
                            const vehicleId = isSR ? request.vehicleId : request.vehicleId;
                            const driverId = isSR ? (request.relatedDriverId || request.requestorId) : request.driverId; // Use relatedDriverId if available
                            const date = isSR ? request.date : request.requestDate;

                            const vehicle = vehicles.find(v => v.id === vehicleId);
                            const driver = drivers.find(d => d.id === driverId);

                            return (
                                <div key={request.id} className="bg-slate-800/50 rounded-lg p-4 relative overflow-hidden border border-white/10 hover:shadow-md transition-all flex flex-col min-h-[200px]">
                                    <div className="relative z-10 flex-1 flex flex-col">
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] font-mono text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-white/10">{request.id}</span>
                                                {isSR && <span className="text-[9px] text-blue-600 mt-0.5">Service Request</span>}
                                            </div>
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${getStatusColor(request.status)}`}>
                                                {request.status}
                                            </span>
                                        </div>

                                        <h4 className="text-sm font-bold text-slate-300 mb-1 line-clamp-1" title={request.description}>
                                            {isSR ? request.serviceType : 'Maintenance Request'}
                                        </h4>
                                        <p className="text-xs text-slate-500 line-clamp-2 mb-2">{request.description}</p>

                                        <div className="space-y-1.5 text-xs border-t border-white/10 pt-3 mt-2">
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">Vehicle:</span>
                                                <span className="text-slate-300 font-medium truncate max-w-[100px]">{vehicle ? `${vehicle.make} ${vehicle.model}` : 'N/A'}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">Driver/User:</span>
                                                <span className="text-slate-300 truncate max-w-[100px]">{driver ? driver.name : (driverId || 'Unknown')}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">Date:</span>
                                                <span className="text-slate-300 font-medium">{new Date(date).toLocaleDateString()}</span>
                                            </div>
                                            {!isSR && request.workOrderNo && (
                                                <div className="flex justify-between">
                                                    <span className="text-slate-500">Work Order:</span>
                                                    <span className="text-slate-300 font-mono">{request.workOrderNo}</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="mt-auto pt-3 border-t border-white/10">
                                            <button
                                                onClick={() => handleViewTimeline(request)}
                                                className="w-full rounded-lg bg-blue-600 border border-transparent px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 shadow-sm transition-all flex items-center justify-center gap-2"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                                </svg>
                                                View Activity
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Timeline Modal */}
            {selectedRequestForTimeline && (
                <TimelineModal
                    isOpen={isTimelineOpen}
                    onClose={() => {
                        setIsTimelineOpen(false);
                        setSelectedRequestForTimeline(null);
                    }}
                    items={getTimelineItems(selectedRequestForTimeline)}
                    title={`Activity: ${selectedRequestForTimeline.id}`}
                />
            )}
        </div>
    );
}
