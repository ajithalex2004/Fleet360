import { MaintenanceStatus } from '@/types/maintenance';

const steps = [
    { id: MaintenanceStatus.REQUESTED, label: 'Requested' },
    { id: MaintenanceStatus.AWAITING_APPROVAL, label: 'Awaiting Approval' },
    { id: MaintenanceStatus.APPROVED, label: 'Approved' },
    { id: MaintenanceStatus.UNDER_ESTIMATION, label: 'Estimation' },
    { id: MaintenanceStatus.UNDER_MAINTENANCE, label: 'Maintenance' },
    { id: MaintenanceStatus.COMPLETED, label: 'Completed' },
];

interface WorkflowStepperProps {
    currentStatus: MaintenanceStatus;
    statusTimeline?: Record<MaintenanceStatus, string>;
}

export default function WorkflowStepper({ currentStatus, statusTimeline }: WorkflowStepperProps) {
    const currentIndex = steps.findIndex((s) => s.id === currentStatus);
    const isRejected = currentStatus === MaintenanceStatus.REJECTED;

    const formatDate = (dateString?: string) => {
        if (!dateString) return null;
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (isRejected) {
        return (
            <div className="w-full py-4">
                <div className="flex items-center justify-center rounded-lg bg-red-50 p-4 text-red-700">
                    <span className="font-medium">Request Rejected</span>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full py-4">
            <div className="flex items-center justify-between">
                {steps.map((step, index) => {
                    const isCompleted = index < currentIndex;
                    const isCurrent = index === currentIndex;
                    const timestamp = statusTimeline?.[step.id];

                    return (
                        <div key={step.id} className="relative flex flex-1 flex-col items-center">
                            {/* Line */}
                            {index !== 0 && (
                                <div
                                    className={`absolute right-[50%] top-4 -mr-[50%] h-[2px] w-full ${index <= currentIndex ? 'bg-blue-600' : 'bg-slate-200'
                                        }`}
                                />
                            )}

                            {/* Circle */}
                            <div
                                className={`z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors ${isCompleted
                                    ? 'border-blue-600 bg-blue-600 text-white'
                                    : isCurrent
                                        ? 'border-blue-600 bg-white text-blue-600'
                                        : 'border-slate-200 bg-white text-slate-300'
                                    }`}
                            >
                                {isCompleted ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                                    </svg>
                                ) : (
                                    <span className="text-xs font-bold">{index + 1}</span>
                                )}
                            </div>

                            {/* Label and Timestamp */}
                            <div className="mt-2 text-center">
                                <span
                                    className={`block text-xs font-medium ${isCurrent ? 'text-blue-600' : isCompleted ? 'text-slate-900' : 'text-slate-400'
                                        }`}
                                >
                                    {step.label}
                                </span>
                                {timestamp && (isCompleted || isCurrent) && (
                                    <span className="mt-1 block text-[10px] text-slate-500">
                                        {formatDate(timestamp)}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
