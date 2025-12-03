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
    AttachmentType
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

export default function RequestDetailsPage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id as string;

    const [request, setRequest] = useState<MaintenanceRequest | null>(null);
    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [garages, setGarages] = useState<Garage[]>([]);
    const [loading, setLoading] = useState(true);

    // Edit Mode State
    const [isEditMode, setIsEditMode] = useState(false);
    const [editedFields, setEditedFields] = useState<Partial<MaintenanceRequest>>({});
    const [availableJobs, setAvailableJobs] = useState<string[]>([]);
    const [jobSearchQuery, setJobSearchQuery] = useState('');

    // RFQ State
    const [candidateGarageIds, setCandidateGarageIds] = useState<string[]>([]);

    // Attachment State
    const [selectedAttachmentType, setSelectedAttachmentType] = useState<AttachmentType>(AttachmentType.INVOICE);
    const [showAttachmentModal, setShowAttachmentModal] = useState(false);

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

    const handleEditMode = () => {
        if (!request) return;
        setIsEditMode(true);
        setEditedFields({
            odometer: request.odometer,
            maintenanceType: request.maintenanceType,
            priority: request.priority,
            description: request.description,
            maintenanceJobs: request.maintenanceJobs,
            expectedCompletionDate: request.expectedCompletionDate
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
        setEditedFields(prev => ({ ...prev, [field]: value }));

        // Auto-populate jobs when maintenance type changes
        if (field === 'maintenanceType' && value) {
            const jobs = MAINTENANCE_JOBS_DATABASE[value as MaintenanceType] || [];
            setAvailableJobs(jobs);
            // Clear previously selected jobs when type changes
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

    const generateRFQTemplate = (garage: Garage) => {
        return `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; border: 1px solid #e5e7eb; padding: 20px;">
                <h2 style="color: #2563eb;">Request for Quotation (RFQ) - Ref: #${request?.id.toUpperCase()}</h2>
                <p><strong>To:</strong> ${garage.name} (${garage.email})</p>
                <hr />
                <h3>Vehicle Details</h3>
                <ul>
                    <li><strong>Vehicle:</strong> ${vehicle?.make} ${vehicle?.model} (${vehicle?.year})</li>
                    <li><strong>License Plate:</strong> ${vehicle?.licensePlate}</li>
                    <li><strong>Current Odometer:</strong> ${request?.odometer || 'N/A'} km</li>
                </ul>
                <h3>Maintenance Requirements</h3>
                <ul>
                    <li><strong>Type:</strong> ${request?.maintenanceType}</li>
                    <li><strong>Priority:</strong> ${request?.priority}</li>
                    <li><strong>Requested Jobs:</strong> ${request?.maintenanceJobs?.join(', ') || 'N/A'}</li>
                </ul>
                <h3>Remarks / Description</h3>
                <p style="background-color: #f9fafb; padding: 10px; border-radius: 4px;">${request?.description || 'No additional remarks.'}</p>
                <hr />
                <p>Please provide your quotation for the above services by <strong>${request?.expectedEndDate || 'ASAP'}</strong>.</p>
            </div>
        `;
    };

    const handleSendRFQ = async () => {
        if (candidateGarageIds.length === 0) {
            alert('Please select at least one garage to send RFQ.');
            return;
        }
        if (!request) return;

        const selectedGarages = garages.filter(g => candidateGarageIds.includes(g.id));

        console.group('Sending RFQs...');
        selectedGarages.forEach(garage => {
            const emailContent = generateRFQTemplate(garage);
            console.log(`Sending RFQ to ${garage.name}:`, emailContent);
        });
        console.groupEnd();

        // Save the selected candidates to the request
        await updateMaintenanceRequest(request.id, { candidateGarageIds });

        alert(`RFQ sent successfully to ${selectedGarages.length} garage(s)!\nCheck console for email content.`);
    };

    const handleAddAttachment = () => {
        setShowAttachmentModal(true);
    };

    const handleFileSelect = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file && request) {
                const newAttachment: Attachment = {
                    id: `att${Date.now()}`,
                    type: selectedAttachmentType,
                    fileName: file.name,
                    url: URL.createObjectURL(file),
                    uploadedAt: new Date().toISOString(),
                };
                const updatedAttachments = [...(request.attachments || []), newAttachment];
                await updateMaintenanceRequest(request.id, { attachments: updatedAttachments });
                setRequest({ ...request, attachments: updatedAttachments });
                setShowAttachmentModal(false);
            }
        };
        input.click();
    };

    const handleDeleteAttachment = async (attId: string) => {
        if (!request) return;
        const updatedAttachments = request.attachments?.filter(att => att.id !== attId) || [];
        await updateMaintenanceRequest(request.id, { attachments: updatedAttachments });
        setRequest({ ...request, attachments: updatedAttachments });
    };

    if (loading) return <div className="p-8 text-center text-slate-500">Loading details...</div>;
    if (!request) return <div className="p-8 text-center text-slate-500">Request not found.</div>;

    // Get next valid statuses from workflow
    const nextStatuses = getNextStatuses(request.status);

    return (
        <div className="mx-auto max-w-5xl pb-12 space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <Link href="/maintenance/requests" className="text-slate-400 hover:text-slate-600">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                            </svg>
                        </Link>
                        <h1 className="text-2xl font-bold text-slate-900">Request #{request.id.toUpperCase()}</h1>
                        <StatusBadge status={request.status} />
                    </div>
                    <p className="text-slate-500 ml-8">Created on {new Date(request.requestDate).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-3">
                    <select
                        className="rounded-lg border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white text-slate-900"
                        value={request.status}
                        onChange={(e) => handleStatusUpdate(e.target.value as MaintenanceStatus)}
                    >
                        {/* Current status */}
                        <option key={request.status} value={request.status} className="text-slate-900">
                            {request.status} (Current)
                        </option>
                        {/* Next valid statuses only */}
                        {nextStatuses.map((status) => (
                            <option key={status} value={status} className="text-slate-900">
                                {status}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Main Info */}
                <div className="lg:col-span-2 space-y-8">
                    {/* Vehicle & Maintenance Info */}
                    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-900">Request Details</h3>
                            <div className="flex gap-2">
                                {!isEditMode ? (
                                    <button
                                        onClick={handleEditMode}
                                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                        </svg>
                                        Edit Details
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            onClick={handleCancelEdit}
                                            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleSaveChanges}
                                            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                                        >
                                            Save Changes
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <label className="block text-xs font-medium text-slate-500 uppercase">Vehicle</label>
                                <p className="mt-1 text-sm font-medium text-slate-900">{vehicle?.make} {vehicle?.model}</p>
                                <p className="text-xs text-slate-500">{vehicle?.licensePlate}</p>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 uppercase">Odometer</label>
                                {isEditMode ? (
                                    <input
                                        type="number"
                                        value={editedFields.odometer || ''}
                                        onChange={(e) => handleFieldChange('odometer', parseInt(e.target.value) || 0)}
                                        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        placeholder="Enter odometer reading"
                                    />
                                ) : (
                                    <p className="mt-1 text-sm font-medium text-slate-900">{request.odometer ? `${request.odometer} km` : 'N/A'}</p>
                                )}
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 uppercase">Maintenance Type</label>
                                {isEditMode ? (
                                    <select
                                        value={editedFields.maintenanceType || ''}
                                        onChange={(e) => handleFieldChange('maintenanceType', e.target.value)}
                                        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    >
                                        <option value="">Select type</option>
                                        {Object.values(MaintenanceType).map((type) => (
                                            <option key={type} value={type}>{type}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <p className="mt-1 text-sm font-medium text-slate-900">{request.maintenanceType || 'N/A'}</p>
                                )}
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 uppercase">Priority</label>
                                {isEditMode ? (
                                    <select
                                        value={editedFields.priority || ''}
                                        onChange={(e) => handleFieldChange('priority', e.target.value as MaintenancePriority)}
                                        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    >
                                        {Object.values(MaintenancePriority).map((priority) => (
                                            <option key={priority} value={priority}>{priority}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${request.priority === MaintenancePriority.CRITICAL ? 'bg-red-100 text-red-700' :
                                        request.priority === MaintenancePriority.HIGH ? 'bg-orange-100 text-orange-700' :
                                            request.priority === MaintenancePriority.MEDIUM ? 'bg-yellow-100 text-yellow-700' :
                                                'bg-green-100 text-green-700'
                                        }`}>
                                        {request.priority || 'Low'}
                                    </span>
                                )}
                            </div>
                            <div className="col-span-2">
                                <label className="block text-xs font-medium text-slate-500 uppercase">Description</label>
                                {isEditMode ? (
                                    <textarea
                                        value={editedFields.description || ''}
                                        onChange={(e) => handleFieldChange('description', e.target.value)}
                                        rows={3}
                                        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        placeholder="Enter description"
                                    />
                                ) : (
                                    <p className="mt-1 text-sm text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100">
                                        {request.description}
                                    </p>
                                )}
                            </div>
                            {/* Maintenance Jobs Section */}
                            <div className="col-span-2">
                                <label className="block text-xs font-medium text-slate-500 uppercase">
                                    Maintenance Jobs
                                    {isEditMode && editedFields.maintenanceType && (
                                        <span className="ml-2 text-xs font-normal text-slate-400">
                                            ({(editedFields.maintenanceJobs || []).length} selected)
                                        </span>
                                    )}
                                </label>
                                {isEditMode ? (
                                    editedFields.maintenanceType ? (
                                        <div className="mt-2 space-y-3">
                                            {/* Search Input with Icon */}
                                            <div className="relative">
                                                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                                    <svg className="h-4 w-4 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                                                    </svg>
                                                </div>
                                                <input
                                                    type="text"
                                                    value={jobSearchQuery}
                                                    onChange={(e) => setJobSearchQuery(e.target.value)}
                                                    placeholder="Search jobs..."
                                                    className="block w-full rounded-md border border-slate-300 pl-10 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                            </div>
                                            {/* Jobs List with Enhanced Scrollbar */}
                                            <div
                                                className="max-h-60 overflow-y-auto rounded-lg border-2 border-slate-300 bg-white p-3 shadow-inner"
                                                style={{
                                                    scrollbarWidth: 'thin',
                                                    scrollbarColor: '#94a3b8 #e2e8f0'
                                                }}
                                            >
                                                <style jsx>{`
                                                    div::-webkit-scrollbar {
                                                        width: 8px;
                                                    }
                                                    div::-webkit-scrollbar-track {
                                                        background: #e2e8f0;
                                                        border-radius: 4px;
                                                    }
                                                    div::-webkit-scrollbar-thumb {
                                                        background: #94a3b8;
                                                        border-radius: 4px;
                                                    }
                                                    div::-webkit-scrollbar-thumb:hover {
                                                        background: #64748b;
                                                    }
                                                `}</style>
                                                <div className="space-y-2">
                                                    {getFilteredJobs().map((job) => (
                                                        <label
                                                            key={job}
                                                            className="flex items-center gap-3 cursor-pointer hover:bg-slate-50 rounded-md p-2 transition-colors border border-transparent hover:border-slate-200"
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={(editedFields.maintenanceJobs || []).includes(job)}
                                                                onChange={() => handleJobToggle(job)}
                                                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                                                            />
                                                            <span className="text-sm text-slate-700 font-medium">{job}</span>
                                                        </label>
                                                    ))}
                                                    {getFilteredJobs().length === 0 && (
                                                        <p className="text-sm text-slate-500 text-center py-8">
                                                            No jobs found matching "{jobSearchQuery}"
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="mt-2 text-sm text-slate-500 italic">
                                            Select a maintenance type to see available jobs
                                        </p>
                                    )
                                ) : (
                                    request.maintenanceJobs && request.maintenanceJobs.length > 0 ? (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {request.maintenanceJobs.map(job => (
                                                <span key={job} className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                                                    {job}
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="mt-2 text-sm text-slate-500">No jobs specified</p>
                                    )
                                )}
                            </div>
                            {/* Expected Completion Date */}
                            <div className="col-span-2">
                                <label className="block text-xs font-medium text-slate-500 uppercase">Expected Completion Date</label>
                                {isEditMode ? (
                                    <input
                                        type="date"
                                        value={editedFields.expectedCompletionDate || ''}
                                        onChange={(e) => handleFieldChange('expectedCompletionDate', e.target.value)}
                                        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                ) : (
                                    <p className="mt-1 text-sm font-medium text-slate-900">
                                        {request.expectedCompletionDate
                                            ? new Date(request.expectedCompletionDate).toLocaleDateString('en-GB', {
                                                day: '2-digit',
                                                month: '2-digit',
                                                year: 'numeric'
                                            })
                                            : 'Not set'
                                        }
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* RFQ Section */}
                    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-900">Request for Quotation (RFQ)</h3>
                            <button
                                onClick={handleSendRFQ}
                                disabled={request.status !== MaintenanceStatus.UNDER_ESTIMATION}
                                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-lg transition-all ${request.status === MaintenanceStatus.UNDER_ESTIMATION
                                        ? 'bg-indigo-600 text-white shadow-indigo-500/30 hover:bg-indigo-700 hover:shadow-indigo-500/50 cursor-pointer'
                                        : 'bg-slate-300 text-slate-500 shadow-slate-300/30 cursor-not-allowed opacity-50'
                                    }`}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L5.999 12Zm0 0h7.5" />
                                </svg>
                                Send RFQ
                            </button>
                        </div>
                        <p className="text-sm text-slate-500 mb-4">
                            {request.status === MaintenanceStatus.UNDER_ESTIMATION
                                ? 'Select garages to send a request for quotation.'
                                : 'RFQ can only be sent when status is "Under Estimation"'
                            }
                        </p>

                        <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 custom-scrollbar">
                            {garages.map((g) => (
                                <label key={g.id} className="flex items-center space-x-3 p-3 hover:bg-white hover:shadow-sm rounded-lg cursor-pointer transition-all border border-transparent hover:border-slate-200">
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                        checked={candidateGarageIds.includes(g.id)}
                                        onChange={() => handleGarageToggle(g.id)}
                                    />
                                    <div className="flex-1">
                                        <div className="flex justify-between">
                                            <span className="font-medium text-slate-900">{g.name}</span>
                                            {g.isInternal && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Internal</span>}
                                        </div>
                                        <p className="text-xs text-slate-500">{g.location} • {g.specialties.join(', ')}</p>
                                    </div>
                                </label>
                            ))}
                        </div>
                        <div className="mt-3 flex justify-between text-xs text-slate-500">
                            <span>{candidateGarageIds.length} garage(s) selected</span>
                            {request.candidateGarageIds && request.candidateGarageIds.length > 0 && (
                                <span className="text-green-600">Last sent to {request.candidateGarageIds.length} garages</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Sidebar Info */}
                <div className="space-y-8">
                    {/* Dates */}
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
                            {request.status !== MaintenanceStatus.COMPLETED && (
                                <button
                                    onClick={handleAddAttachment}
                                    className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                    </svg>
                                    Add
                                </button>
                            )}
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
                                        <button
                                            onClick={() => handleDeleteAttachment(att.id)}
                                            className="text-red-600 hover:text-red-800 p-1"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-xs text-slate-500 italic text-center py-4">No attachments yet</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Attachment Upload Modal */}
            {showAttachmentModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
                        <h3 className="text-lg font-bold text-slate-900">Add Attachment</h3>
                        <p className="mt-1 text-sm text-slate-500">Select the attachment type and upload a file</p>

                        <div className="mt-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Attachment Type</label>
                                <select
                                    value={selectedAttachmentType}
                                    onChange={(e) => setSelectedAttachmentType(e.target.value as AttachmentType)}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white text-slate-900"
                                >
                                    {Object.values(AttachmentType).map((type) => (
                                        <option key={type} value={type} className="text-slate-900">
                                            {type}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="rounded-lg border-2 border-dashed border-slate-300 p-6 text-center">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="mx-auto h-12 w-12 text-slate-400">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                                </svg>
                                <p className="mt-2 text-sm text-slate-600">Click below to select a file</p>
                                <p className="text-xs text-slate-500 mt-1">PDF, JPG, PNG, DOC, DOCX, XLS, XLSX</p>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                onClick={() => {
                                    setShowAttachmentModal(false);
                                    setSelectedAttachmentType(AttachmentType.INVOICE);
                                }}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleFileSelect}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                            >
                                Select File
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
