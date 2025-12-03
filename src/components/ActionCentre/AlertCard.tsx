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
}

export default function AlertCard({ alert, onAction, onAssign, onEscalate }: AlertCardProps) {
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
                <h3 className="mt-4 text-lg font-semibold text-slate-900">{alert.title}</h3>
                <p className="mt-2 text-sm text-slate-500">{alert.description}</p>

                <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                    <span className="font-medium text-slate-600">Type:</span> {alert.type}
                </div>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-4">
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
            </div>
        </div>
    );
}
