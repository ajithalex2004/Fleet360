import { MaintenanceStatus } from '@/types/maintenance';

const statusStyles: Record<MaintenanceStatus, string> = {

    [MaintenanceStatus.REQUESTED]: 'bg-blue-50 text-blue-700 border-blue-200',
    [MaintenanceStatus.ACCEPTED]: 'bg-green-50 text-green-700 border-green-200',
    [MaintenanceStatus.REJECTED]: 'bg-red-50 text-red-700 border-red-200',
    [MaintenanceStatus.RE_ASSIGN]: 'bg-orange-50 text-orange-700 border-orange-200',
    [MaintenanceStatus.UNDER_ESTIMATION]: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    [MaintenanceStatus.PENDING_ESTIMATION_APPROVAL]: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    [MaintenanceStatus.UNDER_MAINTENANCE]: 'bg-purple-50 text-purple-700 border-purple-200',
    [MaintenanceStatus.MAINTENANCE_COMPLETED]: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    [MaintenanceStatus.PENDING_INVOICE]: 'bg-orange-50 text-orange-700 border-orange-200',
    [MaintenanceStatus.INVOICE_SUBMITTED]: 'bg-teal-50 text-teal-700 border-teal-200',
    [MaintenanceStatus.CLOSED]: 'bg-gray-50 text-gray-700 border-gray-200',
};

export default function StatusBadge({ status }: { status: MaintenanceStatus }) {
    return (
        <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusStyles[status] || 'bg-gray-100 text-gray-800'
                }`}
        >
            {status}
        </span>
    );
}
