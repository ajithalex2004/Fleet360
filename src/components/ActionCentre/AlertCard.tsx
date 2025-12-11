import { Alert, AlertSeverity, ActionStatus } from '@/types/maintenance';

const severityColors: Record<AlertSeverity, string> = {
    [AlertSeverity.LOW]: 'bg-blue-50 text-blue-700 border-blue-200',
    [AlertSeverity.MEDIUM]: 'bg-amber-50 text-amber-700 border-amber-200',
    [AlertSeverity.HIGH]: 'bg-orange-50 text-orange-700 border-orange-200',
    [AlertSeverity.CRITICAL]: 'bg-red-50 text-red-700 border-red-200',
};

interface AlertCardProps {
    alert: Alert;
    onAction: (id: string, action: ActionStatus) => void;
    onAssign: (alert: Alert) => void;
    onEscalate: (alert: Alert) => void;
    onView: (alert: Alert) => void;
    isHistory?: boolean;
}

export default function AlertCard({ alert, onAction, onAssign, onEscalate, onView, isHistory = false }: AlertCardProps) {
    return (
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:shadow-md">
            <div>
                <div className="flex items-center justify-between">
                    <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${severityColors[alert.severity]
                            }`}
                    >
                        {alert.severity}
                    </span>
                    <span className="text-xs text-slate-400">
                        {new Date(alert.dateCreated).toLocaleDateString()}
                    </span>
                </div>
                <div className="flex justify-between items-start mt-4">
                    <h3 className="text-lg font-semibold text-slate-900">{alert.title}</h3>
                    <button
                        onClick={() => onView(alert)}
                        className="text-slate-400 hover:text-blue-600"
                        title="View Details"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        </svg>
                    </button>
                </div>
                <p className="mt-2 text-sm text-slate-500">{alert.description}</p>

                <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                    <span className="font-medium text-slate-600">Type:</span> {alert.type}
                </div>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-4">
                {isHistory ? (
                    <div className="flex justify-center">
                        <span className="inline-flex items-center rounded-md bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/10">
                            {alert.status}
                        </span>
                    </div>
                ) : (
                    <div className="flex gap-2">
                        {alert.status === ActionStatus.PENDING && (
                            <button
                                onClick={() => onAction(alert.id, ActionStatus.ACKNOWLEDGED)}
                                className="flex-1 rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
                            >
                                Acknowledge
                            </button>
                        )}
                        {alert.status === ActionStatus.ACKNOWLEDGED && (
                            <>
                                <button
                                    onClick={() => onAssign(alert)}
                                    className="flex-1 rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                                >
                                    Assign
                                </button>
                                <button
                                    onClick={() => onEscalate(alert)}
                                    className="flex-1 rounded-lg bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100"
                                >
                                    Escalate
                                </button>
                            </>
                        )}
                        {alert.status === ActionStatus.ASSIGNED && (
                            <button
                                onClick={() => onAction(alert.id, ActionStatus.RESOLVED)}
                                className="flex-1 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
                            >
                                Resolve
                            </button>
                        )}
                        {alert.status === ActionStatus.RESOLVED && (
                            <span className="flex-1 text-center text-sm font-medium text-green-600">
                                Resolved
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
