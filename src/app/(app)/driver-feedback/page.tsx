'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    DRIVER_REPORT_CATEGORIES, DRIVER_REPORT_SEVERITIES, driverReportRequest, parseDriverReport,
    type DriverReportSeverity,
} from '@/lib/maintenance/driver-report';

interface Report {
    id: string;
    vehicleLabel: string;
    submitted: string;
    category: string;
    severity: DriverReportSeverity;
    issue: string;
    status: string;
    workOrderNo: string | null;
}

interface Option { id: string; label: string }

const blankForm = () => ({ vehicleId: '', issue: '', severity: 'Medium' as DriverReportSeverity, category: 'Engine' });

const vehicleText = (v: Record<string, unknown> | null | undefined) =>
    v ? [v.licensePlate, [v.make, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') : '';

/** Driver reports among the tenant's maintenance requests, newest first. */
function toReports(rows: Array<Record<string, unknown>>): Report[] {
    const out: Report[] = [];
    for (const r of rows) {
        const parsed = parseDriverReport(typeof r.description === 'string' ? r.description : null);
        if (!parsed) continue;
        out.push({
            id: String(r.id),
            vehicleLabel: vehicleText(r.Vehicle as Record<string, unknown> | null) || String(r.vehicleId ?? '—'),
            submitted: String(r.requestDate ?? r.createdAt ?? ''),
            ...parsed,
            status: String(r.status ?? 'Requested'),
            workOrderNo: typeof r.workOrderNo === 'string' ? r.workOrderNo : null,
        });
    }
    return out;
}

export default function DriverFeedbackPage() {
    const [reports, setReports] = useState<Report[]>([]);
    const [vehicles, setVehicles] = useState<Option[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [showReportModal, setShowReportModal] = useState(false);
    const [formData, setFormData] = useState(blankForm());

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/maintenance-requests', { cache: 'no-store' });
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(json?.error ?? `Could not load reports (${res.status})`);
            setReports(toReports(Array.isArray(json) ? json : []));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load reports');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        fetch('/api/vehicles', { cache: 'no-store' })
            .then(r => (r.ok ? r.json() : []))
            .then((rows: Array<Record<string, unknown>>) => setVehicles((Array.isArray(rows) ? rows : []).map(v => ({
                id: String(v.id), label: vehicleText(v) || String(v.id),
            }))))
            .catch(() => setVehicles([]));
    }, []);

    const openModal = () => { setFormError(null); setNotice(null); setShowReportModal(true); };

    const handleSubmitFeedback = async () => {
        const built = driverReportRequest(formData);
        if (!built.ok) { setFormError(built.error); return; }
        setSaving(true);
        setFormError(null);
        try {
            const res = await fetch('/api/maintenance-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(built.body),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error ?? `Could not submit the report (${res.status})`);
            setShowReportModal(false);
            setFormData(blankForm());
            setNotice('Issue reported. A maintenance request has been created for the workshop.');
            await load();
        } catch (e) {
            setFormError(e instanceof Error ? e.message : 'Could not submit the report');
        } finally {
            setSaving(false);
        }
    };

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'Low': return 'bg-blue-100 text-blue-700 border-blue-300';
            case 'Medium': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
            case 'High': return 'bg-orange-100 text-orange-700 border-orange-300';
            case 'Critical': return 'bg-red-100 text-red-700 border-red-300';
            default: return 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border-[var(--border-subtle)]';
        }
    };

    const field = 'w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)]';

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-main)]">Driver Feedback</h1>
                    <p className="text-xs mt-1 text-[var(--text-muted)]">Report vehicle issues; each report becomes a maintenance request</p>
                </div>
                <button
                    onClick={openModal}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                    + Report Issue
                </button>
            </div>

            {notice && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">{notice}</div>}
            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

            <div className="grid grid-cols-1 gap-4">
                {loading ? (
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center text-sm text-[var(--text-muted)]">
                        Loading reports…
                    </div>
                ) : reports.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center">
                        <p className="text-[var(--text-muted)]">No issues reported yet.</p>
                        <button onClick={openModal} className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-800">
                            Report your first issue
                        </button>
                    </div>
                ) : (
                    reports.map(r => (
                        <div key={r.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-sm">
                            <div className="flex items-start justify-between mb-3 gap-4">
                                <div className="min-w-0">
                                    <h3 className="text-lg font-bold text-[var(--text-main)] break-words">{r.issue}</h3>
                                    <p className="text-sm text-[var(--text-muted)] mt-1">
                                        {r.submitted ? new Date(r.submitted).toLocaleString() : '—'} • {r.category} • {r.vehicleLabel}
                                    </p>
                                </div>
                                <span className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-medium border ${getSeverityColor(r.severity)}`}>
                                    {r.severity}
                                </span>
                            </div>
                            <p className="text-xs text-[var(--text-faint)]">
                                Maintenance request: {r.workOrderNo ?? r.id.slice(0, 8)} · {r.status}
                            </p>
                        </div>
                    ))
                )}
            </div>

            {showReportModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-[var(--bg-surface)] rounded-2xl w-full max-w-2xl shadow-2xl">
                        <div className="p-6 border-b border-[var(--border-subtle)]">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-[var(--text-main)]">Report Issue</h3>
                                <button onClick={() => setShowReportModal(false)} className="text-[var(--text-faint)] hover:text-[var(--text-main)]">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Vehicle *</label>
                                <select
                                    value={formData.vehicleId}
                                    onChange={(e) => setFormData({ ...formData, vehicleId: e.target.value })}
                                    className={field}
                                >
                                    <option value="">{vehicles.length ? 'Select a vehicle' : 'No vehicles found'}</option>
                                    {vehicles.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Issue Description *</label>
                                <textarea
                                    rows={4}
                                    value={formData.issue}
                                    onChange={(e) => setFormData({ ...formData, issue: e.target.value })}
                                    className={field}
                                    placeholder="Describe the issue you're experiencing..."
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Severity</label>
                                    <select
                                        value={formData.severity}
                                        onChange={(e) => setFormData({ ...formData, severity: e.target.value as DriverReportSeverity })}
                                        className={field}
                                    >
                                        {DRIVER_REPORT_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Category</label>
                                    <select
                                        value={formData.category}
                                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                        className={field}
                                    >
                                        {DRIVER_REPORT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            </div>
                            {formError && <p className="text-sm text-red-400">{formError}</p>}
                        </div>

                        <div className="p-6 border-t border-[var(--border-subtle)] flex justify-end gap-3">
                            <button
                                onClick={() => setShowReportModal(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => void handleSubmitFeedback()}
                                disabled={saving}
                                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                                {saving ? 'Submitting…' : 'Submit Report'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
