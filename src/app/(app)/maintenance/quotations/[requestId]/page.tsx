'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    MaintenanceRequest,
    Quotation,
    QuotationStatus,
    PartItem,
    Garage,
    Vehicle
} from '@/types/maintenance';
import {
    getMaintenanceRequests,
    getGarages,
    getVehicles
} from '@/services/mockData';

export default function QuotationsPage() {
    const router = useRouter();
    const { requestId = '' } = useParams<{ requestId: string }>() ?? {};

    const [request, setRequest] = useState<MaintenanceRequest | null>(null);
    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [garages, setGarages] = useState<Garage[]>([]);
    const [quotations, setQuotations] = useState<Quotation[]>([]);
    const [loading, setLoading] = useState(true);
    const [showSubmitForm, setShowSubmitForm] = useState(false);
    const [selectedGarageId, setSelectedGarageId] = useState('');
    const [compareMode, setCompareMode] = useState(false);
    const [selectedForComparison, setSelectedForComparison] = useState<string[]>([]);

    // Form state for new quotation
    const [quotationForm, setQuotationForm] = useState({
        laborCost: 0,
        partsCost: 0,
        additionalCosts: 0,
        taxAmount: 0,
        estimatedDuration: 0,
        validUntil: '',
        notes: '',
        partsBreakdown: [] as PartItem[]
    });

    useEffect(() => {
        const fetchData = async () => {
            const [requests, allGarages, vehicles] = await Promise.all([
                getMaintenanceRequests(),
                getGarages(),
                getVehicles()
            ]);

            const foundRequest = requests.find(r => r.id === requestId);
            if (foundRequest) {
                setRequest(foundRequest);
                setQuotations(foundRequest.quotations || []);

                const foundVehicle = vehicles.find(v => v.id === foundRequest.vehicleId);
                setVehicle(foundVehicle || null);
            }
            setGarages(allGarages);
            setLoading(false);
        };
        fetchData();
    }, [requestId]);

    const handleAddPart = () => {
        const newPart: PartItem = {
            id: `part-${Date.now()}`,
            name: '',
            partNumber: '',
            quantity: 1,
            unitPrice: 0,
            totalPrice: 0
        };
        setQuotationForm({
            ...quotationForm,
            partsBreakdown: [...quotationForm.partsBreakdown, newPart]
        });
    };

    const handlePartChange = (index: number, field: keyof PartItem, value: any) => {
        const updatedParts = [...quotationForm.partsBreakdown];
        updatedParts[index] = { ...updatedParts[index], [field]: value };

        // Auto-calculate total price
        if (field === 'quantity' || field === 'unitPrice') {
            updatedParts[index].totalPrice = updatedParts[index].quantity * updatedParts[index].unitPrice;
        }

        setQuotationForm({ ...quotationForm, partsBreakdown: updatedParts });
    };

    const handleRemovePart = (index: number) => {
        setQuotationForm({
            ...quotationForm,
            partsBreakdown: quotationForm.partsBreakdown.filter((_, i) => i !== index)
        });
    };

    const calculateTotalCost = () => {
        const { laborCost, partsCost, additionalCosts, taxAmount } = quotationForm;
        return laborCost + partsCost + additionalCosts + taxAmount;
    };

    const handleSubmitQuotation = () => {
        if (!selectedGarageId) {
            alert('Please select a garage');
            return;
        }

        const selectedGarage = garages.find(g => g.id === selectedGarageId);
        const newQuotation: Quotation = {
            id: `quot-${Date.now()}`,
            requestId,
            garageId: selectedGarageId,
            garageName: selectedGarage?.name ?? '',
            quotationDate: new Date().toISOString(),
            submittedDate: new Date().toISOString(),
            validUntil: quotationForm.validUntil,
            laborCost: quotationForm.laborCost,
            partsCost: quotationForm.partsCost,
            consumablesCost: 0,
            additionalCosts: quotationForm.additionalCosts,
            taxAmount: quotationForm.taxAmount,
            vatAmount: quotationForm.taxAmount ?? 0,
            totalCost: calculateTotalCost(),
            grandTotal: calculateTotalCost(),
            parts: quotationForm.partsBreakdown ?? [],
            labor: [],
            partsBreakdown: quotationForm.partsBreakdown,
            estimatedDuration: quotationForm.estimatedDuration,
            notes: quotationForm.notes,
            status: QuotationStatus.PENDING,
            submittedBy: 'system',
            attachments: []
        };

        setQuotations([...quotations, newQuotation]);
        setShowSubmitForm(false);

        // Reset form
        setQuotationForm({
            laborCost: 0,
            partsCost: 0,
            additionalCosts: 0,
            taxAmount: 0,
            estimatedDuration: 0,
            validUntil: '',
            notes: '',
            partsBreakdown: []
        });
        setSelectedGarageId('');

        alert('Quotation submitted successfully!');
    };

    const handleAcceptQuotation = (quotationId: string) => {
        const updatedQuotations = quotations.map(q =>
            q.id === quotationId
                ? { ...q, status: QuotationStatus.ACCEPTED }
                : q.status === QuotationStatus.ACCEPTED
                    ? { ...q, status: QuotationStatus.REJECTED }
                    : q
        );
        setQuotations(updatedQuotations);
        alert('Quotation accepted! Other quotations have been rejected.');
    };

    const handleRejectQuotation = (quotationId: string) => {
        const updatedQuotations = quotations.map(q =>
            q.id === quotationId ? { ...q, status: QuotationStatus.REJECTED } : q
        );
        setQuotations(updatedQuotations);
    };

    const toggleComparisonSelection = (quotationId: string) => {
        if (selectedForComparison.includes(quotationId)) {
            setSelectedForComparison(selectedForComparison.filter(id => id !== quotationId));
        } else if (selectedForComparison.length < 3) {
            setSelectedForComparison([...selectedForComparison, quotationId]);
        } else {
            alert('You can compare up to 3 quotations at a time');
        }
    };

    const getStatusColor = (status: QuotationStatus) => {
        switch (status) {
            case QuotationStatus.PENDING:
                return 'bg-amber-500/20 text-yellow-700 border-yellow-300';
            case QuotationStatus.ACCEPTED:
                return 'bg-emerald-500/20 text-green-700 border-green-300';
            case QuotationStatus.REJECTED:
                return 'bg-red-500/20 text-red-700 border-red-300';
            case QuotationStatus.EXPIRED:
                return 'bg-[var(--bg-surface-hover)]/40 text-[var(--text-muted)] border-[var(--border-subtle)]';
            default:
                return 'bg-[var(--bg-surface-hover)]/40 text-[var(--text-muted)] border-[var(--border-subtle)]';
        }
    };

    if (loading) return <div className="p-8 text-center text-[var(--text-faint)]">Loading quotations...</div>;
    if (!request) return <div className="p-8 text-center text-[var(--text-faint)]">Request not found.</div>;

    const quotationsToCompare = quotations.filter(q => selectedForComparison.includes(q.id));

    return (
        <div className="mx-auto max-w-7xl pb-12 space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <Link href={`/maintenance/requests/${requestId}`} className="text-[var(--text-muted)] hover:text-[var(--text-muted)]">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                            </svg>
                        </Link>
                        <h1 className="text-2xl font-bold text-[var(--text-main)]">Quotations - Request #{request.id.toUpperCase()}</h1>
                    </div>
                    <p className="text-xs text-[var(--text-faint)] ml-8">
                        {vehicle?.make} {vehicle?.model} ({vehicle?.licensePlate}) • {quotations.length} quotation(s) received
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {quotations.length >= 2 && (
                        <button
                            onClick={() => setCompareMode(!compareMode)}
                            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${compareMode
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-[var(--bg-surface-hover)]/40 text-[var(--text-muted)] hover:bg-slate-200'
                                }`}
                        >
                            {compareMode ? 'Exit Compare Mode' : 'Compare Quotations'}
                        </button>
                    )}
                    <button
                        onClick={() => setShowSubmitForm(true)}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                        + Submit Quotation
                    </button>
                </div>
            </div>

            {/* Comparison View */}
            {compareMode && selectedForComparison.length > 0 && (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-[var(--text-main)] mb-4">Quotation Comparison</h3>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-white/10">
                            <thead>
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-faint)] uppercase">Item</th>
                                    {quotationsToCompare.map(q => (
                                        <th key={q.id} className="px-4 py-3 text-left text-xs font-medium text-[var(--text-faint)] uppercase">
                                            {q.garageName}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10">
                                <tr>
                                    <td className="px-4 py-3 text-sm font-medium text-[var(--text-main)]">Total Cost</td>
                                    {quotationsToCompare.map(q => (
                                        <td key={q.id} className="px-4 py-3 text-sm text-[var(--text-muted)] font-bold">
                                            ${q.totalCost.toLocaleString()}
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-4 py-3 text-sm font-medium text-[var(--text-main)]">Labor Cost</td>
                                    {quotationsToCompare.map(q => (
                                        <td key={q.id} className="px-4 py-3 text-sm text-[var(--text-muted)]">
                                            ${q.laborCost.toLocaleString()}
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-4 py-3 text-sm font-medium text-[var(--text-main)]">Parts Cost</td>
                                    {quotationsToCompare.map(q => (
                                        <td key={q.id} className="px-4 py-3 text-sm text-[var(--text-muted)]">
                                            ${q.partsCost.toLocaleString()}
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-4 py-3 text-sm font-medium text-[var(--text-main)]">Duration (hours)</td>
                                    {quotationsToCompare.map(q => (
                                        <td key={q.id} className="px-4 py-3 text-sm text-[var(--text-muted)]">
                                            {q.estimatedDuration}h
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-4 py-3 text-sm font-medium text-[var(--text-main)]">Valid Until</td>
                                    {quotationsToCompare.map(q => (
                                        <td key={q.id} className="px-4 py-3 text-sm text-[var(--text-muted)]">
                                            {new Date(q.validUntil).toLocaleDateString()}
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-4 py-3 text-sm font-medium text-[var(--text-main)]">Status</td>
                                    {quotationsToCompare.map(q => (
                                        <td key={q.id} className="px-4 py-3">
                                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${getStatusColor(q.status)}`}>
                                                {q.status}
                                            </span>
                                        </td>
                                    ))}
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Quotations List */}
            <div className="grid grid-cols-1 gap-6">
                {quotations.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 p-12 text-center">
                        <p className="text-[var(--text-faint)]">No quotations received yet.</p>
                        <button
                            onClick={() => setShowSubmitForm(true)}
                            className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-300"
                        >
                            Submit the first quotation
                        </button>
                    </div>
                ) : (
                    quotations.map(quotation => (
                        <div key={quotation.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-sm">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-2">
                                        <h3 className="text-lg font-bold text-[var(--text-main)]">{quotation.garageName}</h3>
                                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${getStatusColor(quotation.status)}`}>
                                            {quotation.status}
                                        </span>
                                    </div>
                                    <p className="text-sm text-[var(--text-faint)]">
                                        Submitted: {quotation.submittedDate ? new Date(quotation.submittedDate).toLocaleDateString() : new Date(quotation.quotationDate).toLocaleDateString()} •
                                        Valid until: {new Date(quotation.validUntil).toLocaleDateString()}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {compareMode && (
                                        <button
                                            onClick={() => toggleComparisonSelection(quotation.id)}
                                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${selectedForComparison.includes(quotation.id)
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-[var(--bg-surface-hover)]/40 text-[var(--text-muted)] hover:bg-slate-200'
                                                }`}
                                        >
                                            {selectedForComparison.includes(quotation.id) ? 'Selected' : 'Select'}
                                        </button>
                                    )}
                                    {quotation.status === QuotationStatus.PENDING && (
                                        <>
                                            <button
                                                onClick={() => handleAcceptQuotation(quotation.id)}
                                                className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                                            >
                                                Accept
                                            </button>
                                            <button
                                                onClick={() => handleRejectQuotation(quotation.id)}
                                                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                                            >
                                                Reject
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-4 gap-6 mb-4">
                                <div>
                                    <label className="block text-xs text-[var(--text-faint)]">Labor Cost</label>
                                    <p className="text-sm font-medium text-[var(--text-main)]">${quotation.laborCost.toLocaleString()}</p>
                                </div>
                                <div>
                                    <label className="block text-xs text-[var(--text-faint)]">Parts Cost</label>
                                    <p className="text-sm font-medium text-[var(--text-main)]">${quotation.partsCost.toLocaleString()}</p>
                                </div>
                                <div>
                                    <label className="block text-xs text-[var(--text-faint)]">Total Cost</label>
                                    <p className="text-lg font-bold text-blue-600">${quotation.totalCost.toLocaleString()}</p>
                                </div>
                                <div>
                                    <label className="block text-xs text-[var(--text-faint)]">Duration</label>
                                    <p className="text-sm font-medium text-[var(--text-main)]">{quotation.estimatedDuration} hours</p>
                                </div>
                            </div>

                            {quotation.partsBreakdown && quotation.partsBreakdown.length > 0 && (
                                <div className="mt-4">
                                    <h4 className="text-sm font-medium text-[var(--text-main)] mb-2">Parts Breakdown</h4>
                                    <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
                                        <table className="min-w-full divide-y divide-white/10">
                                            <thead className="bg-[var(--bg-surface)]/50">
                                                <tr>
                                                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-faint)]">Part Name</th>
                                                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-faint)]">Part #</th>
                                                    <th className="px-3 py-2 text-right text-xs font-medium text-[var(--text-faint)]">Qty</th>
                                                    <th className="px-3 py-2 text-right text-xs font-medium text-[var(--text-faint)]">Unit Price</th>
                                                    <th className="px-3 py-2 text-right text-xs font-medium text-[var(--text-faint)]">Total</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/10 bg-[var(--bg-surface)]">
                                                {(quotation.partsBreakdown ?? []).map(part => (
                                                    <tr key={part.id}>
                                                        <td className="px-3 py-2 text-sm text-[var(--text-main)]">{part.name}</td>
                                                        <td className="px-3 py-2 text-sm text-[var(--text-muted)]">{part.partNumber || '-'}</td>
                                                        <td className="px-3 py-2 text-sm text-[var(--text-main)] text-right">{part.quantity}</td>
                                                        <td className="px-3 py-2 text-sm text-[var(--text-main)] text-right">${part.unitPrice}</td>
                                                        <td className="px-3 py-2 text-sm font-medium text-[var(--text-main)] text-right">${part.totalPrice}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {quotation.notes && (
                                <div className="mt-4">
                                    <label className="block text-xs text-[var(--text-faint)] mb-1">Notes</label>
                                    <p className="text-sm text-[var(--text-muted)] bg-[var(--bg-surface)]/50 p-3 rounded-lg">{quotation.notes}</p>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Submit Quotation Modal */}
            {showSubmitForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-[var(--bg-surface)] rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
                        <div className="p-6 border-b border-[var(--border-subtle)]">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-[var(--text-main)]">Submit Quotation</h3>
                                <button onClick={() => setShowSubmitForm(false)} className="text-[var(--text-muted)] hover:text-[var(--text-muted)]">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* Garage Selection */}
                            <div>
                                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Select Garage *</label>
                                <select
                                    value={selectedGarageId}
                                    onChange={(e) => setSelectedGarageId(e.target.value)}
                                    className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)]"
                                >
                                    <option value="">Choose a garage</option>
                                    {garages.map(garage => (
                                        <option key={garage.id} value={garage.id}>{garage.name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Cost Details */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Labor Cost ($)</label>
                                    <input
                                        type="number"
                                        value={quotationForm.laborCost}
                                        onChange={(e) => setQuotationForm({ ...quotationForm, laborCost: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)]"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Parts Cost ($)</label>
                                    <input
                                        type="number"
                                        value={quotationForm.partsCost}
                                        onChange={(e) => setQuotationForm({ ...quotationForm, partsCost: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)]"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Additional Costs ($)</label>
                                    <input
                                        type="number"
                                        value={quotationForm.additionalCosts}
                                        onChange={(e) => setQuotationForm({ ...quotationForm, additionalCosts: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)]"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Tax Amount ($)</label>
                                    <input
                                        type="number"
                                        value={quotationForm.taxAmount}
                                        onChange={(e) => setQuotationForm({ ...quotationForm, taxAmount: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)]"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Estimated Duration (hours)</label>
                                    <input
                                        type="number"
                                        value={quotationForm.estimatedDuration}
                                        onChange={(e) => setQuotationForm({ ...quotationForm, estimatedDuration: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)]"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Valid Until *</label>
                                    <input
                                        type="date"
                                        value={quotationForm.validUntil}
                                        onChange={(e) => setQuotationForm({ ...quotationForm, validUntil: e.target.value })}
                                        className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)]"
                                    />
                                </div>
                            </div>

                            {/* Total Cost Display */}
                            <div className="bg-blue-500/10 border border-blue-200 rounded-lg p-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-sm font-medium text-[var(--text-muted)]">Total Cost:</span>
                                    <span className="text-2xl font-bold text-blue-600">${calculateTotalCost().toLocaleString()}</span>
                                </div>
                            </div>

                            {/* Parts Breakdown */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <label className="block text-sm font-medium text-[var(--text-muted)]">Parts Breakdown</label>
                                    <button
                                        onClick={handleAddPart}
                                        className="text-sm font-medium text-blue-600 hover:text-blue-300"
                                    >
                                        + Add Part
                                    </button>
                                </div>
                                {quotationForm.partsBreakdown.length > 0 && (
                                    <div className="space-y-3">
                                        {quotationForm.partsBreakdown.map((part, index) => (
                                            <div key={part.id} className="grid grid-cols-6 gap-3 items-end p-3 bg-[var(--bg-surface)]/50 rounded-lg">
                                                <div className="col-span-2">
                                                    <label className="block text-xs text-[var(--text-faint)] mb-1">Part Name</label>
                                                    <input
                                                        type="text"
                                                        value={part.name}
                                                        onChange={(e) => handlePartChange(index, 'name', e.target.value)}
                                                        className="w-full rounded border border-[var(--border-subtle)] px-2 py-1 text-sm bg-[var(--bg-surface)] text-[var(--text-main)]"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs text-[var(--text-faint)] mb-1">Part #</label>
                                                    <input
                                                        type="text"
                                                        value={part.partNumber}
                                                        onChange={(e) => handlePartChange(index, 'partNumber', e.target.value)}
                                                        className="w-full rounded border border-[var(--border-subtle)] px-2 py-1 text-sm bg-[var(--bg-surface)] text-[var(--text-main)]"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs text-[var(--text-faint)] mb-1">Qty</label>
                                                    <input
                                                        type="number"
                                                        value={part.quantity}
                                                        onChange={(e) => handlePartChange(index, 'quantity', Number(e.target.value))}
                                                        className="w-full rounded border border-[var(--border-subtle)] px-2 py-1 text-sm bg-[var(--bg-surface)] text-[var(--text-main)]"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs text-[var(--text-faint)] mb-1">Unit Price</label>
                                                    <input
                                                        type="number"
                                                        value={part.unitPrice}
                                                        onChange={(e) => handlePartChange(index, 'unitPrice', Number(e.target.value))}
                                                        className="w-full rounded border border-[var(--border-subtle)] px-2 py-1 text-sm bg-[var(--bg-surface)] text-[var(--text-main)]"
                                                    />
                                                </div>
                                                <button
                                                    onClick={() => handleRemovePart(index)}
                                                    className="text-red-600 hover:text-red-300 p-1"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Notes */}
                            <div>
                                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Notes</label>
                                <textarea
                                    rows={3}
                                    value={quotationForm.notes}
                                    onChange={(e) => setQuotationForm({ ...quotationForm, notes: e.target.value })}
                                    className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)]"
                                    placeholder="Additional notes or terms..."
                                />
                            </div>
                        </div>

                        <div className="p-6 border-t border-[var(--border-subtle)] flex justify-end gap-3">
                            <button
                                onClick={() => setShowSubmitForm(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmitQuotation}
                                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
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
