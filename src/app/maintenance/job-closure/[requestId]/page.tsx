'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    EnhancedMaintenanceRequest,
    EnhancedInvoice,
    Vehicle,
    Driver,
    MaintenanceStatus
} from '@/types/maintenance';
import { getMaintenanceRequests, getVehicles, getDrivers } from '@/services/mockData';
import { sendJobClosureEmail } from '@/services/email/emailService';
import { formatCurrency } from '@/utils/currency';

export default function JobClosurePage() {
    const params = useParams();
    const router = useRouter();
    const requestId = params.requestId as string;

    const [request, setRequest] = useState<EnhancedMaintenanceRequest | null>(null);
    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [driver, setDriver] = useState<Driver | null>(null);
    const [loading, setLoading] = useState(true);
    const [closing, setClosing] = useState(false);
    const [closureNotes, setClosureNotes] = useState('');

    useEffect(() => {
        const fetchData = async () => {
            const [requests, vehicles, drivers] = await Promise.all([
                getMaintenanceRequests(),
                getVehicles(),
                getDrivers()
            ]);

            const foundRequest = requests.find(r => r.id === requestId) as EnhancedMaintenanceRequest;
            if (!foundRequest) {
                router.push('/maintenance/requests');
                return;
            }

            setRequest(foundRequest);

            const foundVehicle = vehicles.find(v => v.id === foundRequest.vehicleId);
            setVehicle(foundVehicle || null);

            const foundDriver = drivers.find(d => d.id === foundRequest.driverId);
            setDriver(foundDriver || null);

            setLoading(false);
        };

        fetchData();
    }, [requestId, router]);

    const calculateDowntime = () => {
        if (!request?.requestDate || !request?.completionDate) return 0;
        const start = new Date(request.requestDate);
        const end = new Date(request.completionDate);
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    };

    const handleCloseJob = async () => {
        if (!request) return;

        setClosing(true);

        try {
            // Send closure notifications
            await sendJobClosureEmail(request);

            // Update request status
            const updatedRequest: EnhancedMaintenanceRequest = {
                ...request,
                status: MaintenanceStatus.CLOSED,
                completionDate: new Date().toISOString()
            };

            // TODO: Save to backend
            alert('Job closed successfully! Closure notifications sent to all stakeholders.');
            router.push('/maintenance/requests');
        } catch (error) {
            alert('Failed to close job');
        } finally {
            setClosing(false);
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
    if (!request) return <div className="p-8 text-center text-slate-500">Request not found</div>;

    const downtime = calculateDowntime();
    const invoice = request.enhancedInvoice;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-white">Job Closure</h1>
                <p className="mt-1 text-slate-500">Request #{request.id.toUpperCase()}</p>
            </div>

            {/* Completion Summary */}
            <div className="rounded-xl border border-green-200 bg-emerald-500/10 p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                    <div className="rounded-full bg-green-600 p-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-white">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-emerald-300">Maintenance Completed</h3>
                        <p className="text-sm text-green-700">Ready to close this job</p>
                    </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-green-700">Status:</span>
                        <span className="ml-2 font-medium text-emerald-300">{request.status}</span>
                    </div>
                    <div>
                        <span className="text-green-700">Downtime:</span>
                        <span className="ml-2 font-medium text-emerald-300">{downtime} days</span>
                    </div>
                    <div>
                        <span className="text-green-700">Total Cost:</span>
                        <span className="ml-2 font-medium text-emerald-300">
                            {invoice ? formatCurrency(invoice.grandTotal) : 'N/A'}
                        </span>
                    </div>
                    <div>
                        <span className="text-green-700">Completed:</span>
                        <span className="ml-2 font-medium text-emerald-300">
                            {request.completionDate ? new Date(request.completionDate).toLocaleDateString() : 'N/A'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Request Details */}
            <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                <h3 className="text-lg font-bold text-white mb-4">Request Details</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <span className="text-slate-500">Vehicle:</span>
                        <span className="ml-2 font-medium text-white">
                            {vehicle ? `${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})` : 'N/A'}
                        </span>
                    </div>
                    <div>
                        <span className="text-slate-500">Driver:</span>
                        <span className="ml-2 font-medium text-white">{driver?.name || 'N/A'}</span>
                    </div>
                    <div>
                        <span className="text-slate-500">Maintenance Type:</span>
                        <span className="ml-2 font-medium text-white">{request.maintenanceType || 'N/A'}</span>
                    </div>
                    <div>
                        <span className="text-slate-500">Priority:</span>
                        <span className="ml-2 font-medium text-white">{request.priority || 'Medium'}</span>
                    </div>
                    <div className="col-span-2">
                        <span className="text-slate-500">Description:</span>
                        <p className="text-white mt-1">{request.description}</p>
                    </div>
                </div>
            </div>

            {/* Workflow Timeline */}
            {request.statusTransitions && request.statusTransitions.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-white mb-4">Workflow Timeline</h3>
                    <div className="space-y-3">
                        {request.statusTransitions.map((transition, index) => (
                            <div key={index} className="flex items-start gap-4">
                                <div className="flex-shrink-0 w-24 text-xs text-slate-500">
                                    {new Date(transition.transitionedAt).toLocaleDateString()}
                                </div>
                                <div className="flex-shrink-0">
                                    <div className="w-2 h-2 rounded-full bg-blue-600 mt-1.5"></div>
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-white">
                                        {transition.from} → {transition.to}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                        by {transition.transitionedByName}
                                        {transition.comments && ` - ${transition.comments}`}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Invoice Summary */}
            {invoice && (
                <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-white mb-4">Invoice Summary</h3>
                    <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-600">Invoice Number:</span>
                            <span className="font-medium text-white">{invoice.invoiceNumber}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-600">Parts Total:</span>
                            <span className="font-medium text-white">{formatCurrency(invoice.partsTotal)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-600">Labor Total:</span>
                            <span className="font-medium text-white">{formatCurrency(invoice.laborTotal)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-600">Other Charges:</span>
                            <span className="font-medium text-white">{formatCurrency(invoice.otherCharges)}</span>
                        </div>
                        <div className="flex justify-between text-sm pt-3 border-t border-white/10">
                            <span className="text-slate-600">Subtotal:</span>
                            <span className="font-medium text-white">{formatCurrency(invoice.subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-600">Tax ({(invoice.taxRate * 100).toFixed(1)}%):</span>
                            <span className="font-medium text-white">{formatCurrency(invoice.taxAmount)}</span>
                        </div>
                        <div className="flex justify-between text-lg font-bold pt-3 border-t-2 border-white/15">
                            <span className="text-white">Grand Total:</span>
                            <span className="text-blue-600">{formatCurrency(invoice.grandTotal)}</span>
                        </div>
                        <div className="flex justify-between text-sm pt-3 border-t border-white/10">
                            <span className="text-slate-600">Payment Status:</span>
                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${invoice.paymentStatus === 'Paid' ? 'bg-emerald-500/20 text-green-700 border-green-300' :
                                    invoice.paymentStatus === 'Partially Paid' ? 'bg-amber-500/20 text-yellow-700 border-yellow-300' :
                                        'bg-red-500/20 text-red-700 border-red-300'
                                }`}>
                                {invoice.paymentStatus}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Closure Notes */}
            <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                <h3 className="text-lg font-bold text-white mb-4">Closure Notes (Optional)</h3>
                <textarea
                    rows={4}
                    value={closureNotes}
                    onChange={(e) => setClosureNotes(e.target.value)}
                    className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                    placeholder="Add any final notes or comments about this job..."
                />
            </div>

            {/* Closure Confirmation */}
            <div className="rounded-xl border border-blue-200 bg-blue-500/10 p-6">
                <h3 className="text-base font-bold text-blue-300 mb-2">Closure Confirmation</h3>
                <p className="text-sm text-blue-300 mb-4">
                    Closing this job will:
                </p>
                <ul className="text-sm text-blue-300 space-y-1 mb-4 ml-4 list-disc">
                    <li>Send closure notifications to all stakeholders</li>
                    <li>Update the request status to CLOSED</li>
                    <li>Archive all related documents</li>
                    <li>Update vehicle maintenance history</li>
                    <li>Update garage performance metrics</li>
                </ul>
                <p className="text-xs text-blue-700">
                    This action cannot be undone. Please ensure all details are correct before proceeding.
                </p>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-3">
                <button
                    onClick={() => router.back()}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10"
                >
                    Cancel
                </button>
                <button
                    onClick={handleCloseJob}
                    disabled={closing}
                    className="rounded-lg bg-green-600 px-6 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:bg-green-300 disabled:cursor-not-allowed"
                >
                    {closing ? 'Closing Job...' : 'Close Job'}
                </button>
            </div>
        </div>
    );
}
