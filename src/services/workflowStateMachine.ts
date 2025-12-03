import { MaintenanceStatus, EnhancedMaintenanceRequest } from '@/types/maintenance';

/**
 * Workflow State Machine
 * Manages valid status transitions and side effects for maintenance requests
 */

// Define valid status transitions
const STATUS_TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
    [MaintenanceStatus.DRAFT]: [MaintenanceStatus.SUBMITTED],
    [MaintenanceStatus.SUBMITTED]: [MaintenanceStatus.PENDING_OPERATIONS_ACK],
    [MaintenanceStatus.PENDING_OPERATIONS_ACK]: [MaintenanceStatus.PENDING_MAINTENANCE_APPROVAL],
    [MaintenanceStatus.PENDING_MAINTENANCE_APPROVAL]: [
        MaintenanceStatus.UNDER_ESTIMATION,
        MaintenanceStatus.REJECTED_BY_MAINTENANCE
    ],
    [MaintenanceStatus.REJECTED_BY_MAINTENANCE]: [], // Terminal state
    [MaintenanceStatus.UNDER_ESTIMATION]: [MaintenanceStatus.PENDING_ESTIMATION_APPROVAL],
    [MaintenanceStatus.PENDING_ESTIMATION_APPROVAL]: [
        MaintenanceStatus.ESTIMATION_APPROVED,
        MaintenanceStatus.UNDER_ESTIMATION // Back to estimation if rejected
    ],
    [MaintenanceStatus.ESTIMATION_APPROVED]: [MaintenanceStatus.UNDER_MAINTENANCE],
    [MaintenanceStatus.UNDER_MAINTENANCE]: [MaintenanceStatus.MAINTENANCE_COMPLETED],
    [MaintenanceStatus.MAINTENANCE_COMPLETED]: [MaintenanceStatus.PENDING_INVOICE],
    [MaintenanceStatus.PENDING_INVOICE]: [MaintenanceStatus.INVOICE_SUBMITTED],
    [MaintenanceStatus.INVOICE_SUBMITTED]: [MaintenanceStatus.CLOSED],
    [MaintenanceStatus.CLOSED]: [], // Terminal state

    // Legacy statuses (for backward compatibility)
    [MaintenanceStatus.REQUESTED]: [MaintenanceStatus.APPROVED, MaintenanceStatus.REJECTED],
    [MaintenanceStatus.AWAITING_APPROVAL]: [MaintenanceStatus.APPROVED, MaintenanceStatus.REJECTED],
    [MaintenanceStatus.APPROVED]: [MaintenanceStatus.UNDER_ESTIMATION],
    [MaintenanceStatus.COMPLETED]: [MaintenanceStatus.CLOSED],
    [MaintenanceStatus.REJECTED]: [], // Terminal state
};

/**
 * Check if a status transition is valid
 */
export function canTransition(from: MaintenanceStatus, to: MaintenanceStatus): boolean {
    const allowedTransitions = STATUS_TRANSITIONS[from];
    return allowedTransitions?.includes(to) ?? false;
}

/**
 * Get all possible next statuses from current status
 */
export function getNextStatuses(currentStatus: MaintenanceStatus): MaintenanceStatus[] {
    return STATUS_TRANSITIONS[currentStatus] || [];
}

/**
 * Check if a status is terminal (no further transitions)
 */
export function isTerminalStatus(status: MaintenanceStatus): boolean {
    const transitions = STATUS_TRANSITIONS[status];
    return !transitions || transitions.length === 0;
}

/**
 * Get status display color
 */
export function getStatusColor(status: MaintenanceStatus): string {
    switch (status) {
        case MaintenanceStatus.DRAFT:
            return 'bg-slate-100 text-slate-700 border-slate-300';
        case MaintenanceStatus.SUBMITTED:
        case MaintenanceStatus.PENDING_OPERATIONS_ACK:
        case MaintenanceStatus.PENDING_MAINTENANCE_APPROVAL:
            return 'bg-blue-100 text-blue-700 border-blue-300';
        case MaintenanceStatus.UNDER_ESTIMATION:
        case MaintenanceStatus.PENDING_ESTIMATION_APPROVAL:
            return 'bg-yellow-100 text-yellow-700 border-yellow-300';
        case MaintenanceStatus.ESTIMATION_APPROVED:
            return 'bg-green-100 text-green-700 border-green-300';
        case MaintenanceStatus.UNDER_MAINTENANCE:
            return 'bg-purple-100 text-purple-700 border-purple-300';
        case MaintenanceStatus.MAINTENANCE_COMPLETED:
        case MaintenanceStatus.PENDING_INVOICE:
        case MaintenanceStatus.INVOICE_SUBMITTED:
            return 'bg-indigo-100 text-indigo-700 border-indigo-300';
        case MaintenanceStatus.CLOSED:
            return 'bg-gray-100 text-gray-700 border-gray-300';
        case MaintenanceStatus.REJECTED_BY_MAINTENANCE:
        case MaintenanceStatus.REJECTED:
            return 'bg-red-100 text-red-700 border-red-300';
        default:
            return 'bg-slate-100 text-slate-700 border-slate-300';
    }
}

/**
 * Transition a request to a new status
 * This function handles the transition and triggers side effects
 */
export async function transitionStatus(
    request: EnhancedMaintenanceRequest,
    newStatus: MaintenanceStatus,
    transitionedBy: string,
    transitionedByName: string,
    comments?: string
): Promise<EnhancedMaintenanceRequest> {
    // Validate transition
    if (!canTransition(request.status, newStatus)) {
        throw new Error(`Invalid status transition from ${request.status} to ${newStatus}`);
    }

    // Record transition
    const transition = {
        from: request.status,
        to: newStatus,
        transitionedAt: new Date().toISOString(),
        transitionedBy,
        transitionedByName,
        comments,
        automated: false
    };

    // Update request
    let workOrderNo = request.workOrderNo;
    if (newStatus === MaintenanceStatus.APPROVED && !workOrderNo) {
        const date = new Date();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        // const year = date.getFullYear(); // Removed year as per new requirement
        workOrderNo = `WO-${month}-${request.id}`;
    }

    const updatedRequest: EnhancedMaintenanceRequest = {
        ...request,
        status: newStatus,
        workOrderNo,
        statusTransitions: [...(request.statusTransitions || []), transition],
        statusTimeline: {
            ...request.statusTimeline,
            [newStatus]: new Date().toISOString()
        }
    };

    // Handle side effects
    await handleStatusChange(updatedRequest, newStatus);

    return updatedRequest;
}

/**
 * Handle side effects when status changes
 */
async function handleStatusChange(
    request: EnhancedMaintenanceRequest,
    newStatus: MaintenanceStatus
): Promise<void> {
    switch (newStatus) {
        case MaintenanceStatus.PENDING_OPERATIONS_ACK:
            await notifyOperationsTeam(request);
            break;

        case MaintenanceStatus.PENDING_MAINTENANCE_APPROVAL:
            await notifyMaintenanceTeam(request);
            break;

        case MaintenanceStatus.UNDER_ESTIMATION:
            await matchGaragesAndSendRFQ(request);
            break;

        case MaintenanceStatus.PENDING_ESTIMATION_APPROVAL:
            await sendEstimationApprovalRequest(request);
            break;

        case MaintenanceStatus.UNDER_MAINTENANCE:
            await sendWorkOrderConfirmation(request);
            break;

        case MaintenanceStatus.MAINTENANCE_COMPLETED:
            await notifyInvoiceRequired(request);
            break;

        case MaintenanceStatus.CLOSED:
            await sendJobClosureNotifications(request);
            break;
    }
}

/**
 * Side effect handlers (to be implemented with actual email service)
 */

async function notifyOperationsTeam(request: EnhancedMaintenanceRequest): Promise<void> {
    console.log(`[WORKFLOW] Notifying operations team for request ${request.id}`);
    // TODO: Implement email notification
}

async function notifyMaintenanceTeam(request: EnhancedMaintenanceRequest): Promise<void> {
    console.log(`[WORKFLOW] Notifying maintenance team for request ${request.id}`);
    // TODO: Implement email notification
}

async function matchGaragesAndSendRFQ(request: EnhancedMaintenanceRequest): Promise<void> {
    console.log(`[WORKFLOW] Matching garages and sending RFQ for request ${request.id}`);
    // TODO: Implement garage matching and RFQ email
}

async function sendEstimationApprovalRequest(request: EnhancedMaintenanceRequest): Promise<void> {
    console.log(`[WORKFLOW] Sending estimation approval request for ${request.id}`);
    // TODO: Implement email to manager
}

async function sendWorkOrderConfirmation(request: EnhancedMaintenanceRequest): Promise<void> {
    console.log(`[WORKFLOW] Sending work order confirmation for ${request.id}`);
    // TODO: Implement work order email
}

async function notifyInvoiceRequired(request: EnhancedMaintenanceRequest): Promise<void> {
    console.log(`[WORKFLOW] Notifying invoice required for ${request.id}`);
    // TODO: Implement email notification
}

async function sendJobClosureNotifications(request: EnhancedMaintenanceRequest): Promise<void> {
    console.log(`[WORKFLOW] Sending job closure notifications for ${request.id}`);
    // TODO: Implement closure emails
}

/**
 * Get workflow progress percentage
 */
export function getWorkflowProgress(status: MaintenanceStatus): number {
    const statusOrder = [
        MaintenanceStatus.DRAFT,
        MaintenanceStatus.SUBMITTED,
        MaintenanceStatus.PENDING_OPERATIONS_ACK,
        MaintenanceStatus.PENDING_MAINTENANCE_APPROVAL,
        MaintenanceStatus.UNDER_ESTIMATION,
        MaintenanceStatus.PENDING_ESTIMATION_APPROVAL,
        MaintenanceStatus.ESTIMATION_APPROVED,
        MaintenanceStatus.UNDER_MAINTENANCE,
        MaintenanceStatus.MAINTENANCE_COMPLETED,
        MaintenanceStatus.PENDING_INVOICE,
        MaintenanceStatus.INVOICE_SUBMITTED,
        MaintenanceStatus.CLOSED
    ];

    const currentIndex = statusOrder.indexOf(status);
    if (currentIndex === -1) return 0;

    return Math.round(((currentIndex + 1) / statusOrder.length) * 100);
}

/**
 * Get workflow stage name
 */
export function getWorkflowStage(status: MaintenanceStatus): string {
    if ([MaintenanceStatus.DRAFT, MaintenanceStatus.SUBMITTED].includes(status)) {
        return 'Submission';
    }
    if ([MaintenanceStatus.PENDING_OPERATIONS_ACK, MaintenanceStatus.PENDING_MAINTENANCE_APPROVAL].includes(status)) {
        return 'Approval';
    }
    if ([MaintenanceStatus.UNDER_ESTIMATION, MaintenanceStatus.PENDING_ESTIMATION_APPROVAL, MaintenanceStatus.ESTIMATION_APPROVED].includes(status)) {
        return 'Estimation';
    }
    if ([MaintenanceStatus.UNDER_MAINTENANCE, MaintenanceStatus.MAINTENANCE_COMPLETED].includes(status)) {
        return 'Execution';
    }
    if ([MaintenanceStatus.PENDING_INVOICE, MaintenanceStatus.INVOICE_SUBMITTED, MaintenanceStatus.CLOSED].includes(status)) {
        return 'Closure';
    }
    return 'Unknown';
}
