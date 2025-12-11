'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    WorkOrder,
    WorkOrderStatus,
    WorkLogEntry,
    PartUsage,
    Technician,
    PartSource,
    Vehicle,
    Garage,
    EnhancedMaintenanceRequest,
    MaintenanceStatus,
    MaintenanceType,
    Attachment,
    Attachment,
    AttachmentType,
    QuotationStatus
} from '@/types/maintenance';
import {
    getMaintenanceRequests,
    getVehicles,
    getGarages,
    updateMaintenanceRequest
} from '@/services/mockData';
import { formatCurrency } from '@/utils/currency';
import { Permission, hasPermission, getCurrentUserRole } from '@/services/rbac';
import { useToast } from '@/contexts/ToastContext';

export default function WorkOrderPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    // In our list view, we link to /maintenance/work-orders/[requestId]
    // So params.id is actually the requestId
    const requestId = decodeURIComponent(params?.id as string);

    // Mock data
    const mockTechnicians: Technician[] = [
        { id: 'tech-1', name: 'Mike Johnson', specialization: ['Engine', 'Transmission'], certifications: ['ASE Master'], garageId: 'g1' },
        { id: 'tech-2', name: 'Sarah Williams', specialization: ['Electrical', 'Diagnostics'], certifications: ['ASE Electrical'], garageId: 'g1' },
        { id: 'tech-3', name: 'David Brown', specialization: ['Brakes', 'Suspension'], certifications: ['ASE Brakes'], garageId: 'g2' }
    ];

    const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
    const [request, setRequest] = useState<EnhancedMaintenanceRequest | null>(null);
    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [garage, setGarage] = useState<Garage | null>(null);
    const [loading, setLoading] = useState(true);

    // Modals
    const [showAddLogModal, setShowAddLogModal] = useState(false);
    const [showAddPartModal, setShowAddPartModal] = useState(false);
    const [showCostEntryModal, setShowCostEntryModal] = useState(false);
    const [showCompletionModal, setShowCompletionModal] = useState(false);

    // Edit states
    const [editingLogId, setEditingLogId] = useState<string | null>(null);
    const [editingPartId, setEditingPartId] = useState<string | null>(null);

    // Form states
    const [logForm, setLogForm] = useState({
        technicianId: '',
        technicianName: '',
        activity: '',
        hoursSpent: 0,
        notes: ''
    });

    const [partForm, setPartForm] = useState({
        partName: '',
        partNumber: '',
        quantityUsed: 1,
        unitCost: 0,
        source: PartSource.STOCK
    });

    // TRIPEXL: Cost Entry Form
    const [costForm, setCostForm] = useState({
        actualPartsCost: 0,
        actualLaborCost: 0,
        actualOtherCharges: 0,
        laborRate: 150, // AED per hour
        notes: ''
    });

    // TRIPEXL: Completion Form
    const [completionForm, setCompletionForm] = useState({
        completionNotes: '',
        qualityCheckPassed: true,
        customerNotified: false
    });

    // TRIPEXL: View Mode & Details Editing
    const [viewMode, setViewMode] = useState<'MAINTENANCE' | 'GARAGE'>('MAINTENANCE');
    const [isEditingDetails, setIsEditingDetails] = useState(false);
    const [detailsForm, setDetailsForm] = useState({
        maintenanceType: 'Preventive' as MaintenanceType,
        maintenanceJobs: [] as string[],
        estimatedCompletionDate: '',
        assignedTechnicians: [] as string[]
    });

    // TRIPEXL: Add Technician Feature
    const [availableTechnicians, setAvailableTechnicians] = useState(mockTechnicians);
    const [showAddTechnicianModal, setShowAddTechnicianModal] = useState(false);
    const [newTechnicianForm, setNewTechnicianForm] = useState({
        name: '',
        specialization: ''
    });

    // RBAC
    const currentUserRole = getCurrentUserRole();
    const canCompleteWorkOrder = hasPermission(currentUserRole, Permission.COMPLETE_MAINTENANCE);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [requests, vehicles, garages] = await Promise.all([
                    getMaintenanceRequests(),
                    getVehicles(),
                    getGarages()
                ]);

                const foundRequest = requests.find(r => r.id === requestId) as EnhancedMaintenanceRequest;

                if (foundRequest) {
                    setRequest(foundRequest);

                    const foundVehicle = vehicles.find(v => v.id === foundRequest.vehicleId);
                    setVehicle(foundVehicle || null);

                    const foundGarage = garages.find(g => g.id === foundRequest.garageId);
                    setGarage(foundGarage || null);

                    // Construct Work Order from Request
                    // In a real app, we would fetch the Work Order by ID or Request ID
                    // Here we mock it based on the request
                    const generatedWorkOrder: WorkOrder = {
                        id: foundRequest.workOrderNo || `WO-${foundRequest.id.toUpperCase()}`,
                        requestId: foundRequest.id,
                        garageId: foundRequest.garageId || '',
                        quotationId: foundRequest.selectedQuotationId,
                        assignedTechnicians: [], // Would come from DB
                        startDate: foundRequest.requestDate,
                        estimatedCompletionDate: foundRequest.expectedEndDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                        workLog: foundRequest.workLog || [],
                        partsUsed: foundRequest.partsUsed || [],
                        totalLaborHours: (foundRequest.workLog || []).reduce((sum, log) => sum + log.hoursSpent, 0),
                        status: mapMaintenanceStatusToWorkOrderStatus(foundRequest.status),
                        checklistItems: foundRequest.checklistItems || [
                            { id: 'check-1', task: 'Initial Inspection', completed: false },
                            { id: 'check-2', task: 'Diagnostic Test', completed: false },
                            { id: 'check-3', task: 'Parts Replacement', completed: false },
                            { id: 'check-4', task: 'Test Drive', completed: false },
                            { id: 'check-5', task: 'Quality Check', completed: false }
                        ],
                        actualCosts: foundRequest.actualCosts
                    };
                    setWorkOrder(generatedWorkOrder);

                    setDetailsForm({
                        maintenanceType: foundRequest.maintenanceType || 'Preventive' as MaintenanceType,
                        maintenanceJobs: foundRequest.maintenanceJobs || [],
                        estimatedCompletionDate: generatedWorkOrder.estimatedCompletionDate.split('T')[0],
                        assignedTechnicians: []
                    });
                }
            } catch (error) {
                console.error("Error fetching work order data:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [requestId]);

    const mapMaintenanceStatusToWorkOrderStatus = (status: MaintenanceStatus): WorkOrderStatus => {
        switch (status) {
            case MaintenanceStatus.UNDER_MAINTENANCE:
                return WorkOrderStatus.IN_PROGRESS;
            case MaintenanceStatus.MAINTENANCE_COMPLETED:
                return WorkOrderStatus.COMPLETED;
            case MaintenanceStatus.PENDING_INVOICE:
                return WorkOrderStatus.SUBMIT_INVOICE;
            case MaintenanceStatus.CLOSED:
                return WorkOrderStatus.COMPLETED; // Or CLOSED if added
            default:
                return WorkOrderStatus.NOT_STARTED;
        }
    };

    const allowedTransitions: Record<WorkOrderStatus, WorkOrderStatus[]> = {
        [WorkOrderStatus.NOT_STARTED]: [WorkOrderStatus.IN_PROGRESS],
        [WorkOrderStatus.IN_PROGRESS]: [WorkOrderStatus.QUALITY_CHECK, WorkOrderStatus.COMPLETED],
        [WorkOrderStatus.ON_HOLD]: [WorkOrderStatus.IN_PROGRESS],
        [WorkOrderStatus.QUALITY_CHECK]: [WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.COMPLETED],
        [WorkOrderStatus.COMPLETED]: [WorkOrderStatus.SUBMIT_INVOICE],
        [WorkOrderStatus.SUBMIT_INVOICE]: [], // End of garage workflow
    };

    const handleAddWorkLog = () => {
        if (!workOrder || !logForm.technicianId || !logForm.activity) {
            addToast('Please fill in all required fields', 'error');
            return;
        }

        const selectedTech = availableTechnicians.find(t => t.id === logForm.technicianId);

        let newWorkLog = [...workOrder.workLog];
        if (editingLogId) {
            // Update existing log
            newWorkLog = newWorkLog.map(log => {
                if (log.id === editingLogId) {
                    return {
                        ...log,
                        technicianId: logForm.technicianId,
                        technicianName: selectedTech?.name || '',
                        activity: logForm.activity,
                        hoursSpent: logForm.hoursSpent,
                        notes: logForm.notes
                    };
                }
                return log;
            });
        } else {
            // Add new log
            const newLog: WorkLogEntry = {
                id: `log-${Date.now()}`,
                timestamp: new Date().toISOString(),
                technicianId: logForm.technicianId,
                technicianName: selectedTech?.name || '',
                activity: logForm.activity,
                hoursSpent: logForm.hoursSpent,
                notes: logForm.notes,
                photos: []
            };
            newWorkLog.push(newLog);
        }

        // Recalculate total hours
        const totalHours = newWorkLog.reduce((sum, log) => sum + log.hoursSpent, 0);

        // Update local state
        setWorkOrder({
            ...workOrder,
            workLog: newWorkLog,
            totalLaborHours: totalHours
        });

        // Persist to backend
        if (request) {
            updateMaintenanceRequest(request.id, { workLog: newWorkLog })
                .catch(err => console.error('Failed to persist work log:', err));
        }

        setShowAddLogModal(false);
        setEditingLogId(null);
        setLogForm({ technicianId: '', technicianName: '', activity: '', hoursSpent: 0, notes: '' });
    };

    const handleEditLog = (log: WorkLogEntry) => {
        setLogForm({
            technicianId: log.technicianId,
            technicianName: log.technicianName,
            activity: log.activity,
            hoursSpent: log.hoursSpent,
            notes: log.notes || ''
        });
        setEditingLogId(log.id);
        setShowAddLogModal(true);
    };

    const handleAddPart = () => {
        if (!workOrder || !partForm.partName) {
            addToast('Please fill in all required fields', 'error');
            return;
        }

        let newPartsUsed = [...workOrder.partsUsed];
        if (editingPartId) {
            // Update existing part
            newPartsUsed = newPartsUsed.map(part => {
                if (part.id === editingPartId) {
                    return {
                        ...part,
                        partName: partForm.partName,
                        partNumber: partForm.partNumber,
                        quantityUsed: partForm.quantityUsed,
                        unitCost: partForm.unitCost,
                        totalCost: partForm.quantityUsed * partForm.unitCost,
                        source: partForm.source
                    };
                }
                return part;
            });
        } else {
            // Add new part
            const newPart: PartUsage = {
                id: `part-${Date.now()}`,
                partId: `p-${Date.now()}`,
                partName: partForm.partName,
                partNumber: partForm.partNumber,
                quantityUsed: partForm.quantityUsed,
                unitCost: partForm.unitCost,
                totalCost: partForm.quantityUsed * partForm.unitCost,
                source: partForm.source
            };
            newPartsUsed.push(newPart);
        }

        // Update local state
        setWorkOrder({
            ...workOrder,
            partsUsed: newPartsUsed
        });

        // Persist to backend
        if (request) {
            updateMaintenanceRequest(request.id, { partsUsed: newPartsUsed })
                .catch(err => console.error('Failed to persist parts used:', err));
        }

        setShowAddPartModal(false);
        setEditingPartId(null);
        setPartForm({ partName: '', partNumber: '', quantityUsed: 1, unitCost: 0, source: PartSource.STOCK });
    };

    const handleEditPart = (part: PartUsage) => {
        setPartForm({
            partName: part.partName,
            partNumber: part.partNumber || '',
            quantityUsed: part.quantityUsed,
            unitCost: part.unitCost,
            source: part.source
        });
        setEditingPartId(part.id);
        setShowAddPartModal(true);
    };

    // TRIPEXL: Handle Cost Entry
    const handleCostEntry = () => {
        if (!workOrder) return;

        const totalActualCost = costForm.actualPartsCost + costForm.actualLaborCost + costForm.actualOtherCharges;

        const actualCosts = {
            parts: costForm.actualPartsCost,
            labor: costForm.actualLaborCost,
            other: costForm.actualOtherCharges,
            total: totalActualCost
        };

        // Update work order with actual costs
        const updatedWorkOrder = {
            ...workOrder,
            actualCosts
        };
        setWorkOrder(updatedWorkOrder);

        // Persist to backend
        if (request) {
            updateMaintenanceRequest(request.id, {
                actualCosts,
                // Also update flat fields for compatibility with Request Details page
                actualPartsCost: costForm.actualPartsCost,
                actualLaborCost: costForm.actualLaborCost,
                actualOtherCost: costForm.actualOtherCharges,
                actualCost: totalActualCost
            }).catch(err => console.error('Failed to persist actual costs:', err));
        }

        setShowCostEntryModal(false);
        addToast('Actual costs recorded successfully!', 'success');
    };

    // TRIPEXL: Handle Details Update
    const handleUpdateDetails = () => {
        if (!request || !workOrder) return;

        // Update Request Details
        setRequest({
            ...request,
            maintenanceType: detailsForm.maintenanceType,
            maintenanceJobs: detailsForm.maintenanceJobs
        });

        // Update Work Order Details
        const updatedTechnicians = availableTechnicians.filter(t => detailsForm.assignedTechnicians.includes(t.id));
        setWorkOrder({
            ...workOrder,
            estimatedCompletionDate: new Date(detailsForm.estimatedCompletionDate).toISOString(),
            assignedTechnicians: updatedTechnicians
        });

        setIsEditingDetails(false);
        addToast('Work order details updated successfully', 'success');
    };

    // TRIPEXL: Handle Add New Technician
    const handleAddTechnician = () => {
        if (!newTechnicianForm.name || !newTechnicianForm.specialization) {
            addToast('Please fill in all fields', 'error');
            return;
        }

        const newTech = {
            id: `t${Date.now()}`,
            name: newTechnicianForm.name,
            specialization: newTechnicianForm.specialization.split(',').map(s => s.trim()),
            availabilityStatus: 'AVAILABLE' as const,
            currentLoad: 0,
            garageId: garage?.id || '',
            certifications: []
        };

        setAvailableTechnicians([...availableTechnicians, newTech]);
        setDetailsForm({
            ...detailsForm,
            assignedTechnicians: [...detailsForm.assignedTechnicians, newTech.id]
        });

        if (workOrder) {
            setWorkOrder({
                ...workOrder,
                assignedTechnicians: [...workOrder.assignedTechnicians, newTech]
            });
        }

        setShowAddTechnicianModal(false);
        setNewTechnicianForm({ name: '', specialization: '' });
    };

    // TRIPEXL: Handle Work Order Completion
    const handleCompleteWorkOrder = async () => {
        console.log('handleCompleteWorkOrder called');
        if (!workOrder || !request) {
            console.error('Missing workOrder or request', { workOrder, request });
            return;
        }

        // Check if all checklist items are completed
        const allCompleted = workOrder.checklistItems?.every(item => item.completed) ?? false;
        if (!allCompleted) {
            addToast('Please complete all checklist items before closing the work order', 'error');
            return;
        }

        // Check if costs are entered
        if (!workOrder.actualCosts) {
            addToast('Please enter actual costs before completing the work order', 'error');
            return;
        }

        // Check Work Log
        if (!workOrder.workLog || workOrder.workLog.length === 0) {
            console.warn('Work log is empty');
            addToast('Please add at least one Work Log entry before completing the work order.', 'error');
            return;
        }

        // Check Parts Used
        if (!workOrder.partsUsed || workOrder.partsUsed.length === 0) {
            console.log('No parts used, asking for confirmation');
            const confirmNoParts = window.confirm('No parts have been used. Are you sure you want to complete without parts?');
            if (!confirmNoParts) return;
        }

        const completionDate = new Date().toISOString();

        // Record status transition
        const statusTransition = {
            from: request.status,
            to: MaintenanceStatus.MAINTENANCE_COMPLETED,
            transitionedAt: completionDate,
            transitionedBy: 'maintenance-user-1',
            transitionedByName: 'Maintenance Manager',
            comments: completionForm.completionNotes,
            automated: false
        };

        console.log('Work order completed:', {
            workOrderId: workOrder.id,
            requestId: request.id,
            newStatus: MaintenanceStatus.MAINTENANCE_COMPLETED,
            statusTransition,
            actualCompletionDate: completionDate
        });

        // Update local state for immediate feedback
        setWorkOrder({
            ...workOrder,
            status: WorkOrderStatus.COMPLETED,
            actualCompletionDate: completionDate
        });

        // Trigger Email Notification if requested
        if (completionForm.customerNotified) {
            console.group('📧 CUSTOMER NOTIFICATION TRIGGERED');
            console.log(`To: Customer (Vehicle Owner)`);
            console.log(`Subject: Work Order ${workOrder.workOrderNo || workOrder.id} Completed`);
            console.log(`Body: Dear Customer, your vehicle maintenance has been completed. Details:`);
            console.log(`- Total Cost: ${formatCurrency(workOrder.actualCosts?.total || 0)}`);
            console.log(`- Completion Notes: ${completionForm.completionNotes}`);
            console.groupEnd();

            // Simulate API latency
            await new Promise(resolve => setTimeout(resolve, 500));
            addToast('Customer notification email sent successfully!', 'success');
        }

        // Save to backend
        try {
            await updateMaintenanceRequest(request.id, {
                status: MaintenanceStatus.MAINTENANCE_COMPLETED,
                actualCompletionDate: completionDate,
                history: [...(request.history || []), statusTransition]
            });
            console.log('Backend updated successfully');
        } catch (error) {
            console.error('Failed to update backend status', error);
            addToast('Failed to update status on server, but local state updated.', 'warning');
        }

        addToast('Work order completed successfully! Request status updated to Maintenance Completed.', 'success');
        setShowCompletionModal(false);
    };

    const toggleChecklistItem = (itemId: string) => {
        if (!workOrder) return;

        const updatedItems = workOrder.checklistItems.map(item => {
            if (item.id === itemId) {
                return {
                    ...item,
                    completed: !item.completed,
                    completedBy: !item.completed ? 'Current User' : undefined,
                    completedAt: !item.completed ? new Date().toISOString() : undefined
                };
            }
            return item;
        });

        setWorkOrder({ ...workOrder, checklistItems: updatedItems });

        // Persist to backend
        if (request) {
            updateMaintenanceRequest(request.id, { checklistItems: updatedItems })
                .catch(err => console.error('Failed to persist checklist:', err));
        }
    };

    const updateWorkOrderStatus = async (newStatus: WorkOrderStatus) => {
        if (!workOrder) return;

        // Validation for QUALITY_CHECK
        if (newStatus === WorkOrderStatus.QUALITY_CHECK) {
            // Find index of Quality Check item
            const qcIndex = workOrder.checklistItems.findIndex(i => i.task === 'Quality Check');
            if (qcIndex !== -1) {
                // Check if all items before QC are completed
                const preQcItems = workOrder.checklistItems.slice(0, qcIndex);
                const allPreQcCompleted = preQcItems.every(i => i.completed);
                if (!allPreQcCompleted) {
                    addToast('Please complete all checklist items (Inspection, Diagnostics, Repairs, Test Drive) before moving to Quality Check.', 'error');
                    return;
                }
            }

            // Validate Work Log and Parts Used
            if (!workOrder.workLog || workOrder.workLog.length === 0) {
                addToast('Please add at least one Work Log entry before moving to Quality Check.', 'error');
                return;
            }

            if (!workOrder.partsUsed || workOrder.partsUsed.length === 0) {
                addToast('Please add at least one Part Used entry before moving to Quality Check.', 'error');
                return;
            }
        }

        // Validation for SUBMIT_INVOICE
        if (newStatus === WorkOrderStatus.SUBMIT_INVOICE) {
            if (!workOrder.invoiceAttachments || workOrder.invoiceAttachments.length === 0) {
                addToast('Please attach an invoice before submitting.', 'error');
                return;
            }

            // Sync invoice to Maintenance Request
            if (request) {
                try {
                    const existingAttachments = request.attachments || [];
                    const newAttachments = workOrder.invoiceAttachments.filter(
                        inv => !existingAttachments.some(existing => existing.id === inv.id)
                    );

                    if (newAttachments.length > 0) {
                        const updatedAttachments = [...existingAttachments, ...newAttachments];
                        await updateMaintenanceRequest(request.id, {
                            attachments: updatedAttachments,
                            status: MaintenanceStatus.INVOICE_SUBMITTED // Ensure status is synced
                        });
                        setRequest({ ...request, attachments: updatedAttachments, status: MaintenanceStatus.INVOICE_SUBMITTED });
                    }
                } catch (error) {
                    console.error('Failed to sync invoice to request:', error);
                    addToast('Failed to sync invoice to request. Please try again.', 'error');
                    return;
                }
            }
        }

        // Validation for COMPLETED (if manually selected)
        if (newStatus === WorkOrderStatus.COMPLETED) {
            // Reuse validation logic or call handleCompleteWorkOrder if appropriate
            // For now, simple check
            if (workOrder.workLog.length === 0) {
                addToast('Please add at least one Work Log entry before completing.', 'error');
                return;
            }
        }

        let updates: Partial<WorkOrder> = { status: newStatus };

        if (newStatus === WorkOrderStatus.COMPLETED) {
            updates.actualCompletionDate = new Date().toISOString();
        }

        setWorkOrder({ ...workOrder, ...updates });
        addToast(`Work order status updated to ${newStatus}`, 'success');
    };

    const handleSaveProgress = async () => {
        if (!request || !workOrder) return;
        try {
            await updateMaintenanceRequest(request.id, {
                workLog: workOrder.workLog,
                partsUsed: workOrder.partsUsed,
                checklistItems: workOrder.checklistItems,
                actualCosts: workOrder.actualCosts,
                assignedTechnicians: workOrder.assignedTechnicians
                // Note: We don't update status here to avoid state machine conflicts
            });
            addToast('Work order progress saved successfully', 'success');
        } catch (error) {
            console.error('Failed to save progress:', error);
            addToast('Failed to save work order progress', 'error');
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!workOrder || !e.target.files || e.target.files.length === 0) return;

        const file = e.target.files[0];

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
            const base64Url = await fileToBase64(file);

            const newAttachment: Attachment = {
                id: `att-${Date.now()}`,
                type: AttachmentType.INVOICE,
                fileName: file.name,
                url: base64Url,
                uploadedAt: new Date().toISOString()
            };

            const updatedInvoiceAttachments = [...(workOrder.invoiceAttachments || []), newAttachment];

            setWorkOrder({
                ...workOrder,
                invoiceAttachments: updatedInvoiceAttachments
            });

            // Sync if in SUBMIT_INVOICE status
            if (workOrder.status === WorkOrderStatus.SUBMIT_INVOICE && request) {
                const existingAttachments = request.attachments || [];
                // Add to request attachments
                const updatedRequestAttachments = [...existingAttachments, newAttachment];

                await updateMaintenanceRequest(request.id, {
                    attachments: updatedRequestAttachments
                });
                setRequest({ ...request, attachments: updatedRequestAttachments });
            }
        } catch (error) {
            console.error('Failed to process invoice upload:', error);
            addToast('Failed to process invoice upload.', 'error');
        }
    };

    const removeAttachment = async (attachmentId: string) => {
        if (!workOrder) return;

        const updatedInvoiceAttachments = workOrder.invoiceAttachments?.filter(a => a.id !== attachmentId) || [];

        setWorkOrder({
            ...workOrder,
            invoiceAttachments: updatedInvoiceAttachments
        });

        // Sync if in SUBMIT_INVOICE status
        if (workOrder.status === WorkOrderStatus.SUBMIT_INVOICE) {
            try {
                // Remove from request attachments
                const updatedRequestAttachments = request?.attachments?.filter(a => a.id !== attachmentId) || [];

                // If no invoices left, revert status to COMPLETED
                if (updatedInvoiceAttachments.length === 0) {
                    setWorkOrder({
                        ...workOrder,
                        invoiceAttachments: updatedInvoiceAttachments,
                        status: WorkOrderStatus.COMPLETED
                    });
                }

                if (request) {
                    await updateMaintenanceRequest(request.id, {
                        attachments: updatedRequestAttachments
                    });
                    setRequest({ ...request, attachments: updatedRequestAttachments });
                }
            } catch (error) {
                console.error('Failed to sync invoice removal:', error);
                addToast('Failed to sync invoice removal.', 'error');
            }
        }
    };

    const getStatusColor = (status: WorkOrderStatus) => {
        switch (status) {
            case WorkOrderStatus.NOT_STARTED:
                return 'bg-slate-100 text-slate-700 border-slate-300';
            case WorkOrderStatus.IN_PROGRESS:
                return 'bg-blue-100 text-blue-700 border-blue-300';
            case WorkOrderStatus.ON_HOLD:
                return 'bg-yellow-100 text-yellow-700 border-yellow-300';
            case WorkOrderStatus.QUALITY_CHECK:
                return 'bg-purple-100 text-purple-700 border-purple-300';
            case WorkOrderStatus.COMPLETED:
                return 'bg-green-100 text-green-700 border-green-300';
            case WorkOrderStatus.SUBMIT_INVOICE:
                return 'bg-indigo-100 text-indigo-700 border-indigo-300';
            default:
                return 'bg-slate-100 text-slate-700 border-slate-300';
        }
    };

    const calculateTotalPartsCost = () => {
        return workOrder?.partsUsed.reduce((sum, part) => sum + part.totalCost, 0) || 0;
    };

    const calculateProgress = () => {
        if (!workOrder) return 0;
        const completed = workOrder.checklistItems.filter(item => item.completed).length;
        return Math.round((completed / workOrder.checklistItems.length) * 100);
    };

    const getEstimatedCosts = () => {
        if (!request || !request.quotations) return { parts: 0, labor: 0, other: 0, total: 0 };

        // Find the approved quotation
        const approvedQuote = request.quotations.find(q =>
            q.id === request.selectedQuotationId ||
            q.status === QuotationStatus.APPROVED
        );

        if (!approvedQuote) return { parts: 0, labor: 0, other: 0, total: 0 };

        // Calculate 'Other' as Consumables + VAT
        const parts = approvedQuote.partsCost || 0;
        const labor = approvedQuote.laborCost || 0;
        const consumables = approvedQuote.consumablesCost || 0;
        const vat = approvedQuote.vatAmount || 0;

        // 'Other' includes Consumables and VAT
        const other = consumables + vat;

        // Use grandTotal if available, otherwise calculate
        const total = approvedQuote.grandTotal || (parts + labor + other);

        return { parts, labor, other, total };
    };

    if (loading) return <div className="p-8 text-center text-slate-500">Loading work order...</div>;
    if (!workOrder) return <div className="p-8 text-center text-slate-500">Work order not found.</div>;

    const progress = calculateProgress();
    const estimatedCosts = getEstimatedCosts();
    const allChecklistCompleted = workOrder.checklistItems.every(item => item.completed);

    return (
        <div className="mx-auto max-w-7xl pb-12 space-y-8">
            {/* Print Header */}
            <div className="hidden print:block mb-8 border-b-2 border-slate-900 pb-4">
                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 uppercase tracking-wider">Work Order Details</h1>
                        <p className="text-sm text-slate-600 mt-1">ID: <span className="font-mono font-bold">{workOrder.id.toUpperCase()}</span></p>
                    </div>
                    <div className="text-right">
                        <p className="text-sm font-bold text-slate-900">{garage?.name}</p>
                        <p className="text-xs text-slate-500">Date: {new Date().toLocaleDateString()}</p>
                    </div>
                </div>
            </div>

            {/* Header */}
            <div className="flex items-center justify-between print:hidden">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <Link href="/maintenance/work-orders" className="text-slate-400 hover:text-slate-600">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                            </svg>
                        </Link>
                        <h1 className="text-lg font-bold text-slate-900">Work Order #{workOrder.id.toUpperCase()}</h1>
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium border ${getStatusColor(workOrder.status)}`}>
                            {workOrder.status}
                        </span>
                    </div>
                    <p className="text-slate-500 ml-8">
                        {vehicle?.make} {vehicle?.model} ({vehicle?.licensePlate}) • {garage?.name}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleSaveProgress}
                        className="rounded-lg bg-white border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-sm transition-colors"
                    >
                        Save Progress
                    </button>
                    {workOrder.status === WorkOrderStatus.IN_PROGRESS && allChecklistCompleted && !workOrder.actualCosts && (
                        <button
                            onClick={() => setShowCostEntryModal(true)}
                            disabled={viewMode !== 'GARAGE'}
                            className={`rounded-lg px-4 py-2 text-xs font-medium text-white ${viewMode === 'GARAGE' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-300 cursor-not-allowed opacity-50'}`}
                        >
                            Enter Actual Costs
                        </button>
                    )}
                    {workOrder.actualCosts && allChecklistCompleted && canCompleteWorkOrder && workOrder.status === WorkOrderStatus.IN_PROGRESS && (
                        <button
                            onClick={() => setShowCompletionModal(true)}
                            className="rounded-lg bg-green-600 px-4 py-2 text-xs font-medium text-white hover:bg-green-700"
                        >
                            Complete Work Order
                        </button>
                    )}
                    {workOrder.status === WorkOrderStatus.COMPLETED && (
                        <button
                            onClick={() => updateWorkOrderStatus(WorkOrderStatus.SUBMIT_INVOICE)}
                            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
                        >
                            Submit Invoice
                        </button>
                    )}
                    {/* View Mode Toggle (Dev Only) */}
                    <div className="flex items-center bg-slate-100 rounded-lg p-1 mr-2">
                        <button
                            onClick={() => setViewMode('MAINTENANCE')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'MAINTENANCE' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            Maintenance
                        </button>
                        <button
                            onClick={() => setViewMode('GARAGE')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'GARAGE' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            Garage
                        </button>
                    </div>
                    <select
                        value={workOrder.status}
                        onChange={(e) => updateWorkOrderStatus(e.target.value as WorkOrderStatus)}
                        disabled={viewMode !== 'GARAGE'}
                        className={`rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white text-slate-900 ${viewMode !== 'GARAGE' ? 'opacity-50 cursor-not-allowed bg-slate-100' : ''}`}
                    >
                        <option value={workOrder.status}>{workOrder.status}</option>
                        {allowedTransitions[workOrder.status]?.map(status => (
                            <option key={status} value={status}>{status}</option>
                        ))}
                    </select>
                    <button
                        onClick={() => window.print()}
                        className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 print:hidden"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
                        </svg>
                        Print
                    </button>
                </div>
            </div>

            <style jsx global>{`
                @media print {
                    @page {
                        size: A4;
                        margin: 10mm;
                    }
                    body {
                        background: white;
                        font-size: 10pt;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    
                    /* Hide Navigation and UI Elements */
                    nav, aside, .glass-panel, .print\\:hidden {
                        display: none !important;
                    }
                    
                    /* Hide ALL Buttons and Inputs */
                    button, input[type="file"], .btn {
                        display: none !important;
                    }
                    
                    /* Reset Layout */
                    main {
                        margin: 0 !important;
                        padding: 0 !important;
                        width: 100% !important;
                        max-width: none !important;
                    }
                    
                    /* Linearize Grid Layouts */
                    .grid {
                        display: block !important;
                    }
                    .lg\\:grid-cols-3, .md\\:grid-cols-2, .grid-cols-4 {
                        display: block !important;
                    }
                    .lg\\:col-span-2 {
                        width: 100% !important;
                    }
                    
                    /* Spacing Adjustments */
                    .space-y-8 > :not([hidden]) ~ :not([hidden]) {
                        margin-top: 1rem !important;
                    }
                    .gap-8, .gap-6, .gap-4 {
                        gap: 0 !important;
                    }
                    
                    /* Card Styling Removal */
                    .rounded-xl, .rounded-lg {
                        border-radius: 0 !important;
                        border: none !important;
                        box-shadow: none !important;
                        background: transparent !important;
                        padding: 0 !important;
                        margin-bottom: 1.5rem !important;
                    }
                    .shadow-sm {
                        box-shadow: none !important;
                    }
                    
                    /* Typography */
                    h1 { font-size: 24pt !important; margin-bottom: 0.5rem !important; }
                    h3 { 
                        font-size: 14pt !important; 
                        border-bottom: 1px solid #000; 
                        padding-bottom: 0.25rem; 
                        margin-bottom: 0.5rem !important;
                        color: #000 !important;
                    }
                    p, td, th, li, span, div, label {
                        color: #000 !important;
                    }
                    
                    /* Table Styling */
                    table {
                        width: 100% !important;
                        border-collapse: collapse !important;
                        margin-top: 0.5rem !important;
                    }
                    th {
                        background-color: #f3f4f6 !important;
                        border-bottom: 1px solid #000 !important;
                        font-weight: bold !important;
                        color: #000 !important;
                    }
                    td {
                        border-bottom: 1px solid #eee !important;
                    }
                    
                    /* Specific Section Visibility */
                    /* Ensure Sidebar content (Timeline, Checklist, Techs) is visible and flows naturally */
                    .lg\\:col-span-2 + div {
                        margin-top: 1rem !important;
                    }
                    
                    /* Hide "Edit Details" or other interactive text links */
                    a, .text-blue-600 {
                        text-decoration: none !important;
                        color: #000 !important;
                    }
                    
                    /* Specific Hiding */
                    /* Hide "Add Entry", "Add Part" buttons which might be just text in some contexts */
                    button { display: none !important; }
                }
            `}</style>

            {/* Progress Bar */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:hidden">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-700">Overall Progress</span>
                    <span className="text-sm font-bold text-blue-600">{progress}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3">
                    <div
                        className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>

            {/* Work Order Details */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-slate-900">Work Order Details</h3>
                    {viewMode === 'GARAGE' && !isEditingDetails && (
                        <button
                            onClick={() => setIsEditingDetails(true)}
                            className="text-sm font-medium text-blue-600 hover:text-blue-800"
                        >
                            Edit Details
                        </button>
                    )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left Column: Vehicle & WO Info */}
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs text-slate-500">Work Order Number</label>
                            <p className="text-sm font-medium text-slate-900">{workOrder.id.toUpperCase()}</p>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500">Vehicle</label>
                            <p className="text-sm font-medium text-slate-900">
                                {vehicle?.make} {vehicle?.model} ({vehicle?.year})
                            </p>
                            <p className="text-xs text-slate-500">{vehicle?.licensePlate} • VIN: {vehicle?.vin}</p>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500">Current Mileage</label>
                            <p className="text-sm font-medium text-slate-900">{vehicle?.currentMileage.toLocaleString()} km</p>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500">Estimation Approved By</label>
                            <p className="text-sm font-medium text-slate-900">
                                {request?.estimateApproval?.approvedByName || 'N/A'}
                            </p>
                        </div>
                    </div>

                    {/* Right Column: Maintenance Info */}
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs text-slate-500 mb-1">Maintenance Type</label>
                            {isEditingDetails ? (
                                <select
                                    value={detailsForm.maintenanceType}
                                    onChange={(e) => setDetailsForm({ ...detailsForm, maintenanceType: e.target.value as MaintenanceType })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white text-slate-900"
                                >
                                    {MaintenanceType && Object.values(MaintenanceType).map(type => (
                                        <option key={type} value={type}>{type}</option>
                                    ))}
                                </select>
                            ) : (
                                <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                                    {request?.maintenanceType || 'N/A'}
                                </span>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1">Maintenance Jobs</label>
                            {isEditingDetails ? (
                                <textarea
                                    value={detailsForm.maintenanceJobs.join('\n')}
                                    onChange={(e) => setDetailsForm({ ...detailsForm, maintenanceJobs: e.target.value.split('\n') })}
                                    rows={4}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white text-slate-900"
                                    placeholder="Enter jobs (one per line)"
                                />
                            ) : (
                                <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
                                    {request?.maintenanceJobs?.length ? (
                                        request.maintenanceJobs.map((job, idx) => (
                                            <li key={idx}>{job}</li>
                                        ))
                                    ) : (
                                        <li className="text-slate-400 italic">No jobs listed</li>
                                    )}
                                </ul>
                            )}
                        </div>
                        {isEditingDetails && (
                            <div className="flex justify-end gap-2 mt-2">
                                <button
                                    onClick={() => {
                                        setIsEditingDetails(false);
                                        // Reset form
                                        if (request) {
                                            if (request) {
                                                setDetailsForm({
                                                    maintenanceType: request.maintenanceType || 'Preventive' as MaintenanceType,
                                                    maintenanceJobs: request.maintenanceJobs || [],
                                                    estimatedCompletionDate: workOrder?.estimatedCompletionDate.split('T')[0] || '',
                                                    assignedTechnicians: workOrder?.assignedTechnicians.map(t => t.id) || []
                                                });
                                            }
                                        }
                                    }}
                                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleUpdateDetails}
                                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                                >
                                    Save Changes
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* TRIPEXL: Cost Comparison Card */}
            {workOrder.actualCosts && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-blue-900 mb-4">Cost Comparison - Estimated vs Actual</h3>
                    <div className="grid grid-cols-4 gap-4">
                        <div>
                            <p className="text-xs text-blue-700 mb-1">Parts</p>
                            <p className="text-sm text-blue-900">Est: {formatCurrency(estimatedCosts.parts)}</p>
                            <p className="text-sm font-bold text-blue-900">Act: {formatCurrency(workOrder.actualCosts.parts)}</p>
                            <p className={`text-xs mt-1 ${workOrder.actualCosts.parts > estimatedCosts.parts ? 'text-red-700' : 'text-green-700'}`}>
                                {workOrder.actualCosts.parts > estimatedCosts.parts ? '+' : ''}{formatCurrency(workOrder.actualCosts.parts - estimatedCosts.parts)}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-blue-700 mb-1">Labor</p>
                            <p className="text-sm text-blue-900">Est: {formatCurrency(estimatedCosts.labor)}</p>
                            <p className="text-sm font-bold text-blue-900">Act: {formatCurrency(workOrder.actualCosts.labor)}</p>
                            <p className={`text-xs mt-1 ${workOrder.actualCosts.labor > estimatedCosts.labor ? 'text-red-700' : 'text-green-700'}`}>
                                {workOrder.actualCosts.labor > estimatedCosts.labor ? '+' : ''}{formatCurrency(workOrder.actualCosts.labor - estimatedCosts.labor)}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-blue-700 mb-1">Other</p>
                            <p className="text-sm text-blue-900">Est: {formatCurrency(estimatedCosts.other)}</p>
                            <p className="text-sm font-bold text-blue-900">Act: {formatCurrency(workOrder.actualCosts.other)}</p>
                            <p className={`text-xs mt-1 ${workOrder.actualCosts.other > estimatedCosts.other ? 'text-red-700' : 'text-green-700'}`}>
                                {workOrder.actualCosts.other > estimatedCosts.other ? '+' : ''}{formatCurrency(workOrder.actualCosts.other - estimatedCosts.other)}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-blue-700 mb-1">Total</p>
                            <p className="text-sm text-blue-900">Est: {formatCurrency(estimatedCosts.total)}</p>
                            <p className="text-lg font-bold text-blue-900">Act: {formatCurrency(workOrder.actualCosts.total)}</p>
                            <p className={`text-sm font-bold mt-1 ${workOrder.actualCosts.total > estimatedCosts.total ? 'text-red-700' : 'text-green-700'}`}>
                                {workOrder.actualCosts.total > estimatedCosts.total ? '+' : ''}{formatCurrency(workOrder.actualCosts.total - estimatedCosts.total)}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Main Content */}
                <div className="lg:col-span-2 space-y-8">
                    {/* Work Log */}
                    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-900">Work Log</h3>
                            <button
                                onClick={() => setShowAddLogModal(true)}
                                disabled={viewMode !== 'GARAGE'}
                                className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white ${viewMode === 'GARAGE' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-300 cursor-not-allowed opacity-50'}`}
                            >
                                + Add Entry
                            </button>
                        </div>

                        <div className="space-y-4">
                            {workOrder.workLog.map(log => (
                                <div key={log.id} className="border-l-4 border-blue-500 pl-4 py-2">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex justify-between items-start">
                                                <p className="text-sm font-medium text-slate-900">{log.activity}</p>
                                                {viewMode === 'GARAGE' && (
                                                    <button
                                                        onClick={() => handleEditLog(log)}
                                                        className="text-slate-400 hover:text-blue-600"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                            <p className="text-xs text-slate-500 mt-1">
                                                {log.technicianName} • {new Date(log.timestamp).toLocaleString()} • {log.hoursSpent}h
                                            </p>
                                            {log.notes && (
                                                <p className="text-sm text-slate-700 mt-2 bg-slate-50 p-2 rounded">{log.notes}</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="mt-4 pt-4 border-t border-slate-200">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-600">Total Labor Hours:</span>
                                <span className="font-bold text-slate-900">{workOrder.totalLaborHours}h</span>
                            </div>
                        </div>
                    </div>

                    {/* Parts Used */}
                    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-900">Parts Used</h3>
                            <button
                                onClick={() => setShowAddPartModal(true)}
                                disabled={viewMode !== 'GARAGE'}
                                className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white ${viewMode === 'GARAGE' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-300 cursor-not-allowed opacity-50'}`}
                            >
                                + Add Part
                            </button>
                        </div>

                        {workOrder.partsUsed.length > 0 ? (
                            <div className="overflow-hidden rounded-lg border border-slate-200">
                                <table className="min-w-full divide-y divide-slate-200">
                                    <thead className="bg-slate-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Part Name</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Part #</th>
                                            <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Qty</th>
                                            <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Unit Cost</th>
                                            <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Total</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Source</th>
                                            {viewMode === 'GARAGE' && <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Actions</th>}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 bg-white">
                                        {workOrder.partsUsed.map(part => (
                                            <tr key={part.id}>
                                                <td className="px-4 py-3 text-sm text-slate-900">{part.partName}</td>
                                                <td className="px-4 py-3 text-sm text-slate-500">{part.partNumber || '-'}</td>
                                                <td className="px-4 py-3 text-sm text-slate-900 text-right">{part.quantityUsed}</td>
                                                <td className="px-4 py-3 text-sm text-slate-900 text-right">{formatCurrency(part.unitCost)}</td>
                                                <td className="px-4 py-3 text-sm font-medium text-slate-900 text-right">{formatCurrency(part.totalCost)}</td>
                                                <td className="px-4 py-3 text-sm text-slate-500">{part.source}</td>
                                                {viewMode === 'GARAGE' && (
                                                    <td className="px-4 py-3 text-sm text-right">
                                                        <button
                                                            onClick={() => handleEditPart(part)}
                                                            className="text-slate-400 hover:text-blue-600"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 inline-block">
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                                            </svg>
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-sm text-slate-500 text-center py-8">No parts used yet</p>
                        )}

                        <div className="mt-4 pt-4 border-t border-slate-200">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-600">Total Parts Cost:</span>
                                <span className="font-bold text-slate-900">{formatCurrency(calculateTotalPartsCost())}</span>
                            </div>
                        </div>
                    </div>

                    {/* Invoice & Attachments */}
                    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-900">Invoices & Attachments</h3>
                            {viewMode === 'GARAGE' && (
                                <label className="cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
                                    + Upload Invoice
                                    <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg" onChange={handleFileUpload} />
                                </label>
                            )}
                        </div>

                        {workOrder.invoiceAttachments && workOrder.invoiceAttachments.length > 0 ? (
                            <div className="space-y-3">
                                {workOrder.invoiceAttachments.map(att => (
                                    <div key={att.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                                                </svg>
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-slate-900">{att.fileName}</p>
                                                <p className="text-xs text-slate-500">{new Date(att.uploadedAt).toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                        {viewMode === 'GARAGE' && (
                                            <button
                                                onClick={() => removeAttachment(att.id)}
                                                className="text-slate-400 hover:text-red-600"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-200 py-8">
                                <div className="rounded-full bg-slate-50 p-3 mb-3">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-400">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                                    </svg>
                                </div>
                                <p className="text-sm font-medium text-slate-900">No invoices attached</p>
                                <p className="text-xs text-slate-500 mt-1">Upload the final invoice to complete the work order</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Sidebar */}
                <div className="space-y-8">
                    {/* Timeline */}
                    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                        <h3 className="text-sm font-bold text-slate-900 uppercase mb-4">Timeline</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs text-slate-500">Start Date</label>
                                <p className="text-sm font-medium text-slate-900">{new Date(workOrder.startDate).toLocaleDateString()}</p>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500">Est. Completion</label>
                                {isEditingDetails ? (
                                    <input
                                        type="date"
                                        value={detailsForm.estimatedCompletionDate}
                                        onChange={(e) => setDetailsForm({ ...detailsForm, estimatedCompletionDate: e.target.value })}
                                        className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm bg-white text-slate-900"
                                    />
                                ) : (
                                    <p className="text-sm font-medium text-slate-900">{new Date(workOrder.estimatedCompletionDate).toLocaleDateString()}</p>
                                )}
                            </div>
                            {workOrder.actualCompletionDate && (
                                <div>
                                    <label className="block text-xs text-slate-500">Actual Completion</label>
                                    <p className="text-sm font-medium text-slate-900">{new Date(workOrder.actualCompletionDate).toLocaleDateString()}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Checklist */}
                    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                        <h3 className="text-sm font-bold text-slate-900 uppercase mb-4">Checklist</h3>
                        <div className="space-y-3">
                            {workOrder.checklistItems.map(item => (
                                <div key={item.id} className="flex items-start gap-3">
                                    <input
                                        type="checkbox"
                                        checked={item.completed}
                                        onChange={() => toggleChecklistItem(item.id)}
                                        disabled={viewMode !== 'GARAGE'}
                                        className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <div>
                                        <p className={`text-sm ${item.completed ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                                            {item.task}
                                        </p>
                                        {item.completed && (
                                            <p className="text-xs text-slate-400">
                                                {item.completedBy} • {item.completedAt ? new Date(item.completedAt).toLocaleDateString() : ''}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Assigned Technicians */}
                    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-bold text-slate-900 uppercase">Technicians</h3>
                            {viewMode === 'GARAGE' && (
                                <button
                                    onClick={() => setShowAddTechnicianModal(true)}
                                    className="text-xs font-medium text-blue-600 hover:text-blue-800"
                                >
                                    + Add
                                </button>
                            )}
                        </div>
                        <div className="space-y-3">
                            {workOrder.assignedTechnicians.length > 0 ? (
                                workOrder.assignedTechnicians.map(tech => (
                                    <div key={tech.id} className="flex items-center gap-3">
                                        <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
                                            {tech.name.charAt(0)}
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-slate-900">{tech.name}</p>
                                            <p className="text-xs text-slate-500">{tech.specialization.join(', ')}</p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-sm text-slate-500 italic">No technicians assigned</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Modals */}
            {showAddLogModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                        <h3 className="text-lg font-bold text-slate-900 mb-4">{editingLogId ? 'Edit Work Log Entry' : 'Add Work Log Entry'}</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Technician</label>
                                <select
                                    value={logForm.technicianId}
                                    onChange={(e) => setLogForm({ ...logForm, technicianId: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                >
                                    <option value="">Select Technician</option>
                                    {availableTechnicians.map(tech => (
                                        <option key={tech.id} value={tech.id}>{tech.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Activity</label>
                                <input
                                    type="text"
                                    value={logForm.activity}
                                    onChange={(e) => setLogForm({ ...logForm, activity: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    placeholder="e.g. Replaced brake pads"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Hours Spent</label>
                                <input
                                    type="number"
                                    value={isNaN(logForm.hoursSpent) ? '' : logForm.hoursSpent}
                                    onChange={(e) => setLogForm({ ...logForm, hoursSpent: parseFloat(e.target.value) })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    step="0.5"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                                <textarea
                                    value={logForm.notes}
                                    onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    rows={3}
                                />
                            </div>
                            <div className="flex justify-end gap-3 mt-6">
                                <button
                                    onClick={() => {
                                        setShowAddLogModal(false);
                                        setEditingLogId(null);
                                        setLogForm({ technicianId: '', technicianName: '', activity: '', hoursSpent: 0, notes: '' });
                                    }}
                                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddWorkLog}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                >
                                    {editingLogId ? 'Update Entry' : 'Add Entry'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showAddPartModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                        <h3 className="text-lg font-bold text-slate-900 mb-4">{editingPartId ? 'Edit Part Usage' : 'Add Part Usage'}</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Part Name</label>
                                <input
                                    type="text"
                                    value={partForm.partName}
                                    onChange={(e) => setPartForm({ ...partForm, partName: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    placeholder="e.g. Oil Filter"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Part Number</label>
                                <input
                                    type="text"
                                    value={partForm.partNumber}
                                    onChange={(e) => setPartForm({ ...partForm, partNumber: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    placeholder="Optional"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">Quantity</label>
                                    <input
                                        type="number"
                                        value={isNaN(partForm.quantityUsed) ? '' : partForm.quantityUsed}
                                        onChange={(e) => setPartForm({ ...partForm, quantityUsed: parseInt(e.target.value) })}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                        min="1"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">Unit Cost</label>
                                    <input
                                        type="number"
                                        value={isNaN(partForm.unitCost) ? '' : partForm.unitCost}
                                        onChange={(e) => setPartForm({ ...partForm, unitCost: parseFloat(e.target.value) })}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                        min="0"
                                        step="0.01"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Source</label>
                                <select
                                    value={partForm.source}
                                    onChange={(e) => setPartForm({ ...partForm, source: e.target.value as PartSource })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                >
                                    {Object.values(PartSource).map(source => (
                                        <option key={source} value={source}>{source}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex justify-end gap-3 mt-6">
                                <button
                                    onClick={() => {
                                        setShowAddPartModal(false);
                                        setEditingPartId(null);
                                        setPartForm({ partName: '', partNumber: '', quantityUsed: 1, unitCost: 0, source: PartSource.STOCK });
                                    }}
                                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddPart}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                >
                                    {editingPartId ? 'Update Part' : 'Add Part'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Cost Entry Modal */}
            {showCostEntryModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                        <h3 className="text-lg font-bold text-slate-900 mb-4">Enter Actual Costs</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Actual Parts Cost</label>
                                <input
                                    type="number"
                                    value={isNaN(costForm.actualPartsCost) ? '' : costForm.actualPartsCost}
                                    onChange={(e) => setCostForm({ ...costForm, actualPartsCost: parseFloat(e.target.value) })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    min="0"
                                    step="0.01"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Actual Labor Cost</label>
                                <input
                                    type="number"
                                    value={isNaN(costForm.actualLaborCost) ? '' : costForm.actualLaborCost}
                                    onChange={(e) => setCostForm({ ...costForm, actualLaborCost: parseFloat(e.target.value) })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    min="0"
                                    step="0.01"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Other Charges</label>
                                <input
                                    type="number"
                                    value={isNaN(costForm.actualOtherCharges) ? '' : costForm.actualOtherCharges}
                                    onChange={(e) => setCostForm({ ...costForm, actualOtherCharges: parseFloat(e.target.value) })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    min="0"
                                    step="0.01"
                                />
                            </div>
                            <div className="bg-slate-50 p-3 rounded-lg">
                                <div className="flex justify-between text-sm font-bold text-slate-900">
                                    <span>Total Actual Cost:</span>
                                    <span>{formatCurrency(costForm.actualPartsCost + costForm.actualLaborCost + costForm.actualOtherCharges)}</span>
                                </div>
                            </div>
                            <div className="flex justify-end gap-3 mt-6">
                                <button
                                    onClick={() => setShowCostEntryModal(false)}
                                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleCostEntry}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                >
                                    Save Costs
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Completion Modal */}
            {showCompletionModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
                        <h3 className="text-lg font-bold text-slate-900 mb-4">Complete Work Order</h3>
                        <div className="space-y-4">
                            <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                                <h4 className="text-sm font-bold text-yellow-800 mb-2">Summary</h4>
                                <ul className="text-xs text-yellow-700 space-y-1">
                                    <li>• All checklist items completed</li>
                                    <li>• Actual costs recorded: {formatCurrency(workOrder.actualCosts?.total || 0)}</li>
                                    <li>• Total Labor Hours: {workOrder.totalLaborHours}h</li>
                                </ul>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Completion Notes</label>
                                <textarea
                                    value={completionForm.completionNotes}
                                    onChange={(e) => setCompletionForm({ ...completionForm, completionNotes: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    rows={3}
                                    placeholder="Enter any final notes or observations..."
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={completionForm.qualityCheckPassed}
                                        onChange={(e) => setCompletionForm({ ...completionForm, qualityCheckPassed: e.target.checked })}
                                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-slate-700">Quality check passed</span>
                                </label>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={completionForm.customerNotified}
                                        onChange={(e) => setCompletionForm({ ...completionForm, customerNotified: e.target.checked })}
                                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-slate-700">Customer notified (if applicable)</span>
                                </label>
                            </div>

                            <div className="flex justify-end gap-3 mt-6">
                                <button
                                    onClick={() => setShowCompletionModal(false)}
                                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleCompleteWorkOrder}
                                    className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                                >
                                    Confirm Completion
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Technician Modal */}
            {showAddTechnicianModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                        <h3 className="text-lg font-bold text-slate-900 mb-4">Add New Technician</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Name</label>
                                <input
                                    type="text"
                                    value={newTechnicianForm.name}
                                    onChange={(e) => setNewTechnicianForm({ ...newTechnicianForm, name: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    placeholder="Technician Name"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Specialization</label>
                                <input
                                    type="text"
                                    value={newTechnicianForm.specialization}
                                    onChange={(e) => setNewTechnicianForm({ ...newTechnicianForm, specialization: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    placeholder="e.g. Engine, Brakes (comma separated)"
                                />
                            </div>
                            <div className="flex justify-end gap-3 mt-6">
                                <button
                                    onClick={() => setShowAddTechnicianModal(false)}
                                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddTechnician}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                >
                                    Add Technician
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
