'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
    EnhancedMaintenanceRequest,
    MaintenanceStatus,
    Vehicle,
    Driver
} from '@/types/maintenance';
import { getMaintenanceRequests, getVehicles, getDrivers } from '@/services/mockData';


export default function OperationsDashboardPage() {
    const [requests, setRequests] = useState<EnhancedMaintenanceRequest[]>([]);
    const [vehicles, setVehicles] = useState<Record<string, Vehicle>>({});
    const [drivers, setDrivers] = useState<Record<string, Driver>>({});
    const [loading, setLoading] = useState(true);
    const [selectedRequest, setSelectedRequest] = useState<EnhancedMaintenanceRequest | null>(null);
    const [showAckModal, setShowAckModal] = useState(false);
    const [ackComments, setAckComments] = useState('');
    const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set());

    useEffect(() => {
        const fetchData = async () => {
            const [allRequests, allVehicles, allDrivers] = await Promise.all([
                getMaintenanceRequests(),
                getVehicles(),
                getDrivers()
            ]);

            // Create lookup maps
            const vehicleMap = allVehicles.reduce((acc, v) => ({ ...acc, [v.id]: v }), {} as Record<string, Vehicle>);
            const driverMap = allDrivers.reduce((acc, d) => ({ ...acc, [d.id]: d }), {} as Record<string, Driver>);

            setVehicles(vehicleMap);
            setDrivers(driverMap);

            // Filter requests pending operations acknowledgment
            const pendingRequests = allRequests.filter(
                r => r.status === MaintenanceStatus.PENDING_OPERATIONS_ACK || r.status === MaintenanceStatus.SUBMITTED
            ) as EnhancedMaintenanceRequest[];

            setRequests(pendingRequests);
            setLoading(false);
        };

        fetchData();
    }, []);

    const handleAcknowledge = async (request: EnhancedMaintenanceRequest) => {
        // const acknowledgment: OperationsAcknowledgment = {
        //     acknowledgedBy: 'ops-user-1', // TODO: Get from auth
        //     acknowledgedByName: 'Operations Manager',
        //     acknowledgedAt: new Date().toISOString(),
        //     comments
        // };



        // Update local state
        setRequests(requests.filter(r => r.id !== request.id));
        setShowAckModal(false);
        setAckComments('');
        setSelectedRequest(null);

        // TODO: Save to backend
        alert(`Request ${request.id} acknowledged successfully!`);
    };

    const handleBulkAcknowledge = async () => {
        if (selectedRequests.size === 0) {
            alert('Please select at least one request');
            return;
        }

        const count = selectedRequests.size;

        // Acknowledge all selected requests
        const updatedRequests = requests.filter(r => !selectedRequests.has(r.id));
        setRequests(updatedRequests);
        setSelectedRequests(new Set());

        alert(`${count} request(s) acknowledged successfully!`);
    };

    const toggleRequestSelection = (requestId: string) => {
        const newSelection = new Set(selectedRequests);
        if (newSelection.has(requestId)) {
            newSelection.delete(requestId);
        } else {
            newSelection.add(requestId);
        }
        setSelectedRequests(newSelection);
    };

    const toggleSelectAll = () => {
        if (selectedRequests.size === requests.length) {
            setSelectedRequests(new Set());
        } else {
            setSelectedRequests(new Set(requests.map(r => r.id)));
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Operations Dashboard</h1>
                    <p className="mt-1 text-slate-500">Acknowledge pending maintenance requests</p>
                </div>
                {selectedRequests.size > 0 && (
                    <button
                        onClick={handleBulkAcknowledge}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                        Acknowledge Selected ({selectedRequests.size})
                    </button>
                )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-sm text-slate-500">Pending Acknowledgment</p>
                    <p className="text-3xl font-bold text-blue-600">{requests.length}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-sm text-slate-500">Selected</p>
                    <p className="text-3xl font-bold text-slate-900">{selectedRequests.size}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-sm text-slate-500">Avg Response Time</p>
                    <p className="text-3xl font-bold text-green-600">2.5h</p>
                </div>
            </div>

            {/* Requests Table */}
            {requests.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="mx-auto w-12 h-12 text-slate-400 mb-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                    <p className="text-slate-500 font-medium">All caught up!</p>
                    <p className="text-sm text-slate-400 mt-1">No requests pending acknowledgment</p>
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-6 py-3 text-left">
                                    <input
                                        type="checkbox"
                                        checked={selectedRequests.size === requests.length && requests.length > 0}
                                        onChange={toggleSelectAll}
                                        className="h-4 w-4 rounded border-slate-300 text-blue-600"
                                    />
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Request ID</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Vehicle</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Driver</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Description</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Submitted</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Priority</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                            {requests.map(request => {
                                const vehicle = vehicles[request.vehicleId];
                                const driver = drivers[request.driverId];
                                const isSelected = selectedRequests.has(request.id);

                                return (
                                    <tr key={request.id} className={`hover:bg-slate-50 transition-colors ${isSelected ? 'bg-blue-50' : ''}`}>
                                        <td className="px-6 py-4">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleRequestSelection(request.id)}
                                                className="h-4 w-4 rounded border-slate-300 text-blue-600"
                                            />
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <Link href={`/maintenance/requests/${request.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                                                #{request.id.toUpperCase()}
                                            </Link>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-slate-900">{vehicle?.make} {vehicle?.model}</div>
                                            <div className="text-xs text-slate-500">{vehicle?.licensePlate}</div>
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                                            {driver?.name}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-slate-900 max-w-xs truncate">{request.description}</div>
                                            {request.maintenanceType && (
                                                <div className="text-xs text-slate-500 mt-1">{request.maintenanceType}</div>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                                            {new Date(request.requestDate).toLocaleDateString()}
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${request.priority === 'Critical' ? 'bg-red-100 text-red-700 border-red-300' :
                                                request.priority === 'High' ? 'bg-orange-100 text-orange-700 border-orange-300' :
                                                    request.priority === 'Medium' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                                                        'bg-green-100 text-green-700 border-green-300'
                                                }`}>
                                                {request.priority || 'Low'}
                                            </span>
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <button
                                                onClick={() => {
                                                    setSelectedRequest(request);
                                                    setShowAckModal(true);
                                                }}
                                                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                                            >
                                                Acknowledge
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Acknowledgment Modal */}
            {showAckModal && selectedRequest && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl">
                        <div className="p-6 border-b border-slate-200">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-slate-900">Acknowledge Request</h3>
                                <button onClick={() => setShowAckModal(false)} className="text-slate-400 hover:text-slate-600">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <span className="text-slate-500">Request ID:</span>
                                        <span className="ml-2 font-medium text-slate-900">#{selectedRequest.id.toUpperCase()}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Vehicle:</span>
                                        <span className="ml-2 font-medium text-slate-900">
                                            {vehicles[selectedRequest.vehicleId]?.licensePlate}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Driver:</span>
                                        <span className="ml-2 font-medium text-slate-900">
                                            {drivers[selectedRequest.driverId]?.name}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Priority:</span>
                                        <span className="ml-2 font-medium text-slate-900">{selectedRequest.priority || 'Low'}</span>
                                    </div>
                                </div>
                                <div className="mt-3 pt-3 border-t border-slate-200">
                                    <p className="text-xs text-slate-500">Description</p>
                                    <p className="text-sm text-slate-900 mt-1">{selectedRequest.description}</p>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Comments (Optional)</label>
                                <textarea
                                    rows={4}
                                    value={ackComments}
                                    onChange={(e) => setAckComments(e.target.value)}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    placeholder="Add any notes or instructions..."
                                />
                            </div>

                            <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
                                <p className="text-sm text-blue-900">
                                    <span className="font-medium">Next Step:</span> This request will be forwarded to the Maintenance Team for approval.
                                </p>
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                            <button
                                onClick={() => setShowAckModal(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleAcknowledge(selectedRequest, ackComments)}
                                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
                            >
                                Acknowledge & Forward
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
