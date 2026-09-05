'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
    EnhancedMaintenanceRequest,
    VendorQuotation,
    EstimateApproval,
    MaintenanceStatus,
    Vehicle
} from '@/types/maintenance';
import { getMaintenanceRequests, getVehicles } from '@/services/mockData';
import { formatCurrency } from '@/utils/currency';
import { validateApprovalLink } from '@/services/approvalLinkService';
import { UserRole, Permission, hasPermission, getCurrentUserRole } from '@/services/rbac';

export default function EstimateApprovalPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { requestId = '' } = useParams<{ requestId: string }>() ?? {};
    const token = searchParams?.get('token') ?? null;

    const [request, setRequest] = useState<EnhancedMaintenanceRequest | null>(null);
    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [quotations, setQuotations] = useState<VendorQuotation[]>([]);
    const [selectedQuotationId, setSelectedQuotationId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [approvalComments, setApprovalComments] = useState('');
    const [rejectionReason, setRejectionReason] = useState('');
    const [showApprovalModal, setShowApprovalModal] = useState(false);
    const [approvalAction, setApprovalAction] = useState<'approve' | 'reject'>('approve');
    const [isEmailApproval, setIsEmailApproval] = useState(false);
    const [linkValid, setLinkValid] = useState(true);

    // RBAC
    const currentUserRole = getCurrentUserRole();
    const canApproveEstimate = hasPermission(currentUserRole, Permission.APPROVE_ESTIMATE);

    useEffect(() => {
        const fetchData = async () => {
            const [requests, vehicles] = await Promise.all([
                getMaintenanceRequests(),
                getVehicles()
            ]);

            const foundRequest = requests.find(r => r.id === requestId) as EnhancedMaintenanceRequest;
            if (!foundRequest) {
                router.push('/maintenance/requests');
                return;
            }

            // Check if request is in correct status
            if (foundRequest.status !== MaintenanceStatus.PENDING_ESTIMATION_APPROVAL) {
                alert('This request is not pending estimate approval');
                router.push(`/maintenance/requests/${requestId}`);
                return;
            }

            // If token is present, validate it against the loaded request's approval links
            if (token) {
                const validation = validateApprovalLink(token, foundRequest.approvalLinks ?? []);
                if (!validation.valid) {
                    setLinkValid(false);
                    setLoading(false);
                    return;
                }
                setIsEmailApproval(true);
            }

            setRequest(foundRequest);

            const foundVehicle = vehicles.find(v => v.id === foundRequest.vehicleId);
            setVehicle(foundVehicle || null);

            // Load quotations
            if (foundRequest.vendorQuotations) {
                setQuotations(foundRequest.vendorQuotations);
            }

            setLoading(false);
        };

        fetchData();
    }, [requestId, token, router]);

    const handleApproveEstimate = async () => {
        if (!selectedQuotationId) {
            alert('Please select a quotation to approve');
            return;
        }

        if (!request) return;

        const selectedQuotation = quotations.find(q => q.id === selectedQuotationId);
        if (!selectedQuotation) return;

        // TRIPEXL: Create estimate approval record
        const estimateApproval: EstimateApproval = {
            id: `est-appr-${Date.now()}`,
            requestId: request.id,
            selectedQuotationId: selectedQuotationId,
            approvedBy: isEmailApproval ? 'Fleet Manager (Email)' : 'fleet-manager-1',
            approvedByName: isEmailApproval ? 'Fleet Manager' : 'Fleet Manager',
            approvedByRole: UserRole.FLEET_MANAGER,
            approvedAt: new Date().toISOString(),
            approvedCost: selectedQuotation.totalCost,
            comments: approvalComments,
            approvalMethod: isEmailApproval ? 'EMAIL_LINK' : 'IN_APP'
        };

        // Update quotation status
        const updatedQuotations = quotations.map(q => ({
            ...q,
            status: q.id === selectedQuotationId ? 'APPROVED' : 'REJECTED'
        })) as VendorQuotation[];

        // Record status transition
        const statusTransition = {
            from: request.status,
            to: MaintenanceStatus.ESTIMATION_APPROVED,
            transitionedAt: new Date().toISOString(),
            transitionedBy: estimateApproval.approvedBy,
            transitionedByName: estimateApproval.approvedByName,
            comments: approvalComments,
            automated: false
        };

        console.log('Estimate approved:', {
            requestId: request.id,
            quotationId: selectedQuotationId,
            approvedCost: selectedQuotation.totalCost,
            newStatus: MaintenanceStatus.ESTIMATION_APPROVED,
            estimateApproval,
            statusTransition
        });

        // TODO: Save to backend
        alert(`Estimate approved! Total cost: ${formatCurrency(selectedQuotation.totalCost)}. Request status updated to Estimation Approved.`);

        // Navigate to requests page
        router.push('/maintenance/requests');
    };

    const handleRejectEstimate = async () => {
        if (!rejectionReason.trim()) {
            alert('Please provide a reason for rejection');
            return;
        }

        if (!request) return;

        // TRIPEXL: Reject all quotations and send back to estimation
        const updatedQuotations = quotations.map(q => ({
            ...q,
            status: 'REJECTED'
        })) as VendorQuotation[];

        // Record status transition - back to UNDER_ESTIMATION
        const statusTransition = {
            from: request.status,
            to: MaintenanceStatus.UNDER_ESTIMATION,
            transitionedAt: new Date().toISOString(),
            transitionedBy: isEmailApproval ? 'Fleet Manager (Email)' : 'fleet-manager-1',
            transitionedByName: isEmailApproval ? 'Fleet Manager' : 'Fleet Manager',
            comments: rejectionReason,
            automated: false
        };

        console.log('Estimate rejected:', {
            requestId: request.id,
            reason: rejectionReason,
            newStatus: MaintenanceStatus.UNDER_ESTIMATION,
            statusTransition
        });

        // TODO: Save to backend and send email to maintenance team
        alert(`All estimates rejected. Request sent back to Under Estimation for new quotations.`);

        // Navigate to requests page
        router.push('/maintenance/requests');
    };

    const openApprovalModal = (action: 'approve' | 'reject') => {
        setApprovalAction(action);
        setShowApprovalModal(true);
    };

    // Access control check
    if (!canApproveEstimate && !isEmailApproval) {
        return (
            <div className="p-8 text-center">
                <div className="rounded-xl border border-red-200 bg-red-500/10 p-6 inline-block">
                    <p className="text-red-700 font-medium">Access Denied</p>
                    <p className="text-sm text-red-600 mt-1">You do not have permission to approve estimates.</p>
                </div>
            </div>
        );
    }

    // Link validation check
    if (!linkValid) {
        return (
            <div className="p-8 text-center">
                <div className="rounded-xl border border-red-200 bg-red-500/10 p-6 inline-block">
                    <p className="text-red-700 font-medium">Invalid or Expired Link</p>
                    <p className="text-sm text-red-600 mt-1">This approval link is invalid, expired, or has already been used.</p>
                </div>
            </div>
        );
    }

    if (loading) return <div className="p-8 text-center text-[var(--text-faint)]">Loading...</div>;
    if (!request) return <div className="p-8 text-center text-[var(--text-faint)]">Request not found</div>;

    const selectedQuotation = quotations.find(q => q.id === selectedQuotationId);
    const lowestQuotation = quotations.reduce((min, q) => q.totalCost < min.totalCost ? q : min, quotations[0]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-main)]">Estimate Approval</h1>
                    <p className="text-xs mt-1 text-[var(--text-faint)]">
                        Request #{request.id.toUpperCase()}
                        {isEmailApproval && <span className="ml-2 text-blue-600">• Email Approval</span>}
                    </p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => openApprovalModal('reject')}
                        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                    >
                        Reject All Estimates
                    </button>
                    <button
                        onClick={() => openApprovalModal('approve')}
                        disabled={!selectedQuotationId}
                        className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:bg-green-300 disabled:cursor-not-allowed"
                    >
                        Approve Selected
                    </button>
                </div>
            </div>

            {/* Request Summary */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-sm">
                <h3 className="text-lg font-bold text-[var(--text-main)] mb-4">Request Details</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-[var(--text-faint)]">Vehicle:</span>
                        <span className="ml-2 font-medium text-[var(--text-main)]">
                            {vehicle?.make} {vehicle?.model} ({vehicle?.licensePlate})
                        </span>
                    </div>
                    <div>
                        <span className="text-[var(--text-faint)]">Maintenance Type:</span>
                        <span className="ml-2 font-medium text-[var(--text-main)]">{request.maintenanceType || 'N/A'}</span>
                    </div>
                    <div>
                        <span className="text-[var(--text-faint)]">Priority:</span>
                        <span className="ml-2 font-medium text-[var(--text-main)]">{request.priority || 'Medium'}</span>
                    </div>
                    <div>
                        <span className="text-[var(--text-faint)]">Quotations:</span>
                        <span className="ml-2 font-medium text-[var(--text-main)]">{quotations.length}</span>
                    </div>
                </div>
                <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
                    <p className="text-xs text-[var(--text-faint)]">Description</p>
                    <p className="text-sm text-[var(--text-main)] mt-1">{request.description}</p>
                </div>
            </div>

            {/* Quotation Comparison */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm">
                <div className="p-6 border-b border-[var(--border-subtle)]">
                    <h3 className="text-lg font-bold text-[var(--text-main)]">Quotation Comparison</h3>
                    <p className="text-sm text-[var(--text-faint)]">Select a quotation to approve</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-white/10">
                        <thead className="bg-[var(--bg-surface)]/50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-faint)]">Select</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-faint)]">Garage</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-faint)]">Parts</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-faint)]">Labor</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-faint)]">Other</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-faint)]">Total</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-faint)]">Duration</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-faint)]">Valid Until</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10 bg-[var(--bg-surface)]">
                            {quotations.map(quot => {
                                const isSelected = selectedQuotationId === quot.id;
                                const isLowest = quot.id === lowestQuotation?.id;

                                return (
                                    <tr
                                        key={quot.id}
                                        className={`hover:bg-[var(--bg-surface-hover)] cursor-pointer ${isSelected ? 'bg-blue-500/10' : ''}`}
                                        onClick={() => setSelectedQuotationId(quot.id)}
                                    >
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <input
                                                type="radio"
                                                checked={isSelected}
                                                onChange={() => setSelectedQuotationId(quot.id)}
                                                className="h-4 w-4 text-blue-600"
                                            />
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <div className="text-sm font-medium text-[var(--text-main)]">{quot.garageName}</div>
                                            <div className="text-xs text-[var(--text-muted)]">Submitted {new Date(quot.submittedAt).toLocaleDateString()}</div>
                                            {isLowest && (
                                                <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-green-700 border border-green-300 mt-1">
                                                    Lowest Cost
                                                </span>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-[var(--text-main)]">{formatCurrency(quot.partsCost)}</td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-[var(--text-main)]">{formatCurrency(quot.laborCost)}</td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-[var(--text-main)]">{formatCurrency(quot.otherCharges)}</td>
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <div className="text-sm font-bold text-blue-600">{formatCurrency(quot.totalCost)}</div>
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-[var(--text-main)]">{quot.estimatedDuration} days</td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-[var(--text-main)]">
                                            {new Date(quot.validUntil).toLocaleDateString()}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Selected Quotation Details */}
            {selectedQuotation && (
                <div className="rounded-xl border border-blue-200 bg-blue-500/10 p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-blue-300 mb-4">Selected Quotation - {selectedQuotation.garageName}</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                            <span className="text-blue-700">Parts Cost:</span>
                            <span className="ml-2 font-medium text-blue-300">{formatCurrency(selectedQuotation.partsCost)}</span>
                        </div>
                        <div>
                            <span className="text-blue-700">Labor Cost:</span>
                            <span className="ml-2 font-medium text-blue-300">{formatCurrency(selectedQuotation.laborCost)}</span>
                        </div>
                        <div>
                            <span className="text-blue-700">Other Charges:</span>
                            <span className="ml-2 font-medium text-blue-300">{formatCurrency(selectedQuotation.otherCharges)}</span>
                        </div>
                        <div>
                            <span className="text-blue-700">Total Cost:</span>
                            <span className="ml-2 font-bold text-2xl text-blue-300">{formatCurrency(selectedQuotation.totalCost)}</span>
                        </div>
                    </div>
                    {selectedQuotation.notes && (
                        <div className="mt-4 pt-4 border-t border-blue-200">
                            <p className="text-xs text-blue-700">Notes</p>
                            <p className="text-sm text-blue-300 mt-1">{selectedQuotation.notes}</p>
                        </div>
                    )}
                </div>
            )}

            {/* Approval Modal */}
            {showApprovalModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-[var(--bg-surface)] rounded-2xl w-full max-w-2xl shadow-2xl">
                        <div className="p-6 border-b border-[var(--border-subtle)]">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-[var(--text-main)]">
                                    {approvalAction === 'approve' ? 'Approve Estimate' : 'Reject All Estimates'}
                                </h3>
                                <button onClick={() => setShowApprovalModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-muted)]">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            {approvalAction === 'approve' && selectedQuotation ? (
                                <>
                                    <div className="rounded-lg border border-green-200 bg-emerald-500/10 p-4">
                                        <p className="text-sm font-medium text-emerald-300">You are approving:</p>
                                        <p className="text-lg font-bold text-emerald-300 mt-1">{selectedQuotation.garageName}</p>
                                        <p className="text-2xl font-bold text-emerald-300 mt-2">{formatCurrency(selectedQuotation.totalCost)}</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Comments (Optional)</label>
                                        <textarea
                                            rows={3}
                                            value={approvalComments}
                                            onChange={(e) => setApprovalComments(e.target.value)}
                                            className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)]"
                                            placeholder="Add any approval notes..."
                                        />
                                    </div>

                                    <div className="rounded-lg bg-blue-500/10 border border-blue-200 p-4">
                                        <p className="text-sm text-blue-300">
                                            <span className="font-medium">Next Step:</span> Request will move to Estimation Approved status. Work order can be created.
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="rounded-lg border border-red-200 bg-red-500/10 p-4">
                                        <p className="text-sm font-medium text-red-300">All {quotations.length} quotation(s) will be rejected</p>
                                        <p className="text-sm text-red-700 mt-1">Request will be sent back to Under Estimation for new quotations</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">
                                            Rejection Reason <span className="text-red-600">*</span>
                                        </label>
                                        <textarea
                                            rows={3}
                                            value={rejectionReason}
                                            onChange={(e) => setRejectionReason(e.target.value)}
                                            className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)]"
                                            placeholder="Required: Provide reason for rejection..."
                                        />
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="p-6 border-t border-[var(--border-subtle)] flex justify-end gap-3">
                            <button
                                onClick={() => setShowApprovalModal(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={approvalAction === 'approve' ? handleApproveEstimate : handleRejectEstimate}
                                disabled={approvalAction === 'reject' && !rejectionReason.trim()}
                                className={`rounded-lg px-6 py-2 text-sm font-medium text-[var(--text-main)] ${approvalAction === 'approve'
                                    ? 'bg-green-600 hover:bg-green-700'
                                    : 'bg-red-600 hover:bg-red-700 disabled:bg-red-300'
                                    } disabled:cursor-not-allowed`}
                            >
                                {approvalAction === 'approve' ? 'Approve Estimate' : 'Reject All Estimates'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
