'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getServiceRequests, getMaintenanceRequests, getVehicles, getDrivers } from '@/services/api';
import { ServiceRequest, MaintenanceStatus, MaintenanceRequest, Vehicle, Driver } from '@/types/maintenance';
import FilterBar from '@/components/Maintenance/FilterBar';
import TimelineModal from '@/components/Maintenance/TimelineModal';

export default function ServiceRequestHistoryPage() {
    const router = useRouter();
    const currentUser = {
        id: 'u1',
        name: 'John Doe',
    };

    const [requests, setRequests] = useState<ServiceRequest[]>([]);
    const [filteredRequests, setFilteredRequests] = useState<ServiceRequest[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [drivers, setDrivers] = useState<Driver[]>([]);

    // Timeline Modal State
    const [selectedRequestForTimeline, setSelectedRequestForTimeline] = useState<ServiceRequest | null>(null);
    const [isTimelineOpen, setIsTimelineOpen] = useState(false);

    const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([]);

    // Date Helpers
    const getLocalDate = (date: Date) => {
        const offset = date.getTimezoneOffset();
        const localDate = new Date(date.getTime() - (offset * 60 * 1000));
        return localDate.toISOString().split('T')[0];
    };

    const today = new Date();
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 6);

    const todayStr = getLocalDate(today);
    const lastWeekStr = getLocalDate(lastWeek);

    // Filter State
    const [filters, setFilters] = useState({
        term: '',
        dateRange: { start: lastWeekStr, end: todayStr },
        statuses: [] as string[]
    });

    useEffect(() => {
        const loadData = async () => {
            try {
                const [allRequests, mReqs, allVehicles, allDrivers] = await Promise.all([
                    getServiceRequests(),
                    getMaintenanceRequests(),
                    getVehicles(),
                    getDrivers()
                ]);

                // Filter ONLY Closed/Rejected/Resolved requests (including linked MRs)
                const resolvedRequests = allRequests.filter(r => {
                    const isDirectlyClosed = ['Resolved', 'Completed', 'Rejected', 'Closed'].includes(r.status);
                    if (isDirectlyClosed) return true;

                    if (r.maintenanceRequestId) {
                        const linkedMr = mReqs.find((mr: MaintenanceRequest) => mr.id === r.maintenanceRequestId);
                        if (linkedMr && [MaintenanceStatus.CLOSED, MaintenanceStatus.MAINTENANCE_COMPLETED, MaintenanceStatus.REJECTED].includes(linkedMr.status)) {
                            return true;
                        }
                    }
                    return false;
                });

                setRequests(resolvedRequests);
                setMaintenanceRequests(mReqs);
                setVehicles(allVehicles);
                setDrivers(allDrivers);

            } catch (error) {
                console.error("Failed to load data:", error);
            }
        };
        loadData();
    }, []);

    // Apply filters whenever requests or filter state changes
    useEffect(() => {
        let result = requests;

        // Search Term
        if (filters.term) {
            const lowerTerm = filters.term.toLowerCase();
            result = result.filter(r =>
                r.id.toLowerCase().includes(lowerTerm) ||
                r.serviceType.toLowerCase().includes(lowerTerm) ||
                r.description.toLowerCase().includes(lowerTerm) ||
                drivers.find(d => d.id === r.requestorId)?.name.toLowerCase().includes(lowerTerm)
            );
        }

        // Date Range
        if (filters.dateRange.start) {
            result = result.filter(r => r.date >= filters.dateRange.start);
        }
        if (filters.dateRange.end) {
            result = result.filter(r => r.date <= filters.dateRange.end);
        }

        // Status
        if (filters.statuses.length > 0) {
            result = result.filter(r => {
                let currentStatus = r.status as string;
                if (r.maintenanceRequestId) {
                    const linkedMr = maintenanceRequests.find((mr: MaintenanceRequest) => mr.id === r.maintenanceRequestId);
                    if (linkedMr) currentStatus = linkedMr.status as string;
                }
                return filters.statuses.includes(currentStatus);
            });
        }

        setFilteredRequests(result);
    }, [requests, filters, drivers, maintenanceRequests]);

    const handleSearch = (term: string) => {
        setFilters(prev => ({ ...prev, term }));
    };

    const handleDateRangeChange = (start: string, end: string) => {
        setFilters(prev => ({ ...prev, dateRange: { start, end } }));
    };

    const handleStatusChange = (statuses: string[]) => {
        setFilters(prev => ({ ...prev, statuses }));
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Resolved': return 'bg-green-500/20 text-green-600 border-green-500/50';
            case 'Completed': return 'bg-green-500/20 text-green-600 border-green-500/50';
            case 'Closed': return 'bg-slate-500/20 text-slate-600 border-slate-500/50';
            case 'Rejected': return 'bg-red-500/20 text-red-600 border-red-500/50';
            default: return 'bg-gray-500/20 text-gray-600 border-gray-500/50';
        }
    };

    return (
        <div className="space-y-8">
            <div>
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <button
                                onClick={() => router.back()}
                                className="text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                                </svg>
                            </button>
                            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Service Request History</h1>
                        </div>
                        <p className="mt-1 text-slate-500 ml-7">View resolved service requests.</p>
                    </div>
                </div>

                <div className="mb-6">
                    <FilterBar
                        onSearch={handleSearch}
                        onDateRangeChange={handleDateRangeChange}
                        onStatusChange={handleStatusChange}
                        statusOptions={['Resolved', 'Completed', 'Closed', 'Rejected']}
                        placeholder="Search history..."
                        defaultStartDate={lastWeekStr}
                        defaultEndDate={todayStr}
                    />
                </div>

                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {filteredRequests.length === 0 ? (
                        <div className="col-span-full text-center py-12 text-slate-500 bg-slate-50 rounded-lg border border-dashed border-slate-300">
                            No resolved requests found.
                        </div>
                    ) : (
                        filteredRequests.map((request) => {
                            const driver = drivers.find(d => d.id === request.requestorId);
                            const requestorName = request.requestorId === currentUser.id ? currentUser.name : (driver?.name || 'Unknown');
                            const vehicle = vehicles.find(v => v.id === request.vehicleId);

                            return (
                                <div key={request.id} className="bg-slate-50 rounded-lg p-4 relative overflow-hidden border border-slate-200 hover:shadow-md transition-all flex flex-col min-h-[200px]">
                                    <div className="relative z-10 flex-1 flex flex-col">
                                        <div className="flex justify-between items-start mb-3">
                                            <span className="text-[10px] font-mono text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200">{request.id}</span>
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${getStatusColor(request.status)}`}>
                                                {request.status}
                                            </span>
                                        </div>

                                        <h4 className="text-sm font-bold text-slate-700 mb-1 line-clamp-1" title={request.serviceType}>
                                            {request.serviceType}
                                        </h4>

                                        <p className="text-xs text-slate-500 mb-3 line-clamp-2 h-8">
                                            {request.description}
                                        </p>

                                        <div className="space-y-1.5 text-xs border-t border-slate-200 pt-3">
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">Requestor:</span>
                                                <span className="text-slate-700 font-medium truncate max-w-[100px]">{requestorName}</span>
                                            </div>
                                            {/* Dynamic Details: Vehicle or Driver */}
                                            {request.serviceType.includes('Driver') ? (
                                                request.relatedDriverId && (
                                                    <div className="flex justify-between">
                                                        <span className="text-slate-500">Driver Subject:</span>
                                                        <span className="text-slate-700 truncate max-w-[100px]">
                                                            {drivers.find(d => d.id === request.relatedDriverId)?.name || 'Unknown'}
                                                        </span>
                                                    </div>
                                                )
                                            ) : (
                                                vehicle && (
                                                    <>
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-500">Vehicle ID:</span>
                                                            <span className="text-slate-700 font-mono text-[10px]">{vehicle.id}</span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-500">Vehicle:</span>
                                                            <span className="text-slate-700 truncate max-w-[100px]">{vehicle.make} {vehicle.model}</span>
                                                        </div>
                                                    </>
                                                )
                                            )}
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">Service Needed:</span>
                                                <span className="text-slate-700 font-medium">{request.date}</span>
                                            </div>
                                            {request.assignedTo && (
                                                <div className="flex justify-between items-center pt-1">
                                                    <span className="text-slate-500">Assigned To:</span>
                                                    <span className="text-slate-700 truncate max-w-[100px]" title={request.assignedTo}>
                                                        {request.assignedTo}
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="mt-auto pt-3 border-t border-slate-200">
                                            <button
                                                onClick={() => {
                                                    setSelectedRequestForTimeline(request);
                                                    setIsTimelineOpen(true);
                                                }}
                                                className="w-full rounded-lg bg-blue-600 border border-transparent px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 shadow-sm transition-all flex items-center justify-center gap-2"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                                </svg>
                                                View Timeline
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
                    request={selectedRequestForTimeline}
                    maintenanceRequest={maintenanceRequests.find(mr => mr.id === selectedRequestForTimeline.maintenanceRequestId)}
                />
            )}
        </div>
    );
}

