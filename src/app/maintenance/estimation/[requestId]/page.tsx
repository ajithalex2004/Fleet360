'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    EnhancedMaintenanceRequest,
    GarageMatch,
    VendorQuotation,
    EnhancedGarage,
    MaintenanceStatus,
    RFQDetails
} from '@/types/maintenance';
import { getMaintenanceRequests, getGarages, getVehicles } from '@/services/mockData';
import { matchGarages, getMatchScoreColor, getMatchScoreBadge, getMatchQuality } from '@/services/garageMatching';
import { sendRFQEmail } from '@/services/email/emailService';
import { formatCurrency } from '@/utils/currency';
import { generateApprovalLink } from '@/services/approvalLinkService';
import { UserRole, Permission, hasPermission, getCurrentUserRole } from '@/services/rbac';

export default function EstimationPage() {
    const params = useParams();
    const router = useRouter();
    const requestId = params.requestId as string;

    const [request, setRequest] = useState<EnhancedMaintenanceRequest | null>(null);
    const [matchedGarages, setMatchedGarages] = useState<GarageMatch[]>([]);
    const [allGarages, setAllGarages] = useState<EnhancedGarage[]>([]);
    const [quotations, setQuotations] = useState<VendorQuotation[]>([]);
    const [loading, setLoading] = useState(true);
    const [sendingRFQ, setSendingRFQ] = useState(false);
    const [selectedGarages, setSelectedGarages] = useState<Set<string>>(new Set());
    const [showQuotationModal, setShowQuotationModal] = useState(false);
    const [selectedGarage, setSelectedGarage] = useState<GarageMatch | null>(null);
    const [garageSearch, setGarageSearch] = useState('');
    const [quotationForm, setQuotationForm] = useState({
        partsCost: 0,
        laborCost: 0,
        otherCharges: 0,
        estimatedDuration: 1,
        notes: '',
        validUntil: ''
    });

    // RBAC
    const currentUserRole = getCurrentUserRole();
    const canSendRFQ = hasPermission(currentUserRole, Permission.SEND_RFQ);
    const canEnterQuotation = hasPermission(currentUserRole, Permission.ENTER_QUOTATION);

    useEffect(() => {
        const fetchData = async () => {
            const [requests, garages, vehicles] = await Promise.all([
                getMaintenanceRequests(),
                getGarages(),
                getVehicles()
            ]);

            const foundRequest = requests.find(r => r.id === requestId) as EnhancedMaintenanceRequest;
            if (!foundRequest) {
                router.push('/maintenance/requests');
                return;
            }

            setRequest(foundRequest);

            // Convert to EnhancedGarage
            const enhancedGarages: EnhancedGarage[] = garages.map(g => ({
                ...g,
                services: g.specialties.map(() => foundRequest.maintenanceType).filter(Boolean) as any[],
                isExternal: !g.isInternal,
                rating: 4.5,
                completedJobs: Math.floor(Math.random() * 50) + 10,
                averageCompletionTime: Math.floor(Math.random() * 5) + 1,
                averageCost: Math.floor(Math.random() * 1000) + 500
            }));

            setAllGarages(enhancedGarages);

            // Auto-match garages if not already matched
            if (!foundRequest.matchedGarages || foundRequest.matchedGarages.length === 0) {
                const matches = matchGarages(foundRequest, enhancedGarages, 40);
                setMatchedGarages(matches);
            } else {
                setMatchedGarages(foundRequest.matchedGarages);
            }

            // Load existing quotations
            if (foundRequest.vendorQuotations) {
                setQuotations(foundRequest.vendorQuotations);
            }

            setLoading(false);
        };

        fetchData();
    }, [requestId, router]);

    const handleSendRFQ = async () => {
        if (selectedGarages.size === 0) {
            alert('Please select at least one garage');
            return;
        }

        setSendingRFQ(true);

        // TRIPEXL: Create RFQ details with comprehensive information
        const selectedMatches = matchedGarages.filter(m => selectedGarages.has(m.garageId));
        const garageEmails = selectedMatches.map(m => ({
            email: `${m.garageName.toLowerCase().replace(/\s+/g, '')}@garage.com`,
            name: m.garageName
        }));

        try {
            if (request) {
                // Get vehicle details
                const vehicles = await getVehicles();
                const vehicle = vehicles.find(v => v.id === request.vehicleId);

                // Create comprehensive RFQ details
                const rfqDetails: RFQDetails = {
                    requestId: request.id,
                    vehicleDetails: {
                        make: vehicle?.make || 'N/A',
                        model: vehicle?.model || 'N/A',
                        year: vehicle?.year || 2020,
                        licensePlate: vehicle?.licensePlate || 'N/A',
                        currentMileage: vehicle?.currentMileage || 0
                    },
                    workOrderReference: `WO-${request.id.toUpperCase()}`,
                    requiredJobTypes: request.maintenanceJobs || [request.maintenanceType || 'General Maintenance'],
                    priority: request.priority || 'Medium',
                    sla: request.priority === 'Critical' ? '24 hours' : request.priority === 'High' ? '48 hours' : '3-5 days',
                    requiredCompletionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                    attachments: request.attachments || [],
                    additionalNotes: request.description
                };

                await sendRFQEmail(request, garageEmails);

                // Update matched garages with RFQ sent status
                const updatedMatches = matchedGarages.map(m => {
                    if (selectedGarages.has(m.garageId)) {
                        return {
                            ...m,
                            rfqSentAt: new Date().toISOString(),
                            rfqEmailStatus: 'SENT' as const
                        };
                    }
                    return m;
                });

                setMatchedGarages(updatedMatches);
                setSelectedGarages(new Set());

                // Update request with RFQ details
                const updatedRequest = {
                    ...request,
                    rfqDetails,
                    rfqSentAt: new Date().toISOString()
                };
                setRequest(updatedRequest);

                alert(`RFQ sent to ${selectedGarages.size} garage(s) successfully!`);
            }
        } catch (error) {
            alert('Failed to send RFQ emails');
        } finally {
            setSendingRFQ(false);
        }
    };

    const handleSubmitQuotation = () => {
        if (!selectedGarage || !request) return;

        const totalCost = quotationForm.partsCost + quotationForm.laborCost + quotationForm.otherCharges;

        const newQuotation: VendorQuotation = {
            id: `quot-${Date.now()}`,
            requestId: request.id,
            garageId: selectedGarage.garageId,
            garageName: selectedGarage.garageName,
            partsCost: quotationForm.partsCost,
            laborCost: quotationForm.laborCost,
            otherCharges: quotationForm.otherCharges,
            totalCost,
            estimatedDuration: quotationForm.estimatedDuration,
            validUntil: quotationForm.validUntil,
            notes: quotationForm.notes,
            submittedAt: new Date().toISOString(),
            submittedBy: selectedGarage.garageName,
            status: 'SUBMITTED'
        };

        setQuotations([...quotations, newQuotation]);
        setShowQuotationModal(false);
        setQuotationForm({ partsCost: 0, laborCost: 0, otherCharges: 0, estimatedDuration: 1, notes: '', validUntil: '' });
        setSelectedGarage(null);
        alert('Quotation submitted successfully!');
    };

    const handleSubmitForApproval = async () => {
        if (quotations.length === 0) {
            alert('Please enter at least one quotation before submitting for approval');
            return;
        }

        // TRIPEXL: Generate approval link and transition to PENDING_ESTIMATE_APPROVAL
        const approvalLink = generateApprovalLink(
            requestId,
            quotations[0].id, // Use first quotation for now
            'fleet.manager@company.com',
            'Fleet Manager',
            48 // 48 hours expiration
        );

        // Update request status
        const updatedRequest = {
            ...request,
            status: MaintenanceStatus.PENDING_ESTIMATION_APPROVAL,
            vendorQuotations: quotations,
            approvalLinks: [approvalLink]
        };

        console.log('Submitting for approval:', {
            requestId,
            quotationsCount: quotations.length,
            approvalLink,
            newStatus: MaintenanceStatus.PENDING_ESTIMATION_APPROVAL,
            updatedRequest
        });

        setRequest(updatedRequest);

        // TODO: Send email to Fleet Manager with approval link
        alert(`Submitted ${quotations.length} quotation(s) for approval! Email sent to Fleet Manager with secure approval link.`);

        // Navigate to approvals page
        router.push('/maintenance/approvals');
    };

    const toggleGarageSelection = (garageId: string) => {
        const newSelection = new Set(selectedGarages);
        if (newSelection.has(garageId)) {
            newSelection.delete(garageId);
        } else {
            newSelection.add(garageId);
        }
        setSelectedGarages(newSelection);
    };

    // Filter garages by search
    const filteredGarages = matchedGarages.filter(garage =>
        garage.garageName.toLowerCase().includes(garageSearch.toLowerCase()) ||
        garage.matchedSpecialties.some(spec => spec.toLowerCase().includes(garageSearch.toLowerCase()))
    );

    if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
    if (!request) return <div className="p-8 text-center text-slate-500">Request not found</div>;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Estimation Management</h1>
                    <p className="mt-1 text-slate-500">Request #{request.id.toUpperCase()} - {request.status}</p>
                </div>
                <div className="flex gap-3">
                    {selectedGarages.size > 0 && canSendRFQ && (
                        <button
                            onClick={handleSendRFQ}
                            disabled={sendingRFQ}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-blue-300"
                        >
                            {sendingRFQ ? 'Sending...' : `Send RFQ to ${selectedGarages.size} Garage(s)`}
                        </button>
                    )}
                    {quotations.length > 0 && (
                        <button
                            onClick={handleSubmitForApproval}
                            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                        >
                            Submit for Approval ({quotations.length})
                        </button>
                    )}
                </div>
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
                        <span className="text-slate-500">RFQ Sent:</span>
                        <span className="ml-2 font-medium text-slate-900">
                            {request.rfqSentAt ? new Date(request.rfqSentAt).toLocaleDateString() : 'Not sent'}
                        </span>
                    </div>
                    <div>
                        <span className="text-slate-500">Quotations Received:</span>
                        <span className="ml-2 font-medium text-slate-900">{quotations.length}</span>
                    </div>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-200">
                    <p className="text-xs text-slate-500">Description</p>
                    <p className="text-sm text-slate-900 mt-1">{request.description}</p>
                </div>
            </div>

            {/* Quotation Comparison Table */}
            {quotations.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="p-6 border-b border-slate-200">
                        <h3 className="text-lg font-bold text-slate-900">Quotation Comparison ({quotations.length})</h3>
                        <p className="text-sm text-slate-500">Compare vendor quotations side-by-side</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Garage</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Parts</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Labor</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Other</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Total</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Duration</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 bg-white">
                                {quotations.map(quot => (
                                    <tr key={quot.id} className="hover:bg-slate-50">
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <div className="text-sm font-medium text-slate-900">{quot.garageName}</div>
                                            <div className="text-xs text-slate-500">Submitted {new Date(quot.submittedAt).toLocaleDateString()}</div>
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-900">{formatCurrency(quot.partsCost)}</td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-900">{formatCurrency(quot.laborCost)}</td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-900">{formatCurrency(quot.otherCharges)}</td>
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <div className="text-sm font-bold text-blue-600">{formatCurrency(quot.totalCost)}</div>
                                        </td>
                                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-900">{quot.estimatedDuration} days</td>
                                        <td className="whitespace-nowrap px-6 py-4">
                                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${quot.status === 'APPROVED' ? 'bg-green-100 text-green-700 border-green-300' :
                                                quot.status === 'REJECTED' ? 'bg-red-100 text-red-700 border-red-300' :
                                                    'bg-yellow-100 text-yellow-700 border-yellow-300'
                                                }`}>
                                                {quot.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Matched Garages with Search */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="p-6 border-b border-slate-200">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-lg font-bold text-slate-900">Vendor Selection ({filteredGarages.length})</h3>
                            <p className="text-sm text-slate-500">Select garages to send RFQ</p>
                        </div>
                        <div className="w-64">
                            <input
                                type="text"
                                placeholder="Search garages..."
                                value={garageSearch}
                                onChange={(e) => setGarageSearch(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white text-slate-900"
                            />
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <span className="text-slate-500">Selected:</span>
                        <span className="font-medium text-blue-600">{selectedGarages.size} garage(s)</span>
                    </div>
                </div>
                <div className="divide-y divide-slate-200 max-h-96 overflow-y-auto">
                    {filteredGarages.length === 0 ? (
                        <div className="p-12 text-center text-slate-500">
                            {garageSearch ? 'No garages match your search' : 'No garages matched for this request'}
                        </div>
                    ) : (
                        filteredGarages.map(match => {
                            const isSelected = selectedGarages.has(match.garageId);
                            const rfqSent = match.rfqSentAt !== undefined;
                            const hasQuotation = quotations.some(q => q.garageId === match.garageId);

                            return (
                                <div key={match.garageId} className={`p-6 hover:bg-slate-50 transition-colors ${isSelected ? 'bg-blue-50' : ''}`}>
                                    <div className="flex items-start gap-4">
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleGarageSelection(match.garageId)}
                                            disabled={rfqSent}
                                            className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 disabled:opacity-50"
                                        />
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <h4 className="text-base font-bold text-slate-900">{match.garageName}</h4>
                                                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${getMatchScoreBadge(match.matchScore)}`}>
                                                    {match.matchScore}% Match
                                                </span>
                                                {rfqSent && (
                                                    <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 border border-green-300">
                                                        RFQ Sent
                                                    </span>
                                                )}
                                                {hasQuotation && (
                                                    <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 border border-blue-300">
                                                        Quotation Received
                                                    </span>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-2 gap-4 text-sm">
                                                <div>
                                                    <span className="text-slate-500">Specialties:</span>
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {match.matchedSpecialties.map((spec, idx) => (
                                                            <span key={idx} className="inline-flex items-center rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                                                                {spec}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                                {rfqSent && (
                                                    <div>
                                                        <span className="text-slate-500">RFQ Sent:</span>
                                                        <span className="ml-2 text-slate-900">{new Date(match.rfqSentAt!).toLocaleDateString()}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {rfqSent && canEnterQuotation && !hasQuotation && (
                                            <button
                                                onClick={() => {
                                                    setSelectedGarage(match);
                                                    setShowQuotationModal(true);
                                                }}
                                                className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                                            >
                                                Enter Quotation
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Quotation Entry Modal */}
            {showQuotationModal && selectedGarage && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl">
                        <div className="p-6 border-b border-slate-200">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-slate-900">Enter Quotation - {selectedGarage.garageName}</h3>
                                <button onClick={() => setShowQuotationModal(false)} className="text-slate-400 hover:text-slate-600">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Parts Cost (AED)</label>
                                    <input
                                        type="number"
                                        value={quotationForm.partsCost}
                                        onChange={(e) => setQuotationForm({ ...quotationForm, partsCost: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Labor Cost (AED)</label>
                                    <input
                                        type="number"
                                        value={quotationForm.laborCost}
                                        onChange={(e) => setQuotationForm({ ...quotationForm, laborCost: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Other Charges (AED)</label>
                                    <input
                                        type="number"
                                        value={quotationForm.otherCharges}
                                        onChange={(e) => setQuotationForm({ ...quotationForm, otherCharges: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    />
                                </div>
                            </div>

                            <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-blue-900">Total Quotation:</span>
                                    <span className="text-2xl font-bold text-blue-900">
                                        {formatCurrency(quotationForm.partsCost + quotationForm.laborCost + quotationForm.otherCharges)}
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Estimated Duration (days)</label>
                                    <input
                                        type="number"
                                        value={quotationForm.estimatedDuration}
                                        onChange={(e) => setQuotationForm({ ...quotationForm, estimatedDuration: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Valid Until</label>
                                    <input
                                        type="date"
                                        value={quotationForm.validUntil}
                                        onChange={(e) => setQuotationForm({ ...quotationForm, validUntil: e.target.value })}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Notes (Optional)</label>
                                <textarea
                                    rows={3}
                                    value={quotationForm.notes}
                                    onChange={(e) => setQuotationForm({ ...quotationForm, notes: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    placeholder="Add any notes about the quotation..."
                                />
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                            <button
                                onClick={() => setShowQuotationModal(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmitQuotation}
                                className="rounded-lg bg-green-600 px-6 py-2 text-sm font-medium text-white hover:bg-green-700"
                            >
                                Submit Quotation
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
