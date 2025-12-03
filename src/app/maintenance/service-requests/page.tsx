'use client';

import { useState, useEffect } from 'react';
import { mockVehicles, mockDrivers, createMaintenanceRequest, getMaintenanceRequests } from '@/services/mockData';
import { MaintenanceRequest, MaintenanceStatus } from '@/types/maintenance';
import FilterBar from '@/components/Maintenance/FilterBar';

interface ServiceRequest {
    id: string;
    requestorId: string;
    serviceType: string;
    vehicleId: string;
    priority: 'Low' | 'Medium' | 'High';
    description: string;
    date: string;
    status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Acknowledged' | 'Assigned' | 'Escalated' | 'Resolved';
    maintenanceRequestId?: string; // Link to Maintenance Request
    assignedTo?: string;
}

const initialRequests: ServiceRequest[] = [
    {
        id: 'SR-1001',
        requestorId: 'd1',
        serviceType: 'Vehicle Maintenance Service',
        vehicleId: 'v1',
        priority: 'High',
        description: 'Brake pads need replacement immediately.',
        date: '2025-11-24',
        status: 'Pending',
    },
    {
        id: 'SR-1002',
        requestorId: 'd2',
        serviceType: 'Driver License Renewal Service',
        vehicleId: '',
        priority: 'Medium',
        description: 'License expiring next month.',
        date: '2025-11-23',
        status: 'In Progress',
    },
];

export default function ServiceRequestPage() {
    const currentUser = {
        id: 'u1',
        name: 'John Doe',
        licenseNumber: 'N/A',
        licenseExpiry: '',
        assignedVehicleId: '',
        contactNumber: '+971500000000',
    };

    const [requests, setRequests] = useState<ServiceRequest[]>(initialRequests);
    const [filteredRequests, setFilteredRequests] = useState<ServiceRequest[]>(initialRequests);
    const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([]);
    const [formData, setFormData] = useState({
        requestorId: currentUser.id,
        serviceType: 'Vehicle Maintenance Service',
        vehicleId: '',
        priority: 'Medium' as 'Low' | 'Medium' | 'High',
        description: '',
        date: new Date().toISOString().split('T')[0],
    });

    // Fetch maintenance requests to sync status
    useEffect(() => {
        const fetchMaintenanceRequests = async () => {
            const reqs = await getMaintenanceRequests();
            setMaintenanceRequests(reqs);
        };
        fetchMaintenanceRequests();
    }, [requests]); // Re-fetch when local requests change (e.g. after submission)

    // Filter Logic
    const handleFilter = (term: string, dateRange: { start: string, end: string }, statuses: string[]) => {
        let result = requests;

        // Search
        if (term) {
            const lowerTerm = term.toLowerCase();
            result = result.filter(r =>
                r.id.toLowerCase().includes(lowerTerm) ||
                r.serviceType.toLowerCase().includes(lowerTerm) ||
                r.description.toLowerCase().includes(lowerTerm) ||
                mockDrivers.find(d => d.id === r.requestorId)?.name.toLowerCase().includes(lowerTerm)
            );
        }

        // Date Range
        if (dateRange.start) {
            result = result.filter(r => r.date >= dateRange.start);
        }
        if (dateRange.end) {
            result = result.filter(r => r.date <= dateRange.end);
        }

        // Status
        if (statuses.length > 0) {
            result = result.filter(r => statuses.includes(r.status));
        }

        setFilteredRequests(result);
    };

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
            id: `SR-${1000 + requests.length + 1}`,
            ...formData,
            status: 'Pending',
        };

        const updatedRequests = [newRequest, ...requests];
        setRequests(updatedRequests);
        setFilteredRequests(updatedRequests); // Update filtered list too
        console.log('Submitted Request:', newRequest);
        alert('Service Request Submitted Successfully!');

        // Reset form
        setFormData({
            requestorId: currentUser.id,
            serviceType: 'Vehicle Maintenance Service',
            vehicleId: '',
            priority: 'Medium',
            description: '',
            date: new Date().toISOString().split('T')[0],
        });
    };

    const handleStatusChange = async (id: string, newStatus: ServiceRequest['status']) => {
        const request = requests.find(r => r.id === id);
        if (!request) return;

        // Special logic for Vehicle Maintenance Service on Acknowledge
        if (request.serviceType === 'Vehicle Maintenance Service' && newStatus === 'Acknowledged') {
            try {
                // Create the formal Maintenance Request
                const mr = await createMaintenanceRequest({
                    vehicleId: request.vehicleId,
                    driverId: request.requestorId,
                    requestDate: request.date, // Use request date
                    description: request.description,
                    estimatedCost: 0,
                    garageId: '',
                });
                console.log('Created linked Maintenance Request:', mr.id);
                alert(`Maintenance Request #${mr.id} created. Service Request removed from list.`);

                // Remove from Service Request list (it "moves" to Maintenance Requests)
                const updated = requests.filter(req => req.id !== id);
                setRequests(updated);
                setFilteredRequests(updated); // Update filtered list
                return;

            } catch (error) {
                console.error('Failed to create maintenance request', error);
                alert('Failed to create maintenance request. Status not updated.');
                return;
            }
        }

        // Standard status update for other cases
        const updated = requests.map(req =>
            req.id === id ? { ...req, status: newStatus } : req
        );
        setRequests(updated);
        setFilteredRequests(updated); // Update filtered list
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Pending':
            case MaintenanceStatus.REQUESTED:
            case MaintenanceStatus.AWAITING_APPROVAL:
                return 'bg-yellow-500/20 text-yellow-600 border-yellow-500/50';

            case 'In Progress':
            case 'Acknowledged':
            case 'Assigned':
            case MaintenanceStatus.APPROVED:
            case MaintenanceStatus.UNDER_ESTIMATION:
            case MaintenanceStatus.UNDER_MAINTENANCE:
                return 'bg-blue-500/20 text-blue-600 border-blue-500/50';

            case 'Escalated':
                return 'bg-orange-500/20 text-orange-600 border-orange-500/50';

            case 'Completed':
            case 'Resolved':
            case MaintenanceStatus.COMPLETED:
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
            <div>
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Service Requests</h1>
                        <p className="mt-1 text-slate-500">Manage and track service requests.</p>
                    </div>
                </div>

                {/* Filter Bar */}
                <div className="mb-6">
                    <FilterBar
                        onSearch={(term) => handleFilter(term, { start: '', end: '' }, [])} // Simplified for now, real implementation needs state
                        onDateRangeChange={(start, end) => handleFilter('', { start, end }, [])}
                        onStatusChange={(statuses) => handleFilter('', { start: '', end: '' }, statuses)}
                        statusOptions={['Pending', 'In Progress', 'Acknowledged', 'Assigned', 'Escalated', 'Resolved', 'Completed', 'Rejected']}
                        placeholder="Search requests..."
                    />
                </div>

                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {filteredRequests.map((request) => {
                        const driver = mockDrivers.find(d => d.id === request.requestorId);
                        const requestorName = request.requestorId === currentUser.id ? currentUser.name : (driver?.name || 'Unknown');
                        const vehicle = mockVehicles.find(v => v.id === request.vehicleId);

                        // Sync status if linked to a maintenance request (legacy support)
                        let displayStatus: string = request.status;
                        let linkedMrId = null;
                        if (request.maintenanceRequestId) {
                            const linkedMr = maintenanceRequests.find(mr => mr.id === request.maintenanceRequestId);
                            if (linkedMr) {
                                displayStatus = linkedMr.status;
                                linkedMrId = linkedMr.id;
                            }
                        }

                        const isHighPriority = request.priority === 'High';

                        return (
                            <div key={request.id} className={`bg-white rounded-lg p-4 relative overflow-hidden group border shadow-sm hover:shadow-md transition-all flex flex-col ${isHighPriority ? 'border-red-300 ring-1 ring-red-100' : 'border-slate-200'}`}>
                                {isHighPriority && (
                                    <div className="absolute top-0 right-0 w-0 h-0 border-t-[40px] border-r-[40px] border-t-red-500 border-r-transparent z-20">
                                        <span className="absolute -top-[34px] left-[6px] text-white text-[10px] font-bold rotate-45">!</span>
                                    </div>
                                )}

                                <div className="relative z-10 flex-1">
                                    <div className="flex justify-between items-start mb-3">
                                        <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{request.id}</span>
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${getStatusColor(displayStatus)}`}>
                                            {displayStatus}
                                        </span>
                                    </div>

                                    <h4 className="text-sm font-bold text-slate-900 mb-1 line-clamp-1" title={request.serviceType}>
                                        {request.serviceType}
                                    </h4>

                                    <p className="text-xs text-slate-500 mb-3 line-clamp-2 h-8">
                                        {request.description}
                                    </p>

                                    <div className="space-y-1.5 text-xs border-t border-slate-100 pt-3">
                                        <div className="flex justify-between">
                                            <span className="text-slate-500">Requestor:</span>
                                            <span className="text-slate-700 font-medium truncate max-w-[100px]">{requestorName}</span>
                                        </div>
                                        {vehicle && (
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
                                        )}
                                        <div className="flex justify-between">
                                            <span className="text-slate-500">Date:</span>
                                            <span className="text-slate-700">{request.date}</span>
                                        </div>
                                        <div className="flex justify-between items-center pt-1">
                                            <span className="text-slate-500">Priority:</span>
                                            <span className={`font-medium ${getPriorityColor(request.priority)}`}>
                                                {request.priority}
                                            </span>
                                        </div>
                                        {linkedMrId && (
                                            <div className="mt-1 pt-1 border-t border-slate-100 text-[10px] text-blue-600 flex items-center gap-1">
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                                    <path fillRule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                                                </svg>
                                                Linked #{linkedMrId.toUpperCase()}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Workflow Actions for ALL Requests */}
                                <div className="relative z-10 mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2">
                                    {/* Acknowledge */}
                                    {request.status === 'Pending' && (
                                        <button
                                            onClick={() => handleStatusChange(request.id, 'Acknowledged')}
                                            className="col-span-2 rounded bg-blue-50 border border-blue-200 px-2 py-1.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                                        >
                                            Acknowledge
                                        </button>
                                    )}

                                    {/* Assign */}
                                    {(request.status === 'Acknowledged' || request.status === 'Pending') && (
                                        <button
                                            onClick={() => handleStatusChange(request.id, 'Assigned')}
                                            className="rounded bg-indigo-50 border border-indigo-200 px-2 py-1.5 text-[10px] font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                                        >
                                            Assign
                                        </button>
                                    )}

                                    {/* Escalate */}
                                    {(request.status !== 'Resolved' && request.status !== 'Completed' && request.status !== 'Rejected' && request.status !== 'Escalated') && (
                                        <button
                                            onClick={() => handleStatusChange(request.id, 'Escalated')}
                                            className="rounded bg-orange-50 border border-orange-200 px-2 py-1.5 text-[10px] font-medium text-orange-700 hover:bg-orange-100 transition-colors"
                                        >
                                            Escalate
                                        </button>
                                    )}

                                    {/* Resolve */}
                                    {(request.status !== 'Resolved' && request.status !== 'Completed' && request.status !== 'Rejected') && (
                                        <button
                                            onClick={() => handleStatusChange(request.id, 'Resolved')}
                                            className="col-span-2 rounded bg-green-50 border border-green-200 px-2 py-1.5 text-[10px] font-medium text-green-700 hover:bg-green-100 transition-colors"
                                        >
                                            Resolve
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Create Service Request Form (Moved to Bottom & Compacted) */}
            <div className="border-t border-slate-200 pt-8">
                <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                    <span className="w-1 h-6 bg-blue-600 rounded-full"></span>
                    Create New Request
                </h3>

                <div className="bg-white rounded-xl p-6 relative overflow-hidden border border-slate-200 shadow-sm">
                    <form onSubmit={handleSubmit} className="space-y-4 relative z-10">
                        {/* Compact Grid Layout */}
                        <div className="grid gap-4 md:grid-cols-4">
                            {/* Requestor */}
                            <div className="md:col-span-1">
                                <label className="block text-xs font-medium text-slate-700 mb-1">Requestor</label>
                                <select
                                    required
                                    className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                                    value={formData.requestorId}
                                    onChange={(e) => setFormData({ ...formData, requestorId: e.target.value })}
                                >
                                    <option value="" className="text-slate-500">Select Requestor</option>
                                    <option value={currentUser.id} className="text-slate-900">
                                        {currentUser.name} (Me)
                                    </option>
                                    {mockDrivers.map(driver => (
                                        <option key={driver.id} value={driver.id} className="text-slate-900">
                                            {driver.name} ({driver.licenseNumber})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Service Type */}
                            <div className="md:col-span-1">
                                <label className="block text-xs font-medium text-slate-700 mb-1">Service Type</label>
                                <select
                                    required
                                    className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                                    value={formData.serviceType}
                                    onChange={(e) => setFormData({ ...formData, serviceType: e.target.value })}
                                >
                                    {serviceTypes.map(type => (
                                        <option key={type} value={type} className="text-slate-900">{type}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Vehicle */}
                            <div className="md:col-span-1">
                                <label className="block text-xs font-medium text-slate-700 mb-1">Vehicle</label>
                                <select
                                    className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                                    value={formData.vehicleId}
                                    onChange={(e) => setFormData({ ...formData, vehicleId: e.target.value })}
                                >
                                    <option value="" className="text-slate-500">Select Vehicle</option>
                                    {mockVehicles.map(vehicle => (
                                        <option key={vehicle.id} value={vehicle.id} className="text-slate-900">
                                            {vehicle.make} {vehicle.model} - {vehicle.licensePlate}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Date */}
                            <div className="md:col-span-1">
                                <label className="block text-xs font-medium text-slate-700 mb-1">Date Required</label>
                                <input
                                    type="date"
                                    required
                                    min={new Date().toISOString().split('T')[0]}
                                    className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                                    value={formData.date}
                                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-4">
                            {/* Priority */}
                            <div className="md:col-span-1">
                                <label className="block text-xs font-medium text-slate-700 mb-1">Priority</label>
                                <div className="flex gap-2">
                                    {['Low', 'Medium', 'High'].map((p) => (
                                        <label key={p} className={`flex-1 cursor-pointer rounded-lg border px-2 py-2 text-center text-xs font-medium transition-all ${formData.priority === p
                                            ? p === 'High' ? 'bg-red-50 border-red-200 text-red-700'
                                                : p === 'Medium' ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
                                                    : 'bg-green-50 border-green-200 text-green-700'
                                            : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                                            }`}>
                                            <input
                                                type="radio"
                                                name="priority"
                                                value={p}
                                                checked={formData.priority === p}
                                                onChange={(e) => setFormData({ ...formData, priority: e.target.value as 'Low' | 'Medium' | 'High' })}
                                                className="sr-only"
                                            />
                                            {p}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Description */}
                            <div className="md:col-span-3">
                                <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                                <input
                                    type="text"
                                    required
                                    className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors placeholder-slate-400"
                                    placeholder="Brief description of the service required..."
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Submit Button */}
                        <div className="flex justify-end pt-2">
                            <button
                                type="submit"
                                className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-blue-500/20 transition-all hover:bg-blue-700 hover:scale-105"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                                </svg>
                                Submit Request
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
