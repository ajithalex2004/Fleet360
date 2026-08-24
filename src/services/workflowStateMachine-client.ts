import { MaintenanceStatus } from '@/types/maintenance';

/**
 * Workflow State Machine - Client-safe utilities
 * Pure functions for status transitions and display - safe for client components
 */

// Define valid status transitions
const STATUS_TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
    [MaintenanceStatus.SUBMITTED]: [
        MaintenanceStatus.REQUESTED,
        MaintenanceStatus.ACCEPTED,
        MaintenanceStatus.REJECTED
    ],
    [MaintenanceStatus.REQUESTED]: [
        MaintenanceStatus.ACCEPTED,
        MaintenanceStatus.REJECTED,
        MaintenanceStatus.RE_ASSIGN
    ],
    [MaintenanceStatus.ACCEPTED]: [MaintenanceStatus.UNDER_ESTIMATION],
    [MaintenanceStatus.RE_ASSIGN]: [MaintenanceStatus.REQUESTED],
    [MaintenanceStatus.REJECTED]: [], // Terminal state
    [MaintenanceStatus.UNDER_ESTIMATION]: [MaintenanceStatus.PENDING_ESTIMATION_APPROVAL],
    [MaintenanceStatus.PENDING_ESTIMATION_APPROVAL]: [
        MaintenanceStatus.ESTIMATION_APPROVED,
        MaintenanceStatus.UNDER_ESTIMATION // Back to estimation if rejected
    ],
    [MaintenanceStatus.ESTIMATION_APPROVED]: [
        MaintenanceStatus.PENDING_OPERATIONS_ACK,
        MaintenanceStatus.UNDER_MAINTENANCE // Skip ack if not required
    ],
    [MaintenanceStatus.PENDING_OPERATIONS_ACK]: [
        MaintenanceStatus.PENDING_MAINTENANCE_APPROVAL,
        MaintenanceStatus.UNDER_MAINTENANCE
    ],
    [MaintenanceStatus.PENDING_MAINTENANCE_APPROVAL]: [
        MaintenanceStatus.UNDER_MAINTENANCE,
        MaintenanceStatus.PENDING_OPERATIONS_ACK // Back if rejected
    ],
    [MaintenanceStatus.UNDER_MAINTENANCE]: [
        MaintenanceStatus.UNDER_QC,
        MaintenanceStatus.COMPLETED // Skip QC if not required
    ],
    [MaintenanceStatus.UNDER_QC]: [
        MaintenanceStatus.READY,
        MaintenanceStatus.UNDER_MAINTENANCE // If QC fails
    ],
    [MaintenanceStatus.READY]: [MaintenanceStatus.COMPLETED],
    [MaintenanceStatus.COMPLETED]: [], // Terminal state
    [MaintenanceStatus.CLOSED]: [], // Terminal state
};

/**
 * Get allowed next statuses for a given status
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
        case MaintenanceStatus.REQUESTED:
            return 'bg-blue-100 text-blue-700 border-blue-300';
        case MaintenanceStatus.ACCEPTED:
            return 'bg-green-100 text-green-700 border-green-300';
        case MaintenanceStatus.REJECTED:
            return 'bg-red-100 text-red-700 border-red-300';
        case MaintenanceStatus.UNDER_ESTIMATION:
            return 'bg-purple-100 text-purple-700 border-purple-300';
        case MaintenanceStatus.PENDING_ESTIMATION_APPROVAL:
            return 'bg-yellow-100 text-yellow-700 border-yellow-300';
        case MaintenanceStatus.ESTIMATION_APPROVED:
            return 'bg-green-100 text-green-700 border-green-300';
        case MaintenanceStatus.PENDING_OPERATIONS_ACK:
            return 'bg-orange-100 text-orange-700 border-orange-300';
        case MaintenanceStatus.PENDING_MAINTENANCE_APPROVAL:
            return 'bg-yellow-100 text-yellow-700 border-yellow-300';
        case MaintenanceStatus.UNDER_MAINTENANCE:
            return 'bg-indigo-100 text-indigo-700 border-indigo-300';
        case MaintenanceStatus.UNDER_QC:
            return 'bg-purple-100 text-purple-700 border-purple-300';
        case MaintenanceStatus.READY:
            return 'bg-teal-100 text-teal-700 border-teal-300';
        case MaintenanceStatus.COMPLETED:
            return 'bg-green-100 text-green-700 border-green-300';
        case MaintenanceStatus.CLOSED:
            return 'bg-gray-100 text-gray-700 border-gray-300';
        default:
            return 'bg-gray-100 text-gray-700 border-gray-300';
    }
}

/**
 * Validate if a status transition is allowed
 */
export function canTransitionTo(
    currentStatus: MaintenanceStatus,
    targetStatus: MaintenanceStatus
): boolean {
    const allowedStatuses = STATUS_TRANSITIONS[currentStatus] || [];
    return allowedStatuses.includes(targetStatus);
}
