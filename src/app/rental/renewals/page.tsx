'use client';
import React, { useState, useEffect, useCallback } from 'react';

/* ─── Types ─── */
interface Renewal {
  id: string;
  renewal_no: string;
  agreement_id?: string;
  agreement_no?: string;
  customer_name?: string;
  vehicle_name?: string;
  vehicle_no?: string;
  original_end_date?: string;
  new_end_date?: string;
  extension_days?: number;
  daily_rate?: number | string;
  renewal_amount?: number | string;
  vat_amount?: number | string;
  total_amount?: number | string;
  deposit_top_up?: number | string;
  status: string;
  approved_by?: string;
  approved_at?: string;
  notes?: string;
  created_at: string;
}

interface KPIs {
  pendingCount: number;
  approvedTotal: number;
  thisMonthExtensions: number;
  avgExtensionDays: number;
}

/* ─── Constants ─── */
const STATUS_TABS = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'];

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  APPROVED:  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  REJECTED:  'bg-red-500/20 text-red-400 border-red-500/30',
  COMPLETED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

const INPUT_CLS =
  'w-full px-4 py-2.5 rounded-lg bg-slate-700/80 border border-white/10 text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none text-sm transition-colors';
const LABEL_CLS = 'block text-sm font-medium text-slate-300 mb-1.5';

/* ─── Helpers ─── */
function fmt(n: number | string | undefined, decimals = 2) {
  return Number(n ?? 0).toLocaleString('en-AE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function diffDays(a: string, b: string) {
  if (!a || !b) return 0;
  return Math.max(0, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
}

function isExpiringSoon(dateStr?: string) {
  if (!dateStr) return false;
  const d = new Date(dateStr).getTime() - Date.now();
  return d >= 0 && d < 7 * 86400000;
}

/* ─── Default form state ─── */
const DEFAULT_FORM = {
  agreementNo: '',
  customerName: '',
  vehicleName: '',
  vehicleNo: '',
  originalEndDate: '',
  newEndDate: '',
  dailyRate: '',
  depositTopUp: '',
  notes: '',
};

/* ═══════════════════════════════════════════════════════════ */
export default function RenewalsPage() {
  const [renewals, setRenewals]     = useState<Renewal[]>([]);
  const [kpis, setKpis]             = useState<KPIs>({ pendingCount: 0, approvedTotal: 0, thisMonthExtensions: 0, avgExtensionDays: 0 });
  const [activeTab, setActiveTab]   = useState('ALL');
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [showModal, setShowModal]   = useState(false);
  const [form, setForm]             = useState(DEFAULT_FORM);

  /* ── derived calculations ── */
  const extDays  = diffDays(form.originalEndDate, form.newEndDate);
  const dailyR   = parseFloat(form.dailyRate) || 0;
  const renewAmt = +(extDays * dailyR).toFixed(2);
  const vatAmt   = +(renewAmt * 0.05).toFixed(2);
  const totalAmt = +(renewAmt + vatAmt).toFixed(2);

  /* ── load data ── */
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (activeTab !== 'ALL') params.set('status', activeTab);
      if (search) params.set('search', search);
      params.set('limit', '200');

      const res  = await fetch(`/api/rental/renewals?${params}`);
      const json = await res.json();
      setRenewals(Array.isArray(json.data) ? json.data : []);
      if (json.kpis) setKpis(json.kpis);
    } catch {
      setError('Failed to load renewals');
    } finally {
      setLoading(false);
    }
  }, [activeTab, search]);

  useEffect(() => { load(); }, [load]);

  /* ── submit ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/rental/renewals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agreementNo:     form.agreementNo || null,
          customerName:    form.customerName,
          vehicleName:     form.vehicleName,
          vehicleNo:       form.vehicleNo,
          originalEndDate: form.originalEndDate || null,
          newEndDate:      form.newEndDate || null,
          dailyRate:       dailyR,
          depositTopUp:    parseFloat(form.depositTopUp) || 0,
          notes:           form.notes || null,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      setShowModal(false);
      setForm(DEFAULT_FORM);
      load();
    } catch {
      setError('Failed to create renewal');
    } finally {
      setSaving(false);
    }
  };

  /* ── status action ── */
  const updateStatus = async (id: string, status: string) => {
    try {
      const res = await fetch('/api/rental/renewals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, approvedBy: 'ADMIN' }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      setError('Failed to update status');
    }
  };

  /* ── KPI cards ── */
  const kpiCards = [
    {
      label: 'Pending Renewals',
      value: kpis.pendingCount.toString(),
      sub: 'Awaiting approval',
      color: 'text-amber-400',
      border: 'border-amber-500/20',
    },
    {
      label: 'Approved Revenue',
      value: `AED ${fmt(kpis.approvedTotal)}`,
      sub: 'Approved renewals',
      color: 'text-emerald-400',
      border: 'border-emerald-500/20',
    },
    {
      label: 'This Month',
      value: kpis.thisMonthExtensions.toString(),
      sub: 'Extensions processed',
      color: 'text-teal-400',
      border: 'border-teal-500/20',
    },
    {
      label: 'Avg Extension',
      value: `${kpis.avgExtensionDays} days`,
      sub: 'Average extension length',
      color: 'text-cyan-400',
      border: 'border-cyan-500/20',
    },
  ];

  if (loading)
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 animate-pulse text-lg">Loading renewals...</div>
      </div>
    );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">RAC Renewals</h1>
          <p className="text-slate-400">
            {renewals.length} renewal{renewals.length !== 1 ? 's' : ''} — manage agreement extension requests
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 px-6 py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity shadow-lg shadow-teal-900/30"
        >
          + Request Renewal
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((c) => (
          <div
            key={c.label}
            className={`bg-slate-800/60 border ${c.border} rounded-2xl p-5 backdrop-blur-sm`}
          >
            <div className={`text-2xl font-bold ${c.color} mb-1`}>{c.value}</div>
            <div className="text-sm font-medium text-white">{c.label}</div>
            <div className="text-xs text-slate-500 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Status Tabs + Search */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
        <div className="flex gap-1 bg-slate-800/60 border border-white/10 rounded-xl p-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab
                  ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search customer, renewal no, vehicle..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 rounded-xl bg-slate-800/60 border border-white/10 text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none text-sm"
        />
      </div>

      {/* Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl backdrop-blur-sm overflow-x-auto">
        {renewals.length === 0 ? (
          <div className="text-center text-slate-400 py-16">
            <div className="text-4xl mb-3">📋</div>
            <div>No renewals found</div>
          </div>
        ) : (
          <table className="w-full min-w-[1100px]">
            <thead>
              <tr className="border-b border-white/5">
                {[
                  'Renewal No', 'Agreement No', 'Customer', 'Vehicle',
                  'Original End', 'New End', 'Ext Days', 'Daily Rate',
                  'Total (AED)', 'Status', 'Actions',
                ].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {renewals.map((r) => {
                const expiring = isExpiringSoon(r.original_end_date);
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-white/5 hover:bg-white/5 transition-colors ${
                      expiring ? 'bg-amber-500/5' : ''
                    }`}
                  >
                    <td className="px-4 py-3.5 text-sm font-mono text-teal-400 font-medium whitespace-nowrap">
                      {r.renewal_no}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-slate-300 whitespace-nowrap">
                      {r.agreement_no ?? '—'}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-white font-medium">
                      {r.customer_name ?? '—'}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-slate-300">
                      <div>{r.vehicle_name ?? '—'}</div>
                      {r.vehicle_no && (
                        <div className="text-xs text-slate-500">{r.vehicle_no}</div>
                      )}
                    </td>
                    <td
                      className={`px-4 py-3.5 text-sm whitespace-nowrap ${
                        expiring ? 'text-amber-400 font-semibold' : 'text-slate-300'
                      }`}
                    >
                      {r.original_end_date
                        ? new Date(r.original_end_date).toLocaleDateString('en-GB')
                        : '—'}
                      {expiring && (
                        <span className="ml-1 text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
                          Soon
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-slate-300 whitespace-nowrap">
                      {r.new_end_date
                        ? new Date(r.new_end_date).toLocaleDateString('en-GB')
                        : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-center">
                      <span className="font-bold text-cyan-400">{r.extension_days ?? 0}</span>
                      <span className="text-slate-500 text-xs ml-1">d</span>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-slate-300">
                      AED {fmt(r.daily_rate)}
                    </td>
                    <td className="px-4 py-3.5 text-sm font-semibold text-white">
                      AED {fmt(r.total_amount)}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                          STATUS_COLORS[r.status] ?? 'bg-slate-500/20 text-slate-400 border-slate-500/30'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {r.status === 'PENDING' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => updateStatus(r.id, 'APPROVED')}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold hover:bg-emerald-500/30 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => updateStatus(r.id, 'REJECTED')}
                            className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-semibold hover:bg-red-500/30 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                      {r.status === 'APPROVED' && (
                        <button
                          onClick={() => updateStatus(r.id, 'COMPLETED')}
                          className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs font-semibold hover:bg-blue-500/30 transition-colors"
                        >
                          Complete
                        </button>
                      )}
                      {(r.status === 'REJECTED' || r.status === 'COMPLETED') && (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── REQUEST RENEWAL MODAL ─── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            <div className="sticky top-0 bg-slate-900 border-b border-white/10 px-8 py-5 flex items-center justify-between rounded-t-2xl z-10">
              <div>
                <h2 className="text-xl font-bold text-white">Request Renewal</h2>
                <p className="text-sm text-slate-400 mt-0.5">Extend a rental agreement</p>
              </div>
              <button
                onClick={() => { setShowModal(false); setForm(DEFAULT_FORM); }}
                className="text-slate-400 hover:text-white text-xl leading-none transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-8 py-6 space-y-5">
              {/* Agreement Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLS}>Agreement No</label>
                  <input
                    type="text"
                    value={form.agreementNo}
                    onChange={(e) => setForm((p) => ({ ...p, agreementNo: e.target.value }))}
                    placeholder="AGR-000001"
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Customer Name *</label>
                  <input
                    type="text"
                    value={form.customerName}
                    onChange={(e) => setForm((p) => ({ ...p, customerName: e.target.value }))}
                    placeholder="Full name"
                    required
                    className={INPUT_CLS}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLS}>Vehicle Name *</label>
                  <input
                    type="text"
                    value={form.vehicleName}
                    onChange={(e) => setForm((p) => ({ ...p, vehicleName: e.target.value }))}
                    placeholder="e.g. Toyota Camry 2023"
                    required
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Vehicle Plate</label>
                  <input
                    type="text"
                    value={form.vehicleNo}
                    onChange={(e) => setForm((p) => ({ ...p, vehicleNo: e.target.value }))}
                    placeholder="e.g. ABC 1234"
                    className={INPUT_CLS}
                  />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLS}>Original End Date *</label>
                  <input
                    type="date"
                    value={form.originalEndDate}
                    onChange={(e) => setForm((p) => ({ ...p, originalEndDate: e.target.value }))}
                    required
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>New End Date *</label>
                  <input
                    type="date"
                    value={form.newEndDate}
                    min={form.originalEndDate || undefined}
                    onChange={(e) => setForm((p) => ({ ...p, newEndDate: e.target.value }))}
                    required
                    className={INPUT_CLS}
                  />
                </div>
              </div>

              {/* Rate */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLS}>Daily Rate (AED) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.dailyRate}
                    onChange={(e) => setForm((p) => ({ ...p, dailyRate: e.target.value }))}
                    placeholder="0.00"
                    required
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Deposit Top-Up (AED)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.depositTopUp}
                    onChange={(e) => setForm((p) => ({ ...p, depositTopUp: e.target.value }))}
                    placeholder="0.00"
                    className={INPUT_CLS}
                  />
                </div>
              </div>

              {/* Live Calculation Panel */}
              {(extDays > 0 || dailyR > 0) && (
                <div className="bg-slate-800/80 border border-teal-500/20 rounded-xl p-5 space-y-3">
                  <div className="text-xs font-semibold text-teal-400 uppercase tracking-wider mb-3">
                    Live Calculation
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-slate-400">Extension Days</span>
                      <span className="text-sm font-bold text-cyan-400">{extDays} days</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-slate-400">Daily Rate</span>
                      <span className="text-sm font-semibold text-white">AED {fmt(dailyR)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-slate-400">Renewal Amount</span>
                      <span className="text-sm font-semibold text-white">AED {fmt(renewAmt)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-slate-400">VAT (5%)</span>
                      <span className="text-sm font-semibold text-amber-400">AED {fmt(vatAmt)}</span>
                    </div>
                  </div>
                  <div className="border-t border-white/10 pt-3 flex justify-between">
                    <span className="text-sm font-semibold text-white">Total Amount</span>
                    <span className="text-lg font-bold text-teal-400">AED {fmt(totalAmt)}</span>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className={LABEL_CLS}>Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  rows={3}
                  placeholder="Additional notes or comments..."
                  className={INPUT_CLS + ' resize-none'}
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setForm(DEFAULT_FORM); }}
                  className="px-6 py-2.5 rounded-xl border border-white/10 text-white text-sm hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {saving ? 'Submitting...' : 'Submit Renewal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
