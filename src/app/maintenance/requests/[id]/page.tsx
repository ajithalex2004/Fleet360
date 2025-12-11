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
    getMaintenanceRequestById,
    getVehicles,
    getGarages,
    updateMaintenanceRequest,
    createQuotation,
    createGarage
} from '@/services/mockData';
import { sendNotification } from '@/utils/notifications';
import StatusBadge from '@/components/ui/StatusBadge';
import { getNextStatuses } from '@/services/workflowStateMachine';
import { matchGarages } from '@/services/garageMatching';
import { EnhancedGarage } from '@/types/maintenance';
import { useToast } from '@/contexts/ToastContext';

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
    const { addToast } = useToast();
    const params = useParams();
    const rawId = params?.id as string;
    // Ensure ID is decoded (Next.js might return it encoded)
    const id = decodeURIComponent(rawId);

    console.log('Debug Request Details:', { rawId, id });

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

    // Quotation History Modal State
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [historyGarageId, setHistoryGarageId] = useState<string | null>(null);

    // Garage Picker State
    const [showGaragePicker, setShowGaragePicker] = useState(false);
    const [garageSearchTerm, setGarageSearchTerm] = useState('');

    const handleAddGarageToShortlist = (garageId: string) => {
        if (!candidateGarageIds.includes(garageId)) {
            setCandidateGarageIds(prev => [...prev, garageId]);
            addToast('Garage added to shortlist', 'success');
        }
        setShowGaragePicker(false);
    };

    const handleViewHistory = (garageId: string) => {
        setHistoryGarageId(garageId);
        setShowHistoryModal(true);
    };

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [requestData, allVehicles, allGarages] = await Promise.all([
                    getMaintenanceRequestById(id),
                    getVehicles(),
                    getGarages()
                ]);

                if (requestData) {
                    setRequest(requestData);
                    const foundVehicle = allVehicles.find((v: Vehicle) => v.id === requestData.vehicleId);
                    setVehicle(foundVehicle || null);

                    // Initialize candidate garages if they exist (Cleanse stale IDs)
                    if (requestData.candidateGarageIds) {
                        const validGarageIds = allGarages.map((g: Garage) => g.id);
                        const cleanIds = requestData.candidateGarageIds.filter((id: string) => validGarageIds.includes(id));
                        setCandidateGarageIds(cleanIds);

                        // If we cleaned any IDs, we should probably update the backend to clear the rot, but for now just accessing clean state is enough to fix the crash.
                        if (cleanIds.length !== requestData.candidateGarageIds.length) {
                            console.warn('Found and removed stale Garage IDs:', requestData.candidateGarageIds.length - cleanIds.length);
                        }
                    }

                    // Initialize quotations if they exist
                    if (requestData.quotations) {
                        const initialQuotations: { [garageId: string]: any } = {};
                        requestData.quotations.forEach((q: Quotation) => {
                            initialQuotations[q.garageId] = {
                                amount: q.totalCost,
                                partsCost: q.partsCost,
                                laborCost: q.laborCost,
                                attachmentUrl: q.attachments?.[0]?.url,
                                attachmentName: q.attachments?.[0]?.fileName,
                                estimatedDate: q.estimatedCompletionDate ? q.estimatedCompletionDate.split('T')[0] : ''
                            };
                        });
                        setQuotations(initialQuotations);
                    }
                }
                setGarages(allGarages || []);
            } catch (error) {
                console.error("Error fetching request details:", error);
                addToast("Failed to load request details", "error");
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [id, addToast]);


    const handleStatusUpdate = async (newStatus: MaintenanceStatus) => {
        if (!request) return;
        try {
            const updates: Partial<MaintenanceRequest> = { status: newStatus };

            // Generate Work Order Number if moving to ESTIMATION_APPROVED
            if (newStatus === MaintenanceStatus.ESTIMATION_APPROVED && !request.workOrderNo) {
                const date = new Date();
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                updates.workOrderNo = `WO-${month}-${request.id}`;
            }

            // Add History
            const historyEntry = {
                status: newStatus,
                date: new Date().toISOString(),
                note: `Status updated to ${newStatus}`,
                actor: 'System'
            };
            updates.history = [...(request.history || []), historyEntry];

            await updateMaintenanceRequest(request.id, updates);
            setRequest({ ...request, ...updates });
            addToast(`Status updated to ${newStatus}`, 'success');
        } catch (error) {
            console.error('Failed to update status', error);
            addToast('Failed to update status', 'error');
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
            addToast('Changes saved successfully', 'success');
        } catch (error) {
            console.error('Failed to save changes', error);
            addToast('Failed to save changes', 'error');
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
            // Clear previously selected jobs when type changes
            setEditedFields(prev => ({ ...prev, maintenanceJobs: [] }));

            // Trigger auto-selection based on new type
            if (request) {
                const tempRequest = { ...request, maintenanceType: value as MaintenanceType, maintenanceJobs: [] };
                const matches = matchGarages(tempRequest, garages as EnhancedGarage[]);
                const topMatches = matches.slice(0, 5).map(m => m.garageId);
                setCandidateGarageIds(topMatches);
                if (topMatches.length > 0) {
                    console.log(`Auto-selected ${topMatches.length} garages based on maintenance type.`);
                }
            }
        }
    };

    const handleJobToggle = (job: string) => {
        const currentJobs = editedFields.maintenanceJobs || [];
        const newJobs = currentJobs.includes(job)
            ? currentJobs.filter(j => j !== job)
            : [...currentJobs, job];
        setEditedFields(prev => ({ ...prev, maintenanceJobs: newJobs }));

        // Trigger auto-selection based on updated jobs
        if (request) {
            const tempRequest = {
                ...request,
                maintenanceType: editedFields.maintenanceType || request.maintenanceType,
                maintenanceJobs: newJobs
            };
            const matches = matchGarages(tempRequest, garages as EnhancedGarage[]);
            const topMatches = matches.slice(0, 5).map(m => m.garageId);
            setCandidateGarageIds(topMatches);
        }
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
        console.log('handleSendRFQ called');
        if (!request) {
            console.log('Request is null');
            return;
        }
        console.log('Current Request:', request);
        console.log('Validation Check:', {
            odometer: request.odometer,
            type: request.maintenanceType,
            jobs: request.maintenanceJobs
        });

        // Validation: Check for required fields
        const missingFields = [];
        if (request.odometer === undefined || request.odometer === null) missingFields.push('Odometer Reading');
        if (!request.maintenanceType) missingFields.push('Maintenance Type');
        if (!request.maintenanceJobs || request.maintenanceJobs.length === 0) missingFields.push('Maintenance Jobs');

        if (missingFields.length > 0) {
            addToast(`Please provide the following details before sending RFQ: ${missingFields.join(', ')}`, 'error');
            return;
        }

        if (candidateGarageIds.length === 0) {
            addToast('Please select at least one garage to send RFQ.', 'error');
            return;
        }

        const selectedGarages = garages.filter(g => candidateGarageIds.includes(g.id));

        console.group('Sending RFQs...');
        selectedGarages.forEach(garage => {
            const emailContent = generateRFQTemplate(garage);
            console.log(`Sending RFQ to ${garage.name}:`, emailContent);
        });
        console.groupEnd();

        // Save the selected candidates to the request and update status
        const historyEntry = {
            status: MaintenanceStatus.UNDER_ESTIMATION,
            date: new Date().toISOString(),
            note: `RFQ sent to ${selectedGarages.length} garage(s)`,
            actor: 'System'
        };
        const updatedHistory = [...(request.history || []), historyEntry];

        await updateMaintenanceRequest(request.id, {
            candidateGarageIds,
            status: MaintenanceStatus.UNDER_ESTIMATION,
            history: updatedHistory
        });
        setRequest({ ...request, status: MaintenanceStatus.UNDER_ESTIMATION, history: updatedHistory });

        addToast(`RFQ sent successfully to ${selectedGarages.length} garage(s)! Status updated to Under Estimation.`, 'success');
    };

    // Quotation Management State
    const [quotations, setQuotations] = useState<{
        [garageId: string]: {
            amount: number;
            partsCost?: number;
            laborCost?: number;
            totalCost?: number;
            attachmentUrl?: string;
            attachmentName?: string;
            estimatedDate?: string;
            parts?: any[];
            labor?: any[];
            notes?: string;
            validUntil?: string;
        }
    }>({});

    const handleQuotationChange = (garageId: string, field: string, value: any) => {
        setQuotations(prev => ({
            ...prev,
            [garageId]: {
                ...prev[garageId],
                [field]: value
            }
        }));
    };

    const handleRemoveQuotation = (garageId: string) => {
        setQuotations(prev => {
            const newQuotations = { ...prev };
            delete newQuotations[garageId];
            return newQuotations;
        });
    };

    const handleSaveQuotation = async (garageId: string) => {
        if (!request) return;
        const quote = quotations[garageId];

        const parts = quote?.partsCost || 0;
        const labor = quote?.laborCost || 0;
        const total = parts + labor;

        if (!quote || total <= 0) {
            addToast('Please enter an amount (Parts or Labor) before saving.', 'error');
            return;
        }

        console.log(`Saving quotation for garage ${garageId}:`, quote);

        const newQuotation: Quotation = {
            id: `q-${Date.now()}`,
            requestId: request.id,
            garageId,
            garageName: garages.find(g => g.id === garageId)?.name || 'Unknown Garage',
            quotationDate: new Date().toISOString(),
            validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            laborCost: labor,
            partsCost: parts,
            totalCost: total,
            consumablesCost: 0,
            vatAmount: total * 0.05,
            grandTotal: total * 1.05, // Assuming 5% VAT
            estimatedDuration: 24, // Default fallback
            estimatedCompletionDate: quote.estimatedDate ? new Date(quote.estimatedDate).toISOString() : undefined,
            status: QuotationStatus.PENDING,
            submittedBy: 'Fleet Manager (Manual)',
            parts: [], // Manual entry doesn't have detailed parts list yet
            labor: [],
            attachments: quote.attachmentUrl ? [{
                id: `att-${Date.now()}`,
                type: AttachmentType.QUOTATION,
                fileName: quote.attachmentName || 'quotation.pdf',
                url: quote.attachmentUrl,
                uploadedAt: new Date().toISOString()
            }] : []
        };

        // Create quotation
        try {
            const { garageName, ...payload } = newQuotation;
            await createQuotation(payload);

            const updatedQuotations = [...(request.quotations || []), newQuotation];
            setRequest({ ...request, quotations: updatedQuotations });
            addToast('Quotation saved successfully!', 'success');
        } catch (error) {
            console.error('Failed to save quotation:', error);
            addToast('Failed to save quotation.', 'error');
        }
    };

    const generateComparisonEmail = () => {
        const quotationSummary = candidateGarageIds.map(garageId => {
            const garage = garages.find(g => g.id === garageId);
            const quote = quotations[garageId];
            const total = quote?.totalCost || quote?.amount || ((quote?.partsCost || 0) + (quote?.laborCost || 0));
            if (!quote || total <= 0) return '';

            return `
                <p>
                    <strong>${garage?.name}</strong> – AED ${total.toFixed(2)} – ETA: ${quote.estimatedDate ? new Date(quote.estimatedDate).toLocaleDateString() : 'N/A'}
                </p>
            `;
        }).join('');

        const woDeepLink = `${window.location.origin}/maintenance/requests/${encodeURIComponent(request?.id || '')}`;

        return `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; border: 1px solid #e5e7eb; padding: 20px;">
                <h2 style="color: #2563eb;">Maintenance Estimate Approval – WO ${request?.id.toUpperCase()} – ${vehicle?.licensePlate}</h2>
                <p>Dear Approver,</p>
                <p>A maintenance estimate requires your approval for the following work order:</p>
                
                <ul style="list-style: none; padding: 0;">
                    <li><strong>Vehicle:</strong> ${vehicle?.licensePlate} (${vehicle?.make} ${vehicle?.model} – ${vehicle?.year})</li>
                    <li><strong>Work Order:</strong> ${request?.id.toUpperCase()}</li>
                    <li><strong>Issue:</strong> ${request?.description || 'N/A'}</li>
                    <li><strong>Odometer:</strong> ${request?.odometer?.toLocaleString() || 'N/A'} km</li>
                </ul>

                <h3>Quotation Summary:</h3>
                ${quotationSummary || '<p>No quotations available.</p>'}

                <p>You can review detailed quotations and approve via the following link:</p>
                <p><strong>Work Order Link:</strong> <a href="${woDeepLink}">${woDeepLink}</a></p>

                <p>All quotation documents are attached for your review.</p>

                <p>Best regards,</p>
            </div>
        `;
    };

    const handleSendForApproval = async () => {
        if (!request) return;
        const hasQuotes = candidateGarageIds.some(id => {
            const q = quotations[id];
            const total = q?.totalCost || q?.amount || ((q?.partsCost || 0) + (q?.laborCost || 0));
            return total > 0;
        });
        if (!hasQuotes) {
            addToast('Please enter at least one quotation amount before sending for approval.', 'error');
            return;
        }

        const emailContent = generateComparisonEmail();
        console.group('Sending for Approval...');
        console.log('To: Approving Authorities');
        console.log('Subject: Quotation Approval Required');
        console.log('Content:', emailContent);
        console.groupEnd();

        // Construct full Quotation objects
        const finalQuotations: Quotation[] = candidateGarageIds
            .filter(id => {
                const q = quotations[id];
                const total = q?.totalCost || q?.amount || ((q?.partsCost || 0) + (q?.laborCost || 0));
                return total > 0;
            })
            .map(id => {
                const quote = quotations[id];
                const parts = quote.partsCost || 0;
                const labor = quote.laborCost || 0;
                // Fallback to amount if neither parts nor labor is set (legacy behavior)
                const effectiveParts = (parts === 0 && labor === 0 && quote.amount > 0) ? quote.amount : parts;
                const total = effectiveParts + labor;

                return {
                    id: `q-${Date.now()}-${id}`,
                    requestId: request.id,
                    garageId: id,
                    garageName: garages.find(g => g.id === id)?.name || 'Unknown',
                    quotationDate: new Date().toISOString(),
                    validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                    laborCost: labor,
                    partsCost: effectiveParts,
                    totalCost: total,
                    consumablesCost: 0,
                    vatAmount: total * 0.05,
                    grandTotal: total * 1.05,
                    currency: 'AED',
                    parts: [],
                    labor: [],
                    estimatedDuration: 0,
                    estimatedCompletionDate: quote.estimatedDate ? new Date(quote.estimatedDate).toISOString() : undefined,
                    status: QuotationStatus.PENDING,
                    submittedBy: 'Vendor',
                    attachments: quote.attachmentUrl ? [{
                        id: `att-${Date.now()}-${id}`,
                        type: AttachmentType.QUOTATION,
                        fileName: quote.attachmentName || 'Quotation.pdf',
                        url: quote.attachmentUrl,
                        uploadedAt: new Date().toISOString()
                    }] : []
                };
            });

        try {
            // Append new quotations to history
            const updatedQuotations = [...(request.quotations || []), ...finalQuotations];

            // Create quotations individually
            for (const quote of finalQuotations) {
                const { garageName, ...payload } = quote;
                await createQuotation(payload);
            }

            const historyEntry = {
                status: MaintenanceStatus.PENDING_ESTIMATION_APPROVAL,
                date: new Date().toISOString(),
                note: 'Sent for estimation approval',
                actor: 'System'
            };
            const updatedHistory = [...(request.history || []), historyEntry];

            // Update request status only
            await updateMaintenanceRequest(request.id, {
                status: MaintenanceStatus.PENDING_ESTIMATION_APPROVAL,
                history: updatedHistory
            });
            setRequest({
                ...request,
                status: MaintenanceStatus.PENDING_ESTIMATION_APPROVAL,
                quotations: updatedQuotations,
                history: updatedHistory
            });

            addToast('Comparison email sent to authorities! Status updated to Pending Estimation Approval.', 'success');
        } catch (error) {
            console.error('Failed to send for approval:', error);
            addToast('Failed to send for approval.', 'error');
        }
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
                try {
                    addToast('Uploading attachment...', 'info');
                    const uploadRes = await uploadFile(file);

                    const newAttachment: Attachment = {
                        id: `att${Date.now()}`,
                        type: selectedAttachmentType,
                        fileName: file.name,
                        url: uploadRes.url,
                        uploadedAt: new Date().toISOString(),
                    };
                    const updatedAttachments = [...(request.attachments || []), newAttachment];
                    await updateMaintenanceRequest(request.id, { attachments: updatedAttachments });
                    setRequest({ ...request, attachments: updatedAttachments });
                    setShowAttachmentModal(false);
                    addToast('Attachment uploaded successfully', 'success');
                } catch (error) {
                    console.error('Failed to upload:', error);
                    addToast('Failed to upload attachment', 'error');
                }
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

    // Approval Workflow State
    const [selectedGarageForApproval, setSelectedGarageForApproval] = useState<string | null>(null);
    const [rejectionReason, setRejectionReason] = useState('');
    // const [showRejectModal, setShowRejectModal] = useState(false); // Unused
    const [showReviewModal, setShowReviewModal] = useState(false);

    const handleApproveEstimate = async () => {
        if (!selectedGarageForApproval) {
            addToast('Please select a garage to approve.', 'error');
            return;
        }
        if (!request) return;

        // Find the latest quotation for the selected garage
        const garageQuotations = request.quotations?.filter(q => q.garageId === selectedGarageForApproval) || [];
        // Sort by date descending to get the latest
        garageQuotations.sort((a, b) => new Date(b.quotationDate).getTime() - new Date(a.quotationDate).getTime());

        const selectedQuote = garageQuotations[0]; // Get the latest one

        if (!selectedQuote) {
            // Fallback to local state if not found in request (shouldn't happen if flow is correct)
            const localQuote = quotations[selectedGarageForApproval];
            if (!localQuote) return;
            // If we are here, it means we might be approving a manually entered quote that hasn't been saved as a full object yet? 
            // But the flow requires "Send for Approval" which saves them.
            // Let's assume we must have a saved quotation object.
            // But the flow requires "Send for Approval" which saves them.
            // Let's assume we must have a saved quotation object.
            addToast("No quotation found for this garage. Please ensure 'Send for Approval' was clicked.", 'error');
            return;
        }

        try {
            const now = new Date();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const year = now.getFullYear();
            const workOrderNo = `WO-${month}-${year}-${request.id.toUpperCase()}`;

            // Sync Approved Quotation as Attachment
            let updatedAttachments = request.attachments || [];

            console.log('Syncing Attachment. Selected Quote:', selectedQuote);

            let quoteAttachmentUrl = selectedQuote.attachments?.[0]?.url;
            let quoteAttachmentName = selectedQuote.attachments?.[0]?.fileName;

            // Fallback to local state if not found in quote object
            if (!quoteAttachmentUrl) {
                const localQuote = quotations[selectedGarageForApproval];
                if (localQuote?.attachmentUrl) {
                    console.log('Using local quote attachment:', localQuote);
                    quoteAttachmentUrl = localQuote.attachmentUrl;
                    quoteAttachmentName = localQuote.attachmentName || 'Quotation.pdf';
                }
            }

            if (quoteAttachmentUrl) {
                const newAttachment: Attachment = {
                    id: `att-quote-${Date.now()}`,
                    type: AttachmentType.APPROVED_ESTIMATE,
                    fileName: quoteAttachmentName || 'Approved_Estimate.pdf',
                    url: quoteAttachmentUrl,
                    uploadedAt: new Date().toISOString()
                };
                updatedAttachments = [...updatedAttachments, newAttachment];
                console.log('Added new attachment:', newAttachment);
            } else {
                console.warn('No attachment found for selected quote.');
            }

            console.log('Selected Quote for Approval:', selectedQuote);
            console.log('Setting ExpectedEndDate to:', selectedQuote.estimatedCompletionDate);

            // Update the specific quotation status to ACCEPTED
            const updatedQuotations = request.quotations?.map(q => {
                if (q.id === selectedQuote.id) {
                    return { ...q, status: QuotationStatus.APPROVED };
                }
                return q;
            }) || [];

            // Add History Entry
            const newHistoryEntry = {
                status: MaintenanceStatus.ESTIMATION_APPROVED,
                date: new Date().toISOString(),
                note: 'Estimation approved by Maintenance Manager',
                actor: 'Maintenance Manager'
            };
            const updatedHistory = [...(request.history || []), newHistoryEntry];

            // Derive Maintenance Jobs from Quote Parts/Labor if not already set
            let finalMaintenanceJobs = request.maintenanceJobs || [];
            if (finalMaintenanceJobs.length === 0 && selectedQuote.parts) {
                finalMaintenanceJobs = selectedQuote.parts.map(p => p.name);
            }

            await updateMaintenanceRequest(request.id, {
                status: MaintenanceStatus.UNDER_MAINTENANCE,
                garageId: selectedGarageForApproval,
                selectedQuotationId: selectedQuote.id, // Use the actual Quotation ID
                actualPartsCost: selectedQuote.partsCost || 0,
                actualLaborCost: selectedQuote.laborCost || 0,
                actualOtherCost: selectedQuote.consumablesCost || 0,
                actualCost: selectedQuote.totalCost,
                workOrderNo: workOrderNo,
                expectedEndDate: selectedQuote.estimatedCompletionDate,
                attachments: updatedAttachments,
                quotations: updatedQuotations,
                maintenanceType: request.maintenanceType || MaintenanceType.CORRECTIVE, // Ensure type is set
                maintenanceJobs: finalMaintenanceJobs, // Ensure jobs are set
                history: updatedHistory
            });
            setRequest({
                ...request,
                status: MaintenanceStatus.UNDER_MAINTENANCE,
                garageId: selectedGarageForApproval,
                selectedQuotationId: selectedQuote.id,
                workOrderNo: workOrderNo,
                expectedEndDate: selectedQuote.estimatedCompletionDate,
                attachments: updatedAttachments,
                quotations: updatedQuotations,
                history: updatedHistory
            });

            // Simulate Notifications
            console.group('Approval Notifications');
            const garageName = garages.find(g => g.id === selectedGarageForApproval)?.name || 'Garage';
            console.log(`[EMAIL/WHATSAPP] To: ${garageName}`);
            console.log(`Subject: Work Order Approved - ${request.id.toUpperCase()}`);
            console.log(`Message: Please proceed with the work order. Work Order No: ${workOrderNo}. Vehicle: ${vehicle?.licensePlate}. Approved Amount: AED ${selectedQuote.totalCost}`);

            console.log(`[NOTIFICATION] To: Operations & Maintenance Team`);
            console.log(`Message: Estimate approved for ${request.id.toUpperCase()}. Work can start.`);
            console.groupEnd();

            // REAL NOTIFICATION: To Garage
            await sendNotification(
                garages.find(g => g.id === selectedGarageForApproval)?.email || 'test-garage@example.com',
                `Work Order Approved - ${workOrderNo}`,
                `Dear Vendor,\n\nYour quotation for Vehicle ${vehicle?.licensePlate} has been APPROVED.\n\nWork Order No: ${workOrderNo}\nApproved Amount: AED ${selectedQuote.totalCost}\n\nPlease proceed with the work immediately.`,
                'Email',
                'Garage Work Order Assignment'
            );

            // REAL NOTIFICATION: To Operations
            await sendNotification(
                'operations@gravity.com',
                `Estimate Approved: ${workOrderNo}`,
                `Maintenance Manager has approved the estimate for ${vehicle?.licensePlate}.\nGarage: ${garageName}\nAmount: AED ${selectedQuote.totalCost}`,
                'Email',
                'Internal Notification'
            );

            addToast('Estimate approved! Work Order is now Under Maintenance.', 'success');
        } catch (error) {
            console.error('Failed to approve estimate:', error);
            addToast('Failed to approve estimate.', 'error');
        }
    };

    const handleRejectEstimate = async () => {
        if (!request) return;
        try {
            const historyEntry = {
                status: MaintenanceStatus.UNDER_ESTIMATION,
                date: new Date().toISOString(),
                note: 'Estimate rejected',
                actor: 'System'
            };
            const updatedHistory = [...(request.history || []), historyEntry];

            await updateMaintenanceRequest(request.id, {
                status: MaintenanceStatus.UNDER_ESTIMATION,
                history: updatedHistory
            });
            setRequest({ ...request, status: MaintenanceStatus.UNDER_ESTIMATION, history: updatedHistory });
            setRejectionReason('');
            addToast('Estimate rejected. Request returned to Under Estimation.', 'success');
        } catch (error) {
            console.error('Failed to reject estimate:', error);
            addToast('Failed to reject estimate.', 'error');
        }
    };

    if (loading) {
        return <div className="p-8 text-center text-slate-500">Loading details...</div>;
    }

    if (!request) {
        return <div className="p-8 text-center text-slate-500">Request not found.</div>;
    }

    const nextStatuses = getNextStatuses(request.status);

    return (
        <>
            <div className="mx-auto max-w-5xl pb-12 space-y-8">
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
                        {/* View Mode Toggle Removed */}

                        <select
                            className="rounded-lg border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white text-slate-900"
                            value={request.status}
                            onChange={(e) => handleStatusUpdate(e.target.value as MaintenanceStatus)}
                        >
                            <option key={request.status} value={request.status} className="text-slate-900">
                                {request.status} (Current)
                            </option>
                            {nextStatuses.map((status) => (
                                <option key={status} value={status} className="text-slate-900">
                                    {status}
                                </option>
                            ))}
                        </select>
                    </div >
                </div >

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Info */}
                    <div className="lg:col-span-2 space-y-8">
                        {/* Request Details */}
                        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold text-slate-900">Request Details</h3>
                                {!isEditMode ? (
                                    <button
                                        onClick={handleEditMode}
                                        className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                        </svg>
                                        Edit
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={handleCancelEdit}
                                            className="text-sm font-medium text-slate-500 hover:text-slate-700"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleSaveChanges}
                                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                                        >
                                            Save Changes
                                        </button>
                                    </div>
                                )}
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
                                    {isEditMode ? (
                                        <input
                                            type="number"
                                            value={editedFields.odometer || ''}
                                            onChange={(e) => handleFieldChange('odometer', parseInt(e.target.value))}
                                            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    ) : (
                                        <p className="mt-1 text-sm font-medium text-slate-900">{request.odometer?.toLocaleString()} km</p>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 uppercase">Priority</label>
                                    {isEditMode ? (
                                        <select
                                            value={editedFields.priority}
                                            onChange={(e) => handleFieldChange('priority', e.target.value)}
                                            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                        >
                                            {Object.values(MaintenancePriority).map(p => (
                                                <option key={p} value={p}>{p}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <p className="mt-1 text-sm font-medium text-slate-900 capitalize">{request.priority}</p>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 uppercase">Maintenance Type</label>
                                    {isEditMode ? (
                                        <select
                                            value={editedFields.maintenanceType}
                                            onChange={(e) => handleFieldChange('maintenanceType', e.target.value)}
                                            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                        >
                                            <option value="">Select Type</option>
                                            {Object.values(MaintenanceType).map(t => (
                                                <option key={t} value={t}>{t}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <p className="mt-1 text-sm font-medium text-slate-900 capitalize">{request.maintenanceType}</p>
                                    )}
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-slate-500 uppercase">Description</label>
                                    {isEditMode ? (
                                        <textarea
                                            rows={3}
                                            value={editedFields.description || ''}
                                            onChange={(e) => handleFieldChange('description', e.target.value)}
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
                                                                No jobs found matching &quot;{jobSearchQuery}&quot;
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
                            </div>
                        </div>

                        {/* Send RFQ Section */}
                        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <h3 className="text-lg font-bold text-slate-900">Candidate Garages</h3>
                                    <button
                                        onClick={() => setShowGaragePicker(true)}
                                        className="text-xs bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 px-2 py-1 rounded-md transition-colors flex items-center gap-1"
                                        title="Add a garage from the master list"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                            <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                                        </svg>
                                        Add Garage
                                    </button>
                                </div>
                                <button
                                    onClick={handleSendRFQ}
                                    disabled={
                                        (request.status !== MaintenanceStatus.UNDER_ESTIMATION &&
                                            request.status !== MaintenanceStatus.REQUESTED &&
                                            request.status !== MaintenanceStatus.ACCEPTED) ||
                                        candidateGarageIds.length === 0
                                    }
                                    className={`rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm ${(request.status === MaintenanceStatus.UNDER_ESTIMATION ||
                                        request.status === MaintenanceStatus.REQUESTED ||
                                        request.status === MaintenanceStatus.ACCEPTED)
                                        ? 'bg-blue-600 hover:bg-blue-700'
                                        : 'bg-slate-400 cursor-not-allowed'
                                        }`}
                                >
                                    Send RFQ ({candidateGarageIds.length})
                                </button>
                            </div>

                            {candidateGarageIds.length === 0 && (
                                <div className="text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-300">
                                    <p className="text-slate-500">No garages selected based on criteria.</p>
                                    <button onClick={() => setShowGaragePicker(true)} className="mt-2 text-blue-600 text-sm font-medium hover:underline">
                                        Add a garage manually
                                    </button>
                                </div>
                            )}

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {garages.filter(g => candidateGarageIds.includes(g.id)).map((garage) => (
                                    <div
                                        key={garage.id}
                                        onClick={() => (request.status === MaintenanceStatus.UNDER_ESTIMATION || request.status === MaintenanceStatus.REQUESTED || request.status === MaintenanceStatus.ACCEPTED) && handleGarageToggle(garage.id)}
                                        className={`cursor-pointer rounded-lg border p-4 transition-all border-blue-600 bg-blue-50 ring-1 ring-blue-600`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="flex h-6 items-center">
                                                <input
                                                    type="checkbox"
                                                    checked={true}
                                                    onChange={() => { }}
                                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                                                />
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="font-medium text-slate-900">{garage.name}</h4>
                                                    {candidateGarageIds.includes(garage.id) && (
                                                        <span className="inline-flex items-center rounded-md bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                                                            Selected
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-slate-500">{garage.location}</p>
                                                <div className="mt-2 flex items-center gap-1">
                                                    <span className="text-xs text-slate-500">Rating:</span>
                                                    <span className="text-xs font-medium text-amber-500">★ {(garage as unknown as EnhancedGarage).rating || 'N/A'}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Received Quotations Section */}
                        {
                            (request.status === MaintenanceStatus.UNDER_ESTIMATION ||
                                request.status === MaintenanceStatus.PENDING_ESTIMATION_APPROVAL ||
                                request.status === MaintenanceStatus.UNDER_MAINTENANCE ||
                                request.status === MaintenanceStatus.MAINTENANCE_COMPLETED ||
                                request.status === MaintenanceStatus.PENDING_INVOICE ||
                                request.status === MaintenanceStatus.CLOSED) && (
                                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-lg font-bold text-slate-900">
                                            {(request.status === MaintenanceStatus.UNDER_MAINTENANCE ||
                                                request.status === MaintenanceStatus.MAINTENANCE_COMPLETED ||
                                                request.status === MaintenanceStatus.PENDING_INVOICE ||
                                                request.status === MaintenanceStatus.CLOSED)
                                                ? 'Approved Quotation'
                                                : 'Received Quotations'}
                                        </h3>
                                        {(request.status === MaintenanceStatus.UNDER_ESTIMATION ||
                                            request.status === MaintenanceStatus.PENDING_ESTIMATION_APPROVAL ||
                                            request.status === MaintenanceStatus.UNDER_MAINTENANCE ||
                                            request.status === MaintenanceStatus.MAINTENANCE_COMPLETED ||
                                            request.status === MaintenanceStatus.PENDING_INVOICE ||
                                            request.status === MaintenanceStatus.CLOSED) && (
                                                <button
                                                    onClick={handleSendForApproval}
                                                    disabled={request.status !== MaintenanceStatus.UNDER_ESTIMATION}
                                                    className={`rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm ${request.status === MaintenanceStatus.UNDER_ESTIMATION
                                                        ? 'bg-green-600 hover:bg-green-700'
                                                        : 'bg-slate-400 cursor-not-allowed'
                                                        }`}
                                                >
                                                    Send for Approval
                                                </button>
                                            )}
                                    </div>

                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-slate-200">
                                            <thead className="bg-slate-50">
                                                <tr>
                                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Garage</th>
                                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Parts Est (AED)</th>
                                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Labor Est (AED)</th>
                                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Est. Completion Date</th>
                                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Attachment</th>
                                                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white divide-y divide-slate-200">
                                                {candidateGarageIds.filter(garageId => {
                                                    if (request.status === MaintenanceStatus.UNDER_MAINTENANCE ||
                                                        request.status === MaintenanceStatus.PENDING_INVOICE ||
                                                        request.status === MaintenanceStatus.MAINTENANCE_COMPLETED) {
                                                        // Find the accepted quotation for this garage
                                                        const quote = request.quotations?.find(q => q.garageId === garageId && (q.status === QuotationStatus.APPROVED || q.id === request.selectedQuotationId));
                                                        return !!quote;
                                                    }
                                                    return true;
                                                }).map((garageId) => {
                                                    const garage = garages.find(g => g.id === garageId);

                                                    // Determine which quote to show (Prioritize backend data, then local Manual entry)
                                                    const backendQuote = request.quotations?.find(q => q.garageId === garageId);
                                                    let displayQuote: any = backendQuote ? {
                                                        partsCost: backendQuote.partsCost,
                                                        laborCost: backendQuote.laborCost,
                                                        amount: backendQuote.totalCost,
                                                        estimatedDate: backendQuote.estimatedCompletionDate ? new Date(backendQuote.estimatedCompletionDate).toISOString().split('T')[0] : '',
                                                        attachmentUrl: backendQuote.attachments?.[0]?.url,
                                                        attachmentName: backendQuote.attachments?.[0]?.fileName
                                                    } : (quotations[garageId] || { partsCost: 0, laborCost: 0, amount: 0, attachmentUrl: '' });

                                                    if (request.status === MaintenanceStatus.UNDER_MAINTENANCE ||
                                                        request.status === MaintenanceStatus.MAINTENANCE_COMPLETED ||
                                                        request.status === MaintenanceStatus.PENDING_INVOICE ||
                                                        request.status === MaintenanceStatus.CLOSED) {
                                                        const acceptedQuote = request.quotations?.find(q => q.garageId === garageId && (q.status === QuotationStatus.APPROVED || q.id === request.selectedQuotationId));
                                                        if (acceptedQuote) {
                                                            displayQuote = {
                                                                partsCost: acceptedQuote.partsCost,
                                                                laborCost: acceptedQuote.laborCost,
                                                                amount: acceptedQuote.totalCost,
                                                                estimatedDate: acceptedQuote.estimatedCompletionDate ? new Date(acceptedQuote.estimatedCompletionDate).toISOString().split('T')[0] : '',
                                                                attachmentUrl: acceptedQuote.attachments?.[0]?.url,
                                                                attachmentName: acceptedQuote.attachments?.[0]?.fileName
                                                            };
                                                        }
                                                    }

                                                    const quote = displayQuote;
                                                    return (
                                                        <tr key={garageId}>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                                                                <div>{garage?.name}</div>
                                                                {request.quotations?.some(q => q.garageId === garageId) && (
                                                                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 mt-1">
                                                                        Quote Submitted
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    value={quote.partsCost || ''}
                                                                    onChange={(e) => handleQuotationChange(garageId, 'partsCost', parseFloat(e.target.value))}
                                                                    placeholder="0.00"
                                                                    className="block w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                                    disabled={request.status !== MaintenanceStatus.UNDER_ESTIMATION}
                                                                />
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    value={quote.laborCost || ''}
                                                                    onChange={(e) => handleQuotationChange(garageId, 'laborCost', parseFloat(e.target.value))}
                                                                    placeholder="0.00"
                                                                    className="block w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                                    disabled={request.status !== MaintenanceStatus.UNDER_ESTIMATION}
                                                                />
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                                                                <input
                                                                    type="date"
                                                                    min={new Date().toISOString().split('T')[0]}
                                                                    value={quote.estimatedDate || ''}
                                                                    onChange={(e) => handleQuotationChange(garageId, 'estimatedDate', e.target.value)}
                                                                    className="block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                                    disabled={request.status !== MaintenanceStatus.UNDER_ESTIMATION}
                                                                />
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                                                                <div className="flex items-center gap-2">
                                                                    {quote.attachmentUrl ? (
                                                                        <div className="flex items-center gap-2">
                                                                            <a
                                                                                href={quote.attachmentUrl}
                                                                                target="_blank"
                                                                                rel="noreferrer"
                                                                                className="text-sm text-blue-600 hover:underline truncate max-w-[150px]"
                                                                                title={quote.attachmentName}
                                                                            >
                                                                                {quote.attachmentName || 'View Attachment'}
                                                                            </a>
                                                                            {request.status === MaintenanceStatus.UNDER_ESTIMATION && (
                                                                                <button
                                                                                    onClick={() => {
                                                                                        handleQuotationChange(garageId, 'attachmentUrl', undefined);
                                                                                        handleQuotationChange(garageId, 'attachmentName', undefined);
                                                                                    }}
                                                                                    className="text-red-500 hover:text-red-700"
                                                                                >
                                                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                                                                        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                                                                    </svg>
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="relative">
                                                                            <input
                                                                                type="file"
                                                                                id={`file-${garageId}`}
                                                                                className="hidden"
                                                                                accept=".pdf,.png,.jpg,.jpeg"
                                                                                onChange={(e) => {
                                                                                    const file = e.target.files?.[0];
                                                                                    if (file) {
                                                                                        const url = URL.createObjectURL(file);
                                                                                        handleQuotationChange(garageId, 'attachmentUrl', url);
                                                                                        handleQuotationChange(garageId, 'attachmentName', file.name);
                                                                                    }
                                                                                }}
                                                                                disabled={request.status !== MaintenanceStatus.UNDER_ESTIMATION}
                                                                            />
                                                                            <label
                                                                                htmlFor={`file-${garageId}`}
                                                                                className={`cursor-pointer inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 ${request.status !== MaintenanceStatus.UNDER_ESTIMATION ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                                            >
                                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-2 text-slate-500">
                                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                                                                                </svg>
                                                                            </label>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                                <button
                                                                    onClick={() => handleViewHistory(garageId)}
                                                                    className="text-slate-400 hover:text-slate-600"
                                                                    title="View History"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                                                    </svg>
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )
                        }

                        {/* Timeline */}
                        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                            <h3 className="text-sm font-bold text-slate-900 uppercase mb-4">Timeline</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs text-slate-500">Requested Date</label>
                                    <p className="text-sm font-medium text-slate-900">{new Date(request.requestDate).toLocaleDateString()}</p>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500">Estimated Completion Date</label>
                                    {isEditMode ? (
                                        <input
                                            type="date"
                                            min={new Date().toISOString().split('T')[0]}
                                            value={editedFields.expectedEndDate || ''}
                                            onChange={(e) => handleFieldChange('expectedEndDate', e.target.value)}
                                            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    ) : (
                                        <p className="text-sm font-medium text-slate-900">{request.expectedEndDate ? new Date(request.expectedEndDate).toLocaleDateString() : 'Not set'}</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Cost Summary - Only visible when completed */}
                        {
                            (request.status === MaintenanceStatus.CLOSED ||
                                request.status === MaintenanceStatus.MAINTENANCE_COMPLETED) && (
                                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                                    <h3 className="text-sm font-bold text-slate-900 uppercase mb-4">Cost Summary</h3>
                                    <div className="space-y-3">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-500">Parts:</span>
                                            <span className="font-medium text-slate-900">
                                                AED {(request.actualPartsCost || 0).toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-500">Labor:</span>
                                            <span className="font-medium text-slate-900">
                                                AED {(request.actualLaborCost || 0).toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-500">Other:</span>
                                            <span className="font-medium text-slate-900">
                                                AED {(request.actualOtherCost || 0).toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-sm font-bold border-t border-slate-200 pt-2">
                                            <span className="text-slate-900">Total:</span>
                                            <span className="text-blue-600">
                                                AED {(request.actualCost || 0).toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )
                        }

                        {/* Work Order Info - Only visible when approved/under maintenance */}
                        {
                            (request.status === MaintenanceStatus.UNDER_MAINTENANCE ||
                                request.status === MaintenanceStatus.UNDER_ESTIMATION ||
                                request.status === MaintenanceStatus.MAINTENANCE_COMPLETED ||
                                request.status === MaintenanceStatus.CLOSED ||
                                request.status === MaintenanceStatus.ESTIMATION_APPROVED) && request.workOrderNo && (
                                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                                    <h3 className="text-sm font-bold text-slate-900 uppercase mb-6">Work Order Details</h3>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-6">
                                            <div>
                                                <label className="block text-xs text-slate-500">Work Order Number</label>
                                                <p className="text-lg font-bold text-blue-600">{request.workOrderNo}</p>
                                            </div>
                                            <div>
                                                <label className="block text-xs text-slate-500">Vehicle</label>
                                                <p className="text-sm font-medium text-slate-900">{vehicle?.make} {vehicle?.model} ({vehicle?.year})</p>
                                                <p className="text-xs text-slate-500">{vehicle?.licensePlate} • VIN: {vehicle?.vin}</p>
                                            </div>
                                            <div>
                                                <label className="block text-xs text-slate-500">Current Mileage</label>
                                                <p className="text-sm font-medium text-slate-900">{request.odometer?.toLocaleString()} km</p>
                                            </div>
                                            <div>
                                                <label className="block text-xs text-slate-500">Estimation Approved By</label>
                                                <p className="text-sm font-medium text-slate-900">Maintenance Manager</p>
                                                {/* <p className="text-sm font-medium text-slate-900">{request.estimateApproval?.approvedByName || 'N/A'}</p> */}
                                                {/* {request.estimateApproval?.approvedAt && (
                                                    <p className="text-xs text-slate-500">{new Date(request.estimateApproval.approvedAt).toLocaleDateString()}</p>
                                                )} */}
                                            </div>
                                        </div>

                                        <div className="space-y-6">
                                            <div>
                                                <label className="block text-xs text-slate-500">Maintenance Type</label>
                                                <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10 mt-1">
                                                    {request.maintenanceType || 'N/A'}
                                                </span>
                                            </div>
                                            <div>
                                                <label className="block text-xs text-slate-500 mb-2">Maintenance Jobs</label>
                                                {request.maintenanceJobs && request.maintenanceJobs.length > 0 ? (
                                                    <ul className="list-disc pl-4 space-y-1">
                                                        {request.maintenanceJobs.map((job) => (
                                                            <li key={job} className="text-sm text-slate-700">{job}</li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <p className="text-sm text-slate-400 italic">No jobs listed</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )
                        }

                        {/* Attachments */}
                        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-sm font-bold text-slate-900 uppercase">Attachments</h3>
                                {request.status !== MaintenanceStatus.MAINTENANCE_COMPLETED && (
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
            </div >

            {/* Attachment Upload Modal */}
            {
                showAttachmentModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                            <h3 className="text-lg font-bold text-slate-900 mb-4">Upload Attachment</h3>

                            <div className="space-y-4">
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
                )
            }

            {/* Review Estimation Modal */}
            {
                showReviewModal && selectedGarageForApproval && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                        <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
                            <h3 className="text-lg font-bold text-slate-900 mb-4">Review Estimation</h3>

                            <div className="space-y-4">
                                <div className="rounded-lg bg-slate-50 p-4 border border-slate-100">
                                    <h4 className="text-sm font-medium text-slate-900 mb-3">Quotation Summary</h4>
                                    <dl className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <dt className="text-slate-500">Garage:</dt>
                                            <dd className="font-medium text-slate-900">
                                                {garages.find(g => g.id === selectedGarageForApproval)?.name}
                                            </dd>
                                        </div>
                                        <div className="flex justify-between">
                                            <dt className="text-slate-500">Parts Cost:</dt>
                                            <dd className="font-medium text-slate-900">
                                                AED {(quotations[selectedGarageForApproval]?.partsCost || 0).toFixed(2)}
                                            </dd>
                                        </div>
                                        <div className="flex justify-between">
                                            <dt className="text-slate-500">Labor Cost:</dt>
                                            <dd className="font-medium text-slate-900">
                                                AED {(quotations[selectedGarageForApproval]?.laborCost || 0).toFixed(2)}
                                            </dd>
                                        </div>
                                        <div className="flex justify-between border-t border-slate-200 pt-1 mt-1">
                                            <dt className="text-slate-700 font-bold">Total Cost:</dt>
                                            <dd className="font-bold text-blue-600">
                                                AED {(quotations[selectedGarageForApproval]?.totalCost || quotations[selectedGarageForApproval]?.amount || 0).toFixed(2)}
                                            </dd>
                                        </div>
                                        <div className="flex justify-between">
                                            <dt className="text-slate-500">Est. Completion:</dt>
                                            <dd className="font-medium text-slate-900">
                                                {quotations[selectedGarageForApproval]?.estimatedDate
                                                    ? new Date(quotations[selectedGarageForApproval]?.estimatedDate).toLocaleDateString()
                                                    : 'N/A'}
                                            </dd>
                                        </div>
                                        <div className="flex justify-between items-center pt-2 border-t border-slate-200 mt-2">
                                            <dt className="text-slate-500">Attachment:</dt>
                                            <dd>
                                                {quotations[selectedGarageForApproval]?.attachmentUrl ? (
                                                    <a
                                                        href={quotations[selectedGarageForApproval].attachmentUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-blue-600 hover:underline flex items-center gap-1"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                                                        </svg>
                                                        View File
                                                    </a>
                                                ) : (
                                                    <span className="text-slate-400 italic">No attachment</span>
                                                )}
                                            </dd>
                                        </div>
                                    </dl>
                                </div>

                                <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-3">
                                    <p className="text-xs text-yellow-800">
                                        Approving this estimation will generate a Work Order and notify the garage to proceed.
                                    </p>
                                </div>
                            </div>

                            <div className="mt-6 flex justify-end gap-3">
                                <button
                                    onClick={() => setShowReviewModal(false)}
                                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        handleRejectEstimate();
                                        setShowReviewModal(false);
                                    }}
                                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-100"
                                >
                                    Reject
                                </button>
                                <button
                                    onClick={() => {
                                        handleApproveEstimate();
                                        setShowReviewModal(false);
                                    }}
                                    className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 shadow-sm"
                                >
                                    Approve Estimation
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Quotation History Modal */}
            {
                showHistoryModal && historyGarageId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                        <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-bold text-slate-900">
                                    Quotation History - {garages.find(g => g.id === historyGarageId)?.name}
                                </h2>
                                <button onClick={() => setShowHistoryModal(false)} className="text-slate-400 hover:text-slate-600">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                                {request?.quotations
                                    ?.filter(q => q.garageId === historyGarageId)
                                    .sort((a, b) => new Date(b.quotationDate).getTime() - new Date(a.quotationDate).getTime())
                                    .map((quote, index) => (
                                        <div key={quote.id} className="p-4 rounded-lg border border-slate-200 bg-slate-50">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-xs font-medium text-slate-500">
                                                    {new Date(quote.quotationDate).toLocaleString()}
                                                </span>
                                                {index === 0 && (
                                                    <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                                                        Latest
                                                    </span>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-2 gap-4 text-sm">
                                                <div>
                                                    <span className="text-slate-500">Total Cost:</span>
                                                    <div className="font-medium">AED {quote.totalCost.toFixed(2)}</div>
                                                </div>
                                                <div>
                                                    <span className="text-slate-500">Estimated Completion:</span>
                                                    <div className="font-medium">{quote.estimatedCompletionDate ? new Date(quote.estimatedCompletionDate).toLocaleDateString() : 'N/A'}</div>
                                                </div>
                                                <div className="col-span-2">
                                                    <span className="text-slate-500">Attachment:</span>
                                                    <div>
                                                        {quote.attachments && quote.attachments.length > 0 ? (
                                                            <a href={quote.attachments[0].url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                                                                {quote.attachments[0].fileName || 'View Attachment'}
                                                            </a>
                                                        ) : (
                                                            <span className="text-slate-400">No attachment</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                }
                                {(!request?.quotations?.some(q => q.garageId === historyGarageId)) && (
                                    <p className="text-center text-slate-500 py-4">No history available.</p>
                                )}
                            </div>

                            <div className="mt-6 flex justify-end">
                                <button
                                    onClick={() => setShowHistoryModal(false)}
                                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
            {showGaragePicker && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 backdrop-blur-sm p-4">
                    <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
                        <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="font-bold text-lg text-slate-800">Add Garage from Master</h3>
                            <button onClick={() => setShowGaragePicker(false)} className="text-slate-400 hover:text-slate-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="p-4 border-b border-slate-100">
                            <input
                                type="text"
                                placeholder="Search garage name..."
                                className="w-full rounded-lg border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                                value={garageSearchTerm}
                                onChange={(e) => setGarageSearchTerm(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="overflow-y-auto p-4 space-y-2 flex-1">
                            {garages
                                .filter(g => !candidateGarageIds.includes(g.id))
                                .filter(g => g.name.toLowerCase().includes(garageSearchTerm.toLowerCase()))
                                .map(garage => (
                                    <div key={garage.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                                        <div>
                                            <h4 className="font-medium text-slate-900">{garage.name}</h4>
                                            <div className="flex gap-2 text-xs text-slate-500">
                                                <span>{garage.location}</span>
                                                <span>•</span>
                                                <span>•</span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleAddGarageToShortlist(garage.id)}
                                            className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-200 transition-colors"
                                        >
                                            Add
                                        </button>
                                    </div>
                                ))
                            }
                            {garages.filter(g => !candidateGarageIds.includes(g.id) && g.name.toLowerCase().includes(garageSearchTerm.toLowerCase())).length === 0 && (
                                <div className="text-center py-8">
                                    <p className="text-slate-500">No matching garages found.</p>
                                    <p className="text-xs text-slate-400 mt-1">Try adjusting your search terms.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
