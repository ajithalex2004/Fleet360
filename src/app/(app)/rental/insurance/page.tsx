'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Policy {
  id: string;
  policyNo: string;
  vehicleId: string | null;
  vehicleNo: string;
  vehicleName: string | null;
  insurer: string;
  policyType: string;
  coverageAmount: number | null;
  excessAmount: number;
  premiumAnnual: number | null;
  startDate: string;
  endDate: string;
  status: string;
  documentUrl: string | null;
  notes: string | null;
  createdAt: string;
  expiryDaysRemaining: number;
}

interface Stats {
  total: number;
  active: number;
  expiringSoon: number;
  expired: number;
  cancelled: number;
  totalPremiumAed: number;
}

const TABS = [
  { key: 'ALL',           label: 'All' },
  { key: 'ACTIVE',        label: 'Active' },
  { key: 'EXPIRING_SOON', label: 'Expiring Soon' },
  { key: 'EXPIRED',       label: 'Expired' },
  { key: 'CANCELLED',     label: 'Cancelled' },
];

const INSURERS = ['AXA', 'OMAN INSURANCE', 'RSA', 'ORIENT', 'DUBAI INSURANCE', 'OTHER'];
const POLICY_TYPES = ['COMPREHENSIVE', 'THIRD_PARTY', 'TPL'];

const POLICY_TYPE_COLORS: Record<string, string> = {
  COMPREHENSIVE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  THIRD_PARTY:   'bg-blue-500/20 text-blue-400 border-blue-500/30',
  TPL:           'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:        'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  EXPIRING_SOON: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  EXPIRED:       'bg-rose-500/20 text-rose-400 border-rose-500/30',
  CANCELLED:     'bg-slate-500/20 text-slate-400 border-slate-500/30',
  PENDING:       'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

function daysColor(days: number): string {
  if (days < 0)  return 'text-rose-400';
  if (days < 30) return 'text-rose-400';
  if (days < 90) return 'text-amber-400';
  return 'text-emerald-400';
}

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return n.toLocaleString('en-AE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const emptyForm = {
  vehicleNo: '', vehicleName: '', insurer: 'AXA', policyType: 'COMPREHENSIVE',
  coverageAmount: '', excessAmount: '0', premiumAnnual: '',
  startDate: '', endDate: '', notes: '',
};

export default function InsurancePage() {
  const [policies, setPolicies]   = useState<Policy[]>([]);
  const [stats, setStats]         = useState<Stats | null>(null);
  const [tab, setTab]             = useState('ALL');
  const [search, setSearch]       = useState('');
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editPolicy, setEditPolicy] = useState<Policy | null>(null);
  const [saving, setSaving]       = useState(false);
  const [formData, setFormData]   = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (tab !== 'ALL') params.set('status', tab);
      if (search)        params.set('search', search);
      const res  = await fetch(`/api/rental/insurance?${params}`);
      const data = await res.json();
      setPolicies(data.policies ?? []);
      setStats(data.stats ?? null);
    } catch {
      setError('Failed to load insurance policies');
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditPolicy(null);
    setFormData(emptyForm);
    setShowModal(true);
  };

  const openEdit = (p: Policy) => {
    setEditPolicy(p);
    setFormData({
      vehicleNo:      p.vehicleNo,
      vehicleName:    p.vehicleName ?? '',
      insurer:        p.insurer,
      policyType:     p.policyType,
      coverageAmount: p.coverageAmount != null ? String(p.coverageAmount) : '',
      excessAmount:   String(p.excessAmount),
      premiumAnnual:  p.premiumAnnual != null ? String(p.premiumAnnual) : '',
      startDate:      p.startDate.slice(0, 10),
      endDate:        p.endDate.slice(0, 10),
      notes:          p.notes ?? '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        vehicleNo:      formData.vehicleNo,
        vehicleName:    formData.vehicleName || null,
        insurer:        formData.insurer,
        policyType:     formData.policyType,
        coverageAmount: formData.coverageAmount ? Number(formData.coverageAmount) : null,
        excessAmount:   Number(formData.excessAmount || 0),
        premiumAnnual:  formData.premiumAnnual ? Number(formData.premiumAnnual) : null,
        startDate:      formData.startDate,
        endDate:        formData.endDate,
        notes:          formData.notes || null,
      };

      let res: Response;
      if (editPolicy) {
        res = await fetch('/api/rental/insurance', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editPolicy.id, ...payload }),
        });
      } else {
        res = await fetch('/api/rental/insurance', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to save');
      }
      setShowModal(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (p: Policy) => {
    if (!confirm(`Cancel policy ${p.policyNo}?`)) return;
    try {
      await fetch('/api/rental/insurance', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, status: 'CANCELLED' }),
      });
      load();
    } catch {
      setError('Failed to cancel policy');
    }
  };

  const expiringSoon = stats?.expiringSoon ?? 0;

  const inputCls = 'w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none text-sm';
  const labelCls = 'block text-sm font-medium text-slate-300 mb-1.5';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Insurance Documentation</h1>
          <p className="text-slate-400">Manage RAC vehicle insurance policies</p>
        </div>
        <button
          onClick={openNew}
          className="rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          + Add Policy
        </button>
      </div>

      {/* Expiry Alert Banner */}
      {expiringSoon > 0 && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-5 py-4">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="text-amber-400 font-semibold">
              {expiringSoon} {expiringSoon === 1 ? 'policy' : 'policies'} expiring within 30 days
            </p>
            <p className="text-amber-500/70 text-sm">Review and renew these policies to maintain compliance.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Active Policies',     value: stats.active,           color: 'text-emerald-400', icon: '✅' },
            { label: 'Expiring Soon',       value: stats.expiringSoon,     color: 'text-amber-400',   icon: '⏳' },
            { label: 'Expired',             value: stats.expired,          color: 'text-rose-400',    icon: '❌' },
            { label: 'Total Premium (AED/yr)', value: `AED ${fmt(stats.totalPremiumAed, 0)}`, color: 'text-teal-400', icon: '💰', raw: true },
          ].map(({ label, value, color, icon, raw }) => (
            <div key={label} className="bg-slate-800/60 border border-white/10 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{icon}</span>
                <p className="text-xs text-slate-400 uppercase tracking-wider">{label}</p>
              </div>
              <p className={`text-3xl font-bold ${color}`}>
                {raw ? value : fmt(value as number)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800/60 border border-white/10 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              tab === t.key
                ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {t.label}
            {t.key === 'EXPIRING_SOON' && expiringSoon > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-amber-500/30 text-amber-400 text-xs rounded-full">{expiringSoon}</span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by vehicle no, policy no, or insurer..."
        className="w-full max-w-md px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none text-sm"
      />

      {/* Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 animate-pulse">Loading policies...</div>
        ) : policies.length === 0 ? (
          <div className="text-center text-slate-400 py-16">No insurance policies found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Policy No', 'Vehicle No', 'Vehicle Name', 'Insurer', 'Type', 'Coverage (AED)', 'Premium/yr', 'Period', 'Days Left', 'Status', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {policies.map(p => {
                  const isWarning = p.expiryDaysRemaining >= 0 && p.expiryDaysRemaining < 30;
                  return (
                    <tr
                      key={p.id}
                      className={`border-b border-white/5 hover:bg-white/5 transition-colors ${isWarning ? 'bg-amber-500/5' : ''}`}
                    >
                      <td className="px-4 py-3 text-sm font-mono text-teal-400 whitespace-nowrap">
                        {p.policyNo}
                        {isWarning && <span className="ml-2 text-xs text-amber-400">⚠</span>}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-white whitespace-nowrap">{p.vehicleNo}</td>
                      <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap">{p.vehicleName ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-white whitespace-nowrap">{p.insurer}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${POLICY_TYPE_COLORS[p.policyType] ?? 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
                          {p.policyType.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-white whitespace-nowrap">
                        {p.coverageAmount != null ? `AED ${fmt(p.coverageAmount)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-white whitespace-nowrap">
                        {p.premiumAnnual != null ? `AED ${fmt(p.premiumAnnual)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300 whitespace-nowrap">
                        <div>{fmtDate(p.startDate)}</div>
                        <div className="text-slate-500">→ {fmtDate(p.endDate)}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-sm font-semibold ${daysColor(p.expiryDaysRemaining)}`}>
                          {p.expiryDaysRemaining < 0
                            ? `Expired ${Math.abs(p.expiryDaysRemaining)}d ago`
                            : `${p.expiryDaysRemaining}d`}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${STATUS_COLORS[p.status] ?? 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
                          {p.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex gap-2">
                          <button
                            onClick={() => openEdit(p)}
                            className="text-xs px-2.5 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
                          >
                            Edit
                          </button>
                          {p.status !== 'CANCELLED' && p.status !== 'EXPIRED' && (
                            <button
                              onClick={() => handleCancel(p)}
                              className="text-xs px-2.5 py-1 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">
                {editPolicy ? 'Edit Policy' : 'Add Insurance Policy'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Vehicle No *</label>
                  <input
                    type="text" required placeholder="e.g. DXB-12345"
                    value={formData.vehicleNo}
                    onChange={e => setFormData(p => ({ ...p, vehicleNo: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Vehicle Name</label>
                  <input
                    type="text" placeholder="e.g. Toyota Corolla 2023"
                    value={formData.vehicleName}
                    onChange={e => setFormData(p => ({ ...p, vehicleName: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Insurer *</label>
                  <select
                    required value={formData.insurer}
                    onChange={e => setFormData(p => ({ ...p, insurer: e.target.value }))}
                    className={inputCls}
                  >
                    {INSURERS.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Policy Type *</label>
                  <select
                    required value={formData.policyType}
                    onChange={e => setFormData(p => ({ ...p, policyType: e.target.value }))}
                    className={inputCls}
                  >
                    {POLICY_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Coverage Amount (AED)</label>
                  <input
                    type="number" min="0" step="0.01" placeholder="0.00"
                    value={formData.coverageAmount}
                    onChange={e => setFormData(p => ({ ...p, coverageAmount: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Excess Amount (AED)</label>
                  <input
                    type="number" min="0" step="0.01" placeholder="0.00"
                    value={formData.excessAmount}
                    onChange={e => setFormData(p => ({ ...p, excessAmount: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Annual Premium (AED)</label>
                  <input
                    type="number" min="0" step="0.01" placeholder="0.00"
                    value={formData.premiumAnnual}
                    onChange={e => setFormData(p => ({ ...p, premiumAnnual: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div className="col-span-1" />

                <div>
                  <label className={labelCls}>Start Date *</label>
                  <input
                    type="date" required
                    value={formData.startDate}
                    onChange={e => setFormData(p => ({ ...p, startDate: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>End Date *</label>
                  <input
                    type="date" required
                    value={formData.endDate}
                    onChange={e => setFormData(p => ({ ...p, endDate: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div className="col-span-2">
                  <label className={labelCls}>Notes</label>
                  <textarea
                    rows={3} placeholder="Additional notes..."
                    value={formData.notes}
                    onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))}
                    className={`${inputCls} resize-none`}
                  />
                </div>
              </div>

              <div className="flex gap-4 justify-end pt-2">
                <button
                  type="button" onClick={() => setShowModal(false)}
                  className="px-6 py-2.5 rounded-lg border border-white/10 text-white hover:bg-white/5 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={saving}
                  className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white hover:opacity-90 disabled:opacity-50 text-sm font-medium"
                >
                  {saving ? 'Saving...' : editPolicy ? 'Update Policy' : 'Add Policy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
