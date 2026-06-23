'use client';

export const dynamic = 'force-dynamic';

// Helper to prevent null pointer exceptions on array operations
function ensureArray<T>(arr: T[] | null | undefined): T[] {
    return Array.isArray(arr) ? arr : [];
}

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from 'next/navigation';
import { getMaintenanceRequests, getMaintenanceRequestById, getVehicleById, updateMaintenanceRequest, createQuotation, updateQuotation } from "@/services/mockData";
import { Quotation, QuotationStatus, MaintenanceRequest, MaintenanceStatus, PartItem, LaborItem, AttachmentType } from "@/types/maintenance";
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '@/contexts/ToastContext';

export default function VendorQuotePage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
    const [selectedRequest, setSelectedRequest] = useState<MaintenanceRequest | null>(null);
    const [selectedVehicle, setSelectedVehicle] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // Filters
    const [dateFilter, setDateFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState<'All' | 'Pending for Submission' | 'Quote Submitted'>('All');
    const [searchFilter, setSearchFilter] = useState("");

    // Form State
    const [parts, setParts] = useState<PartItem[]>([]);
    const [labor, setLabor] = useState<LaborItem[]>([]);
    const [consumablesType, setConsumablesType] = useState<'Percentage' | 'Fixed'>('Percentage');
    const [consumablesValue, setConsumablesValue] = useState<number>(5); // Default 5%
    const [vatRate, setVatRate] = useState<number>(5); // Default 5%

    // const [amount, setAmount] = useState(""); // Replaced by calculated total
    const [eta, setEta] = useState("");
    const [validityDays, setValidityDays] = useState("");
    const [files, setFiles] = useState<File[]>([]);
    const [comments, setComments] = useState("");
    const [submitted, setSubmitted] = useState(false);
    const [isRevisionMode, setIsRevisionMode] = useState(false);

    // Hardcoded Garage ID for demo
    const currentGarageId = 'g1';

    useEffect(() => {
        const loadData = async () => {
            try {
                const allRequests: MaintenanceRequest[] = await getMaintenanceRequests();

                // Filter for Quotations tab
                const quotationRequests = allRequests.filter(r =>
                    r.status === MaintenanceStatus.UNDER_ESTIMATION ||
                    r.status === MaintenanceStatus.PENDING_ESTIMATION_APPROVAL
                );
                setRequests(quotationRequests);

            } catch (error) {
                console.error("Error loading requests:", error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, []);

    useEffect(() => {
        const loadVehicle = async () => {
            if (selectedRequest) {
                // Optimization: Use preloaded vehicle if available
                if (selectedRequest.vehicle) {
                    setSelectedVehicle(selectedRequest.vehicle);
                } else {
                    const vehicle = await getVehicleById(selectedRequest.vehicleId);
                    setSelectedVehicle(vehicle);
                }

                // Hydrate Form if quotation exists
                const existingQuote = selectedRequest.quotations?.find(q => q.garageId === currentGarageId);
                if (existingQuote) {
                    setSubmitted(true);
                    setParts(existingQuote.parts?.map(p => ({
                        id: p.id || uuidv4(),
                        name: p.name,
                        quantity: p.quantity,
                        unitPrice: p.unitPrice,
                        totalPrice: p.totalPrice
                    })) || []);

                    setLabor(existingQuote.labor?.map(l => ({
                        id: l.id || uuidv4(),
                        description: l.description,
                        hours: l.hours,
                        ratePerHour: l.ratePerHour,
                        totalPrice: l.totalPrice
                    })) || []);

                    if (existingQuote.estimatedCompletionDate) {
                        setEta(existingQuote.estimatedCompletionDate.split('T')[0]);
                    }

                    // Calculate validity days if validUntil exists
                    if (existingQuote.validUntil) {
                        const validUntil = new Date(existingQuote.validUntil);
                        const today = new Date();
                        const diffTime = Math.abs(validUntil.getTime() - today.getTime());
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        setValidityDays(diffDays.toString());
                    }

                    setComments(existingQuote.notes || "");

                    // Attachments handling - mock file object for display logic if needed or just show existing
                    // existingQuote.attachments is of type Attachment[] (url, fileName etc)
                    // files state is File[] (browser file object)
                    // We can't convert URL to File easily/securely to prefill <input type="file">
                    // So we must handle display of existing attachments separately in the UI.
                } else {
                    // Reset form
                    setSubmitted(false);
                    setParts([]);
                    setLabor([]);
                    setConsumablesValue(5);
                    setEta("");
                    setValidityDays("");
                    setFiles([]);
                    setComments("");
                }
            }
        };
        loadVehicle();
    }, [selectedRequest]);

    const filteredRequests = useMemo(() => {
        if (!Array.isArray(requests)) {
            console.warn('Requests is not an array:', requests);
            return [];
        }
        return requests.filter(req => {
            // 1. Search Filter
            const matchesSearch = searchFilter === "" ||
                req.id.toLowerCase().includes(searchFilter.toLowerCase()) ||
                req.description.toLowerCase().includes(searchFilter.toLowerCase());

            // 2. Date Filter
            const matchesDate = dateFilter === "" ||
                new Date(req.requestDate).toISOString().split('T')[0] === dateFilter;

            // 3. Status Filter
            const hasSubmittedQuote = req.quotations?.some(q => q.garageId === currentGarageId);
            let matchesStatus = true;
            if (statusFilter === 'Pending for Submission') {
                matchesStatus = !hasSubmittedQuote && req.status === MaintenanceStatus.UNDER_ESTIMATION;
            } else if (statusFilter === 'Quote Submitted') {
                matchesStatus = hasSubmittedQuote || req.status !== MaintenanceStatus.UNDER_ESTIMATION;
            }

            return matchesSearch && matchesDate && matchesStatus;
        });
    }, [requests, searchFilter, dateFilter, statusFilter]);

    console.log('Rendering GaragePortal. FilteredRequests:', filteredRequests?.length, 'SelectedRequest:', selectedRequest?.id);

    const calculateTotals = () => {
        const partsTotal = ensureArray(parts).reduce((sum, item) => sum + item.totalPrice, 0);
        const laborTotal = ensureArray(labor).reduce((sum, item) => sum + item.totalPrice, 0);
        const subTotal = partsTotal + laborTotal;

        const consumables = consumablesType === 'Percentage'
            ? (subTotal * consumablesValue / 100)
            : consumablesValue;

        const taxableAmount = subTotal + consumables;
        const vat = taxableAmount * vatRate / 100;
        const grandTotal = taxableAmount + vat;

        return { partsTotal, laborTotal, subTotal, consumables, vat, grandTotal };
    };

    const totals = calculateTotals();

    const addPart = () => {
        setParts([...parts, { id: uuidv4(), name: '', quantity: 1, unitPrice: 0, totalPrice: 0 }]);
    };

    const updatePart = (id: string, field: keyof PartItem, value: any) => {
        setParts(ensureArray(parts).map(p => {
            if (p.id === id) {
                let parsedValue = value;
                if (field === 'quantity' || field === 'unitPrice') {
                    parsedValue = value === '' ? 0 : Number(value);
                }

                const updated = { ...p, [field]: parsedValue };
                if (field === 'quantity' || field === 'unitPrice') {
                    updated.totalPrice = Number(updated.quantity) * Number(updated.unitPrice);
                }
                return updated;
            }
            return p;
        }));
    };

    const removePart = (id: string) => {
        setParts(ensureArray(parts).filter(p => p.id !== id));
    };

    const addLabor = () => {
        setLabor([...labor, { id: uuidv4(), description: '', hours: 1, ratePerHour: 0, totalPrice: 0 }]);
    };

    const updateLabor = (id: string, field: keyof LaborItem, value: any) => {
        setLabor(ensureArray(labor).map(l => {
            if (l.id === id) {
                let parsedValue = value;
                if (field === 'hours' || field === 'ratePerHour') {
                    parsedValue = value === '' ? 0 : Number(value);
                }

                const updated = { ...l, [field]: parsedValue };
                if (field === 'hours' || field === 'ratePerHour') {
                    updated.totalPrice = Number(updated.hours) * Number(updated.ratePerHour);
                }
                return updated;
            }
            return l;
        }));
    };

    const removeLabor = (id: string) => {
        setLabor(ensureArray(labor).filter(l => l.id !== id));
    };

    const isLocked = selectedRequest &&
        selectedRequest.status !== MaintenanceStatus.UNDER_ESTIMATION &&
        selectedRequest.status !== MaintenanceStatus.PENDING_ESTIMATION_APPROVAL;

    const isValid =
        !isLocked &&
        totals.grandTotal > 0 &&
        eta.trim() !== "" &&
        validityDays.trim() !== "" &&
        Number(validityDays) > 0 &&
        files.length > 0;

    function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        if (!e.target.files) return;
        setFiles(Array.from(e.target.files));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!isValid || !selectedRequest) return;

        // Helper to convert file to base64
        const fileToBase64 = (file: File): Promise<string> => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = error => reject(error);
            });
        };

        try {
            // Convert files to base64
            const attachmentPromises = files.map(async f => ({
                id: uuidv4(),
                type: AttachmentType.QUOTATION,
                fileName: f.name,
                url: await fileToBase64(f),
                uploadedAt: new Date().toISOString()
            }));
            const processedAttachments = await Promise.all(attachmentPromises);

            // Create a new quotation object
            const newQuotation: Quotation = {
                id: uuidv4(),
                requestId: selectedRequest.id,
                garageId: currentGarageId,
                garageName: 'Garage Name',
                quotationDate: new Date().toISOString(),
                // Calculate validUntil date based on days
                validUntil: (() => {
                    const date = new Date();
                    date.setDate(date.getDate() + Number(validityDays));
                    return date.toISOString();
                })(),
                laborCost: totals.laborTotal,
                partsCost: totals.partsTotal,
                totalCost: totals.subTotal,
                consumablesCost: totals.consumables,
                vatAmount: totals.vat,
                grandTotal: totals.grandTotal,
                currency: 'AED',
                parts: parts.map(p => ({
                    ...p,
                    quantity: Number(p.quantity),
                    unitPrice: Number(p.unitPrice),
                    totalPrice: Number(p.quantity) * Number(p.unitPrice)
                })),
                labor: labor.map(l => ({
                    ...l,
                    hours: Number(l.hours),
                    ratePerHour: Number(l.ratePerHour),
                    totalPrice: Number(l.hours) * Number(l.ratePerHour)
                })),
                estimatedDuration: 24, // Mock
                estimatedCompletionDate: new Date(eta).toISOString(),
                notes: comments,
                status: QuotationStatus.PENDING,
                submittedBy: 'Garage Admin',
                attachments: processedAttachments
            };

            // Remove garageName as it's not in the schema
            const { garageName, ...quotationPayload } = newQuotation;


            // Check if updating existing quotation
            const existingQuote = selectedRequest.quotations?.find(q => q.garageId === currentGarageId);

            if (existingQuote) {
                // UPDATE logic
                // Use existing ID
                quotationPayload.id = existingQuote.id;
                await updateQuotation(existingQuote.id, quotationPayload);
                setSubmitted(true);
                addToast('Quotation revised successfully', 'success');

                // Update local state and selectedRequest
                setRequests(prev => prev.map(r => {
                    if (r.id === selectedRequest.id) {
                        const updatedRequest = {
                            ...r,
                            quotations: r.quotations?.map(q => q.id === existingQuote.id ? { ...newQuotation, id: existingQuote.id } : q)
                        };
                        setSelectedRequest(updatedRequest); // Update detail view
                        return updatedRequest;
                    }
                    return r;
                }));

            } else {
                // CREATE logic
                const response = await createQuotation(quotationPayload);
                setSubmitted(true);

                // Update local state and selectedRequest
                setRequests(prev => prev.map(r => {
                    if (r.id === selectedRequest.id) {
                        const updatedRequest = {
                            ...r,
                            quotations: [...(r.quotations || []), newQuotation] // Use newQuotation with temp ID for immediate feedback or response if available
                        };
                        setSelectedRequest(updatedRequest); // Update detail view
                        return updatedRequest;
                    }
                    return r;
                }));
            }

            // Reset after delay or let user navigate back
            setTimeout(() => {
                setSelectedRequest(null);
                setSubmitted(false);
                setParts([]);
                setLabor([]);
                setConsumablesValue(5);
                setEta("");
                setValidityDays("");
                setFiles([]);
                setComments("");
            }, 2000);

        } catch (error) {
            console.error("Error submitting quotation:", error);
            addToast('Failed to submit quotation', 'error');
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-800/50">
                Loading...
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-800/50">
            {/* Top Bar */}
            <header className="flex items-center justify-between px-4 py-3 bg-slate-900 shadow-sm md:px-6 sticky top-0 z-10">
                <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-slate-900 flex items-center justify-center text-white text-xs font-bold">
                        G
                    </div>
                    <div className="font-semibold text-slate-200 text-sm md:text-base">Garage Portal</div>
                </div>
                <div className="text-xs text-slate-600 md:text-sm">
                    Logged in as <span className="font-medium">Autopro Service Centre</span> (v2.2 - HARDENED)
                </div>
            </header >

            {/* Content */}
            < main className="max-w-6xl mx-auto px-4 py-6" >
                {!selectedRequest ? (
                    // List View - Quotations
                    <div className="space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <h2 className="text-2xl font-bold text-slate-200">Quotations</h2>

                            {/* Filters */}
                            <div className="flex flex-col sm:flex-row gap-2 text-sm">
                                <input
                                    type="text"
                                    placeholder="Search WO or Description..."
                                    value={searchFilter}
                                    onChange={(e) => setSearchFilter(e.target.value)}
                                    className="px-3 py-2 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-slate-900 w-full sm:w-48 text-white"
                                />
                                <input
                                    type="date"
                                    value={dateFilter}
                                    onChange={(e) => setDateFilter(e.target.value)}
                                    className="px-3 py-2 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-slate-900 text-white"
                                />
                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value as 'All' | 'Pending for Submission' | 'Quote Submitted')}
                                    className="px-3 py-2 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-900 text-white"
                                >
                                    <option value="All">All Status</option>
                                    <option value="Pending for Submission">Pending Submission</option>
                                    <option value="Quote Submitted">Quote Submitted</option>
                                </select>
                            </div>
                        </div>

                        {filteredRequests.length === 0 ? (
                            <div className="text-center py-12 bg-slate-900 rounded-2xl shadow-sm">
                                <p className="text-slate-500">No requests found matching your filters.</p>
                            </div>
                        ) : (
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {Array.isArray(filteredRequests) && filteredRequests.map(req => {
                                    const isSubmitted = req.quotations?.some(q => q.garageId === currentGarageId);

                                    return (
                                        <div
                                            key={req.id}
                                            onClick={async () => {
                                                const fullReq = await getMaintenanceRequestById(req.id);
                                                setSelectedRequest(fullReq);
                                                // Reset revision mode when opening a request
                                                setIsRevisionMode(false);
                                            }}
                                            className="bg-slate-900 rounded-xl shadow-sm p-5 cursor-pointer hover:shadow-md transition-shadow border border-transparent hover:border-blue-500/30 group"
                                        >
                                            <div className="flex justify-between items-start mb-3">
                                                <span className="font-mono text-xs font-medium text-slate-500 bg-slate-700/40 px-2 py-1 rounded">
                                                    WO-{new Date().getFullYear()}-{req.id.toUpperCase()}
                                                </span>
                                                {isSubmitted ? (
                                                    <div className="flex flex-col items-end gap-1">
                                                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                                            Quote Submitted
                                                        </span>
                                                        <span className="text-[10px] text-slate-500 font-medium">
                                                            {req.quotations?.find(q => q.garageId === currentGarageId)?.revision
                                                                ? `Rev.${String(req.quotations?.find(q => q.garageId === currentGarageId)?.revision).padStart(2, '0')}`
                                                                : 'Rev.00'}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                                        Pending Submission
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="font-semibold text-slate-200 mb-1 group-hover:text-blue-600 transition-colors line-clamp-1">
                                                {req.description}
                                            </h3>
                                            <div className="text-xs text-slate-500 mb-4 space-y-1">
                                                <div>Requested: {new Date(req.requestDate).toLocaleDateString()}</div>
                                                {isSubmitted && req.quotations?.find(q => q.garageId === currentGarageId)?.quotationDate && (
                                                    <div className="text-emerald-600 font-medium">
                                                        Submitted: {new Date(req.quotations?.find(q => q.garageId === currentGarageId)?.quotationDate ?? new Date().toISOString()).toLocaleDateString()}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center justify-between pt-3 border-t border-white/5">
                                                <span className="text-xs font-medium text-slate-600">View Details</span>
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-slate-400 group-hover:text-blue-500">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                                                </svg>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ) : (
                    // Detail/Form View
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)] animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="md:col-span-2 mb-2">
                            <button
                                onClick={() => setSelectedRequest(null)}
                                className="flex items-center text-sm text-slate-500 hover:text-slate-200 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-1">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                                </svg>
                                Back to List
                            </button>
                        </div>

                        {/* Left: WO Summary */}
                        <section className="bg-slate-900 rounded-2xl shadow-sm p-4 md:p-5 space-y-3 h-fit">
                            <div className="flex items-center justify-between">
                                <h2 className="text-sm font-semibold tracking-wide text-slate-300 uppercase">
                                    Work Order Summary
                                </h2>
                                <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                                    Under Estimation
                                </span>
                            </div>
                            <div className="space-y-2 text-sm text-slate-600">
                                <div><span className="font-medium text-white">WO Number:</span> <span className="text-slate-300">{selectedRequest.workOrderNo || `WO-${new Date().getMonth() + 1}-${selectedRequest.id}`}</span></div>
                                {selectedVehicle && (
                                    <>
                                        <div><span className="font-medium text-white">Vehicle ID:</span> <span className="text-slate-300">{selectedVehicle.id}</span></div>
                                        <div><span className="font-medium text-white">Vehicle:</span> <span className="text-slate-300">{selectedVehicle.licensePlate} – {selectedVehicle.make} {selectedVehicle.model} {selectedVehicle.year}</span></div>
                                        <div><span className="font-medium text-white">Type:</span> <span className="text-slate-300">{selectedVehicle.type}</span></div>
                                        <div><span className="font-medium text-white">Odometer:</span> <span className="text-slate-300">{(selectedRequest.odometer || selectedVehicle.currentMileage).toLocaleString()} km</span></div>
                                    </>
                                )}
                                {selectedRequest.maintenanceType && (
                                    <div><span className="font-medium text-white">Maintenance Type:</span> <span className="text-slate-300">{selectedRequest.maintenanceType}</span></div>
                                )}
                                {selectedRequest.maintenanceJobs && selectedRequest.maintenanceJobs.length > 0 && (
                                    <div>
                                        <span className="font-medium text-white">Jobs Selected:</span>
                                        <ul className="list-disc list-inside text-xs text-slate-600 mt-1 ml-1">
                                            {selectedRequest.maintenanceJobs?.map((job, idx) => (
                                                <li key={idx}>{job}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                <div><span className="font-medium text-white">Reported Issue:</span></div>
                                <p className="text-slate-300 text-xs bg-slate-800/50 rounded-lg p-2 border border-white/5">
                                    {selectedRequest.description}
                                </p>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                        <span className="font-medium text-white">Priority:</span> <span className="text-slate-300">{selectedRequest.priority || 'Normal'}</span>
                                    </div>
                                    <div>
                                        <span className="font-medium text-white">Required By:</span> <span className="text-slate-300">{selectedRequest.expectedEndDate ? new Date(selectedRequest.expectedEndDate).toLocaleDateString() : 'N/A'}</span>
                                    </div>
                                    <div className="col-span-2">
                                        <span className="font-medium text-white">Location:</span> <span className="text-slate-300">{selectedVehicle?.location || 'Abu Dhabi – Musaffah Yard'}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="pt-2 border-t border-white/5">
                                <div className="text-xs font-medium text-slate-300 mb-1">
                                    Attachments
                                </div>
                                {selectedRequest.attachments && selectedRequest.attachments.length > 0 ? (
                                    <div className="flex gap-2 flex-wrap">
                                        {selectedRequest.attachments?.map((att, idx) => (
                                            <a
                                                key={att.id || idx}
                                                href={att.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="h-16 w-20 rounded-lg bg-slate-700/40 border border-white/10 text-[10px] flex flex-col items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors p-1"
                                            >
                                                <span className="truncate w-full text-center">{att.fileName}</span>
                                                <span className="text-[9px] text-slate-400 uppercase mt-1">{att.type}</span>
                                            </a>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-slate-400 italic">No attachments available.</p>
                                )}
                            </div>
                        </section>

                        {/* Right: Quote Form */}
                        <section className="bg-slate-900 rounded-2xl shadow-sm p-4 md:p-5">
                            <h2 className="text-sm font-semibold tracking-wide text-slate-300 uppercase flex items-center gap-2">
                                {submitted ? (
                                    isRevisionMode ? (
                                        <>
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-blue-600">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                            </svg>
                                            Revise Your Quotation
                                        </>
                                    ) : (
                                        <>
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-emerald-600">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                            </svg>
                                            Quotation Submitted
                                        </>
                                    )
                                ) : (
                                    "Submit Your Quotation"
                                )}
                            </h2>
                            {submitted && (
                                <div className="flex gap-2">
                                    <span className="inline-flex items-center rounded-full bg-slate-700/40 px-2.5 py-0.5 text-xs font-medium text-slate-300 ring-1 ring-inset ring-slate-700/10">
                                        {selectedRequest.quotations?.find(q => q.garageId === currentGarageId)?.status || 'SUBMITTED'}
                                    </span>
                                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-700/10">
                                        {selectedRequest.quotations?.find(q => q.garageId === currentGarageId)?.revision ? `Rev.${String(selectedRequest.quotations?.find(q => q.garageId === currentGarageId)?.revision).padStart(2, '0')}` : 'Rev.00'}
                                    </span>
                                    {isRevisionMode && !isLocked && (
                                        <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                                            Revision Mode
                                        </span>
                                    )}
                                </div>
                            )}


                            <form onSubmit={handleSubmit} className="space-y-6 text-sm">
                                {submitted && !isLocked && isRevisionMode && (
                                    <div className="bg-blue-500/10 p-3 rounded-lg border border-blue-100 text-blue-700 text-xs flex items-start gap-2">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mt-0.5 flex-shrink-0">
                                            <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM7.48 9.817a3 3 0 0 1 5.04 0 4.301 4.301 0 0 1-1.64 3.193.75.75 0 0 0-.53.74v.75a.75.75 0 0 1-1.5 0v-.75a2.25 2.25 0 0 1 1.581-2.219 1.5 1.5 0 1 0-2.122-1.396.75.75 0 0 1-1.5 0 4.25 4.25 0 0 1 .822-2.536.75.75 0 0 1 .349.818ZM9 15a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" clipRule="evenodd" />
                                        </svg>
                                        <div>
                                            <strong>You are revising a submitted quotation.</strong>
                                            <p className="mt-1 opacity-90">Modify any fields below and click "Revise Quotation" to save as a new revision.</p>
                                        </div>
                                    </div>
                                )}
                                <div>
                                    <h3 className="text-sm font-bold text-slate-200 mb-3">Cost Breakdown</h3>

                                    {/* Spare Parts & Materials */}
                                    <div className="mb-6">
                                        <div className="flex items-center justify-between mb-2">
                                            <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
                                                </svg>
                                                Spare Parts & Materials
                                            </h4>
                                            {!submitted || isRevisionMode ? (
                                                <button type="button" onClick={addPart} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                                    </svg>
                                                    Add Item
                                                </button>
                                            ) : null}
                                        </div>

                                        <div className="grid grid-cols-12 gap-2 text-[10px] font-medium text-slate-500 mb-1 px-1">
                                            <div className="col-span-1">#</div>
                                            <div className="col-span-5">Description</div>
                                            <div className="col-span-2">Qty</div>
                                            <div className="col-span-2">Unit Price (AED)</div>
                                            <div className="col-span-2 text-right">Total (AED)</div>
                                        </div>

                                        <div className="space-y-2">
                                            {parts?.map((item, index) => (
                                                <div key={item.id} className="grid grid-cols-12 gap-2 items-center bg-slate-800/50 p-1.5 rounded border border-white/5">
                                                    <div className="col-span-1 text-xs text-slate-500 pl-1">{index + 1}</div>
                                                    <div className="col-span-5">
                                                        <input
                                                            type="text"
                                                            value={item.name}
                                                            onChange={e => updatePart(item.id, 'name', e.target.value)}
                                                            className="w-full bg-transparent border-b border-white/10 focus:border-blue-500 focus:outline-none text-xs py-1 text-white"
                                                            placeholder="Item Name"
                                                            disabled={submitted && !isRevisionMode}
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            value={item.quantity}
                                                            onChange={e => updatePart(item.id, 'quantity', e.target.value)}
                                                            className="w-full bg-transparent border-b border-white/10 focus:border-blue-500 focus:outline-none text-xs py-1 text-white"
                                                            disabled={submitted && !isRevisionMode}
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            value={item.unitPrice}
                                                            onChange={e => updatePart(item.id, 'unitPrice', e.target.value)}
                                                            className="w-full bg-transparent border-b border-white/10 focus:border-blue-500 focus:outline-none text-xs py-1 text-white"
                                                            disabled={submitted && !isRevisionMode}
                                                        />
                                                    </div>
                                                    <div className="col-span-2 flex items-center justify-between pl-2">
                                                        <span className="text-xs font-medium text-slate-300">{item.totalPrice.toFixed(2)}</span>
                                                        {(!submitted || isRevisionMode) && (
                                                            <button type="button" onClick={() => removePart(item.id)} className="text-slate-400 hover:text-red-500 transition-colors">
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                                                </svg>
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                            {parts.length === 0 && <div className="text-center py-3 text-xs text-slate-400 italic bg-slate-800/50 rounded border border-dashed border-white/10">No parts added. Click "Add Item" to start.</div>}
                                        </div>
                                        <div className="flex justify-between items-center mt-2 pt-2 border-t border-white/5">
                                            <span className="text-xs font-semibold text-slate-300">Parts Sub Total</span>
                                            <span className="text-xs font-bold text-white">{totals.partsTotal.toFixed(2)}</span>
                                        </div>
                                    </div>

                                    {/* Labor Charges */}
                                    <div className="mb-6">
                                        <div className="flex items-center justify-between mb-2">
                                            <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
                                                </svg>
                                                Labor Charges
                                            </h4>
                                            {!submitted || isRevisionMode ? (
                                                <button type="button" onClick={addLabor} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                                    </svg>
                                                    Add Item
                                                </button>
                                            ) : null}
                                        </div>

                                        <div className="grid grid-cols-12 gap-2 text-[10px] font-medium text-slate-500 mb-1 px-1">
                                            <div className="col-span-1">#</div>
                                            <div className="col-span-5">Description</div>
                                            <div className="col-span-2">Hours</div>
                                            <div className="col-span-2">Rate/Hour (AED)</div>
                                            <div className="col-span-2 text-right">Total (AED)</div>
                                        </div>

                                        <div className="space-y-2">
                                            {labor?.map((item, index) => (
                                                <div key={item.id} className="grid grid-cols-12 gap-2 items-center bg-slate-800/50 p-1.5 rounded border border-white/5">
                                                    <div className="col-span-1 text-xs text-slate-500 pl-1">{index + 1}</div>
                                                    <div className="col-span-5">
                                                        <input
                                                            type="text"
                                                            value={item.description}
                                                            onChange={e => updateLabor(item.id, 'description', e.target.value)}
                                                            className="w-full bg-transparent border-b border-white/10 focus:border-blue-500 focus:outline-none text-xs py-1 text-white"
                                                            placeholder="Description"
                                                            disabled={submitted && !isRevisionMode}
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <input
                                                            type="number"
                                                            min="0.5"
                                                            step="0.5"
                                                            value={item.hours}
                                                            onChange={e => updateLabor(item.id, 'hours', e.target.value)}
                                                            className="w-full bg-transparent border-b border-white/10 focus:border-blue-500 focus:outline-none text-xs py-1 text-white"
                                                            disabled={submitted && !isRevisionMode}
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            value={item.ratePerHour}
                                                            onChange={e => updateLabor(item.id, 'ratePerHour', e.target.value)}
                                                            className="w-full bg-transparent border-b border-white/10 focus:border-blue-500 focus:outline-none text-xs py-1 text-white"
                                                            disabled={submitted && !isRevisionMode}
                                                        />
                                                    </div>
                                                    <div className="col-span-2 flex items-center justify-between pl-2">
                                                        <span className="text-xs font-medium text-slate-300">{item.totalPrice.toFixed(2)}</span>
                                                        {(!submitted || isRevisionMode) && (
                                                            <button type="button" onClick={() => removeLabor(item.id)} className="text-slate-400 hover:text-red-500 transition-colors">
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                                                </svg>
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                            {labor.length === 0 && <div className="text-center py-3 text-xs text-slate-400 italic bg-slate-800/50 rounded border border-dashed border-white/10">No labor charges added.</div>}
                                        </div>
                                        <div className="flex justify-between items-center mt-2 pt-2 border-t border-white/5">
                                            <span className="text-xs font-semibold text-slate-300">Labor Sub Total</span>
                                            <span className="text-xs font-bold text-white">{totals.laborTotal.toFixed(2)}</span>
                                        </div>
                                    </div>

                                    {/* Summary of Charges */}
                                    <div className="bg-slate-800/50 rounded-lg p-4 space-y-3 border border-white/5">
                                        <h4 className="text-xs font-bold text-slate-200 mb-2 border-b border-white/10 pb-2">Summary of Charges</h4>

                                        <div className="flex justify-between text-xs">
                                            <span className="text-slate-600">Parts Total</span>
                                            <span className="font-medium text-white">{totals.partsTotal.toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-slate-600">Labor Total</span>
                                            <span className="font-medium text-white">{totals.laborTotal.toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between text-xs items-center">
                                            <span className="text-slate-600 flex items-center gap-1">
                                                Shop Supplies/Consumables
                                                <select
                                                    value={consumablesType}
                                                    onChange={e => setConsumablesType(e.target.value as any)}
                                                    className="bg-transparent border-none text-[10px] text-white focus:ring-0 p-0"
                                                    disabled={submitted && !isRevisionMode}
                                                >
                                                    <option value="Percentage">(%)</option>
                                                    <option value="Fixed">(Fixed)</option>
                                                </select>
                                                {consumablesType === 'Percentage' && (
                                                    <input
                                                        type="number"
                                                        value={consumablesValue}
                                                        onChange={e => setConsumablesValue(Number(e.target.value))}
                                                        className="w-8 bg-transparent border-b border-white/15 text-center text-[10px] focus:outline-none text-white"
                                                        disabled={submitted && !isRevisionMode}
                                                    />
                                                )}
                                            </span>
                                            <span className="font-medium text-white">{totals.consumables.toFixed(2)}</span>
                                        </div>

                                        <div className="flex justify-between text-xs font-semibold pt-2 border-t border-white/10">
                                            <span className="text-slate-300">Subtotal</span>
                                            <span className="text-white">{totals.subTotal.toFixed(2)}</span>
                                        </div>

                                        <div className="flex justify-between text-xs items-center">
                                            <span className="text-slate-600">VAT ({vatRate}%)</span>
                                            <span className="font-medium text-white">{totals.vat.toFixed(2)}</span>
                                        </div>

                                        <div className="flex justify-between text-sm font-bold pt-2 border-t border-white/15 text-white">
                                            <span>Grand Total</span>
                                            <span>{totals.grandTotal.toFixed(2)} AED</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Other Fields */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">
                                            Estimated Completion Date *
                                        </label>
                                        <input
                                            type="date"
                                            value={eta}
                                            onChange={(e) => setEta(e.target.value)}
                                            disabled={submitted && !isRevisionMode}
                                            className="w-full rounded-lg border border-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">
                                            Quotation Validity (Days) *
                                        </label>
                                        <input
                                            type="number"
                                            min="1"
                                            value={validityDays}
                                            onChange={(e) => setValidityDays(e.target.value)}
                                            disabled={submitted && !isRevisionMode}
                                            className="w-full rounded-lg border border-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                                            placeholder="e.g. 30"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-slate-300 mb-1">
                                        Quotation Attachment (PDF / Image) *
                                    </label>
                                    <input
                                        type="file"
                                        multiple={false}
                                        accept=".pdf,.jpg,.jpeg,.png"
                                        disabled={submitted && !isRevisionMode}
                                        onChange={handleFileChange}
                                        className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-slate-800"
                                    />
                                    {files.length > 0 && (
                                        <p className="mt-1 text-[11px] text-slate-500">
                                            Selected: {files[0].name}
                                        </p>
                                    )}
                                    {submitted && selectedRequest?.quotations?.find(q => q.garageId === currentGarageId)?.attachments?.map((att, idx) => (
                                        <div key={idx} className="mt-2 text-xs">
                                            <span className="text-slate-500">Submitted: </span>
                                            <a href={att.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{att.fileName}</a>
                                        </div>
                                    ))}
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-slate-300 mb-1">
                                        Comments (Optional)
                                    </label>
                                    <textarea
                                        rows={3}
                                        value={comments}
                                        onChange={(e) => setComments(e.target.value)}
                                        disabled={submitted && !isRevisionMode}
                                        className="w-full rounded-lg border border-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                                        placeholder="Add any clarifications if needed..."
                                    />
                                </div>

                                <div className="flex items-center justify-between pt-2">
                                    {!submitted && (
                                        <p className="text-[11px] text-slate-500 hidden sm:block">
                                            Fields marked with * are required.
                                        </p>
                                    )}
                                    <div className="flex gap-2 ml-auto w-full sm:w-auto justify-end">
                                        {!submitted && (
                                            <button
                                                type="button"
                                                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5"
                                            >
                                                Save as Draft
                                            </button>
                                        )}

                                        {submitted && !isRevisionMode ? (
                                            !isLocked ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setIsRevisionMode(true)}
                                                    className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 flex items-center gap-1.5"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                                    </svg>
                                                    Revise Quote
                                                </button>
                                            ) : (
                                                <div className="text-xs text-slate-400 italic">
                                                    Quotation cannot be revised at this stage.
                                                </div>
                                            )
                                        ) : (
                                            <>
                                                {isRevisionMode && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsRevisionMode(false)}
                                                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5"
                                                    >
                                                        Cancel Revision
                                                    </button>
                                                )}
                                                <button
                                                    type="submit"
                                                    disabled={!isValid}
                                                    className={`rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors flex items-center gap-2 ${isValid ? 'bg-slate-900 hover:bg-slate-800' : 'bg-slate-300 cursor-not-allowed'}`}
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L5.999 12Zm0 0h7.5" />
                                                    </svg>
                                                    {isRevisionMode ? "Revise Quotation" : "Submit Quotation"}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </form>
                        </section>
                    </div>
                )
                }
            </main >

            <footer className="py-3 text-center text-[11px] text-slate-400">
                Powered by Fleet360
            </footer>
        </div >
    );
}
