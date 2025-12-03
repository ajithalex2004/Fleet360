'use client';

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from 'next/navigation';
import { getMaintenanceRequests, getVehicleById, updateMaintenanceRequest } from "@/services/mockData";
import { Quotation, QuotationStatus, MaintenanceRequest, MaintenanceStatus } from "@/types/maintenance";
import { v4 as uuidv4 } from 'uuid';

export default function VendorQuotePage() {
    const router = useRouter();
    const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
    const [selectedRequest, setSelectedRequest] = useState<MaintenanceRequest | null>(null);
    const [selectedVehicle, setSelectedVehicle] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // Filters
    const [dateFilter, setDateFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState<'All' | 'Pending for Submission' | 'Quote Submitted'>('All');
    const [searchFilter, setSearchFilter] = useState("");

    // Form State
    const [amount, setAmount] = useState("");
    const [eta, setEta] = useState("");
    const [validityDays, setValidityDays] = useState("");
    const [files, setFiles] = useState<File[]>([]);
    const [comments, setComments] = useState("");
    const [submitted, setSubmitted] = useState(false);

    // Hardcoded Garage ID for demo
    const currentGarageId = 'g1';

    useEffect(() => {
        const loadData = async () => {
            try {
                const allRequests = await getMaintenanceRequests();

                // Filter for Quotations tab
                const quotationRequests = allRequests.filter(r =>
                    r.status === MaintenanceStatus.UNDER_ESTIMATION ||
                    r.status === MaintenanceStatus.PENDING_ESTIMATION_APPROVAL ||
                    r.status === MaintenanceStatus.ESTIMATION_APPROVED
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
                const vehicle = await getVehicleById(selectedRequest.vehicleId);
                setSelectedVehicle(vehicle);
            }
        };
        loadVehicle();
    }, [selectedRequest]);

    const filteredRequests = useMemo(() => {
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

    const isValid =
        !submitted &&
        amount.trim() !== "" &&
        !Number.isNaN(Number(amount)) &&
        Number(amount) > 0 &&
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
            laborCost: Number(amount) * 0.4, // Mock breakdown
            partsCost: Number(amount) * 0.6, // Mock breakdown
            totalCost: Number(amount),
            currency: 'AED',
            parts: [], // Empty for now
            estimatedDuration: 24, // Mock
            estimatedCompletionDate: new Date(eta).toISOString(),
            notes: comments,
            status: QuotationStatus.PENDING,
            submittedBy: 'Garage Admin',
            attachments: files.map(f => ({
                id: uuidv4(),
                type: 'Quotation' as any,
                fileName: f.name,
                url: URL.createObjectURL(f),
                uploadedAt: new Date().toISOString()
            }))
        };

        try {
            console.log("Submitting quotation:", newQuotation);

            // Persist the quotation
            const updatedQuotations = [...(selectedRequest.quotations || []), newQuotation];
            await updateMaintenanceRequest(selectedRequest.id, {
                quotations: updatedQuotations,
                // Optionally update status if needed, but workflow might handle that
            });

            setSubmitted(true);

            // Update local state to reflect submission
            setRequests(prev => prev.map(r => {
                if (r.id === selectedRequest.id) {
                    return {
                        ...r,
                        quotations: updatedQuotations
                    };
                }
                return r;
            }));

            // Reset after delay or let user navigate back
            setTimeout(() => {
                setSelectedRequest(null);
                setSubmitted(false);
                setAmount("");
                setEta("");
                setValidityDays("");
                setFiles([]);
                setComments("");
            }, 2000);

        } catch (error) {
            console.error("Error submitting quotation:", error);
        }
    }

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50">Loading...</div>;
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Top Bar */}
            <header className="flex items-center justify-between px-4 py-3 bg-white shadow-sm md:px-6 sticky top-0 z-10">
                <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-slate-900 flex items-center justify-center text-white text-xs font-bold">
                        G
                    </div>
                    <div className="font-semibold text-slate-800 text-sm md:text-base">Garage Portal</div>
                </div>
                <div className="text-xs text-slate-600 md:text-sm">
                    Logged in as <span className="font-medium">Autopro Service Centre</span>
                </div>
            </header>

            {/* Content */}
            <main className="max-w-6xl mx-auto px-4 py-6">
                {!selectedRequest ? (
                    // List View - Quotations
                    <div className="space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <h2 className="text-lg font-semibold text-slate-800">Quotations</h2>

                            {/* Filters */}
                            <div className="flex flex-col sm:flex-row gap-2 text-sm">
                                <input
                                    type="text"
                                    placeholder="Search WO or Description..."
                                    value={searchFilter}
                                    onChange={(e) => setSearchFilter(e.target.value)}
                                    className="px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 w-full sm:w-48"
                                />
                                <input
                                    type="date"
                                    value={dateFilter}
                                    onChange={(e) => setDateFilter(e.target.value)}
                                    className="px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900"
                                />
                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value as 'All' | 'Pending for Submission' | 'Quote Submitted')}
                                    className="px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
                                >
                                    <option value="All">All Status</option>
                                    <option value="Pending for Submission">Pending Submission</option>
                                    <option value="Quote Submitted">Quote Submitted</option>
                                </select>
                            </div>
                        </div>

                        {filteredRequests.length === 0 ? (
                            <div className="text-center py-12 bg-white rounded-2xl shadow-sm">
                                <p className="text-slate-500">No requests found matching your filters.</p>
                            </div>
                        ) : (
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {filteredRequests.map(req => {
                                    const isSubmitted = req.quotations?.some(q => q.garageId === currentGarageId);

                                    return (
                                        <div
                                            key={req.id}
                                            onClick={() => setSelectedRequest(req)}
                                            className="bg-white rounded-xl shadow-sm p-5 cursor-pointer hover:shadow-md transition-shadow border border-transparent hover:border-blue-500/30 group"
                                        >
                                            <div className="flex justify-between items-start mb-3">
                                                <span className="font-mono text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded">
                                                    WO-{new Date().getFullYear()}-{req.id.toUpperCase()}
                                                </span>
                                                {isSubmitted ? (
                                                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                                        Quote Submitted
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                                        Pending Submission
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="font-semibold text-slate-800 mb-1 group-hover:text-blue-600 transition-colors line-clamp-1">
                                                {req.description}
                                            </h3>
                                            <div className="text-xs text-slate-500 mb-4">
                                                Requested: {new Date(req.requestDate).toLocaleDateString()}
                                            </div>
                                            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
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
                                className="flex items-center text-sm text-slate-500 hover:text-slate-800 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-1">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                                </svg>
                                Back to List
                            </button>
                        </div>

                        {/* Left: WO Summary */}
                        <section className="bg-white rounded-2xl shadow-sm p-4 md:p-5 space-y-3 h-fit">
                            <div className="flex items-center justify-between">
                                <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">
                                    Work Order Summary
                                </h2>
                                <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                                    Under Estimation
                                </span>
                            </div>
                            <div className="space-y-2 text-sm text-slate-600">
                                <div><span className="font-medium text-slate-900">WO Number:</span> <span className="text-slate-700">{selectedRequest.workOrderNo || `WO-${new Date().getMonth() + 1}-${selectedRequest.id}`}</span></div>
                                {selectedVehicle && (
                                    <>
                                        <div><span className="font-medium text-slate-900">Vehicle ID:</span> <span className="text-slate-700">{selectedVehicle.id}</span></div>
                                        <div><span className="font-medium text-slate-900">Vehicle:</span> <span className="text-slate-700">{selectedVehicle.licensePlate} – {selectedVehicle.make} {selectedVehicle.model} {selectedVehicle.year}</span></div>
                                        <div><span className="font-medium text-slate-900">Type:</span> <span className="text-slate-700">{selectedVehicle.type}</span></div>
                                        <div><span className="font-medium text-slate-900">Odometer:</span> <span className="text-slate-700">{(selectedRequest.odometer || selectedVehicle.currentMileage).toLocaleString()} km</span></div>
                                    </>
                                )}
                                {selectedRequest.maintenanceType && (
                                    <div><span className="font-medium text-slate-900">Maintenance Type:</span> <span className="text-slate-700">{selectedRequest.maintenanceType}</span></div>
                                )}
                                {selectedRequest.maintenanceJobs && selectedRequest.maintenanceJobs.length > 0 && (
                                    <div>
                                        <span className="font-medium text-slate-900">Jobs Selected:</span>
                                        <ul className="list-disc list-inside text-xs text-slate-600 mt-1 ml-1">
                                            {selectedRequest.maintenanceJobs.map((job, idx) => (
                                                <li key={idx}>{job}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                <div><span className="font-medium text-slate-900">Reported Issue:</span></div>
                                <p className="text-slate-700 text-xs bg-slate-50 rounded-lg p-2 border border-slate-100">
                                    {selectedRequest.description}
                                </p>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                        <span className="font-medium text-slate-900">Priority:</span> <span className="text-slate-700">{selectedRequest.priority || 'Normal'}</span>
                                    </div>
                                    <div>
                                        <span className="font-medium text-slate-900">Required By:</span> <span className="text-slate-700">{selectedRequest.expectedEndDate ? new Date(selectedRequest.expectedEndDate).toLocaleDateString() : 'N/A'}</span>
                                    </div>
                                    <div className="col-span-2">
                                        <span className="font-medium text-slate-900">Location:</span> <span className="text-slate-700">{selectedVehicle?.location || 'Abu Dhabi – Musaffah Yard'}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="pt-2 border-t border-slate-100">
                                <div className="text-xs font-medium text-slate-700 mb-1">
                                    Attachments
                                </div>
                                {selectedRequest.attachments && selectedRequest.attachments.length > 0 ? (
                                    <div className="flex gap-2 flex-wrap">
                                        {selectedRequest.attachments.map((att, idx) => (
                                            <a
                                                key={att.id || idx}
                                                href={att.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="h-16 w-20 rounded-lg bg-slate-100 border border-slate-200 text-[10px] flex flex-col items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors p-1"
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
                        <section className="bg-white rounded-2xl shadow-sm p-4 md:p-5">
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">
                                    Submit Your Quotation
                                </h2>
                                {submitted && (
                                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                                        Quotation Submitted
                                    </span>
                                )}
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-4 text-sm">
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">
                                        Total Quotation Amount (AED) *
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        disabled={submitted}
                                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                                        placeholder="e.g. 2350.00"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">
                                        Estimated Completion Date *
                                    </label>
                                    <input
                                        type="date"
                                        value={eta}
                                        onChange={(e) => setEta(e.target.value)}
                                        disabled={submitted}
                                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">
                                        Quotation Attachment (PDF / Image) *
                                    </label>
                                    <input
                                        type="file"
                                        multiple={false}
                                        accept=".pdf,.jpg,.jpeg,.png"
                                        disabled={submitted}
                                        onChange={handleFileChange}
                                        className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-slate-800"
                                    />
                                    {files.length > 0 && (
                                        <p className="mt-1 text-[11px] text-slate-500">
                                            Selected: {files[0].name}
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">
                                        Quotation Validity (Days) *
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={validityDays}
                                        onChange={(e) => setValidityDays(e.target.value)}
                                        disabled={submitted}
                                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                                        placeholder="e.g. 30"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">
                                        Comments (Optional)
                                    </label>
                                    <textarea
                                        rows={3}
                                        value={comments}
                                        onChange={(e) => setComments(e.target.value)}
                                        disabled={submitted}
                                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
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
                                                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                            >
                                                Save as Draft
                                            </button>
                                        )}
                                        <button
                                            type="submit"
                                            disabled={!isValid}
                                            className={`rounded-lg px-4 py-1.5 text-xs font-medium text-white transition-colors ${isValid
                                                ? "bg-slate-900 hover:bg-slate-800"
                                                : "bg-slate-400 cursor-not-allowed"
                                                }`}
                                        >
                                            {submitted ? "Submitted" : "Submit Quotation"}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </section>
                    </div>
                )}
            </main>

            <footer className="py-3 text-center text-[11px] text-slate-400">
                Powered by TRIPXL.AI
            </footer>
        </div>
    );
}
