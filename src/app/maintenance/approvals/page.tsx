'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
    MaintenanceRequest,
    ApprovalRecord,
    ApprovalStatus,
    ApproverRole,
    Vehicle,
    Garage,
    MaintenanceStatus,
    EnhancedMaintenanceRequest,
    QuotationStatus,
    Attachment,
    AttachmentType
} from '@/types/maintenance';
import {
    getMaintenanceRequests,
    getVehicles,
    getGarages,
    updateMaintenanceRequest,
    updateQuotation
} from '@/services/mockData';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatCurrency } from '@/utils/currency';
import { Permission, hasPermission, getCurrentUserRole } from '@/services/rbac';
import { UserRole } from '@/types/maintenance';
import FilterBar from '@/components/Maintenance/FilterBar';

export default function ApprovalsPage() {
    const [requests, setRequests] = useState<EnhancedMaintenanceRequest[]>([]);
    const [filteredRequests, setFilteredRequests] = useState<EnhancedMaintenanceRequest[]>([]);
    const [vehicles, setVehicles] = useState<Record<string, Vehicle>>({});
    const [garages, setGarages] = useState<Record<string, Garage>>({});
    const [loading, setLoading] = useState(true);
    const [selectedRequest, setSelectedRequest] = useState<EnhancedMaintenanceRequest | null>(null);

    // Modal States
    const [showApprovalModal, setShowApprovalModal] = useState(false);
    const [showReviewModal, setShowReviewModal] = useState(false);

    const [approvalAction, setApprovalAction] = useState<'approve' | 'reject' | 're-assign'>('approve');
    const [approvalComments, setApprovalComments] = useState('');

    // Tab State
    const [activeTab, setActiveTab] = useState<'maintenance' | 'estimation'>('maintenance');

    // Quotation Selection State
    const [selectedQuotationId, setSelectedQuotationId] = useState<string | null>(null);

    // Get current user role (in production, from auth context)
    const currentUserRole = getCurrentUserRole();
    const canApprove = hasPermission(currentUserRole, Permission.APPROVE_REQUEST);

    // Mock current user (in real app, this would come from auth)
    const currentUser = {
        id: 'user-1',
        name: 'Maintenance Manager',
        role: ApproverRole.MAINTENANCE_MANAGER
    };

    useEffect(() => {
        const fetchData = async () => {
            const [allRequests, allVehicles, allGarages] = await Promise.all([
                getMaintenanceRequests(),
                getVehicles(),
                getGarages()
            ]);

            setRequests(allRequests as EnhancedMaintenanceRequest[]);

            const vehMap = allVehicles.reduce((acc, v) => {
                acc[v.id] = v;
                return acc;
            }, {} as Record<string, Vehicle>);
            setVehicles(vehMap);

            const garMap = allGarages.reduce((acc, g) => {
                acc[g.id] = g;
                return acc;
            }, {} as Record<string, Garage>);
            setGarages(garMap);

            setLoading(false);
        };
        fetchData();
    }, []);

    // Filter requests based on active tab and other filters
    useEffect(() => {
        let result = requests;

        // Tab Filter
        if (activeTab === 'maintenance') {
            result = result.filter(r =>
                r.status === MaintenanceStatus.REQUESTED ||
                r.status === MaintenanceStatus.RE_ASSIGN ||
                r.status === MaintenanceStatus.UNDER_ESTIMATION // Approved Maintenance
            );
        } else {
            result = result.filter(r =>
                r.status === MaintenanceStatus.PENDING_ESTIMATION_APPROVAL ||
                r.status === MaintenanceStatus.UNDER_MAINTENANCE // Approved Estimate
            );
        }

        setFilteredRequests(result);
    }, [requests, activeTab]);

    const handleFilter = (term: string, dateRange: { start: string, end: string }, statuses: string[]) => {
        let result = requests;

        // Apply Tab Filter first
        if (activeTab === 'maintenance') {
            result = result.filter(r =>
                r.status === MaintenanceStatus.REQUESTED ||
                r.status === MaintenanceStatus.RE_ASSIGN ||
                r.status === MaintenanceStatus.UNDER_ESTIMATION
            );
        } else {
            result = result.filter(r =>
                r.status === MaintenanceStatus.PENDING_ESTIMATION_APPROVAL ||
                r.status === MaintenanceStatus.UNDER_MAINTENANCE
            );
        }

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

        // Status (if specific statuses selected in filter bar)
        if (statuses.length > 0) {
            const mappedStatuses = statuses.map(s => {
                if (s === "Approved Maintenance") return MaintenanceStatus.UNDER_ESTIMATION;
                if (s === "Approved Estimate") return MaintenanceStatus.UNDER_MAINTENANCE;
                return s;
            });
            result = result.filter(r => mappedStatuses.includes(r.status));
        }

        setFilteredRequests(result);
    };

    const handleApprovalAction = async () => {
        if (!selectedRequest) return;

        let newStatus: MaintenanceStatus;
        let updatedQuotations = selectedRequest.quotations || [];

        if (approvalAction === 'approve') {
            if (selectedRequest.status === MaintenanceStatus.REQUESTED || selectedRequest.status === MaintenanceStatus.RE_ASSIGN) {
                newStatus = MaintenanceStatus.ACCEPTED;
            } else {
                // Estimation Approval
                newStatus = MaintenanceStatus.UNDER_MAINTENANCE;

                // Generate Work Order Number
                const date = new Date();
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                const workOrderNo = `WO-${month}-${selectedRequest.id}`;

                // Update quotation statuses
                if (selectedQuotationId) {
                    // Update quotations individually via API
                    const updatePromises = updatedQuotations.map(q => {
                        const status = q.id === selectedQuotationId ? QuotationStatus.APPROVED : QuotationStatus.REJECTED;
                        return updateQuotation(q.id, { status });
                    });
                    await Promise.all(updatePromises);

                    // Update local state for UI
                    updatedQuotations = updatedQuotations.map(q => ({
                        ...q,
                        status: q.id === selectedQuotationId ? QuotationStatus.APPROVED : QuotationStatus.REJECTED
                    }));

                    const selectedQuote = updatedQuotations.find(q => q.id === selectedQuotationId);
                    if (selectedQuote) {
                        // Sync Approved Quotation as Attachment
                        let newAttachment: Attachment | null = null;
                        if (selectedQuote.attachments && selectedQuote.attachments.length > 0) {
                            const quoteAttachment = selectedQuote.attachments[0];
                            newAttachment = {
                                id: `att-quote-${Date.now()}`,
                                type: AttachmentType.APPROVED_ESTIMATE,
                                fileName: quoteAttachment.fileName,
                                url: quoteAttachment.url,
                                uploadedAt: new Date().toISOString()
                            };
                        }

                        const attachmentsPayload = newAttachment ? {
                            create: [newAttachment]
                        } : undefined;

                        // Update Request fields (excluding quotations array)
                        await updateMaintenanceRequest(selectedRequest.id, {
                            expectedEndDate: selectedQuote.estimatedCompletionDate,
                            garageId: selectedQuote.garageId,
                            selectedQuotationId: selectedQuotationId,
                            status: newStatus,
                            workOrderNo,
                            attachments: attachmentsPayload as any, // Cast to any to allow Prisma nested write
                            actualPartsCost: selectedQuote.totalCost,
                            actualCost: selectedQuote.totalCost
                        });

                        // Update local state
                        const updatedAttachments = selectedRequest.attachments || [];
                        if (newAttachment) {
                            updatedAttachments.push(newAttachment);
                        }

                        // Update local state
                        setRequests(prev => prev.map(r =>
                            r.id === selectedRequest.id ? {
                                ...r,
                                expectedEndDate: selectedQuote.estimatedCompletionDate,
                                garageId: selectedQuote.garageId,
                                status: newStatus,
                                workOrderNo,
                                quotations: updatedQuotations,
                                attachments: updatedAttachments,
                                actualPartsCost: selectedQuote.totalCost,
                                actualCost: selectedQuote.totalCost
                            } : r
                        ));

                        setShowApprovalModal(false);
                        setShowReviewModal(false);
                        setSelectedRequest(null);
                        setApprovalComments('');
                        setSelectedQuotationId(null);
                        return;
                    }
                }
            }
        } else if (approvalAction === 're-assign') {
            newStatus = MaintenanceStatus.RE_ASSIGN;
        } else {
            // Rejections
            if (selectedRequest.status === MaintenanceStatus.REQUESTED || selectedRequest.status === MaintenanceStatus.RE_ASSIGN) {
                newStatus = MaintenanceStatus.REJECTED;
            } else {
                newStatus = MaintenanceStatus.REJECTED;
            }
        }

        const newApprovalRecord: ApprovalRecord = {
            id: `approval-${Date.now()}`,
            requestId: selectedRequest.id,
            approverRole: currentUser.role,
            approverName: currentUser.name,
            approverEmail: 'user@example.com',
            requestedAt: new Date().toISOString(),
            respondedAt: new Date().toISOString(),
            status: approvalAction === 'approve' ? ApprovalStatus.APPROVED : (approvalAction === 're-assign' ? ApprovalStatus.PENDING : ApprovalStatus.REJECTED),
            comments: approvalComments
        };

        try {
            await updateMaintenanceRequest(selectedRequest.id, {
                status: newStatus,
                selectedQuotationId: selectedQuotationId || undefined
            });

            setRequests(prev => prev.map(r =>
                r.id === selectedRequest.id ? {
                    ...r,
                    status: newStatus,
                    quotations: updatedQuotations,
                    selectedQuotationId: selectedQuotationId || undefined
                } : r
            ));

            setShowApprovalModal(false);
            setShowReviewModal(false);
            setSelectedRequest(null);
            setApprovalComments('');
            setSelectedQuotationId(null);

            alert(`Request ${approvalAction === 'approve' ? 'approved' : (approvalAction === 're-assign' ? 're-assigned' : 'rejected')} successfully!`);
        } catch (error) {
            console.error('Failed to update request:', error);
            alert('Failed to process approval.');
        }
    };

    const openApprovalModal = (request: EnhancedMaintenanceRequest, action: 'approve' | 'reject' | 're-assign') => {
        setSelectedRequest(request);
        setApprovalAction(action);
        setShowApprovalModal(true);
    };

    const openReviewModal = (request: EnhancedMaintenanceRequest) => {
        setSelectedRequest(request);
        // Pre-select if already selected, otherwise null
        setSelectedQuotationId(request.selectedQuotationId || null);
        setShowReviewModal(true);
    };

    if (loading) return <div className="p-8 text-center">Loading approvals...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Pending Approvals</h1>
                    <p className="mt-1 text-slate-500">Review and approve maintenance requests.</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-white/10">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                    <button
                        onClick={() => setActiveTab('maintenance')}
                        className={`
                            whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium
                            ${activeTab === 'maintenance'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-slate-500 hover:border-white/15 hover:text-slate-300'}
                        `}
                    >
                        Maintenance Approvals
                    </button>
                    <button
                        onClick={() => setActiveTab('estimation')}
                        className={`
                            whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium
                            ${activeTab === 'estimation'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-slate-500 hover:border-white/15 hover:text-slate-300'}
                        `}
                    >
                        Estimation Approvals
                    </button>
                </nav>
            </div>

            <FilterBar
                onSearch={(term) => handleFilter(term, { start: '', end: '' }, [])}
                onDateRangeChange={(start, end) => handleFilter('', { start, end }, [])}
                onStatusChange={(statuses) => handleFilter('', { start: '', end: '' }, statuses)}
                statusOptions={activeTab === 'maintenance'
                    ? [MaintenanceStatus.REQUESTED, MaintenanceStatus.RE_ASSIGN, "Approved Maintenance"]
                    : [MaintenanceStatus.PENDING_ESTIMATION_APPROVAL, "Approved Estimate"]}
                placeholder="Search approvals..."
            />

            <div className="rounded-xl border border-white/10 bg-slate-900 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-800/50 text-slate-500">
                            <tr>
                                <th className="px-6 py-3 font-medium">Request ID</th>
                                <th className="px-6 py-3 font-medium">Vehicle</th>
                                <th className="px-6 py-3 font-medium">Description</th>
                                <th className="px-6 py-3 font-medium">Est. Cost</th>
                                <th className="px-6 py-3 font-medium">Status</th>
                                <th className="px-6 py-3 font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filteredRequests.map((request) => {
                                const vehicle = vehicles[request.vehicleId];
                                return (
                                    <tr key={request.id} className="hover:bg-white/5">
                                        <td className="px-6 py-4 font-medium text-white">
                                            <Link href={`/maintenance/requests/${encodeURIComponent(request.id)}`} className="hover:text-blue-600 hover:underline">
                                                {request.id}
                                            </Link>
                                        </td>
                                        <td className="px-6 py-4 text-slate-300">
                                            {vehicle ? `${vehicle.make} ${vehicle.model}` : 'Unknown'}
                                            <div className="text-xs text-slate-300">{vehicle?.licensePlate}</div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-600">
                                            <div className="max-w-xs truncate" title={request.description}>
                                                {request.description}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 font-medium text-white">
                                            {request.estimatedCost ? formatCurrency(request.estimatedCost) : '-'}
                                        </td>
                                        <td className="px-6 py-4">
                                            <StatusBadge status={request.status} />
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex gap-2">
                                                {activeTab === 'maintenance' ? (
                                                    (request.status === MaintenanceStatus.REQUESTED || request.status === MaintenanceStatus.RE_ASSIGN) && (
                                                        <>
                                                            <button
                                                                onClick={() => openApprovalModal(request, 'approve')}
                                                                className="rounded bg-emerald-500/10 px-2 py-1 text-xs font-medium text-green-700 hover:bg-emerald-500/20 border border-green-200"
                                                            >
                                                                Approve
                                                            </button>
                                                            <button
                                                                onClick={() => openApprovalModal(request, 're-assign')}
                                                                className="rounded bg-orange-500/10 px-2 py-1 text-xs font-medium text-orange-700 hover:bg-orange-500/20 border border-orange-200"
                                                            >
                                                                Re-Assign
                                                            </button>
                                                            <button
                                                                onClick={() => openApprovalModal(request, 'reject')}
                                                                className="rounded bg-red-500/10 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-500/20 border border-red-200"
                                                            >
                                                                Reject
                                                            </button>
                                                        </>
                                                    )
                                                ) : (
                                                    request.status === MaintenanceStatus.PENDING_ESTIMATION_APPROVAL && (
                                                        <button
                                                            onClick={() => openReviewModal(request)}
                                                            className="rounded bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-500/20 border border-blue-200"
                                                        >
                                                            Review Estimation
                                                        </button>
                                                    )
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
                        No pending approvals found in this category.
                    </div>
                )}
            </div>

            {/* Approval Modal */}
            {showApprovalModal && selectedRequest && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-xl bg-slate-900 p-6 shadow-2xl">
                        <h3 className="text-lg font-bold text-white">
                            {approvalAction === 'approve' ? 'Approve Request' : (approvalAction === 're-assign' ? 'Re-Assign Request' : 'Reject Request')}
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                            {approvalAction === 'approve'
                                ? `Are you sure you want to approve request ${selectedRequest.id}?`
                                : (approvalAction === 're-assign'
                                    ? `Are you sure you want to re-assign request ${selectedRequest.id}?`
                                    : `Please provide a reason for rejecting request ${selectedRequest.id}.`)
                            }
                        </p>

                        <div className="mt-4">
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                Comments {approvalAction !== 'approve' && '*'}
                            </label>
                            <textarea
                                rows={3}
                                className="block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                placeholder="Add comments..."
                                value={approvalComments}
                                onChange={(e) => setApprovalComments(e.target.value)}
                            />
                        </div>

                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                onClick={() => setShowApprovalModal(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleApprovalAction}
                                disabled={approvalAction !== 'approve' && !approvalComments.trim()}
                                className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${approvalAction === 'approve'
                                    ? 'bg-green-600 hover:bg-green-700'
                                    : (approvalAction === 're-assign'
                                        ? 'bg-orange-600 hover:bg-orange-700 disabled:opacity-50'
                                        : 'bg-red-600 hover:bg-red-700 disabled:opacity-50')
                                    }`}
                            >
                                Confirm {approvalAction === 'approve' ? 'Approval' : (approvalAction === 're-assign' ? 'Re-Assignment' : 'Rejection')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Review Estimation Modal */}
            {showReviewModal && selectedRequest && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="w-full max-w-2xl rounded-xl bg-slate-900 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-white">Review Estimation</h3>
                            <button onClick={() => setShowReviewModal(false)} className="text-slate-400 hover:text-slate-300">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="block text-slate-500">Request ID</span>
                                    <span className="font-medium text-white">{selectedRequest.id}</span>
                                </div>
                                <div>
                                    <span className="block text-slate-500">Vehicle</span>
                                    <span className="font-medium text-white">
                                        {vehicles[selectedRequest.vehicleId]?.make} {vehicles[selectedRequest.vehicleId]?.model} ({vehicles[selectedRequest.vehicleId]?.licensePlate})
                                    </span>
                                </div>
                            </div>

                            <div className="rounded-lg border border-white/10 bg-slate-800/50 p-4">
                                <h4 className="font-medium text-white mb-2">Select Quotation to Approve</h4>
                                {selectedRequest.quotations && selectedRequest.quotations.length > 0 ? (
                                    <div className="space-y-3">
                                        {/* Deduplicate quotations by Garage ID (show latest per garage) */}
                                        {Array.from(new Map(selectedRequest.quotations.map(q => [q.garageId, q])).values()).map((quote) => (
                                            <label
                                                key={quote.id}
                                                className={`flex items-center justify-between bg-slate-900 p-3 rounded border cursor-pointer transition-all ${selectedQuotationId === quote.id
                                                    ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-500/10'
                                                    : 'border-white/10 hover:border-white/15'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <input
                                                        type="radio"
                                                        name="quotation"
                                                        value={quote.id}
                                                        checked={selectedQuotationId === quote.id}
                                                        onChange={() => setSelectedQuotationId(quote.id)}
                                                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-white/15"
                                                    />
                                                    <div>
                                                        <div className="font-medium text-white">{garages[quote.garageId]?.name || 'Unknown Garage'}</div>
                                                        <div className="text-xs text-slate-500">ETC: {quote.estimatedCompletionDate ? new Date(quote.estimatedCompletionDate).toLocaleDateString() : 'N/A'}</div>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-bold text-white">{formatCurrency(quote.totalCost)}</div>
                                                    {quote.attachments && quote.attachments.length > 0 && (
                                                        <a
                                                            href={quote.attachments[0].url}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="text-xs text-blue-600 hover:underline block"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            View Quote
                                                        </a>
                                                    )}
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500">No quotations available.</p>
                                )}
                            </div>

                            <div className="mt-4">
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Approval Comments
                                </label>
                                <textarea
                                    rows={3}
                                    className="block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                    placeholder="Add comments..."
                                    value={approvalComments}
                                    onChange={(e) => setApprovalComments(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-white/5">
                            <button
                                onClick={() => {
                                    setApprovalAction('reject');
                                    handleApprovalAction();
                                }}
                                disabled={!approvalComments.trim()}
                                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                            >
                                Reject Estimation
                            </button>
                            <button
                                onClick={() => {
                                    setApprovalAction('approve');
                                    handleApprovalAction();
                                }}
                                disabled={!selectedQuotationId}
                                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Approve Estimation
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
