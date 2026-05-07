'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createMaintenanceRequest, getMaintenanceRequests, getServiceRequests, createServiceRequest, updateServiceRequest, sendEmailNotification, getVehicles, getDrivers } from '@/services/mockData';
import { MaintenanceRequest, MaintenanceStatus, ServiceRequest, AttachmentType } from '@/types/maintenance';
import FilterBar from '@/components/Maintenance/FilterBar';
import AssignmentModal from '@/components/Maintenance/AssignmentModal';
import { buildServiceRequestIdMap, formatServiceRequestId } from '@/lib/service-request-id';

export default function ServiceRequestPage() {
    const router = useRouter();
    const currentUser = {
        id: 'd2',
        name: 'John Smith',
        licenseNumber: 'N/A',
        licenseExpiry: '',
        assignedVehicleId: '',
        contactNumber: '+971500000000',
    };

    const [requests, setRequests] = useState<ServiceRequest[]>([]);
    const [filteredRequests, setFilteredRequests] = useState<ServiceRequest[]>([]);
    /** Stable UUID → SR2026-10001 mapping, derived from creation order. */
    const readableIdMap = useMemo(() => buildServiceRequestIdMap(requests), [requests]);
    const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([]);
    const [vehicles, setVehicles] = useState<any[]>([]);
    const [drivers, setDrivers] = useState<any[]>([]);

    // Filter State
    // Use local date to avoid timezone issues
    const getLocalDate = (date: Date) => {
        const offset = date.getTimezoneOffset();
        const localDate = new Date(date.getTime() - (offset * 60 * 1000));
        return localDate.toISOString().split('T')[0];
    };

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const todayStr = getLocalDate(today);
    const yesterdayStr = getLocalDate(yesterday);

    const [searchTerm, setSearchTerm] = useState('');
    const [dateRange, setDateRange] = useState({ start: yesterdayStr, end: todayStr });
    const [statusFilter, setStatusFilter] = useState<string[]>([]);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalAction, setModalAction] = useState<'Assign' | 'Escalate'>('Assign');
    const [selectedRequestForAction, setSelectedRequestForAction] = useState<ServiceRequest | null>(null);

    const [formData, setFormData] = useState({
        requestorId: currentUser.id,
        serviceType: 'Vehicle Maintenance Service',
        vehicleId: '',
        relatedDriverId: '',
        priority: 'Medium' as 'Low' | 'Medium' | 'High',
        description: '',
        date: getLocalDate(new Date()),
    });

    // Attachments State
    const [attachments, setAttachments] = useState<{ type: string; file: File | null }[]>([
        { type: AttachmentType.IMAGE, file: null }
    ]);

    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    // Fetch data
    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const [sReqs, mReqs, vehs, drvs] = await Promise.all([
                    getServiceRequests(),
                    getMaintenanceRequests(),
                    getVehicles(),
                    getDrivers()
                ]);

                // Filter out Closed requests for the main view (check both SR status and linked MR status)
                const activeRequests = sReqs.filter(r => {
                    const isDirectlyClosed = ['Resolved', 'Completed', 'Rejected', 'Closed'].includes(r.status);
                    if (isDirectlyClosed) return false;

                    // Check linked Maintenance Request status if applicable
                    if (r.maintenanceRequestId) {
                        const linkedMr = mReqs.find((mr: MaintenanceRequest) => mr.id === r.maintenanceRequestId);
                        if (linkedMr && [MaintenanceStatus.CLOSED, MaintenanceStatus.MAINTENANCE_COMPLETED, MaintenanceStatus.REJECTED].includes(linkedMr.status)) {
                            return false;
                        }
                    }
                    return true;
                });
                setRequests(activeRequests);
                setMaintenanceRequests(mReqs);
                setVehicles(vehs);
                setDrivers(drvs);
                // Initial filtering will be handled by useEffect
                // setFilteredRequests(activeRequests); 
            } catch (err: any) {
                console.error("Failed to fetch data:", err);
                setError("Unable to load service requests. The server might be offline.");
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, []);

    // Filter Logic
    // Filter Logic
    useEffect(() => {
        let result = requests;

        // Search
        if (searchTerm) {
            const lowerTerm = searchTerm.toLowerCase();
            result = result.filter(r =>
                r.id.toLowerCase().includes(lowerTerm) ||
                r.serviceType.toLowerCase().includes(lowerTerm) ||
                r.description.toLowerCase().includes(lowerTerm) ||
                drivers.find(d => d.id === r.requestorId)?.name.toLowerCase().includes(lowerTerm)
            );
        }

        // Date Range
        if (dateRange.start) {
            result = result.filter(r => {
                const requestDate = r.createdAt ? r.createdAt.split('T')[0] : r.date;
                return requestDate >= dateRange.start;
            });
        }
        if (dateRange.end) {
            result = result.filter(r => {
                const requestDate = r.createdAt ? r.createdAt.split('T')[0] : r.date;
                return requestDate <= dateRange.end;
            });
        }

        // Status
        if (statusFilter.length > 0) {
            result = result.filter(r => statusFilter.includes(r.status));
        }

        setFilteredRequests(result);
    }, [requests, searchTerm, dateRange, statusFilter]);

    const serviceTypes = [
        'Vehicle Maintenance Service',
        'Towing & Recovery Service',
        'Cleaning Service',
        'Vehicle Registration Renewal Service',
        'Vehicle Permit Renewal Service',
        'Driver License Renewal Service',
        'Driver Permit Renewal Service',
        'Other'
    ];

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const newRequest: ServiceRequest = {
            id: '', // Backend will generate ID (SR-YY1001)
            ...formData,
            status: 'Pending',
            createdAt: new Date().toISOString(),
            attachments: attachments
                .filter(a => a.file)
                .map(a => ({
                    id: crypto.randomUUID(),
                    type: a.type as AttachmentType,
                    fileName: a.file?.name || 'unknown',
                    url: `mock://${a.file?.name}`,
                    uploadedAt: new Date().toISOString()
                }))
        };

        await createServiceRequest(newRequest);

        // Refresh list
        const allRequests = await getServiceRequests();
        const allMaintenanceRequests = await getMaintenanceRequests();
        const activeRequests = allRequests.filter(r => {
            const isDirectlyClosed = ['Resolved', 'Completed', 'Rejected', 'Closed'].includes(r.status);
            if (isDirectlyClosed) return false;

            if (r.maintenanceRequestId) {
                const linkedMr = allMaintenanceRequests.find((mr: MaintenanceRequest) => mr.id === r.maintenanceRequestId);
                if (linkedMr && [MaintenanceStatus.CLOSED, MaintenanceStatus.MAINTENANCE_COMPLETED, MaintenanceStatus.REJECTED].includes(linkedMr.status)) {
                    return false;
                }
            }
            return true;
        });
        setRequests(activeRequests);
        setFilteredRequests(activeRequests);

        console.log('Submitted Request:', newRequest);

        // Notify Operations Team
        await sendEmailNotification(
            'operations@gravity.com',
            `New Service Request: ${newRequest.id}`,
            `A new service request has been submitted by ${currentUser.name}.\n\nType: ${newRequest.serviceType}\nPriority: ${newRequest.priority}\nDescription: ${newRequest.description}`
        );

        alert('Service Request Submitted Successfully!');

        // Reset form
        setFormData({
            requestorId: currentUser.id,
            serviceType: 'Vehicle Maintenance Service',
            vehicleId: '',
            relatedDriverId: '',
            priority: 'Medium',
            description: '',
            date: getLocalDate(new Date()),
        });

        // Reset filters to ensure new request is visible
        setSearchTerm('');
        setDateRange({ start: '', end: '' }); // Clear date filter to show all (or at least the new one)
        setStatusFilter([]);
        setAttachments([{ type: AttachmentType.IMAGE, file: null }]);
    };

    const handleStatusChange = async (id: string, newStatus: ServiceRequest['status']) => {
        const request = requests.find(r => r.id === id);
        if (!request) return;

        // Open Modal for Assign or Escalate
        if (newStatus === 'Assigned' || newStatus === 'Escalated') {
            setSelectedRequestForAction(request);
            setModalAction(newStatus === 'Assigned' ? 'Assign' : 'Escalate');
            setIsModalOpen(true);
            return;
        }

        // Special logic for Vehicle Maintenance Service on Acknowledge
        if (request.serviceType === 'Vehicle Maintenance Service' && newStatus === 'Acknowledged') {
            try {
                // Validate Vehicle ID
                if (!request.vehicleId) {
                    alert('Cannot create Maintenance Request: No vehicle assigned to this service request.');
                    return;
                }

                // Fix for legacy data: map 'u1' to a valid driver 'd2'
                const validDriverId = request.requestorId === 'u1' ? 'd2' : request.requestorId;

                // Create the formal Maintenance Request
                const mr = await createMaintenanceRequest({
                    vehicleId: request.vehicleId,
                    driverId: validDriverId,
                    requestDate: new Date(request.date).toISOString(), // Ensure ISO format
                    description: request.description,
                    estimatedCost: 0,
                });

                // Update Service Request to link to Maintenance Request
                await updateServiceRequest({
                    ...request,
                    status: 'Acknowledged',
                    maintenanceRequestId: mr.id,
                    date: new Date(request.date).toISOString()
                });

                console.log('Created linked Maintenance Request:', mr.id);
                alert(`Maintenance Request #${mr.id} created.`);

                // Refresh list
                const allRequests = await getServiceRequests();
                const allMaintenanceRequests = await getMaintenanceRequests();
                const activeRequests = allRequests.filter(r => {
                    const isDirectlyClosed = ['Resolved', 'Completed', 'Rejected', 'Closed'].includes(r.status);
                    if (isDirectlyClosed) return false;

                    if (r.maintenanceRequestId) {
                        const linkedMr = allMaintenanceRequests.find((mr: MaintenanceRequest) => mr.id === r.maintenanceRequestId);
                        if (linkedMr && [MaintenanceStatus.CLOSED, MaintenanceStatus.MAINTENANCE_COMPLETED, MaintenanceStatus.REJECTED].includes(linkedMr.status)) {
                            return false;
                        }
                    }
                    return true;
                });
                setRequests(activeRequests);
                setFilteredRequests(activeRequests);
                return;

            } catch (error) {
                console.error('Failed to create maintenance request', error);
                alert(`Failed to create maintenance request: ${(error as Error).message}`);
                return;
            }
        }

        // Standard status update for other cases (Acknowledge, Resolve, etc.)
        await updateServiceRequest({
            ...request,
            status: newStatus,
            date: new Date(request.date).toISOString()
        });

        // Refresh list
        const allRequests = await getServiceRequests();
        const allMaintenanceRequests = await getMaintenanceRequests();
        const activeRequests = allRequests.filter(r => {
            const isDirectlyClosed = ['Resolved', 'Completed', 'Rejected', 'Closed'].includes(r.status);
            if (isDirectlyClosed) return false;

            if (r.maintenanceRequestId) {
                const linkedMr = allMaintenanceRequests.find((mr: MaintenanceRequest) => mr.id === r.maintenanceRequestId);
                if (linkedMr && [MaintenanceStatus.CLOSED, MaintenanceStatus.MAINTENANCE_COMPLETED, MaintenanceStatus.REJECTED].includes(linkedMr.status)) {
                    return false;
                }
            }
            return true;
        });
        setRequests(activeRequests);
        setFilteredRequests(activeRequests);
    };

    const handleModalConfirm = async (email: string) => {
        if (!selectedRequestForAction) return;

        const newStatus = modalAction === 'Assign' ? 'Assigned' : 'Escalated';

        await updateServiceRequest({
            ...selectedRequestForAction,
            status: newStatus,
            assignedTo: email,
            date: new Date(selectedRequestForAction.date).toISOString()
        });

        // Send Email Notification
        const subject = `Service Request ${modalAction === 'Assign' ? 'Assigned' : 'Escalated'}: ${selectedRequestForAction.id}`;
        const body = `
            Dear User,
            
            The Service Request ${selectedRequestForAction.id} (${selectedRequestForAction.serviceType}) has been ${modalAction === 'Assign' ? 'assigned' : 'escalated'} to you.
            
            Description: ${selectedRequestForAction.description}
            Priority: ${selectedRequestForAction.priority}
            
            Please take the necessary actions.
        `;

        await sendEmailNotification(email, subject, body);
        alert(`Email sent to ${email}`);

        setIsModalOpen(false);
        setSelectedRequestForAction(null);

        // Refresh list
        const allRequests = await getServiceRequests();
        const allMaintenanceRequests = await getMaintenanceRequests();
        const activeRequests = allRequests.filter(r => {
            const isDirectlyClosed = ['Resolved', 'Completed', 'Rejected', 'Closed'].includes(r.status);
            if (isDirectlyClosed) return false;

            if (r.maintenanceRequestId) {
                const linkedMr = allMaintenanceRequests.find((mr: MaintenanceRequest) => mr.id === r.maintenanceRequestId);
                if (linkedMr && [MaintenanceStatus.CLOSED, MaintenanceStatus.MAINTENANCE_COMPLETED, MaintenanceStatus.REJECTED].includes(linkedMr.status)) {
                    return false;
                }
            }
            return true;
        });
        setRequests(activeRequests);
        setFilteredRequests(activeRequests);
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Pending':
            case MaintenanceStatus.REQUESTED:
                return 'bg-yellow-500/20 text-yellow-600 border-yellow-500/50';

            case 'In Progress':
            case 'Acknowledged':
            case 'Assigned':
            case MaintenanceStatus.ACCEPTED:
            case MaintenanceStatus.UNDER_ESTIMATION:
            case MaintenanceStatus.PENDING_ESTIMATION_APPROVAL:
                return 'bg-blue-500/20 text-blue-600 border-blue-500/50';

            case 'Escalated':
            case MaintenanceStatus.RE_ASSIGN:
                return 'bg-orange-500/20 text-orange-600 border-orange-500/50';

            case 'Completed':
            case 'Resolved':
            case MaintenanceStatus.UNDER_MAINTENANCE:
            case MaintenanceStatus.MAINTENANCE_COMPLETED:
            case MaintenanceStatus.PENDING_INVOICE:
            case MaintenanceStatus.INVOICE_SUBMITTED:
            case MaintenanceStatus.CLOSED:
                return 'bg-green-500/20 text-green-600 border-green-500/50';

            case 'Rejected':
            case MaintenanceStatus.REJECTED:
                return 'bg-red-500/20 text-red-600 border-red-500/50';

            default: return 'bg-slate-500/20 text-slate-500 border-slate-500/50';
        }
    };

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'High': return 'text-red-600 font-bold';
            case 'Medium': return 'text-amber-600';
            case 'Low': return 'text-green-600';
            default: return 'text-slate-500';
        }
    };


    return (
        <div className="space-y-8">
            {/* Service Requests List (Moved to Top) */}
            {error && (
                <div className="bg-red-500/10 border border-red-200 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
                    <strong className="font-bold">Error! </strong>
                    <span className="block sm:inline">{error}</span>
                </div>
            )}
            <div>
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-white tracking-tight">Service Requests</h1>
                        <p className="mt-1 text-slate-500">Manage and track service requests.</p>
                    </div>
                    <button
                        onClick={() => router.push('/maintenance/service-requests/history')}
                        className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                        View History
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                        </svg>
                    </button>
                </div>

                {/* Filter Bar */}
                <div className="mb-6">
                    <FilterBar
                        onSearch={setSearchTerm}
                        onDateRangeChange={(start, end) => setDateRange({ start, end })}
                        onStatusChange={setStatusFilter}
                        statusOptions={['Pending', 'In Progress', 'Acknowledged', 'Assigned', 'Escalated', 'Rejected']}
                        placeholder="Search requests..."
                        defaultStartDate={yesterdayStr}
                        defaultEndDate={todayStr}
                    />
                </div>

                {loading ? (
                    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {[...Array(8)].map((_, i) => (
                            <div key={i} className="bg-slate-900 rounded-lg p-4 border border-white/10 animate-pulse">
                                <div className="flex justify-between items-start mb-3">
                                    <div className="h-4 bg-slate-700/60 rounded w-20" />
                                    <div className="h-4 bg-slate-700/60 rounded-full w-16" />
                                </div>
                                <div className="h-5 bg-slate-700/60 rounded w-3/4 mb-2" />
                                <div className="h-3 bg-slate-700/40 rounded w-full mb-1" />
                                <div className="h-3 bg-slate-700/40 rounded w-5/6 mb-4" />
                                <div className="border-t border-white/5 pt-3 space-y-2">
                                    <div className="h-3 bg-slate-700/40 rounded w-2/3" />
                                    <div className="h-3 bg-slate-700/40 rounded w-3/4" />
                                    <div className="h-3 bg-slate-700/40 rounded w-1/2" />
                                </div>
                                <div className="mt-4 h-9 bg-slate-700/40 rounded" />
                            </div>
                        ))}
                    </div>
                ) : filteredRequests.length === 0 ? (
                    <div className="bg-slate-900 border border-white/10 rounded-2xl py-12 text-center">
                        <p className="text-slate-400 text-sm">No service requests match your filters.</p>
                        <p className="text-slate-600 text-xs mt-1">Try clearing the date range or status filter.</p>
                    </div>
                ) : (
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {filteredRequests.map((request) => {
                        const driver = drivers.find(d => d.id === request.requestorId);
                        const requestorName = request.requestorId === currentUser.id ? currentUser.name : (driver?.name || 'Unknown');
                        const vehicle = vehicles.find(v => v.id === request.vehicleId);

                        // Sync status if linked to a maintenance request (legacy support)
                        let displayStatus: string = request.status;
                        let linkedMrId = null;
                        if (request.maintenanceRequestId) {
                            const linkedMr = maintenanceRequests.find(mr => mr.id === request.maintenanceRequestId);
                            if (linkedMr) {
                                displayStatus = linkedMr.status;
                                linkedMrId = linkedMr.readableId || linkedMr.id;
                            }
                        }

                        const isHighPriority = request.priority === 'High';

                        return (
                            <div key={request.id} className={`bg-slate-900 rounded-lg p-4 relative overflow-hidden group border shadow-sm hover:shadow-md transition-all flex flex-col ${isHighPriority ? 'border-red-300 ring-1 ring-red-100' : 'border-white/10'}`}>
                                {isHighPriority && (
                                    <div className="absolute top-0 right-0 w-0 h-0 border-t-[40px] border-r-[40px] border-t-red-500 border-r-transparent z-20">
                                        <span className="absolute -top-[34px] left-[6px] text-white text-[10px] font-bold rotate-45">!</span>
                                    </div>
                                )}

                                <div className="relative z-10 flex-1">
                                    <div className="flex justify-between items-start mb-3">
                                        <span className="text-[11px] font-mono font-semibold text-slate-300 bg-slate-700/40 px-2 py-0.5 rounded" title={request.id}>{formatServiceRequestId(request, readableIdMap)}</span>
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${getStatusColor(displayStatus)}`}>
                                            {displayStatus}
                                        </span>
                                    </div>

                                    <h4 className="text-sm font-bold text-white mb-1 line-clamp-1" title={request.serviceType}>
                                        {request.serviceType}
                                    </h4>

                                    <p className="text-xs text-slate-500 mb-3 line-clamp-2 h-8">
                                        {request.description}
                                    </p>

                                    <div className="space-y-1.5 text-xs border-t border-white/5 pt-3">
                                        <div className="flex justify-between">
                                            <span className="text-slate-500">Requestor:</span>
                                            <span className="text-slate-300 font-medium truncate max-w-[100px]">{requestorName}</span>
                                        </div>
                                        {/* Dynamic Details: Vehicle or Driver */}
                                        {request.serviceType.includes('Driver') ? (
                                            request.relatedDriverId && (
                                                <div className="flex justify-between">
                                                    <span className="text-slate-500">Driver Subject:</span>
                                                    <span className="text-slate-300 truncate max-w-[100px]">
                                                        {drivers.find(d => d.id === request.relatedDriverId)?.name || 'Unknown'}
                                                    </span>
                                                </div>
                                            )
                                        ) : (
                                            vehicle && (
                                                <>
                                                    <div className="flex justify-between">
                                                        <span className="text-slate-500">Vehicle ID:</span>
                                                        <span className="text-slate-300 font-mono text-[10px]">{vehicle.id}</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-slate-500">Vehicle:</span>
                                                        <span className="text-slate-300 truncate max-w-[100px]">{vehicle.make} {vehicle.model}</span>
                                                    </div>
                                                </>
                                            )
                                        )}
                                        <div className="flex justify-between">
                                            <span className="text-slate-500">Service Needed:</span>
                                            <span className="text-slate-300 font-medium">{request.date}</span>
                                        </div>
                                        <div className="flex justify-between items-center pt-1">
                                            <span className="text-slate-500">Priority:</span>
                                            <span className={`font-medium ${getPriorityColor(request.priority)}`}>
                                                {request.priority}
                                            </span>
                                        </div>
                                        {request.assignedTo && (
                                            <div className="flex justify-between items-center pt-1">
                                                <span className="text-slate-500">Assigned To:</span>
                                                <span className="text-slate-300 truncate max-w-[100px]" title={request.assignedTo}>
                                                    {request.assignedTo}
                                                </span>
                                            </div>
                                        )}
                                        {linkedMrId && (
                                            <div className="mt-1 pt-1 border-t border-white/5 text-[10px] text-blue-600 flex items-center gap-1">
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                                    <path fillRule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                                                </svg>
                                                Linked #{linkedMrId.toUpperCase()}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Workflow Actions for ALL Requests */}
                                <div className="relative z-10 mt-4 pt-3 border-t border-white/5 grid grid-cols-2 gap-2">
                                    {/* Acknowledge - Only for Pending */}
                                    {request.status === 'Pending' && (
                                        <button
                                            onClick={() => handleStatusChange(request.id, 'Acknowledged')}
                                            className="col-span-2 rounded bg-blue-500/10 border border-blue-200 px-2 py-1.5 text-[10px] font-medium text-blue-700 hover:bg-blue-500/20 transition-colors"
                                        >
                                            Acknowledge
                                        </button>
                                    )}

                                    {/* Assign & Escalate - Only for Acknowledged (and NOT Vehicle Maintenance Service) */}
                                    {request.status === 'Acknowledged' && request.serviceType !== 'Vehicle Maintenance Service' && (
                                        <>
                                            <button
                                                onClick={() => handleStatusChange(request.id, 'Assigned')}
                                                className="rounded bg-indigo-50 border border-indigo-200 px-2 py-1.5 text-[10px] font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                                            >
                                                Assign
                                            </button>
                                            <button
                                                onClick={() => handleStatusChange(request.id, 'Escalated')}
                                                className="rounded bg-orange-500/10 border border-orange-200 px-2 py-1.5 text-[10px] font-medium text-orange-700 hover:bg-orange-500/20 transition-colors"
                                            >
                                                Escalate
                                            </button>
                                        </>
                                    )}

                                    {/* Resolve - Only for Assigned or Escalated */}
                                    {(request.status === 'Assigned' || request.status === 'Escalated') && (
                                        <button
                                            onClick={() => handleStatusChange(request.id, 'Resolved')}
                                            className="col-span-2 rounded bg-emerald-500/10 border border-green-200 px-2 py-1.5 text-[10px] font-medium text-green-700 hover:bg-emerald-500/20 transition-colors"
                                        >
                                            Resolve
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
                )}
            </div>

            {/* Create Service Request Form (Moved to Bottom & Compacted) */}
            <div className="border-t border-white/10 pt-8">
                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <span className="w-1 h-6 bg-blue-600 rounded-full"></span>
                    Create New Request
                </h3>

                <div className="bg-slate-900 rounded-xl p-6 relative overflow-hidden border border-white/10 shadow-sm">
                    <form onSubmit={handleSubmit} className="space-y-4 relative z-10">
                        {/* Compact Grid Layout */}
                        <div className="grid gap-4 md:grid-cols-12">
                            {/* Requestor */}
                            <div className="md:col-span-4">
                                <label className="block text-xs font-medium text-slate-300 mb-1">Requestor</label>
                                <select
                                    required
                                    className="block w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                                    value={formData.requestorId}
                                    onChange={(e) => setFormData({ ...formData, requestorId: e.target.value })}
                                >
                                    <option value="" className="text-slate-500">Select Requestor</option>
                                    <option value={currentUser.id} className="text-white">
                                        {currentUser.name} (Me)
                                    </option>
                                    {drivers.map((driver, index) => (
                                        <option key={driver.id || index} value={driver.id} className="text-white">
                                            {driver.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Service Type */}
                            <div className="md:col-span-4">
                                <label className="block text-xs font-medium text-slate-300 mb-1">Service Type</label>
                                <select
                                    required
                                    className="block w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                                    value={formData.serviceType}
                                    onChange={(e) => setFormData({ ...formData, serviceType: e.target.value })}
                                >
                                    {serviceTypes.map((type, index) => (
                                        <option key={type || index} value={type}>{type}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Priority - Moved here for better layout */}
                            <div className="md:col-span-4">
                                <label className="block text-xs font-medium text-slate-300 mb-1">Priority</label>
                                <select
                                    className="block w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                                    value={formData.priority}
                                    onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                                >
                                    <option value="Low">Low</option>
                                    <option value="Medium">Medium</option>
                                    <option value="High">High</option>
                                </select>
                            </div>

                            {/* Dynamic Field: Vehicle or Driver based on Service Type */}
                            <div className="md:col-span-8">
                                {formData.serviceType.includes('Driver') ? (
                                    <>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">Driver Subject</label>
                                        <select
                                            className="block w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                                            value={formData.relatedDriverId}
                                            onChange={(e) => setFormData({ ...formData, relatedDriverId: e.target.value, vehicleId: '' })}
                                        >
                                            <option value="">Select Driver</option>
                                            {drivers.map((driver, index) => (
                                                <option key={driver.id || index} value={driver.id}>
                                                    {driver.name} ({driver.licenseNumber})
                                                </option>
                                            ))}
                                        </select>
                                    </>
                                ) : (
                                    <>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">Vehicle</label>
                                        <select
                                            required
                                            className="block w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                                            value={formData.vehicleId}
                                            onChange={(e) => setFormData({ ...formData, vehicleId: e.target.value, relatedDriverId: '' })}
                                        >
                                            <option value="">No Vehicle</option>
                                            {vehicles.map((vehicle, index) => (
                                                <option key={vehicle.id || index} value={vehicle.id}>
                                                    {vehicle.make} {vehicle.model} ({vehicle.licensePlate})
                                                </option>
                                            ))}
                                        </select>
                                    </>
                                )}
                            </div>



                            {/* Service Needed Date */}
                            <div className="md:col-span-4">
                                <label className="block text-xs font-medium text-slate-300 mb-1">Service Needed Date</label>
                                <input
                                    type="date"
                                    required
                                    className="block w-full rounded-lg border border-white/15 px-3 py-2 text-sm text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                                    value={formData.date}
                                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                />
                            </div>

                            {/* Description - Full Width */}
                            <div className="md:col-span-12">
                                <label className="block text-xs font-medium text-slate-300 mb-1">Description</label>
                                <textarea
                                    required
                                    rows={2}
                                    className="block w-full rounded-lg border border-white/15 px-3 py-2 text-sm text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="Describe the issue or service required..."
                                />
                            </div>

                            {/* Attachments Section */}
                            <div className="md:col-span-4 border-t border-white/5 pt-4 mt-2">
                                <h4 className="text-sm font-medium text-white mb-3">Attachments</h4>
                                <div className="space-y-3">
                                    {attachments.map((att, index) => (
                                        <div key={index} className="flex items-end gap-3 bg-slate-800/50 p-3 rounded-lg border border-white/5">
                                            <div className="w-1/3">
                                                <label className="block text-xs font-medium text-slate-500 mb-1">Type</label>
                                                <select
                                                    className="block w-full rounded-md border-white/15 text-xs shadow-sm focus:border-blue-500 focus:ring-blue-500 text-white"
                                                    value={att.type}
                                                    onChange={(e) => {
                                                        const newAtts = [...attachments];
                                                        newAtts[index].type = e.target.value;
                                                        setAttachments(newAtts);
                                                    }}
                                                >
                                                    {Object.values(AttachmentType).map((t) => (
                                                        <option key={t} value={t}>{t}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="flex-1">
                                                <label className="block text-xs font-medium text-slate-500 mb-1">File</label>
                                                <input
                                                    type="file"
                                                    className="block w-full text-xs text-white file:mr-2 file:py-1 file:px-2 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-blue-500/20 file:text-blue-700 hover:file:bg-blue-200"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0] || null;
                                                        const newAtts = [...attachments];
                                                        newAtts[index].file = file;
                                                        setAttachments(newAtts);
                                                    }}
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const newAtts = attachments.filter((_, i) => i !== index);
                                                    setAttachments(newAtts);
                                                }}
                                                className="p-1.5 text-red-500 hover:bg-red-500/20 rounded-md transition-colors"
                                                disabled={attachments.length === 1}
                                                title="Remove Attachment"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                </svg>
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={() => setAttachments([...attachments, { type: AttachmentType.IMAGE, file: null }])}
                                        className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 mt-2"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                        </svg>
                                        Add Another Attachment
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end pt-2">
                            <button
                                type="submit"
                                className="inline-flex justify-center rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors"
                            >
                                Submit Request
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* Assignment/Escalation Modal */}
            {selectedRequestForAction && (
                <AssignmentModal
                    isOpen={isModalOpen}
                    onClose={() => {
                        setIsModalOpen(false);
                        setSelectedRequestForAction(null);
                    }}
                    onConfirm={handleModalConfirm}
                    title={modalAction === 'Assign' ? 'Assign Request' : 'Escalate Request'}
                    request={selectedRequestForAction}
                    actionLabel={modalAction === 'Assign' ? 'Assign Request' : 'Escalate Request'}
                />
            )}
        </div>
    );
}
