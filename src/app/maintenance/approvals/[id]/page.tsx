'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
    MaintenanceRequest,
    Vehicle,
    Garage,
    MaintenanceStatus,
    MaintenancePriority,
    MaintenanceType,
    Attachment,
    AttachmentType,
    Quotation,
    QuotationStatus
} from '@/types/maintenance';
import {
    getMaintenanceRequests,
    getVehicles,
    getGarages,
    updateMaintenanceRequest
} from '@/services/mockData';
import StatusBadge from '@/components/ui/StatusBadge';
import { getNextStatuses } from '@/services/workflowStateMachine';

// Comprehensive Maintenance Jobs Database
const MAINTENANCE_JOBS_DATABASE = {
    [MaintenanceType.PREVENTIVE]: [
        'Oil Change',
        'Oil Filter Replacement',
        'Air Filter Replacement',
        'Cabin Filter Replacement',
        'Fuel Filter Replacement',
        'Tire Rotation',
        'Tire Pressure Check',
        'Brake Inspection',
        'Brake Pad Replacement',
        'Brake Fluid Change',
        'Coolant Flush',
        'Transmission Fluid Change',
        'Power Steering Fluid Check',
        'Battery Check',
        'Spark Plug Replacement',
        'Timing Belt Replacement',
        'Serpentine Belt Replacement',
        'Wiper Blade Replacement',
        'Headlight Alignment',
        'Wheel Alignment',
        'Wheel Balancing'
    ],
    [MaintenanceType.CORRECTIVE]: [
        'Engine Repair',
        'Engine Overhaul',
        'Cylinder Head Repair',
        'Piston Replacement',
        'Valve Adjustment',
        'Timing Chain Replacement',
        'Transmission Repair',
        'Transmission Rebuild',
        'Clutch Replacement',
        'Gearbox Repair',
        'Differential Repair',
        'Suspension Repair',
        'Shock Absorber Replacement',
        'Strut Replacement',
        'Control Arm Replacement',
        'Ball Joint Replacement',
        'Tie Rod Replacement',
        'Brake System Repair',
        'Brake Caliper Replacement',
        'Brake Rotor Replacement',
        'ABS System Repair',
        'Electrical System Repair',
        'Alternator Replacement',
        'Starter Motor Replacement',
        'Battery Replacement',
        'Wiring Harness Repair',
        'Fuel Pump Replacement',
        'Fuel Injector Cleaning',
        'Radiator Repair',
        'Water Pump Replacement',
        'Thermostat Replacement',
        'AC Compressor Replacement',
        'AC Condenser Replacement',
        'Heater Core Replacement',
        'Exhaust System Repair',
        'Muffler Replacement',
        'Catalytic Converter Replacement',
        'Body Work',
        'Dent Removal',
        'Paint Touch-up',
        'Bumper Replacement',
        'Windshield Replacement',
        'Door Panel Replacement',
        'Upholstery Repair'
    ],
    [MaintenanceType.EMERGENCY]: [
        'Breakdown Assistance',
        'Towing Service',
        'Flat Tire Repair',
        'Tire Replacement',
        'Battery Jump Start',
        'Battery Replacement',
        'Fuel Delivery',
        'Lockout Service',
        'Accident Recovery',
        'Engine Overheating',
        'Coolant Leak Repair',
        'Oil Leak Repair',
        'Brake Failure Repair',
        'Steering Failure Repair',
        'Electrical Failure Repair'
    ],
    [MaintenanceType.INSPECTION]: [
        'Annual Inspection',
        'Pre-Purchase Inspection',
        'Safety Inspection',
        'Emissions Test',
        'Brake System Inspection',
        'Suspension Inspection',
        'Tire Inspection',
        'Exhaust System Inspection',
        'Electrical System Inspection',
        'Engine Diagnostic',
        'Transmission Diagnostic',
        'AC System Inspection',
        'Fluid Level Check',
        'Belt and Hose Inspection'
    ]
};

export default function ApprovalDetailsPage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id as string;

    const [request, setRequest] = useState<MaintenanceRequest | null>(null);
    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [garages, setGarages] = useState<Garage[]>([]);
    const [loading, setLoading] = useState(true);

    // Edit Mode State (For Maintenance View)
    const [isEditMode, setIsEditMode] = useState(false);
    const [editedFields, setEditedFields] = useState<Partial<MaintenanceRequest>>({});
    const [availableJobs, setAvailableJobs] = useState<string[]>([]);
    const [jobSearchQuery, setJobSearchQuery] = useState('');

    // RFQ State
    const [candidateGarageIds, setCandidateGarageIds] = useState<string[]>([]);

    // Attachment State
    const [selectedAttachmentType, setSelectedAttachmentType] = useState<AttachmentType>(AttachmentType.INVOICE);
    const [showAttachmentModal, setShowAttachmentModal] = useState(false);

    // View Mode State - Default to APPROVER for this page
    const [approvalViewMode, setApprovalViewMode] = useState<'MAINTENANCE' | 'APPROVER'>('APPROVER');

    useEffect(() => {
        const fetchData = async () => {
            const [allRequests, allVehicles, allGarages] = await Promise.all([
                getMaintenanceRequests(),
                getVehicles(),
                getGarages()
            ]);

            const foundRequest = allRequests.find(r => r.id === id);
            if (foundRequest) {
                setRequest(foundRequest);
                const foundVehicle = allVehicles.find(v => v.id === foundRequest.vehicleId);
                setVehicle(foundVehicle || null);

                // Initialize candidate garages if they exist
                if (foundRequest.candidateGarageIds) {
                    setCandidateGarageIds(foundRequest.candidateGarageIds);
                }

                // Initialize quotations if they exist
                if (foundRequest.quotations) {
                    const initialQuotations: { [garageId: string]: { amount: number, attachmentUrl?: string, attachmentName?: string, estimatedDate?: string } } = {};
                    foundRequest.quotations.forEach(q => {
                        initialQuotations[q.garageId] = {
                            amount: q.totalCost,
                            attachmentUrl: q.attachments?.[0]?.url,
                            attachmentName: q.attachments?.[0]?.fileName,
                            estimatedDate: q.estimatedCompletionDate
                        };
                    });
                    setQuotations(initialQuotations);
                }
            }
            setGarages(allGarages);
            setLoading(false);
        };
        fetchData();
    }, [id]);

    const handleStatusUpdate = async (newStatus: MaintenanceStatus) => {
        if (!request) return;
        try {
            await updateMaintenanceRequest(request.id, { status: newStatus });
            setRequest({ ...request, status: newStatus });
            alert(`Status updated to ${newStatus}`);
        } catch (error) {
            console.error('Failed to update status', error);
            alert('Failed to update status');
        }
    };

    // ... (Maintenance View Handlers) ...
    const handleEditMode = () => {
        if (!request) return;
        setIsEditMode(true);
        setEditedFields({
            odometer: request.odometer,
            maintenanceType: request.maintenanceType,
            priority: request.priority,
            description: request.description,
            maintenanceJobs: request.maintenanceJobs,
            expectedEndDate: request.expectedEndDate
        });
        // Initialize available jobs if maintenance type is set
        if (request.maintenanceType) {
            const jobs = MAINTENANCE_JOBS_DATABASE[request.maintenanceType as MaintenanceType] || [];
            setAvailableJobs(jobs);
        }
    };

    const handleSaveChanges = async () => {
        if (!request) return;
        try {
            await updateMaintenanceRequest(request.id, editedFields);
            setRequest({ ...request, ...editedFields });
            setIsEditMode(false);
            setEditedFields({});
            alert('Changes saved successfully');
        } catch (error) {
            console.error('Failed to save changes', error);
            alert('Failed to save changes');
        }
    };

    const handleCancelEdit = () => {
        setIsEditMode(false);
        setEditedFields({});
    };

    const handleFieldChange = (field: keyof MaintenanceRequest, value: any) => {
        setEditedFields(prev => {
            const updated = { ...prev, [field]: value };
            // Auto-calculate total cost when parts, labor, or other costs change
            if (field === 'actualPartsCost' || field === 'actualLaborCost' || field === 'actualOtherCost') {
                const partsCost = field === 'actualPartsCost' ? value : (updated.actualPartsCost || request?.actualPartsCost || 0);
                const laborCost = field === 'actualLaborCost' ? value : (updated.actualLaborCost || request?.actualLaborCost || 0);
                const otherCost = field === 'actualOtherCost' ? value : (updated.actualOtherCost || request?.actualOtherCost || 0);
                updated.actualCost = partsCost + laborCost + otherCost;
            }
            return updated;
        });
        // Auto-populate jobs when maintenance type changes
        if (field === 'maintenanceType' && value) {
            const jobs = MAINTENANCE_JOBS_DATABASE[value as MaintenanceType] || [];
            setAvailableJobs(jobs);
            setEditedFields(prev => ({ ...prev, maintenanceJobs: [] }));
        }
    };

    const handleJobToggle = (job: string) => {
        const currentJobs = editedFields.maintenanceJobs || [];
        const newJobs = currentJobs.includes(job)
            ? currentJobs.filter(j => j !== job)
            : [...currentJobs, job];
        setEditedFields(prev => ({ ...prev, maintenanceJobs: newJobs }));
    };

    const getFilteredJobs = () => {
        if (!jobSearchQuery) return availableJobs;
        return availableJobs.filter(job =>
            job.toLowerCase().includes(jobSearchQuery.toLowerCase())
        );
    };

    const handleGarageToggle = (garageId: string) => {
        setCandidateGarageIds(prev => {
            const ids = prev.includes(garageId)
                ? prev.filter(id => id !== garageId)
                : [...prev, garageId];
            return ids;
        });
    };

    // Quotation Management State
    const [quotations, setQuotations] = useState<{ [garageId: string]: { amount: number, attachmentUrl?: string, attachmentName?: string, estimatedDate?: string } }>({});

    const handleQuotationChange = (garageId: string, field: 'amount' | 'attachmentUrl' | 'attachmentName' | 'estimatedDate', value: any) => {
        setQuotations(prev => ({
            ...prev,
            [garageId]: {
                ...prev[garageId],
                [field]: value
            }
        }));
    };

    const handleSaveQuotation = async (garageId: string) => {
        // ... (Keep existing logic if needed for read-only view or edits)
    };

    const handleSendRFQ = async () => {
        // ... (Keep existing logic)
    };

    const handleSendForApproval = async () => {
        // ... (Keep existing logic)
    };

    const handleAddAttachment = () => {
        setShowAttachmentModal(true);
    };

    const handleFileSelect = () => {
        // ... (Keep existing logic)
    };

    const handleDeleteAttachment = async (attId: string) => {
        // ... (Keep existing logic)
    };


    // Approval Workflow State
    const [selectedGarageForApproval, setSelectedGarageForApproval] = useState<string | null>(null);
    const [rejectionReason, setRejectionReason] = useState('');
    const [showRejectModal, setShowRejectModal] = useState(false);

    const handleApproveEstimate = async () => {
        if (!selectedGarageForApproval) {
            alert('Please select a garage to approve.');
            return;
        }
        if (!request) return;

        const selectedQuote = quotations[selectedGarageForApproval];
        if (!selectedQuote) return;

        try {
            await updateMaintenanceRequest(request.id, {
                status: MaintenanceStatus.UNDER_MAINTENANCE,
                garageId: selectedGarageForApproval,
                selectedQuotationId: selectedGarageForApproval,
                actualPartsCost: selectedQuote.amount,
                actualLaborCost: 0,
                actualOtherCost: 0,
                actualCost: selectedQuote.amount
            });
            setRequest({
                ...request,
                status: MaintenanceStatus.UNDER_MAINTENANCE,
                garageId: selectedGarageForApproval,
                selectedQuotationId: selectedGarageForApproval
            });

            console.group('Approval Notifications');
            const garageName = garages.find(g => g.id === selectedGarageForApproval)?.name || 'Garage';
            console.log(`[EMAIL/WHATSAPP] To: ${garageName}`);
            console.log(`Subject: Work Order Approved - ${request.id.toUpperCase()}`);
            console.log(`Message: Please proceed with the work order. Vehicle: ${vehicle?.licensePlate}. Approved Amount: AED ${selectedQuote.amount}`);
            console.log(`[NOTIFICATION] To: Operations & Maintenance Team`);
            console.log(`Message: Estimate approved for ${request.id.toUpperCase()}. Work can start.`);
            console.groupEnd();

            alert('Estimate approved! Work Order is now Under Maintenance.\nNotifications sent to Garage and Team.');
            router.push('/maintenance/approvals'); // Redirect back to approvals list
        } catch (error) {
            console.error('Failed to approve estimate:', error);
            alert('Failed to approve estimate.');
        }
    };

    const handleRejectEstimate = async () => {
        if (!request) return;
        try {
            await updateMaintenanceRequest(request.id, {
                status: MaintenanceStatus.UNDER_ESTIMATION
            });
            setRequest({ ...request, status: MaintenanceStatus.UNDER_ESTIMATION });
            setShowRejectModal(false);
            setRejectionReason('');
            alert('Estimate rejected. Request returned to Under Estimation.');
            router.push('/maintenance/approvals'); // Redirect back to approvals list
        } catch (error) {
            console.error('Failed to reject estimate:', error);
            alert('Failed to reject estimate.');
        }
    };

    // Calculate lowest quote for delta comparison
    const getLowestQuoteAmount = () => {
        const amounts = candidateGarageIds
            .map(id => quotations[id]?.amount)
            .filter(a => a !== undefined && a > 0);
        return amounts.length > 0 ? Math.min(...amounts) : 0;
    };

    const lowestAmount = getLowestQuoteAmount();

    if (loading) return <div className="p-8 text-center text-slate-500">Loading details...</div>;
    if (!request) return <div className="p-8 text-center text-slate-500">Request not found.</div>;

    // Get next valid statuses from workflow
    const nextStatuses = getNextStatuses(request.status);

    return (
        <div className="mx-auto max-w-5xl pb-12 space-y-8">
            {/* Header with Toggle */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Link href="/maintenance/approvals" className="text-slate-400 hover:text-slate-600">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                        </svg>
                    </Link>
                    <h1 className="text-2xl font-bold text-slate-900">Estimate Approval</h1>
                </div>

                <div className="flex items-center gap-4">
                    {/* View Mode Toggle - ALWAYS VISIBLE ON THIS PAGE */}
                    <div className="bg-slate-100 p-1 rounded-lg flex items-center">
                        <button
                            onClick={() => setApprovalViewMode('MAINTENANCE')}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${approvalViewMode === 'MAINTENANCE'
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            Maintenance Team
                        </button>
                        <button
                            onClick={() => setApprovalViewMode('APPROVER')}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${approvalViewMode === 'APPROVER'
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            Approving Authority
                        </button>
                    </div>
                    <StatusBadge status={request.status} />
                </div>
            </div>

            {/* CONDITIONAL RENDERING BASED ON MODE */}
            {approvalViewMode === 'APPROVER' ? (
                /* APPROVER VIEW */
                <div className="space-y-8">
                    {/* Summary Card */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                            <div>
                                <label className="block text-xs font-medium text-slate-500 uppercase">Vehicle</label>
                                <p className="text-lg font-semibold text-slate-900">{vehicle?.licensePlate}</p>
                                <p className="text-sm text-slate-500">{vehicle?.make} {vehicle?.model} ({vehicle?.year})</p>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 uppercase">Work Order</label>
                                <p className="text-lg font-semibold text-slate-900">#{request.id.toUpperCase()}</p>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 uppercase">Reported Issue</label>
                                <p className="text-lg font-semibold text-slate-900 truncate" title={request.description}>{request.description}</p>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 uppercase">Odometer</label>
                                <p className="text-lg font-semibold text-slate-900">{request.odometer?.toLocaleString()} km</p>
                            </div>
                        </div>
                    </div>

                    {/* Comparison Grid */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
                            <h3 className="font-semibold text-slate-900">Quotation Comparison</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 text-slate-500">
                                    <tr>
                                        <th className="px-6 py-3 font-medium">Select</th>
                                        <th className="px-6 py-3 font-medium">Garage</th>
                                        <th className="px-6 py-3 font-medium">Total Amount (AED)</th>
                                        <th className="px-6 py-3 font-medium">Difference</th>
                                        <th className="px-6 py-3 font-medium">ETA</th>
                                        <th className="px-6 py-3 font-medium">Attachment</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {candidateGarageIds.map(garageId => {
                                        const garage = garages.find(g => g.id === garageId);
                                        const quote = quotations[garageId];
                                        const amount = quote?.amount || 0;
                                        const delta = lowestAmount > 0 && amount > 0 ? amount - lowestAmount : 0;
                                        const isLowest = amount > 0 && amount === lowestAmount;

                                        return (
                                            <tr key={garageId} className={`hover:bg-slate-50 ${selectedGarageForApproval === garageId ? 'bg-blue-50' : ''}`}>
                                                <td className="px-6 py-4">
                                                    <input
                                                        type="radio"
                                                        name="garageSelection"
                                                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300"
                                                        checked={selectedGarageForApproval === garageId}
                                                        onChange={() => setSelectedGarageForApproval(garageId)}
                                                        disabled={!amount}
                                                    />
                                                </td>
                                                <td className="px-6 py-4 font-medium text-slate-900">{garage?.name}</td>
                                                <td className="px-6 py-4 text-slate-700 font-semibold">
                                                    {amount > 0 ? amount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                                                </td>
                                                <td className="px-6 py-4">
                                                    {amount > 0 ? (
                                                        isLowest ? (
                                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                                                Best Price
                                                            </span>
                                                        ) : (
                                                            <span className="text-red-600 font-medium">
                                                                +{delta.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                            </span>
                                                        )
                                                    ) : '-'}
                                                </td>
                                                <td className="px-6 py-4 text-slate-600">
                                                    {quote?.estimatedDate ? new Date(quote.estimatedDate).toLocaleDateString() : '-'}
                                                </td>
                                                <td className="px-6 py-4">
                                                    {quote?.attachmentUrl ? (
                                                        <a
                                                            href={quote.attachmentUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                                                            </svg>
                                                            View
                                                        </a>
                                                    ) : (
                                                        <span className="text-slate-400 text-xs">No file</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-4 pt-4 border-t border-slate-200">
                        <button
                            onClick={() => setShowRejectModal(true)}
                            className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium transition-colors"
                        >
                            Reject / Return for Re-Estimation
                        </button>
                        <button
                            onClick={handleApproveEstimate}
                            disabled={!selectedGarageForApproval}
                            className={`px-6 py-2 rounded-lg font-medium text-white shadow-sm transition-all ${selectedGarageForApproval
                                ? 'bg-green-600 hover:bg-green-700 hover:shadow-md'
                                : 'bg-slate-300 cursor-not-allowed'
                                }`}
                        >
                            Approve Estimate
                        </button>
                    </div>
                </div>
            ) : (
                /* MAINTENANCE TEAM VIEW (Read-Only or Standard View) */
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Info */}
                    <div className="lg:col-span-2 space-y-8">
                        {/* Request Details */}
                        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold text-slate-900">Request Details</h3>
                                {/* Edit buttons removed for this view in Approval context to keep it simple, or can be added back if needed */}
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 uppercase">Vehicle</label>
                                    <div className="mt-1 flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                                            </svg>
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-slate-900">{vehicle?.make} {vehicle?.model}</p>
                                            <p className="text-xs text-slate-500">{vehicle?.licensePlate} • {vehicle?.year}</p>
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 uppercase">Driver</label>
                                    <div className="mt-1 flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-slate-900">{request.driverId}</p>
                                            <p className="text-xs text-slate-500">ID: {request.driverId}</p>
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 uppercase">Odometer</label>
                                    <p className="mt-1 text-sm font-medium text-slate-900">{request.odometer?.toLocaleString()} km</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 uppercase">Priority</label>
                                    <p className="mt-1 text-sm font-medium text-slate-900 capitalize">{request.priority}</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 uppercase">Maintenance Type</label>
                                    <p className="mt-1 text-sm font-medium text-slate-900 capitalize">{request.maintenanceType}</p>
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-slate-500 uppercase">Description</label>
                                    <p className="mt-1 text-sm text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100">
                                        {request.description}
                                    </p>
                                </div>
                                {/* Maintenance Jobs Section */}
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-slate-500 uppercase">
                                        Maintenance Jobs
                                    </label>
                                    {request.maintenanceJobs && request.maintenanceJobs.length > 0 ? (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {request.maintenanceJobs.map(job => (
                                                <span key={job} className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                                                    {job}
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="mt-2 text-sm text-slate-500">No jobs specified</p>
                                    )}
                                </div>
                                {/* Expected Completion Date */}
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-slate-500 uppercase">Expected Completion Date</label>
                                    <p className="mt-1 text-sm font-medium text-slate-900">
                                        {request.expectedEndDate
                                            ? new Date(request.expectedEndDate).toLocaleDateString('en-GB', {
                                                day: '2-digit',
                                                month: '2-digit',
                                                year: 'numeric'
                                            })
                                            : 'Not set'
                                        }
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* Sidebar Info */}
                    <div className="space-y-8">
                        {/* Timeline */}
                        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                            <h3 className="text-sm font-bold text-slate-900 uppercase mb-4">Timeline</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs text-slate-500">Requested Date</label>
                                    <p className="text-sm font-medium text-slate-900">{new Date(request.requestDate).toLocaleDateString()}</p>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500">Expected Completion</label>
                                    <p className="text-sm font-medium text-slate-900">{request.expectedEndDate ? new Date(request.expectedEndDate).toLocaleDateString() : 'Not set'}</p>
                                </div>
                            </div>
                        </div>
                        {/* Attachments */}
                        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-sm font-bold text-slate-900 uppercase">Attachments</h3>
                            </div>
                            {request.attachments && request.attachments.length > 0 ? (
                                <ul className="space-y-2">
                                    {request.attachments.map(att => (
                                        <li key={att.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-slate-400 flex-shrink-0">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                                                </svg>
                                                <div className="flex-1 min-w-0">
                                                    <a href={att.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-blue-600 hover:underline truncate block">
                                                        {att.fileName}
                                                    </a>
                                                    <p className="text-xs text-slate-500">{att.type}</p>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-xs text-slate-500 italic text-center py-4">No attachments yet</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Reject Modal */}
            {showRejectModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
                        <h3 className="text-lg font-bold text-slate-900">Reject Estimate</h3>
                        <p className="text-sm text-slate-600">
                            Are you sure you want to reject all estimates? This will return the request to the "Under Estimation" stage.
                        </p>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase mb-1">Reason (Optional)</label>
                            <textarea
                                className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                                rows={3}
                                placeholder="Enter reason for rejection..."
                                value={rejectionReason}
                                onChange={(e) => setRejectionReason(e.target.value)}
                            />
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                onClick={() => setShowRejectModal(false)}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleRejectEstimate}
                                className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg font-medium"
                            >
                                Confirm Rejection
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
