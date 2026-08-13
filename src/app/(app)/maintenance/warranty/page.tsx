'use client';

import { useState } from 'react';
import { Shield, Plus, AlertTriangle, CheckCircle, Clock, X } from 'lucide-react';
import { VehicleWarranty, WarrantyClaim, WarrantyType, WarrantyClaimStatus } from '@/types/maintenance';

// ─── seed data ────────────────────────────────────────────────────────────────

const SEED_WARRANTIES: VehicleWarranty[] = [
    {
        id: 'w-1',
        tenantId: '',
        vehicleId: 'v-001',
        warrantyType: 'MANUFACTURER',
        provider: 'Toyota',
        startDate: '2023-01-15',
        expiryDate: '2026-01-15',
        coverageDescription: 'Full manufacturer warranty covering engine, transmission, and drivetrain',
        maxClaimAmount: 50000,
        isActive: true,
        claims: [
            { id: 'wc-1', warrantyId: 'w-1', claimDate: '2025-03-10', claimedAmount: 3200, approvedAmount: 3200, status: 'PAID', description: 'Engine sensor replacement', referenceNumber: 'CLM-2025-001', createdAt: '2025-03-10T09:00:00Z' },
        ],
    },
    {
        id: 'w-2',
        tenantId: '',
        vehicleId: 'v-002',
        warrantyType: 'EXTENDED',
        provider: 'Al-Futtaim Warranty Services',
        startDate: '2024-06-01',
        expiryDate: '2027-06-01',
        coverageDescription: 'Extended warranty for electrical systems and AC',
        maxClaimAmount: 20000,
        isActive: true,
        claims: [],
    },
    {
        id: 'w-3',
        tenantId: '',
        vehicleId: 'v-003',
        warrantyType: 'THIRD_PARTY',
        provider: 'FleetGuard Insurance',
        startDate: '2022-09-01',
        expiryDate: '2024-09-01',
        coverageDescription: 'Third-party mechanical breakdown coverage',
        maxClaimAmount: 15000,
        isActive: false,
        claims: [],
    },
];

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
    THIRD_PARTY:  'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function daysUntilExpiry(expiryDate: string): number {
    return Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 86_400_000);
}

function isExpired(w: VehicleWarranty): boolean {
    return new Date(w.expiryDate) < new Date();
}

function claimedTotal(w: VehicleWarranty): number {
    return (w.claims ?? []).reduce((s, c) => s + (c.approvedAmount ?? c.claimedAmount ?? 0), 0);
}

// ─── component ────────────────────────────────────────────────────────────────

export default function WarrantyPage() {
    const [warranties, setWarranties] = useState<VehicleWarranty[]>(SEED_WARRANTIES);
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

    // ─── handlers ──────────────────────────────────────────────────────────────

    const handleCreateWarranty = () => {
        if (!warrantyForm.vehicleId || !warrantyForm.startDate || !warrantyForm.expiryDate) return;
        const newW: VehicleWarranty = {
            id: `w-${Date.now()}`,
            tenantId: '',
            ...warrantyForm,
            isActive: true,
            claims: [],
        };
        setWarranties(prev => [newW, ...prev]);
        setModalMode(null);
        setWarrantyForm({ vehicleId: '', warrantyType: 'MANUFACTURER', provider: '', startDate: '', expiryDate: '', coverageDescription: '', maxClaimAmount: 0 });
    };

    const handleCreateClaim = () => {
        if (!selectedWarrantyId || !claimForm.description) return;
        const newClaim: WarrantyClaim = {
            id: `wc-${Date.now()}`,
            warrantyId: selectedWarrantyId,
            claimDate: claimForm.claimDate,
            claimedAmount: claimForm.claimedAmount,
            status: 'PENDING',
            description: claimForm.description,
            referenceNumber: claimForm.referenceNumber || undefined,
            createdAt: new Date().toISOString(),
        };
        setWarranties(prev => prev.map(w =>
            w.id === selectedWarrantyId ? { ...w, claims: [...(w.claims ?? []), newClaim] } : w
        ));
        setModalMode(null);
        setClaimForm({ claimDate: new Date().toISOString().split('T')[0], claimedAmount: 0, description: '', referenceNumber: '' });
    };

    const handleToggleActive = (id: string) => {
        setWarranties(prev => prev.map(w => w.id === id ? { ...w, isActive: !w.isActive } : w));
    };

    const handleUpdateClaimStatus = (warrantyId: string, claimId: string, status: WarrantyClaimStatus) => {
        setWarranties(prev => prev.map(w =>
            w.id !== warrantyId ? w : {
                ...w,
                claims: (w.claims ?? []).map(c =>
                    c.id !== claimId ? c : { ...c, status }
                ),
            }
        ));
    };

    // ─── render ────────────────────────────────────────────────────────────────

    return (
        <div className="mx-auto max-w-7xl pb-12 space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Warranty Management</h1>
                    <p className="text-slate-500 text-sm mt-1">Track vehicle warranties and manage repair cost claims</p>
                </div>
                <button
                    onClick={() => setModalMode('create-warranty')}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                    <Plus className="h-4 w-4" />
                    Add Warranty
                </button>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Active warranties', value: activeCount,  icon: Shield,        cls: 'text-emerald-400' },
                    { label: 'Expired / inactive',value: expiredCount, icon: AlertTriangle,  cls: 'text-amber-400' },
                    { label: 'Total claims',       value: totalClaims, icon: CheckCircle,    cls: 'text-blue-400' },
                    { label: 'Total paid (AED)',   value: totalPaid.toLocaleString(), icon: Clock, cls: 'text-purple-400' },
                ].map(({ label, value, icon: Icon, cls }) => (
                    <div key={label} className="rounded-xl border border-white/10 bg-slate-900 p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Icon className={`h-4 w-4 ${cls}`} />
                            <span className="text-xs text-slate-500">{label}</span>
                        </div>
                        <p className="text-2xl font-bold text-white">{value}</p>
                    </div>
                ))}
            </div>

            {/* Filter tabs */}
            <div className="flex gap-2 border-b border-white/10 pb-0">
                {(['all', 'active', 'expired'] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilterActive(f)}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${filterActive === f ? 'border-blue-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
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
                        <div key={w.id} className={`rounded-xl border bg-slate-900 p-5 flex flex-col gap-3 ${expired || !w.isActive ? 'border-white/10 opacity-70' : 'border-white/15'}`}>
                            {/* Top row */}
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${WARRANTY_TYPE_COLOR[w.warrantyType]}`}>
                                            {WARRANTY_TYPE_LABELS[w.warrantyType]}
                                        </span>
                                        {!w.isActive && (
                                            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium bg-slate-700/40 text-slate-400 border-white/10">
                                                Inactive
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-1 text-sm font-semibold text-white truncate">Vehicle: {w.vehicleId}</p>
                                    {w.provider && <p className="text-xs text-slate-400">{w.provider}</p>}
                                </div>
                                <button
                                    onClick={() => handleToggleActive(w.id)}
                                    className="text-xs text-slate-500 hover:text-white shrink-0"
                                    title={w.isActive ? 'Deactivate' : 'Activate'}
                                >
                                    {w.isActive ? <Shield className="h-4 w-4 text-emerald-400" /> : <X className="h-4 w-4" />}
                                </button>
                            </div>

                            {/* Coverage */}
                            {w.coverageDescription && (
                                <p className="text-xs text-slate-400 line-clamp-2">{w.coverageDescription}</p>
                            )}

                            {/* Dates */}
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                    <span className="text-slate-500 block">Start</span>
                                    <span className="text-slate-300">{w.startDate}</span>
                                </div>
                                <div>
                                    <span className="text-slate-500 block">Expires</span>
                                    <span className={expired ? 'text-red-400 font-medium' : days < 90 ? 'text-amber-400 font-medium' : 'text-slate-300'}>
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
                                        <span className="text-slate-500">Claimed / Limit</span>
                                        <span className="text-slate-300">AED {claimed.toLocaleString()} / {w.maxClaimAmount.toLocaleString()}</span>
                                    </div>
                                    <div className="h-1.5 w-full rounded-full bg-slate-700">
                                        <div
                                            className="h-1.5 rounded-full bg-blue-500"
                                            style={{ width: `${Math.min((claimed / w.maxClaimAmount) * 100, 100)}%` }}
                                        />
                                    </div>
                                    {remaining != null && remaining >= 0 && (
                                        <p className="text-xs text-slate-500 mt-0.5">AED {remaining.toLocaleString()} remaining</p>
                                    )}
                                </div>
                            )}

                            {/* Claims list */}
                            {(w.claims ?? []).length > 0 && (
                                <div className="border-t border-white/10 pt-3 space-y-2">
                                    <p className="text-xs font-medium text-slate-400 uppercase">Claims ({w.claims!.length})</p>
                                    {w.claims!.map(c => (
                                        <div key={c.id} className="flex items-center justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs text-slate-300 truncate">{c.description}</p>
                                                <p className="text-xs text-slate-500">{c.claimDate} · AED {(c.claimedAmount ?? 0).toLocaleString()}</p>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium ${CLAIM_STATUS_CONFIG[c.status].cls}`}>
                                                    {CLAIM_STATUS_CONFIG[c.status].label}
                                                </span>
                                                {c.status === 'PENDING' && (
                                                    <div className="flex gap-1">
                                                        <button onClick={() => handleUpdateClaimStatus(w.id, c.id, 'APPROVED')} className="text-xs text-emerald-400 hover:text-emerald-300">✓</button>
                                                        <button onClick={() => handleUpdateClaimStatus(w.id, c.id, 'REJECTED')} className="text-xs text-red-400 hover:text-red-300">✗</button>
                                                    </div>
                                                )}
                                                {c.status === 'APPROVED' && (
                                                    <button onClick={() => handleUpdateClaimStatus(w.id, c.id, 'PAID')} className="text-xs text-blue-400 hover:text-blue-300">Mark Paid</button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Footer actions */}
                            <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-3 mt-auto">
                                <button
                                    onClick={() => { setSelectedWarrantyId(w.id); setModalMode('create-claim'); }}
                                    disabled={!w.isActive || expired}
                                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    File Claim
                                </button>
                            </div>
                        </div>
                    );
                })}

                {filtered.length === 0 && (
                    <div className="col-span-full rounded-xl border border-white/10 bg-slate-900 p-12 text-center">
                        <Shield className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                        <p className="text-slate-500">No warranties found</p>
                        <button onClick={() => setModalMode('create-warranty')} className="mt-3 text-sm text-blue-400 hover:text-blue-300">
                            Add the first warranty
                        </button>
                    </div>
                )}
            </div>

            {/* ── Create Warranty Modal ── */}
            {modalMode === 'create-warranty' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-lg rounded-xl bg-slate-900 p-6 shadow-xl max-h-[90vh] overflow-y-auto">
                        <h3 className="text-lg font-bold text-white mb-4">Add Warranty</h3>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-slate-300 mb-1">Vehicle ID *</label>
                                    <input type="text" value={warrantyForm.vehicleId} onChange={e => setWarrantyForm({ ...warrantyForm, vehicleId: e.target.value })} className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm bg-slate-800 text-white" placeholder="v-001" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-300 mb-1">Warranty Type</label>
                                    <select value={warrantyForm.warrantyType} onChange={e => setWarrantyForm({ ...warrantyForm, warrantyType: e.target.value as WarrantyType })} className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm bg-slate-800 text-white">
                                        {(Object.keys(WARRANTY_TYPE_LABELS) as WarrantyType[]).map(t => (
                                            <option key={t} value={t}>{WARRANTY_TYPE_LABELS[t]}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1">Provider</label>
                                <input type="text" value={warrantyForm.provider} onChange={e => setWarrantyForm({ ...warrantyForm, provider: e.target.value })} className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm bg-slate-800 text-white" placeholder="e.g. Toyota, Al-Futtaim" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-slate-300 mb-1">Start Date *</label>
                                    <input type="date" value={warrantyForm.startDate} onChange={e => setWarrantyForm({ ...warrantyForm, startDate: e.target.value })} className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm bg-slate-800 text-white" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-300 mb-1">Expiry Date *</label>
                                    <input type="date" value={warrantyForm.expiryDate} onChange={e => setWarrantyForm({ ...warrantyForm, expiryDate: e.target.value })} className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm bg-slate-800 text-white" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1">Coverage Description</label>
                                <textarea value={warrantyForm.coverageDescription} onChange={e => setWarrantyForm({ ...warrantyForm, coverageDescription: e.target.value })} rows={2} className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm bg-slate-800 text-white" placeholder="What does this warranty cover?" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1">Max Claim Amount (AED)</label>
                                <input type="number" min={0} value={warrantyForm.maxClaimAmount} onChange={e => setWarrantyForm({ ...warrantyForm, maxClaimAmount: parseFloat(e.target.value) || 0 })} className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm bg-slate-800 text-white" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => setModalMode(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10">Cancel</button>
                            <button onClick={handleCreateWarranty} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Create Warranty</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── File Claim Modal ── */}
            {modalMode === 'create-claim' && selectedWarranty && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded-xl bg-slate-900 p-6 shadow-xl">
                        <h3 className="text-lg font-bold text-white mb-1">File Warranty Claim</h3>
                        <p className="text-xs text-slate-400 mb-4">
                            {selectedWarranty.provider} · {WARRANTY_TYPE_LABELS[selectedWarranty.warrantyType]} · Vehicle {selectedWarranty.vehicleId}
                        </p>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-slate-300 mb-1">Claim Date</label>
                                    <input type="date" value={claimForm.claimDate} onChange={e => setClaimForm({ ...claimForm, claimDate: e.target.value })} className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm bg-slate-800 text-white" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-300 mb-1">Claim Amount (AED)</label>
                                    <input type="number" min={0} value={claimForm.claimedAmount} onChange={e => setClaimForm({ ...claimForm, claimedAmount: parseFloat(e.target.value) || 0 })} className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm bg-slate-800 text-white" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1">Description *</label>
                                <textarea value={claimForm.description} onChange={e => setClaimForm({ ...claimForm, description: e.target.value })} rows={3} className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm bg-slate-800 text-white" placeholder="Describe what needs to be claimed under warranty" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1">Reference Number (optional)</label>
                                <input type="text" value={claimForm.referenceNumber} onChange={e => setClaimForm({ ...claimForm, referenceNumber: e.target.value })} className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm bg-slate-800 text-white" placeholder="e.g. WO-2026-0042" />
                            </div>
                            {selectedWarranty.maxClaimAmount != null && (
                                <div className="rounded-lg bg-slate-800/50 p-3 text-xs text-slate-400">
                                    Remaining coverage: AED {(selectedWarranty.maxClaimAmount - claimedTotal(selectedWarranty)).toLocaleString()}
                                </div>
                            )}
                        </div>
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => setModalMode(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10">Cancel</button>
                            <button onClick={handleCreateClaim} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Submit Claim</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
