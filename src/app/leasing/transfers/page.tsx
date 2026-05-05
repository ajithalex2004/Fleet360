'use client';
import React, { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
type TransferStatus = 'REQUESTED' | 'APPROVED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';
type TransferReason = 'REBALANCING' | 'CONTRACT_REQUIREMENT' | 'MAINTENANCE' | 'CUSTOMER_REQUEST' | 'OTHER';
type Emirate = 'ABU_DHABI' | 'DUBAI' | 'SHARJAH' | 'AJMAN' | 'UMM_AL_QUWAIN' | 'RAS_AL_KHAIMAH' | 'FUJAIRAH';

interface Transfer {
  id: string;
  transferNo: string;
  vehicleId: string | null;
  vehicleNo: string;
  vehicleName: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  fromBranchId: string | null;
  fromBranchName: string;
  fromEmirate: string | null;
  toBranchId: string | null;
  toBranchName: string;
  toEmirate: string | null;
  transferDate: string;
  reason: TransferReason;
  fuelLevel: number | null;
  odometerReading: number | null;
  conditionNotes: string | null;
  driverName: string | null;
  driverPhone: string | null;
  status: TransferStatus;
  requestedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  cancelledReason: string | null;
  notes: string | null;
  createdAt: string;
}

interface Summary {
  requested: number;
  approved: number;
  inTransit: number;
  completed: number;
  cancelled: number;
  completedThisMonth: number;
}

interface ApiResponse {
  data: Transfer[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  summary: Summary;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const EMIRATES: { value: Emirate; label: string; flag: string }[] = [
  { value: 'ABU_DHABI',     label: 'Abu Dhabi',      flag: '🏛️' },
  { value: 'DUBAI',         label: 'Dubai',           flag: '🏙️' },
  { value: 'SHARJAH',       label: 'Sharjah',         flag: '🕌' },
  { value: 'AJMAN',         label: 'Ajman',           flag: '⛵' },
  { value: 'UMM_AL_QUWAIN', label: 'Umm Al Quwain',  flag: '🌿' },
  { value: 'RAS_AL_KHAIMAH',label: 'Ras Al Khaimah',  flag: '⛰️' },
  { value: 'FUJAIRAH',      label: 'Fujairah',        flag: '🌊' },
];

const EMIRATE_FLAGS: Record<string, string> = {
  ABU_DHABI: '🏛️', DUBAI: '🏙️', SHARJAH: '🕌',
  AJMAN: '⛵', UMM_AL_QUWAIN: '🌿', RAS_AL_KHAIMAH: '⛰️', FUJAIRAH: '🌊',
};
const emirateFlag = (e: string | null) => e ? (EMIRATE_FLAGS[e] ?? '🌐') : '🌐';
const emirateLabel = (e: string | null) => {
  if (!e) return '';
  return EMIRATES.find(x => x.value === e)?.label ?? e;
};

const REASONS: { value: TransferReason; label: string }[] = [
  { value: 'REBALANCING',           label: 'Rebalancing' },
  { value: 'CONTRACT_REQUIREMENT',  label: 'Contract Requirement' },
  { value: 'MAINTENANCE',           label: 'Maintenance' },
  { value: 'CUSTOMER_REQUEST',      label: 'Customer Request' },
  { value: 'OTHER',                 label: 'Other' },
];

const REASON_COLORS: Record<TransferReason, string> = {
  REBALANCING:          'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  CONTRACT_REQUIREMENT: 'bg-violet-500/20 text-violet-300 border border-violet-500/30',
  MAINTENANCE:          'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  CUSTOMER_REQUEST:     'bg-teal-500/20 text-teal-300 border border-teal-500/30',
  OTHER:                'bg-slate-500/20 text-slate-300 border border-slate-500/30',
};

const STATUS_COLORS: Record<TransferStatus, string> = {
  REQUESTED:  'bg-amber-500/20  text-amber-300  border border-amber-500/30',
  APPROVED:   'bg-blue-500/20   text-blue-300   border border-blue-500/30',
  IN_TRANSIT: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
  COMPLETED:  'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  CANCELLED:  'bg-red-500/20    text-red-300    border border-red-500/30',
};

const STATUS_LABELS: Record<TransferStatus, string> = {
  REQUESTED:  'Requested',
  APPROVED:   'Approved',
  IN_TRANSIT: 'In Transit',
  COMPLETED:  'Completed',
  CANCELLED:  'Cancelled',
};

const ALL_STATUSES: TransferStatus[] = ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'];

// ─── Empty form ───────────────────────────────────────────────────────────────
const emptyForm = () => ({
  vehicleNo: '', vehicleName: '', vehicleMake: '', vehicleModel: '',
  fromBranchName: '', fromEmirate: '' as Emirate | '',
  toBranchName: '',   toEmirate:   '' as Emirate | '',
  transferDate: new Date().toISOString().split('T')[0],
  reason: 'REBALANCING' as TransferReason,
  fuelLevel: '', odometerReading: '', conditionNotes: '',
  driverName: '', driverPhone: '',
  requestedBy: '', notes: '',
});

// ─── Input helper ─────────────────────────────────────────────────────────────
const inputCls = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500';
const labelCls = 'block text-xs font-medium text-slate-400 mb-1';

export default function LeasingTransfersPage() {
  const [transfers, setTransfers]     = useState<Transfer[]>([]);
  const [summary, setSummary]         = useState<Summary>({ requested: 0, approved: 0, inTransit: 0, completed: 0, cancelled: 0, completedThisMonth: 0 });
  const [loading, setLoading]         = useState(true);
  const [statusFilter, setStatusFilter] = useState<TransferStatus | 'ALL'>('ALL');
  const [search, setSearch]           = useState('');

  // Modals
  const [showCreate, setShowCreate]   = useState(false);
  const [showApprove, setShowApprove] = useState<Transfer | null>(null);
  const [showCancel, setShowCancel]   = useState<Transfer | null>(null);
  const [form, setForm]               = useState(emptyForm());
  const [approvedBy, setApprovedBy]   = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  const fetchTransfers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (search) params.set('search', search);
      const res = await fetch(`/api/leasing/transfers?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json: ApiResponse = await res.json();
      setTransfers(json.data);
      setSummary(json.summary);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => { fetchTransfers(); }, [fetchTransfers]);

  const handleCreate = async () => {
    if (!form.vehicleNo.trim() || !form.fromBranchName.trim() || !form.toBranchName.trim() || !form.transferDate || !form.reason) {
      setError('Vehicle No, From Branch, To Branch, Transfer Date and Reason are required.');
      return;
    }
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/leasing/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleNo:       form.vehicleNo.trim(),
          vehicleName:     form.vehicleName || undefined,
          vehicleMake:     form.vehicleMake || undefined,
          vehicleModel:    form.vehicleModel || undefined,
          fromBranchName:  form.fromBranchName.trim(),
          fromEmirate:     form.fromEmirate || undefined,
          toBranchName:    form.toBranchName.trim(),
          toEmirate:       form.toEmirate || undefined,
          transferDate:    form.transferDate,
          reason:          form.reason,
          fuelLevel:       form.fuelLevel !== '' ? Number(form.fuelLevel) : undefined,
          odometerReading: form.odometerReading !== '' ? Number(form.odometerReading) : undefined,
          conditionNotes:  form.conditionNotes || undefined,
          driverName:      form.driverName || undefined,
          driverPhone:     form.driverPhone || undefined,
          requestedBy:     form.requestedBy || undefined,
          notes:           form.notes || undefined,
        }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error ?? 'Failed to create');
      }
      setShowCreate(false);
      setForm(emptyForm());
      fetchTransfers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create transfer');
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (id: string, action: string, extra?: Record<string, string>) => {
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/leasing/transfers?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error ?? 'Failed to update');
      }
      setShowApprove(null);
      setShowCancel(null);
      setApprovedBy('');
      setCancelReason('');
      fetchTransfers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update transfer');
    } finally {
      setSaving(false);
    }
  };

  const f = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  // Pipeline counts
  const pipelineSteps: { key: TransferStatus; label: string; count: number; color: string }[] = [
    { key: 'REQUESTED',  label: 'Requested',  count: summary.requested,  color: 'border-amber-500/50  bg-amber-500/10  text-amber-300'  },
    { key: 'APPROVED',   label: 'Approved',   count: summary.approved,   color: 'border-blue-500/50   bg-blue-500/10   text-blue-300'   },
    { key: 'IN_TRANSIT', label: 'In Transit', count: summary.inTransit,  color: 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300' },
    { key: 'COMPLETED',  label: 'Completed',  count: summary.completed,  color: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Inter-Branch Vehicle Transfers</h1>
          <p className="text-sm text-slate-400 mt-1">Manage vehicle movements between branches and emirates</p>
        </div>
        <button
          onClick={() => { setForm(emptyForm()); setError(''); setShowCreate(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <span className="text-base">🔀</span> + Request Transfer
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-amber-500/20 rounded-xl p-4">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Requested</p>
          <p className="text-3xl font-bold text-amber-400 mt-1">{summary.requested}</p>
          <p className="text-xs text-slate-500 mt-1">Awaiting approval</p>
        </div>
        <div className="bg-slate-900 border border-blue-500/20 rounded-xl p-4">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">In Transit</p>
          <p className="text-3xl font-bold text-blue-400 mt-1">{summary.inTransit}</p>
          <p className="text-xs text-slate-500 mt-1">On the road now</p>
        </div>
        <div className="bg-slate-900 border border-emerald-500/20 rounded-xl p-4">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Completed This Month</p>
          <p className="text-3xl font-bold text-emerald-400 mt-1">{summary.completedThisMonth}</p>
          <p className="text-xs text-slate-500 mt-1">Arrived at destination</p>
        </div>
        <div className="bg-slate-900 border border-red-500/20 rounded-xl p-4">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Cancelled</p>
          <p className="text-3xl font-bold text-red-400 mt-1">{summary.cancelled}</p>
          <p className="text-xs text-slate-500 mt-1">All time</p>
        </div>
      </div>

      {/* Transfer Pipeline Visual */}
      <div className="bg-slate-900 border border-white/5 rounded-xl p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Transfer Pipeline</p>
        <div className="flex items-center gap-1">
          {pipelineSteps.map((step, i) => (
            <React.Fragment key={step.key}>
              <div className={`flex-1 border rounded-lg px-3 py-2.5 text-center ${step.color}`}>
                <p className="text-lg font-bold">{step.count}</p>
                <p className="text-xs font-medium mt-0.5">{step.label}</p>
              </div>
              {i < pipelineSteps.length - 1 && (
                <span className="text-slate-600 text-lg px-0.5">→</span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        {/* Status tabs */}
        <div className="flex gap-1 flex-wrap">
          {(['ALL', ...ALL_STATUSES] as (TransferStatus | 'ALL')[]).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                statusFilter === s
                  ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              {s === 'ALL' ? 'All' : STATUS_LABELS[s]}
              {s !== 'ALL' && (
                <span className="ml-1.5 opacity-70">
                  {s === 'REQUESTED' ? summary.requested
                    : s === 'APPROVED' ? summary.approved
                    : s === 'IN_TRANSIT' ? summary.inTransit
                    : s === 'COMPLETED' ? summary.completed
                    : summary.cancelled}
                </span>
              )}
            </button>
          ))}
        </div>
        {/* Search */}
        <input
          type="text"
          placeholder="Search vehicle no / transfer no…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 w-64"
        />
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-white/5 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-slate-800/60">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Transfer No</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Vehicle</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">From Branch</th>
                <th className="text-center px-2 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">→</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">To Branch</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Transfer Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Reason</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Driver</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-slate-500">Loading transfers…</td>
                </tr>
              ) : transfers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-slate-500">No transfers found</td>
                </tr>
              ) : transfers.map(t => (
                <tr key={t.id} className="hover:bg-white/[0.02] transition-colors">
                  {/* Transfer No */}
                  <td className="px-4 py-3">
                    <span className="font-mono text-violet-300 text-xs">{t.transferNo}</span>
                    <p className="text-xs text-slate-500 mt-0.5">{f(t.createdAt)}</p>
                  </td>
                  {/* Vehicle */}
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{t.vehicleNo}</p>
                    {t.vehicleName && <p className="text-xs text-slate-400">{t.vehicleName}</p>}
                    {(t.vehicleMake || t.vehicleModel) && (
                      <p className="text-xs text-slate-500">{[t.vehicleMake, t.vehicleModel].filter(Boolean).join(' ')}</p>
                    )}
                  </td>
                  {/* From Branch */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">{emirateFlag(t.fromEmirate)}</span>
                      <div>
                        <p className="font-medium text-white text-xs">{t.fromBranchName}</p>
                        {t.fromEmirate && <p className="text-xs text-slate-500">{emirateLabel(t.fromEmirate)}</p>}
                      </div>
                    </div>
                  </td>
                  {/* Arrow */}
                  <td className="px-2 py-3 text-center text-slate-500 text-lg">→</td>
                  {/* To Branch */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">{emirateFlag(t.toEmirate)}</span>
                      <div>
                        <p className="font-medium text-white text-xs">{t.toBranchName}</p>
                        {t.toEmirate && <p className="text-xs text-slate-500">{emirateLabel(t.toEmirate)}</p>}
                      </div>
                    </div>
                  </td>
                  {/* Transfer Date */}
                  <td className="px-4 py-3 text-slate-300 text-xs whitespace-nowrap">{f(t.transferDate)}</td>
                  {/* Reason */}
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${REASON_COLORS[t.reason]}`}>
                      {REASONS.find(r => r.value === t.reason)?.label ?? t.reason}
                    </span>
                  </td>
                  {/* Driver */}
                  <td className="px-4 py-3">
                    {t.driverName ? (
                      <div>
                        <p className="text-xs text-slate-300">{t.driverName}</p>
                        {t.driverPhone && <p className="text-xs text-slate-500">{t.driverPhone}</p>}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  {/* Status */}
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.status]}`}>
                      {STATUS_LABELS[t.status]}
                    </span>
                    {t.approvedBy && (
                      <p className="text-xs text-slate-500 mt-0.5">by {t.approvedBy}</p>
                    )}
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {t.status === 'REQUESTED' && (
                        <>
                          <button
                            onClick={() => { setShowApprove(t); setApprovedBy(''); setError(''); }}
                            className="px-2.5 py-1 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                          >Approve</button>
                          <button
                            onClick={() => { setShowCancel(t); setCancelReason(''); setError(''); }}
                            className="px-2.5 py-1 rounded text-xs font-medium bg-red-900/60 hover:bg-red-900 text-red-300 transition-colors"
                          >Cancel</button>
                        </>
                      )}
                      {t.status === 'APPROVED' && (
                        <button
                          onClick={() => handleAction(t.id, 'DEPART')}
                          className="px-2.5 py-1 rounded text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors whitespace-nowrap"
                        >Mark Departed</button>
                      )}
                      {t.status === 'IN_TRANSIT' && (
                        <button
                          onClick={() => handleAction(t.id, 'ARRIVE')}
                          className="px-2.5 py-1 rounded text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors whitespace-nowrap"
                        >Mark Arrived</button>
                      )}
                      {(t.status === 'COMPLETED' || t.status === 'CANCELLED') && (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Create Modal ──────────────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-white/5">
              <div>
                <h2 className="text-lg font-bold text-white">Request Transfer</h2>
                <p className="text-xs text-slate-400 mt-0.5">New inter-branch vehicle movement</p>
              </div>
              <button onClick={() => setShowCreate(false)} className="text-slate-500 hover:text-white text-xl leading-none">✕</button>
            </div>

            <div className="p-6 space-y-5">
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 text-sm text-red-400">{error}</div>
              )}

              {/* Vehicle Details */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Vehicle Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 sm:col-span-1">
                    <label className={labelCls}>Vehicle No <span className="text-red-400">*</span></label>
                    <input className={inputCls} placeholder="e.g. DXB-A-12345" value={form.vehicleNo}
                      onChange={e => setForm(p => ({ ...p, vehicleNo: e.target.value }))} />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className={labelCls}>Vehicle Name</label>
                    <input className={inputCls} placeholder="e.g. Toyota Camry" value={form.vehicleName}
                      onChange={e => setForm(p => ({ ...p, vehicleName: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Make</label>
                    <input className={inputCls} placeholder="e.g. Toyota" value={form.vehicleMake}
                      onChange={e => setForm(p => ({ ...p, vehicleMake: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Model</label>
                    <input className={inputCls} placeholder="e.g. Camry 2024" value={form.vehicleModel}
                      onChange={e => setForm(p => ({ ...p, vehicleModel: e.target.value }))} />
                  </div>
                </div>
              </div>

              {/* From / To Branch */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Branch Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>From Branch Name <span className="text-red-400">*</span></label>
                    <input className={inputCls} placeholder="Branch name" value={form.fromBranchName}
                      onChange={e => setForm(p => ({ ...p, fromBranchName: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>From Emirate</label>
                    <select className={inputCls} value={form.fromEmirate}
                      onChange={e => setForm(p => ({ ...p, fromEmirate: e.target.value as Emirate | '' }))}>
                      <option value="">Select emirate</option>
                      {EMIRATES.map(em => (
                        <option key={em.value} value={em.value}>{em.flag} {em.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>To Branch Name <span className="text-red-400">*</span></label>
                    <input className={inputCls} placeholder="Branch name" value={form.toBranchName}
                      onChange={e => setForm(p => ({ ...p, toBranchName: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>To Emirate</label>
                    <select className={inputCls} value={form.toEmirate}
                      onChange={e => setForm(p => ({ ...p, toEmirate: e.target.value as Emirate | '' }))}>
                      <option value="">Select emirate</option>
                      {EMIRATES.map(em => (
                        <option key={em.value} value={em.value}>{em.flag} {em.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Transfer Details */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Transfer Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Transfer Date <span className="text-red-400">*</span></label>
                    <input type="date" className={inputCls} value={form.transferDate}
                      onChange={e => setForm(p => ({ ...p, transferDate: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Reason <span className="text-red-400">*</span></label>
                    <select className={inputCls} value={form.reason}
                      onChange={e => setForm(p => ({ ...p, reason: e.target.value as TransferReason }))}>
                      {REASONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Driver Name</label>
                    <input className={inputCls} placeholder="Driver name" value={form.driverName}
                      onChange={e => setForm(p => ({ ...p, driverName: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Driver Phone</label>
                    <input className={inputCls} placeholder="+971 50 123 4567" value={form.driverPhone}
                      onChange={e => setForm(p => ({ ...p, driverPhone: e.target.value }))} />
                  </div>
                </div>
              </div>

              {/* Vehicle Condition */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Vehicle Condition</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Fuel Level (0–8)</label>
                    <input type="number" min="0" max="8" className={inputCls} placeholder="0–8" value={form.fuelLevel}
                      onChange={e => setForm(p => ({ ...p, fuelLevel: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Odometer Reading (km)</label>
                    <input type="number" min="0" className={inputCls} placeholder="km" value={form.odometerReading}
                      onChange={e => setForm(p => ({ ...p, odometerReading: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Condition Notes</label>
                    <textarea className={inputCls} rows={2} placeholder="Note any scratches, damage, etc." value={form.conditionNotes}
                      onChange={e => setForm(p => ({ ...p, conditionNotes: e.target.value }))} />
                  </div>
                </div>
              </div>

              {/* Admin */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Requested By</label>
                  <input className={inputCls} placeholder="Staff name" value={form.requestedBy}
                    onChange={e => setForm(p => ({ ...p, requestedBy: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Notes</label>
                  <input className={inputCls} placeholder="Additional notes" value={form.notes}
                    onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="flex gap-3 p-6 border-t border-white/5">
              <button onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={handleCreate} disabled={saving}
                className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
                {saving ? 'Creating…' : 'Request Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Approve Modal ─────────────────────────────────────────────────── */}
      {showApprove && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <h2 className="text-base font-bold text-white">Approve Transfer</h2>
              <button onClick={() => setShowApprove(null)} className="text-slate-500 hover:text-white text-xl leading-none">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-400">{error}</div>}
              <p className="text-sm text-slate-300">
                Approving transfer <span className="font-mono text-violet-300">{showApprove.transferNo}</span> for vehicle{' '}
                <span className="font-medium text-white">{showApprove.vehicleNo}</span>
              </p>
              <div>
                <label className={labelCls}>Approved By <span className="text-red-400">*</span></label>
                <input className={inputCls} placeholder="Enter approver name" value={approvedBy}
                  onChange={e => setApprovedBy(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t border-white/5">
              <button onClick={() => setShowApprove(null)} className="flex-1 px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={() => handleAction(showApprove.id, 'APPROVE', { approvedBy })} disabled={saving || !approvedBy.trim()}
                className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-50">
                {saving ? 'Approving…' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel Modal ──────────────────────────────────────────────────── */}
      {showCancel && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <h2 className="text-base font-bold text-white">Cancel Transfer</h2>
              <button onClick={() => setShowCancel(null)} className="text-slate-500 hover:text-white text-xl leading-none">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-400">{error}</div>}
              <p className="text-sm text-slate-300">
                Cancelling transfer <span className="font-mono text-violet-300">{showCancel.transferNo}</span>
              </p>
              <div>
                <label className={labelCls}>Cancellation Reason <span className="text-red-400">*</span></label>
                <textarea className={inputCls} rows={3} placeholder="Reason for cancellation (required)" value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t border-white/5">
              <button onClick={() => setShowCancel(null)} className="flex-1 px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 transition-colors">
                Back
              </button>
              <button onClick={() => handleAction(showCancel.id, 'CANCEL', { cancelledReason: cancelReason })} disabled={saving || !cancelReason.trim()}
                className="flex-1 px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50">
                {saving ? 'Cancelling…' : 'Cancel Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
