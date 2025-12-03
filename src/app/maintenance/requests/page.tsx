'use client';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import {
    MaintenanceRequest,
    Vehicle,
    MaintenanceStatus,
    Attachment,
    AttachmentType,
} from '@/types/maintenance';
import {
    getMaintenanceRequests,
    getVehicles,
    updateMaintenanceRequest,
} from '@/services/mockData';
import StatusBadge from '@/components/ui/StatusBadge';
import { getNextStatuses } from '@/services/workflowStateMachine';
import FilterBar from '@/components/Maintenance/FilterBar';

// --- Modals ---

type StatusUpdateModalProps = {
    isOpen: boolean;
    onClose: () => void;
    currentStatus: MaintenanceStatus;
    onUpdate: (newStatus: MaintenanceStatus) => void;
};

function StatusUpdateModal({
    isOpen,
    onClose,
    currentStatus,
    onUpdate,
}: StatusUpdateModalProps) {
    const [selectedStatus, setSelectedStatus] =
        useState<MaintenanceStatus>(currentStatus);

    useEffect(() => {
        setSelectedStatus(currentStatus);
    }, [currentStatus]);

    if (!isOpen) return null;

    const nextStatuses = getNextStatuses(currentStatus);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
                <h3 className="text-lg font-bold text-slate-900">Update Status</h3>
                <p className="mt-1 text-sm text-slate-500">
                    Change the status of this maintenance request.
                </p>
                <div className="mt-4">
                    <label className="block text-sm font-medium text-slate-700">
                        New Status
                    </label>
                    <select
                        className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={selectedStatus}
                        onChange={(e) =>
                            setSelectedStatus(e.target.value as MaintenanceStatus)
                        }
                    >
                        <option
                            key={currentStatus}
                            value={currentStatus}
                            className="bg-white text-slate-900"
                        >
                            {currentStatus} (Current)
                        </option>
                        {nextStatuses.map((status) => (
                            <option
                                key={status}
                                value={status}
                                className="bg-white text-slate-900"
                            >
                                {status}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => {
                            onUpdate(selectedStatus);
                            onClose();
                        }}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                        Update Status
                    </button>
                </div>
            </div>
        </div>
    );
}

// --- Main Page Component ---

export default function MaintenanceRequestsPage() {
    const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
    const [filteredRequests, setFilteredRequests] = useState<MaintenanceRequest[]>([]);
    const [vehicles, setVehicles] = useState<Record<string, Vehicle>>({});
    const [loading, setLoading] = useState(true);

    // Modal State
    const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
    const [selectedRequest, setSelectedRequest] =
        useState<MaintenanceRequest | null>(null);

    // Action Menu State
    const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            const [reqs, vehs] = await Promise.all([
                getMaintenanceRequests(),
                getVehicles(),
            ]);
            setRequests(reqs);
            setFilteredRequests(reqs);

            const vehMap = vehs.reduce((acc, v) => {
                acc[v.id] = v;
                return acc;
            }, {} as Record<string, Vehicle>);
            setVehicles(vehMap);

            setLoading(false);
        };
        fetchData();
    }, []);

    // Close action menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            // Ignore clicks on the toggle button itself
            if ((event.target as Element).closest('[data-action-toggle]')) {
                return;
            }
            setOpenActionMenuId(null);
        };
        document.addEventListener('click', handleClickOutside);
        return () => {
            document.removeEventListener('click', handleClickOutside);
        };
    }, []);

    const handleFilter = (term: string, dateRange: { start: string, end: string }, statuses: string[]) => {
        let result = requests;

        // Search
        if (term) {
            const lowerTerm = term.toLowerCase();
            result = result.filter(r =>
                r.id.toLowerCase().includes(lowerTerm) ||
                r.description.toLowerCase().includes(lowerTerm) ||
                (vehicles[r.vehicleId]?.make + ' ' + vehicles[r.vehicleId]?.model).toLowerCase().includes(lowerTerm)
            );
        }

        // Date Range
        if (dateRange.start) {
            result = result.filter(r => r.requestDate >= dateRange.start);
        }
        if (dateRange.end) {
            result = result.filter(r => r.requestDate <= dateRange.end);
        }

        // Status
        if (statuses.length > 0) {
            result = result.filter(r => statuses.includes(r.status));
        }

        setFilteredRequests(result);
    };

    const handleStatusClick = (request: MaintenanceRequest) => {
        setSelectedRequest(request);
        setIsStatusModalOpen(true);
    };

    const handleStatusUpdate = async (newStatus: MaintenanceStatus) => {
        if (!selectedRequest) return;

        try {
            const updatedRequest = await updateMaintenanceRequest(selectedRequest.id, {
                status: newStatus,
            });

            setRequests((prev) =>
                prev.map((r) => (r.id === updatedRequest.id ? updatedRequest : r))
            );
            // Re-apply filters (simplified: just update filtered list too)
            setFilteredRequests((prev) =>
                prev.map((r) => (r.id === updatedRequest.id ? updatedRequest : r))
            );
        } catch (error) {
            console.error('Failed to update status:', error);
            alert('Failed to update status. Please try again.');
        }
    };

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <div className="text-slate-500">Loading requests...</div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">
                        Maintenance Requests
                    </h1>
                    <p className="mt-1 text-slate-500">
                        View and manage all maintenance requests.
                    </p>
                </div>
                <Link
                    href="/maintenance/create"
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                    Create New Request
                </Link>
            </div>

            <FilterBar
                onSearch={(term) => handleFilter(term, { start: '', end: '' }, [])}
                onDateRangeChange={(start, end) => handleFilter('', { start, end }, [])}
                onStatusChange={(statuses) => handleFilter('', { start: '', end: '' }, statuses)}
                statusOptions={Object.values(MaintenanceStatus)}
                placeholder="Search requests..."
            />

            {/* Removed overflow-hidden to allow dropdowns to spill out */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-500">
                            <tr>
                                <th className="px-6 py-3 font-medium">Request ID</th>
                                <th className="px-6 py-3 font-medium">Vehicle</th>
                                <th className="px-6 py-3 font-medium">Description</th>
                                <th className="px-6 py-3 font-medium">Date</th>
                                <th className="px-6 py-3 font-medium">Status</th>
                                <th className="px-6 py-3 font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredRequests.map((request) => {
                                const vehicle = vehicles[request.vehicleId];
                                return (
                                    <tr key={request.id} className="hover:bg-slate-50">
                                        <td className="px-6 py-4 font-medium text-slate-900">
                                            <Link
                                                href={`/maintenance/requests/${encodeURIComponent(request.id)}`}
                                                className="hover:text-blue-600 hover:underline"
                                            >
                                                {request.id}
                                            </Link>
                                        </td>
                                        <td className="px-6 py-4 text-slate-700">
                                            {vehicle
                                                ? `${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})`
                                                : 'Unknown Vehicle'}
                                        </td>
                                        <td className="px-6 py-4 text-slate-600">
                                            <div className="max-w-xs truncate" title={request.description}>
                                                {request.description}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-600">
                                            {request.requestDate}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div
                                                onClick={() => handleStatusClick(request)}
                                                className="cursor-pointer transition-transform hover:scale-105"
                                            >
                                                <StatusBadge status={request.status} />
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="relative">
                                                <button
                                                    data-action-toggle="true"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setOpenActionMenuId(openActionMenuId === request.id ? null : request.id);
                                                    }}
                                                    className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
                                                    </svg>
                                                </button>

                                                {/* Dropdown Menu */}
                                                {openActionMenuId === request.id && (
                                                    <div className="absolute right-0 top-8 w-48 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50">
                                                        <div className="py-1">
                                                            <Link
                                                                href={`/maintenance/requests/${encodeURIComponent(request.id)}`}
                                                                className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                                                                onClick={() => setOpenActionMenuId(null)}
                                                            >
                                                                Update/View Details
                                                            </Link>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleStatusClick(request);
                                                                    setOpenActionMenuId(null);
                                                                }}
                                                                className="block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                                                            >
                                                                Update Status
                                                            </button>
                                                            <Link
                                                                href={`/maintenance/requests/${encodeURIComponent(request.id)}#attachments`}
                                                                className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                                                                onClick={() => setOpenActionMenuId(null)}
                                                            >
                                                                Attachments
                                                            </Link>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {filteredRequests.length === 0 && (
                    <div className="p-12 text-center text-slate-500">
                        No requests found matching your filters.
                    </div>
                )}
            </div>

            <StatusUpdateModal
                isOpen={isStatusModalOpen}
                onClose={() => setIsStatusModalOpen(false)}
                currentStatus={
                    selectedRequest ? selectedRequest.status : MaintenanceStatus.REQUESTED
                }
                onUpdate={handleStatusUpdate}
            />
        </div>
    );
}
