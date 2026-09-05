import { MaintenanceStatus } from '@/types/maintenance';

const statusStyles: Record<MaintenanceStatus, string> = {

    [MaintenanceStatus.SUBMITTED]: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    [MaintenanceStatus.REQUESTED]: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    [MaintenanceStatus.ACCEPTED]: 'bg-green-500/15 text-green-400 border-green-500/30',
    [MaintenanceStatus.REJECTED]: 'bg-red-500/15 text-red-400 border-red-500/30',
    [MaintenanceStatus.RE_ASSIGN]: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    [MaintenanceStatus.UNDER_ESTIMATION]: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
    [MaintenanceStatus.PENDING_ESTIMATION_APPROVAL]: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    [MaintenanceStatus.ESTIMATION_APPROVED]: 'bg-lime-500/15 text-lime-400 border-lime-500/30',
    [MaintenanceStatus.PENDING_OPERATIONS_ACK]: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    [MaintenanceStatus.PENDING_MAINTENANCE_APPROVAL]: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    [MaintenanceStatus.REJECTED_BY_MAINTENANCE]: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    [MaintenanceStatus.UNDER_MAINTENANCE]: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    [MaintenanceStatus.REPAIR_COMPLETED]: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    [MaintenanceStatus.QUALITY_INSPECTION]: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
    [MaintenanceStatus.INSPECTION_FAILED]: 'bg-red-500/15 text-red-400 border-red-500/30',
    [MaintenanceStatus.READY_FOR_SERVICE]: 'bg-green-500/15 text-green-400 border-green-500/30',
    [MaintenanceStatus.MAINTENANCE_COMPLETED]: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    [MaintenanceStatus.COMPLETED]: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    [MaintenanceStatus.PENDING_INVOICE]: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    [MaintenanceStatus.INVOICE_SUBMITTED]: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
    [MaintenanceStatus.CLOSED]: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

export default function StatusBadge({ status }: { status: MaintenanceStatus }) {
    return (
        <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusStyles[status] || 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'
                }`}
        >
            {status}
        </span>
    );
}
