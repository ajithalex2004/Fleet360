'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shield, Plus, AlertTriangle, CheckCircle, Clock, X, Loader2 } from 'lucide-react';
import { VehicleWarranty, WarrantyClaim, WarrantyType, WarrantyClaimStatus } from '@/types/maintenance';

// ─── data ─────────────────────────────────────────────────────────────────────

interface VehicleOption { id: string; label: string }

const day = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : '');
const money = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));

/** API rows (ISO dates, decimal strings) to the screen's shape. */
function toClaim(c: Record<string, unknown>): WarrantyClaim {
    return {
        id: String(c.id),
        warrantyId: String(c.warrantyId),
        requestId: (c.requestId as string) ?? undefined,
        claimDate: day(c.claimDate) || undefined,
        claimedAmount: money(c.claimedAmount),
        approvedAmount: money(c.approvedAmount),
        status: c.status as WarrantyClaimStatus,
        description: (c.description as string) ?? undefined,
        referenceNumber: (c.referenceNumber as string) ?? undefined,
        createdAt: String(c.createdAt ?? ''),
    };
}

function toWarranty(w: Record<string, unknown>): VehicleWarranty {
    return {
        id: String(w.id),
        tenantId: String(w.tenantId ?? ''),
        vehicleId: String(w.vehicleId),
        warrantyType: w.warrantyType as WarrantyType,
        provider: (w.provider as string) ?? undefined,
        startDate: day(w.startDate),
        expiryDate: day(w.expiryDate),
        coverageDescription: (w.coverageDescription as string) ?? undefined,
        maxClaimAmount: money(w.maxClaimAmount),
        isActive: Boolean(w.isActive),
        claims: Array.isArray(w.claims) ? (w.claims as Record<string, unknown>[]).map(toClaim) : [],
    };
}

async function send(url: string, method: string, body: unknown) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json as Record<string, unknown>;
}

// ─── types ────────────────────────────────────────────────────────────────────

type ModalMode = 'create-warranty' | 'create-claim' | null;

const WARRANTY_TYPE_LABELS: Record<WarrantyType, string> = {
    MANUFACTURER: 'Manufacturer',
    EXTENDED: 'Extended',
    THIRD_PARTY: 'Third Party',
};

const CLAIM_STATUS_CONFIG: Record<WarrantyClaimStatus, { label: string; cls: string }> = {
    PENDING:  { label: 'Pending',  cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    APPROVED: { label: 'Approved', cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    REJECTED: { label: 'Rejected', cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
    PAID:     { label: 'Paid',     cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
};

const WARRANTY_TYPE_COLOR: Record<WarrantyType, string> = {
    MANUFACTURER: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    EXTENDED:     'bg-purple-500/20 text-purple-400 border-purple-500/30',
    THIRD_PARTY:  'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function daysUntilExpiry(expiryDate: string): number {
    return Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 86_400_000);
}

function isExpired(w: VehicleWarranty): boolean {
    return new Date(w.expiryDate) < new Date();
}

/** Approved and paid claims count against the claim limit. */
function claimedTotal(w: VehicleWarranty): number {
    return (w.claims ?? [])
        .filter(c => c.status === 'APPROVED' || c.status === 'PAID')
        .reduce((s, c) => s + (c.approvedAmount ?? c.claimedAmount ?? 0), 0);
}

// ─── component ────────────────────────────────────────────────────────────────

export default function WarrantyPage() {
    const [warranties, setWarranties] = useState<VehicleWarranty[]>([]);
    const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [modalMode, setModalMode] = useState<ModalMode>(null);
    const [selectedWarrantyId, setSelectedWarrantyId] = useState<string | null>(null);
    const [filterActive, setFilterActive] = useState<'all' | 'active' | 'expired'>('all');

    // ── new warranty form ──
    const [warrantyForm, setWarrantyForm] = useState({
        vehicleId: '',
        warrantyType: 'MANUFACTURER' as WarrantyType,
        provider: '',
        startDate: '',
        expiryDate: '',
        coverageDescription: '',
        maxClaimAmount: 0,
    });

    // ── new claim form ──
    const [claimForm, setClaimForm] = useState({
        claimDate: new Date().toISOString().split('T')[0],
        claimedAmount: 0,
        description: '',
        referenceNumber: '',
    });

    // ─── derived ───────────────────────────────────────────────────────────────

    const filtered = warranties.filter(w => {
        if (filterActive === 'active')  return w.isActive && !isExpired(w);
        if (filterActive === 'expired') return !w.isActive || isExpired(w);
        return true;
    });

    const activeCount  = warranties.filter(w => w.isActive && !isExpired(w)).length;
    const expiredCount = warranties.filter(w => !w.isActive || isExpired(w)).length;
    const totalClaims  = warranties.reduce((s, w) => s + (w.claims?.length ?? 0), 0);
    const totalPaid    = warranties.reduce((s, w) => s + claimedTotal(w), 0);

    const selectedWarranty = warranties.find(w => w.id === selectedWarrantyId) ?? null;

    // ─── load ──────────────────────────────────────────────────────────────────

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/maintenance/warranties?activeOnly=false', { cache: 'no-store' });
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(json?.error ?? `Could not load warranties (${res.status})`);
            setWarranties((Array.isArray(json) ? json : []).map(toWarranty));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load warranties');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        fetch('/api/vehicles', { cache: 'no-store' })
            .then(r => (r.ok ? r.json() : []))
            .then((rows: Array<Record<string, unknown>>) => setVehicles((Array.isArray(rows) ? rows : []).map(v => ({
                id: String(v.id),
                label: [v.licensePlate, [v.make, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || String(v.id),
            }))))
            .catch(() => setVehicles([]));
    }, []);

    const vehicleLabel = (id: string) => vehicles.find(v => v.id === id)?.label ?? id;

    // ─── handlers ──────────────────────────────────────────────────────────────

    const closeModal = () => { setModalMode(null); setFormError(null); };

    const handleCreateWarranty = async () => {
        if (!warrantyForm.vehicleId || !warrantyForm.startDate || !warrantyForm.expiryDate) {
            setFormError('Vehicle, start date and expiry date are required.');
            return;
        }
        setSaving(true);
        setFormError(null);
        try {
            const created = toWarranty(await send('/api/maintenance/warranties', 'POST', warrantyForm));
            setWarranties(prev => [created, ...prev]);
            closeModal();
            setWarrantyForm({ vehicleId: '', warrantyType: 'MANUFACTURER', provider: '', startDate: '', expiryDate: '', coverageDescription: '', maxClaimAmount: 0 });
        } catch (e) {
            setFormError(e instanceof Error ? e.message : 'Could not save the warranty');
        } finally {
            setSaving(false);
        }
    };

    const handleCreateClaim = async () => {
        if (!selectedWarrantyId || !claimForm.description.trim()) {
            setFormError('Describe the repair being claimed.');
            return;
        }
        setSaving(true);
        setFormError(null);
        try {
            const claim = toClaim(await send('/api/maintenance/warranty-claims', 'POST', { warrantyId: selectedWarrantyId, ...claimForm }));
            setWarranties(prev => prev.map(w =>
                w.id === selectedWarrantyId ? { ...w, claims: [claim, ...(w.claims ?? [])] } : w
            ));
            closeModal();
            setClaimForm({ claimDate: new Date().toISOString().split('T')[0], claimedAmount: 0, description: '', referenceNumber: '' });
        } catch (e) {
            setFormError(e instanceof Error ? e.message : 'Could not file the claim');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (w: VehicleWarranty) => {
        setError(null);
        try {
            const updated = toWarranty(await send(`/api/maintenance/warranties/${w.id}`, 'PATCH', { isActive: !w.isActive }));
            setWarranties(prev => prev.map(x => (x.id === w.id ? updated : x)));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not update the warranty');
        }
    };

    const handleUpdateClaimStatus = async (warrantyId: string, claimId: string, status: WarrantyClaimStatus) => {
        setError(null);
        try {
            const updated = toClaim(await send(`/api/maintenance/warranty-claims/${claimId}`, 'PATCH', { status }));
            setWarranties(prev => prev.map(w =>
                w.id !== warrantyId ? w : { ...w, claims: (w.claims ?? []).map(c => (c.id === claimId ? updated : c)) }
            ));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not update the claim');
        }
    };

    // ─── render ────────────────────────────────────────────────────────────────

    return (
        <div className="mx-auto max-w-7xl pb-12 space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-main)]">Warranty Management</h1>
                    <p className="text-[var(--text-faint)] text-xs mt-1">Track vehicle warranties and manage repair cost claims</p>
                </div>
                <button
                    onClick={() => { setFormError(null); setModalMode('create-warranty'); }}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                    <Plus className="h-4 w-4" />
                    Add Warranty
                </button>
            </div>

            {error && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    <span>{error}</span>
                    <button onClick={() => void load()} className="text-xs underline">Retry</button>
                </div>
            )}

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Active warranties', value: activeCount,  icon: Shield,        cls: 'text-emerald-400' },
                    { label: 'Expired / inactive',value: expiredCount, icon: AlertTriangle,  cls: 'text-amber-400' },
                    { label: 'Total claims',       value: totalClaims, icon: CheckCircle,    cls: 'text-blue-400' },
                    { label: 'Total paid (AED)',   value: totalPaid.toLocaleString(), icon: Clock, cls: 'text-purple-400' },
                ].map(({ label, value, icon: Icon, cls }) => (
                    <div key={label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Icon className={`h-4 w-4 ${cls}`} />
                            <span className="text-xs text-[var(--text-faint)]">{label}</span>
                        </div>
                        <p className="text-2xl font-bold text-[var(--text-main)]">{value}</p>
                    </div>
                ))}
            </div>

            {/* Filter tabs */}
            <div className="flex gap-2 border-b border-[var(--border-subtle)] pb-0">
                {(['all', 'active', 'expired'] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilterActive(f)}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${filterActive === f ? 'border-blue-500 text-[var(--text-main)]' : 'border-transparent text-[var(--text-faint)] hover:text-[var(--text-muted)]'}`}
                    >
                        {f === 'all' ? `All (${warranties.length})` : f === 'active' ? `Active (${activeCount})` : `Expired (${expiredCount})`}
                    </button>
                ))}
            </div>

            {/* Warranty list */}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map(w => {
                    const days = daysUntilExpiry(w.expiryDate);
                    const expired = isExpired(w);
                    const claimed = claimedTotal(w);
                    const remaining = w.maxClaimAmount ? w.maxClaimAmount - claimed : null;

                    return (
                        <div key={w.id} className={`rounded-xl border bg-[var(--bg-surface)] p-5 flex flex-col gap-3 ${expired || !w.isActive ? 'border-[var(--border-subtle)] opacity-70' : 'border-[var(--border-subtle)]'}`}>
                            {/* Top row */}
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${WARRANTY_TYPE_COLOR[w.warrantyType]}`}>
                                            {WARRANTY_TYPE_LABELS[w.warrantyType]}
                                        </span>
                                        {!w.isActive && (
                                            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium bg-[var(--bg-surface-hover)]/40 text-[var(--text-muted)] border-[var(--border-subtle)]">
                                                Inactive
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-1 text-sm font-semibold text-[var(--text-main)] truncate">Vehicle: {vehicleLabel(w.vehicleId)}</p>
                                    {w.provider && <p className="text-xs text-[var(--text-muted)]">{w.provider}</p>}
                                </div>
                                <button
                                    onClick={() => void handleToggleActive(w)}
                                    className="text-xs text-[var(--text-faint)] hover:text-[var(--text-main)] shrink-0"
                                    title={w.isActive ? 'Deactivate' : 'Activate'}
                                >
                                    {w.isActive ? <Shield className="h-4 w-4 text-emerald-400" /> : <X className="h-4 w-4" />}
                                </button>
                            </div>

                            {/* Coverage */}
                            {w.coverageDescription && (
                                <p className="text-xs text-[var(--text-muted)] line-clamp-2">{w.coverageDescription}</p>
                            )}

                            {/* Dates */}
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                    <span className="text-[var(--text-faint)] block">Start</span>
                                    <span className="text-[var(--text-muted)]">{w.startDate}</span>
                                </div>
                                <div>
                                    <span className="text-[var(--text-faint)] block">Expires</span>
                                    <span className={expired ? 'text-red-400 font-medium' : days < 90 ? 'text-amber-400 font-medium' : 'text-[var(--text-muted)]'}>
                                        {w.expiryDate}
                                        {!expired && ` (${days}d)`}
                                        {expired && ' (Expired)'}
                                    </span>
                                </div>
                            </div>

                            {/* Claim summary */}
                            {w.maxClaimAmount != null && (
                                <div>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-[var(--text-faint)]">Claimed / Limit</span>
                                        <span className="text-[var(--text-muted)]">AED {claimed.toLocaleString()} / {w.maxClaimAmount.toLocaleString()}</span>
                                    </div>
                                    <div className="h-1.5 w-full rounded-full bg-[var(--bg-surface-hover)]">
                                        <div
                                            className="h-1.5 rounded-full bg-blue-500"
                                            style={{ width: `${Math.min((claimed / w.maxClaimAmount) * 100, 100)}%` }}
                                        />
                                    </div>
                                    {remaining != null && remaining >= 0 && (
                                        <p className="text-xs text-[var(--text-faint)] mt-0.5">AED {remaining.toLocaleString()} remaining</p>
                                    )}
                                </div>
                            )}

                            {/* Claims list */}
                            {(w.claims ?? []).length > 0 && (
                                <div className="border-t border-[var(--border-subtle)] pt-3 space-y-2">
                                    <p className="text-xs font-medium text-[var(--text-muted)] uppercase">Claims ({w.claims!.length})</p>
                                    {w.claims!.map(c => (
                                        <div key={c.id} className="flex items-center justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs text-[var(--text-muted)] truncate">{c.description}</p>
                                                <p className="text-xs text-[var(--text-faint)]">{c.claimDate} · AED {(c.claimedAmount ?? 0).toLocaleString()}</p>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium ${CLAIM_STATUS_CONFIG[c.status].cls}`}>
                                                    {CLAIM_STATUS_CONFIG[c.status].label}
                                                </span>
                                                {c.status === 'PENDING' && (
                                                    <div className="flex gap-1">
                                                        <button onClick={() => void handleUpdateClaimStatus(w.id, c.id, 'APPROVED')} className="text-xs text-emerald-400 hover:text-emerald-300">✓</button>
                                                        <button onClick={() => void handleUpdateClaimStatus(w.id, c.id, 'REJECTED')} className="text-xs text-red-400 hover:text-red-300">✗</button>
                                                    </div>
                                                )}
                                                {c.status === 'APPROVED' && (
                                                    <button onClick={() => void handleUpdateClaimStatus(w.id, c.id, 'PAID')} className="text-xs text-blue-400 hover:text-blue-300">Mark Paid</button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Footer actions */}
                            <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-3 mt-auto">
                                <button
                                    onClick={() => { setSelectedWarrantyId(w.id); setFormError(null); setModalMode('create-claim'); }}
                                    disabled={!w.isActive || expired}
                                    className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    File Claim
                                </button>
                            </div>
                        </div>
                    );
                })}

                {loading && (
                    <div className="col-span-full flex items-center justify-center gap-2 p-12 text-[var(--text-faint)]">
                        <Loader2 className="h-5 w-5 animate-spin" /> Loading warranties…
                    </div>
                )}

                {!loading && filtered.length === 0 && (
                    <div className="col-span-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center">
                        <Shield className="h-10 w-10 text-[var(--text-faint)] mx-auto mb-3" />
                        <p className="text-[var(--text-faint)]">No warranties found</p>
                        <button onClick={() => { setFormError(null); setModalMode('create-warranty'); }} className="mt-3 text-sm text-blue-400 hover:text-blue-300">
                            Add the first warranty
                        </button>
                    </div>
                )}
            </div>

            {/* ── Create Warranty Modal ── */}
            {modalMode === 'create-warranty' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-lg rounded-xl bg-[var(--bg-surface)] p-6 shadow-xl max-h-[90vh] overflow-y-auto">
                        <h3 className="text-lg font-bold text-[var(--text-main)] mb-4">Add Warranty</h3>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Vehicle *</label>
                                    <select value={warrantyForm.vehicleId} onChange={e => setWarrantyForm({ ...warrantyForm, vehicleId: e.target.value })} className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm bg-[var(--bg-surface)] text-[var(--text-main)]">
                                        <option value="">{vehicles.length ? 'Select a vehicle' : 'No vehicles found'}</option>
                                        {vehicles.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Warranty Type</label>
                                    <select value={warrantyForm.warrantyType} onChange={e => setWarrantyForm({ ...warrantyForm, warrantyType: e.target.value as WarrantyType })} className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm bg-[var(--bg-surface)] text-[var(--text-main)]">
                                        {(Object.keys(WARRANTY_TYPE_LABELS) as WarrantyType[]).map(t => (
                                            <option key={t} value={t}>{WARRANTY_TYPE_LABELS[t]}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Provider</label>
                                <input type="text" value={warrantyForm.provider} onChange={e => setWarrantyForm({ ...warrantyForm, provider: e.target.value })} className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm bg-[var(--bg-surface)] text-[var(--text-main)]" placeholder="e.g. Toyota, Al-Futtaim" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Start Date *</label>
                                    <input type="date" value={warrantyForm.startDate} onChange={e => setWarrantyForm({ ...warrantyForm, startDate: e.target.value })} className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm bg-[var(--bg-surface)] text-[var(--text-main)]" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Expiry Date *</label>
                                    <input type="date" value={warrantyForm.expiryDate} onChange={e => setWarrantyForm({ ...warrantyForm, expiryDate: e.target.value })} className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm bg-[var(--bg-surface)] text-[var(--text-main)]" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Coverage Description</label>
                                <textarea value={warrantyForm.coverageDescription} onChange={e => setWarrantyForm({ ...warrantyForm, coverageDescription: e.target.value })} rows={2} className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm bg-[var(--bg-surface)] text-[var(--text-main)]" placeholder="What does this warranty cover?" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Max Claim Amount (AED)</label>
                                <input type="number" min={0} value={warrantyForm.maxClaimAmount} onChange={e => setWarrantyForm({ ...warrantyForm, maxClaimAmount: parseFloat(e.target.value) || 0 })} className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm bg-[var(--bg-surface)] text-[var(--text-main)]" />
                            </div>
                        </div>
                        {formError && <p className="mt-4 text-sm text-red-400">{formError}</p>}
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={closeModal} className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]">Cancel</button>
                            <button onClick={() => void handleCreateWarranty()} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">{saving ? 'Saving…' : 'Create Warranty'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── File Claim Modal ── */}
            {modalMode === 'create-claim' && selectedWarranty && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded-xl bg-[var(--bg-surface)] p-6 shadow-xl">
                        <h3 className="text-lg font-bold text-[var(--text-main)] mb-1">File Warranty Claim</h3>
                        <p className="text-xs text-[var(--text-muted)] mb-4">
                            {selectedWarranty.provider} · {WARRANTY_TYPE_LABELS[selectedWarranty.warrantyType]} · Vehicle {vehicleLabel(selectedWarranty.vehicleId)}
                        </p>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Claim Date</label>
                                    <input type="date" value={claimForm.claimDate} onChange={e => setClaimForm({ ...claimForm, claimDate: e.target.value })} className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm bg-[var(--bg-surface)] text-[var(--text-main)]" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Claim Amount (AED)</label>
                                    <input type="number" min={0} value={claimForm.claimedAmount} onChange={e => setClaimForm({ ...claimForm, claimedAmount: parseFloat(e.target.value) || 0 })} className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm bg-[var(--bg-surface)] text-[var(--text-main)]" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Description *</label>
                                <textarea value={claimForm.description} onChange={e => setClaimForm({ ...claimForm, description: e.target.value })} rows={3} className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm bg-[var(--bg-surface)] text-[var(--text-main)]" placeholder="Describe what needs to be claimed under warranty" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Reference Number (optional)</label>
                                <input type="text" value={claimForm.referenceNumber} onChange={e => setClaimForm({ ...claimForm, referenceNumber: e.target.value })} className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm bg-[var(--bg-surface)] text-[var(--text-main)]" placeholder="e.g. WO-2026-0042" />
                            </div>
                            {selectedWarranty.maxClaimAmount != null && (
                                <div className="rounded-lg bg-[var(--bg-surface)]/50 p-3 text-xs text-[var(--text-muted)]">
                                    Remaining coverage: AED {(selectedWarranty.maxClaimAmount - claimedTotal(selectedWarranty)).toLocaleString()}
                                </div>
                            )}
                        </div>
                        {formError && <p className="mt-4 text-sm text-red-400">{formError}</p>}
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={closeModal} className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]">Cancel</button>
                            <button onClick={() => void handleCreateClaim()} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">{saving ? 'Saving…' : 'Submit Claim'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
