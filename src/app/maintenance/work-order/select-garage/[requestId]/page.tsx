'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    EnhancedMaintenanceRequest,
    Estimate,
    EnhancedGarage,
    EnhancedDriver,
    WorkOrderConfirmation
} from '@/types/maintenance';
import { getMaintenanceRequests, getGarages, getDrivers } from '@/services/mockData';
import { sendWorkOrderEmail, sendDriverAssignmentEmail } from '@/services/email/emailService';
import { formatCurrency } from '@/utils/currency';

export default function SelectGaragePage() {
    const params = useParams();
    const router = useRouter();
    const requestId = params.requestId as string;

    const [request, setRequest] = useState<EnhancedMaintenanceRequest | null>(null);
    const [estimates, setEstimates] = useState<Estimate[]>([]);
    const [garages, setGarages] = useState<Record<string, EnhancedGarage>>({});
    const [drivers, setDrivers] = useState<EnhancedDriver[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedEstimateId, setSelectedEstimateId] = useState<string>('');
    const [showDriverModal, setShowDriverModal] = useState(false);
    const [selectedDriverId, setSelectedDriverId] = useState<string>('');
    const [driverNotes, setDriverNotes] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            const [requests, allGarages, allDrivers] = await Promise.all([
                getMaintenanceRequests(),
                getGarages(),
                getDrivers()
            ]);

            const foundRequest = requests.find(r => r.id === requestId) as EnhancedMaintenanceRequest;
            if (!foundRequest) {
                router.push('/maintenance/requests');
                return;
            }

            setRequest(foundRequest);

            // Get approved estimates
            const approvedEstimates = foundRequest.estimates?.filter(e => e.status === 'APPROVED') || [];
            setEstimates(approvedEstimates);

            // Create garage map
            const garageMap = allGarages.reduce((acc, g) => {
                acc[g.id] = {
                    ...g,
                    services: [],
                    isExternal: !g.isInternal,
                    rating: 4.5,
                    completedJobs: 20,
                    averageCompletionTime: 3,
                    averageCost: 800
                };
                return acc;
            }, {} as Record<string, EnhancedGarage>);
            setGarages(garageMap);

            // Get available drivers
            const enhancedDrivers: EnhancedDriver[] = allDrivers.map(d => ({
                ...d,
                availability: 'AVAILABLE' as const,
                currentAssignments: []
            }));
            setDrivers(enhancedDrivers);

            setLoading(false);
        };

        fetchData();
    }, [requestId, router]);

    const handleSendWorkOrder = async () => {
        if (!selectedEstimateId || !request) {
            alert('Please select an estimate');
            return;
        }

        const selectedEstimate = estimates.find(e => e.id === selectedEstimateId);
        if (!selectedEstimate) return;

        const selectedGarage = garages[selectedEstimate.garageId];
        if (!selectedGarage) return;

        // Check if garage is external
        if (selectedGarage.isExternal && !selectedDriverId) {
            setShowDriverModal(true);
            return;
        }

        setSending(true);

        try {
            // Create work order confirmation
            const workOrder: WorkOrderConfirmation = {
                workOrderNumber: `WO-${request.id.toUpperCase()}`,
                requestId: request.id,
                selectedGarageId: selectedGarage.id,
                selectedGarageName: selectedGarage.name,
                approvedEstimateId: selectedEstimate.id,
                expectedStartDate: new Date().toISOString(),
                expectedCompletionDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
                sentAt: new Date().toISOString(),
                sentBy: 'operations-user',
                emailStatus: 'SENT'
            };

            console.log('Work Order Created:', workOrder);

            // Send work order email
            await sendWorkOrderEmail(request, selectedGarage.name, selectedGarage.email);

            // If driver assigned, send driver notification
            if (selectedDriverId) {
                const driver = drivers.find(d => d.id === selectedDriverId);
                if (driver) {
                    await sendDriverAssignmentEmail(
                        request,
                        driver.name,
                        driver.email || `${driver.name.toLowerCase().replace(/\s+/g, '')}@company.com`,
                        selectedGarage.name
                    );
                }
            }

            alert('Work order sent successfully!');
            router.push(`/maintenance/requests/${request.id}`);
        } catch (error) {
            console.error('Failed to send work order:', error);
            alert('Failed to send work order');
        } finally {
            setSending(false);
        }
    };

    const handleDriverAssignment = async () => {
        if (!selectedDriverId) {
            alert('Please select a driver');
            return;
        }

        setShowDriverModal(false);
        await handleSendWorkOrder();
    };

    if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
    if (!request) return <div className="p-8 text-center text-slate-500">Request not found</div>;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-slate-900">Select Garage & Send Work Order</h1>
                <p className="mt-1 text-slate-500">Request #{request.id.toUpperCase()}</p>
            </div>

            {/* Request Summary */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900 mb-4">Request Details</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-slate-500">Maintenance Type:</span>
                        <span className="ml-2 font-medium text-slate-900">{request.maintenanceType || 'N/A'}</span>
                    </div>
                    <div>
                        <span className="text-slate-500">Priority:</span>
                        <span className="ml-2 font-medium text-slate-900">{request.priority || 'Medium'}</span>
                    </div>
                    <div>
                        <span className="text-slate-500">Status:</span>
                        <span className="ml-2 font-medium text-slate-900">{request.status}</span>
                    </div>
                    <div>
                        <span className="text-slate-500">Approved Estimates:</span>
                        <span className="ml-2 font-medium text-slate-900">{estimates.length}</span>
                    </div>
                </div>
            </div>

            {/* Approved Estimates */}
            {estimates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
                    <p className="text-slate-500 font-medium">No approved estimates</p>
                    <p className="text-sm text-slate-400 mt-1">Please approve an estimate before proceeding</p>
                </div>
            ) : (
                <div className="space-y-4">
                    <h3 className="text-lg font-bold text-slate-900">Select Approved Estimate</h3>
                    {estimates.map(estimate => {
                        const garage = garages[estimate.garageId];
                        const isSelected = selectedEstimateId === estimate.id;

                        return (
                            <div
                                key={estimate.id}
                                onClick={() => setSelectedEstimateId(estimate.id)}
                                className={`rounded-xl border-2 p-6 cursor-pointer transition-all ${isSelected
                                    ? 'border-blue-500 bg-blue-50 shadow-lg'
                                    : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-md'
                                    }`}
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="radio"
                                            checked={isSelected}
                                            onChange={() => setSelectedEstimateId(estimate.id)}
                                            className="h-5 w-5 text-blue-600"
                                        />
                                        <div>
                                            <h4 className="text-lg font-bold text-slate-900">{estimate.garageName}</h4>
                                            <p className="text-sm text-slate-500">
                                                {garage?.isExternal ? 'External Garage' : 'Internal Garage'}
                                                {garage?.isExternal && ' - Driver assignment required'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-2xl font-bold text-blue-600">{formatCurrency(estimate.estimatedCost)}</p>
                                        <p className="text-xs text-slate-500">Total Estimate</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-4 text-sm">
                                    <div className="rounded-lg bg-slate-100 p-3">
                                        <p className="text-xs text-slate-500">Parts</p>
                                        <p className="text-base font-medium text-slate-900">{formatCurrency(estimate.breakdown.parts)}</p>
                                    </div>
                                    <div className="rounded-lg bg-slate-100 p-3">
                                        <p className="text-xs text-slate-500">Labor</p>
                                        <p className="text-base font-medium text-slate-900">{formatCurrency(estimate.breakdown.labor)}</p>
                                    </div>
                                    <div className="rounded-lg bg-slate-100 p-3">
                                        <p className="text-xs text-slate-500">Other</p>
                                        <p className="text-base font-medium text-slate-900">{formatCurrency(estimate.breakdown.other)}</p>
                                    </div>
                                </div>

                                {estimate.notes && (
                                    <div className="mt-4 pt-4 border-t border-slate-200">
                                        <p className="text-xs text-slate-500">Notes</p>
                                        <p className="text-sm text-slate-700 mt-1">{estimate.notes}</p>
                                    </div>
                                )}

                                {garage?.isExternal && isSelected && (
                                    <div className="mt-4 rounded-lg bg-yellow-50 border border-yellow-200 p-4">
                                        <p className="text-sm text-yellow-900">
                                            <span className="font-medium">⚠️ External Garage:</span> You will be prompted to assign a driver before sending the work order.
                                        </p>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Action Buttons */}
            {estimates.length > 0 && (
                <div className="flex justify-end gap-3">
                    <button
                        onClick={() => router.back()}
                        className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSendWorkOrder}
                        disabled={!selectedEstimateId || sending}
                        className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
                    >
                        {sending ? 'Sending...' : 'Send Work Order'}
                    </button>
                </div>
            )}

            {/* Driver Assignment Modal */}
            {showDriverModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl">
                        <div className="p-6 border-b border-slate-200">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-slate-900">Assign Driver</h3>
                                <button onClick={() => setShowDriverModal(false)} className="text-slate-400 hover:text-slate-600">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
                                <p className="text-sm text-blue-900">
                                    <span className="font-medium">External Garage Selected:</span> A driver is required to deliver the vehicle to the garage.
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Select Driver</label>
                                <select
                                    value={selectedDriverId}
                                    onChange={(e) => setSelectedDriverId(e.target.value)}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                >
                                    <option value="">Select a driver...</option>
                                    {drivers.filter(d => d.availability === 'AVAILABLE').map(driver => (
                                        <option key={driver.id} value={driver.id}>
                                            {driver.name} - {driver.licenseNumber}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {selectedDriverId && (
                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                    {(() => {
                                        const driver = drivers.find(d => d.id === selectedDriverId);
                                        return driver ? (
                                            <div className="grid grid-cols-2 gap-4 text-sm">
                                                <div>
                                                    <span className="text-slate-500">Name:</span>
                                                    <span className="ml-2 font-medium text-slate-900">{driver.name}</span>
                                                </div>
                                                <div>
                                                    <span className="text-slate-500">License:</span>
                                                    <span className="ml-2 font-medium text-slate-900">{driver.licenseNumber}</span>
                                                </div>
                                                <div>
                                                    <span className="text-slate-500">Contact:</span>
                                                    <span className="ml-2 font-medium text-slate-900">{driver.contactNumber}</span>
                                                </div>
                                                <div>
                                                    <span className="text-slate-500">Status:</span>
                                                    <span className="ml-2 font-medium text-green-600">{driver.availability}</span>
                                                </div>
                                            </div>
                                        ) : null;
                                    })()}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Notes (Optional)</label>
                                <textarea
                                    rows={3}
                                    value={driverNotes}
                                    onChange={(e) => setDriverNotes(e.target.value)}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    placeholder="Add any special instructions for the driver..."
                                />
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                            <button
                                onClick={() => setShowDriverModal(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDriverAssignment}
                                disabled={!selectedDriverId}
                                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
                            >
                                Assign & Send Work Order
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
