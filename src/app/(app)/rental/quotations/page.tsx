'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Quotation {
  id: string;
  quote_no: string;
  inquiry_id?: string;
  customer_name: string;
  email?: string;
  phone?: string;
  vehicle_type?: string;
  vehicle_name?: string;
  pickup_date: string;
  return_date: string;
  rental_days: number;
  daily_rate: number | string;
  subtotal: number | string;
  vat_amount: number | string;
  grand_total: number | string;
  deposit_amount?: number | string;
  status: string;
  valid_until?: string;
  notes?: string;
  sent_at?: string;
  accepted_at?: string;
  rejected_at?: string;
  converted_to?: string;
  created_at: string;
}

interface SummaryEntry {
  status: string;
  count: string;
  total: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_TABS = ['ALL', 'DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'];

const STATUS_COLORS: Record<string, string> = {
  DRAFT:    'bg-[var(--bg-surface-hover)]/30 text-[var(--text-muted)] border-[var(--border-strong)]/40',
  SENT:     'bg-blue-500/20 text-blue-400 border-blue-500/30',
  ACCEPTED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  REJECTED: 'bg-red-500/20 text-red-400 border-red-500/30',
  EXPIRED:  'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

const STATUS_ACTION: Record<string, { next: string; label: string; color: string }[]> = {
  DRAFT:    [{ next: 'SENT',     label: 'Send Quote', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30' }],
  SENT:     [
    { next: 'ACCEPTED', label: 'Accept',     color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30' },
    { next: 'REJECTED', label: 'Reject',     color: 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30' },
  ],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED:  [],
};

const VEHICLE_TYPES = ['Economy', 'Sedan', 'SUV', 'Luxury', 'Van', 'Bus'];
const VAT_RATE = 0.05;

// ── Helpers ───────────────────────────────────────────────────────────────────
const toNum = (v: number | string | undefined) => parseFloat(String(v ?? '0')) || 0;

const fmtAED = (v: number | string | undefined) => {
  const n = toNum(v);
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const calcDays = (pickup?: string, ret?: string): number => {
  if (!pickup || !ret) return 0;
  const diff = Math.ceil((new Date(ret).getTime() - new Date(pickup).getTime()) / 86400000);
  return diff > 0 ? diff : 0;
};

const isExpired = (q: Quotation): boolean => {
  if (!q.valid_until) return false;
  if (!['DRAFT', 'SENT'].includes(q.status)) return false;
  return new Date(q.valid_until) < new Date(new Date().toDateString());
};

// ── Empty form ────────────────────────────────────────────────────────────────
const emptyForm = {
  customerName: '',
  phone: '',
  email: '',
  vehicleType: '',
  vehicleName: '',
  pickupDate: '',
  returnDate: '',
  dailyRate: '',
  depositAmount: '',
  notes: '',
};

// ── Main Component ────────────────────────────────────────────────────────────
export default function QuotationsPage() {
  const [quotations, setQuotations]   = useState<Quotation[]>([]);
  const [summary, setSummary]         = useState<SummaryEntry[]>([]);
  const [activeTab, setActiveTab]     = useState('ALL');
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [showModal, setShowModal]     = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [formData, setFormData]       = useState({ ...emptyForm });

  // ── Live calculation ──────────────────────────────────────────────────────
  const liveDays     = calcDays(formData.pickupDate, formData.returnDate);
  const liveRate     = parseFloat(formData.dailyRate) || 0;
  const liveSubtotal = liveDays * liveRate;
  const liveVat      = liveSubtotal * VAT_RATE;
  const liveGrand    = liveSubtotal + liveVat;

  // ── Derived summary KPIs ──────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const total = summary.reduce((a, s) => a + parseInt(s.count ?? '0'), 0);
    const acceptedEntry  = summary.find(s => s.status === 'ACCEPTED');
    const pendingEntries = summary.filter(s => ['DRAFT', 'SENT'].includes(s.status));
    const acceptedVal    = toNum(acceptedEntry?.total);
    const pendingVal     = pendingEntries.reduce((a, s) => a + toNum(s.total), 0);
    const acceptedCount  = parseInt(acceptedEntry?.count ?? '0');
    const convRate       = total > 0 ? ((acceptedCount / total) * 100).toFixed(1) : '0.0';
    return { total, acceptedVal, pendingVal, convRate };
  }, [summary]);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const sp = new URLSearchParams({ limit: '100' });
      if (activeTab !== 'ALL') sp.set('status', activeTab);
      if (search) sp.set('search', search);
      const res = await fetch('/api/rental/quotations?' + sp.toString());
      const json = await res.json();
      setQuotations(json.data ?? []);
      setSummary(json.summary ?? []);
    } catch {
      setError('Failed to load quotations');
    } finally {
      setLoading(false);
    }
  }, [activeTab, search]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Count helper ──────────────────────────────────────────────────────────
  const getCount = (tab: string): number => {
    if (tab === 'ALL') return summary.reduce((a, s) => a + parseInt(s.count ?? '0'), 0);
    return parseInt(summary.find(s => s.status === tab)?.count ?? '0');
  };

  // ── Modal helpers ─────────────────────────────────────────────────────────
  const openNew = () => {
    setFormData({ ...emptyForm });
    setShowModal(true);
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (liveDays < 1) { setError('Return date must be after pickup date'); return; }
    if (liveRate <= 0) { setError('Daily rate must be greater than 0'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/rental/quotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName:  formData.customerName,
          phone:         formData.phone || null,
          email:         formData.email || null,
          vehicleType:   formData.vehicleType || null,
          vehicleName:   formData.vehicleName || null,
          pickupDate:    formData.pickupDate,
          returnDate:    formData.returnDate,
          dailyRate:     liveRate,
          depositAmount: parseFloat(formData.depositAmount) || 0,
          notes:         formData.notes || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to create');
      setShowModal(false);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save quotation');
    } finally {
      setSaving(false);
    }
  };

  // ── Status action ─────────────────────────────────────────────────────────
  const handleStatusAction = async (q: Quotation, newStatus: string) => {
    setActionLoading(q.id + newStatus);
    try {
      const res = await fetch('/api/rental/quotations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: q.id, status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed');
      loadData();
    } catch {
      setError('Failed to update quote status');
    } finally {
      setActionLoading(null);
    }
  };

  // ── Field helper ──────────────────────────────────────────────────────────
  const field = (key: keyof typeof formData) => ({
    value: formData[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setFormData(p => ({ ...p, [key]: e.target.value })),
  });

  const inputCls = 'w-full px-4 py-2.5 rounded-lg bg-[var(--bg-surface-hover)]/60 border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/40 transition-colors text-sm';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] tracking-tight">RAC Quotations</h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">Generate and track formal rental quotes through acceptance</p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-teal-900/30"
        >
          <span className="text-lg leading-none">+</span> New Quote
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-300 ml-4">✕</button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Quotes */}
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5">
          <div className="text-[var(--text-muted)] text-xs font-semibold uppercase tracking-wider mb-2">Total Quotes</div>
          <div className="text-3xl font-bold text-[var(--text-main)]">{kpi.total}</div>
          <div className="text-[var(--text-faint)] text-xs mt-1">all time</div>
        </div>

        {/* Accepted Value */}
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-5">
          <div className="text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-2">Accepted Value</div>
          <div className="text-2xl font-bold text-emerald-300 truncate">{fmtAED(kpi.acceptedVal)}</div>
          <div className="text-[var(--text-faint)] text-xs mt-1">confirmed revenue</div>
        </div>

        {/* Pending Value */}
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-5">
          <div className="text-blue-400 text-xs font-semibold uppercase tracking-wider mb-2">Pending Value</div>
          <div className="text-2xl font-bold text-blue-300 truncate">{fmtAED(kpi.pendingVal)}</div>
          <div className="text-[var(--text-faint)] text-xs mt-1">draft + sent</div>
        </div>

        {/* Conversion Rate */}
        <div className="bg-violet-500/5 border border-violet-500/20 rounded-2xl p-5">
          <div className="text-violet-400 text-xs font-semibold uppercase tracking-wider mb-2">Conversion Rate</div>
          <div className="text-3xl font-bold text-violet-300">{kpi.convRate}%</div>
          <div className="text-[var(--text-faint)] text-xs mt-1">accepted / total</div>
        </div>
      </div>

      {/* Filter Tabs + Search */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
        <div className="flex gap-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-1 flex-wrap">
          {STATUS_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab
                  ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white shadow'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]'
              }`}
            >
              {tab}
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${activeTab === tab ? 'bg-[var(--bg-surface-hover)]' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'}`}>
                {getCount(tab)}
              </span>
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or quote no..."
          className="flex-1 max-w-xs px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-teal-500 focus:outline-none text-sm"
        />
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)] text-sm animate-pulse">
            Loading quotations...
          </div>
        ) : quotations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="text-4xl">📄</div>
            <p className="text-[var(--text-muted)] text-sm">No quotations found</p>
            <button onClick={openNew} className="text-teal-400 text-sm hover:text-teal-300 underline underline-offset-2">
              Create the first quote
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Quote No</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Vehicle</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Pickup → Return</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Days</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Daily Rate</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Grand Total (VAT)</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Valid Until</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {quotations.map((q, i) => {
                  const expired = isExpired(q);
                  const displayStatus = expired && q.status !== 'ACCEPTED' && q.status !== 'REJECTED' ? 'EXPIRED' : q.status;
                  const actions = STATUS_ACTION[q.status] ?? [];
                  return (
                    <tr
                      key={q.id}
                      className={`border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors ${i % 2 === 0 ? '' : 'bg-[var(--bg-surface)]/10'}`}
                    >
                      {/* Quote No */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-teal-400 font-semibold">{q.quote_no}</span>
                      </td>

                      {/* Customer */}
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-[var(--text-main)]">{q.customer_name}</div>
                        {q.phone && <div className="text-xs text-[var(--text-muted)] mt-0.5">{q.phone}</div>}
                      </td>

                      {/* Vehicle */}
                      <td className="px-4 py-3">
                        <div className="text-sm text-[var(--text-main)]">{q.vehicle_type ?? '—'}</div>
                        {q.vehicle_name && <div className="text-xs text-[var(--text-faint)] mt-0.5">{q.vehicle_name}</div>}
                      </td>

                      {/* Dates */}
                      <td className="px-4 py-3">
                        <div className="text-xs text-[var(--text-muted)]">{fmtDate(q.pickup_date)}</div>
                        <div className="text-xs text-[var(--text-faint)]">→ {fmtDate(q.return_date)}</div>
                      </td>

                      {/* Days */}
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-semibold text-[var(--text-main)]">{q.rental_days}d</span>
                      </td>

                      {/* Daily Rate */}
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm text-[var(--text-main)]">{fmtAED(q.daily_rate)}</span>
                      </td>

                      {/* Grand Total */}
                      <td className="px-4 py-3 text-right">
                        <div className="text-sm font-bold text-[var(--text-main)]">{fmtAED(q.grand_total)}</div>
                        <div className="text-xs text-[var(--text-faint)] mt-0.5">incl. 5% VAT</div>
                      </td>

                      {/* Valid Until */}
                      <td className="px-4 py-3">
                        <div className={`text-xs ${expired ? 'text-amber-400 font-semibold' : 'text-[var(--text-muted)]'}`}>
                          {fmtDate(q.valid_until)}
                          {expired && <div className="text-amber-500 text-xs">⚠ Expired</div>}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_COLORS[displayStatus] ?? STATUS_COLORS.DRAFT}`}>
                          {displayStatus}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {actions.map(act => (
                            <button
                              key={act.next}
                              disabled={actionLoading === q.id + act.next}
                              onClick={() => handleStatusAction(q, act.next)}
                              className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${act.color} disabled:opacity-50`}
                            >
                              {actionLoading === q.id + act.next ? '...' : act.label}
                            </button>
                          ))}
                          {actions.length === 0 && (
                            <span className="text-xs text-[var(--text-faint)] italic">—</span>
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

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl">
            {/* Modal Header */}
            <div className="sticky top-0 z-10 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-6 py-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-[var(--text-main)]">New Rental Quotation</h2>
                <p className="text-[var(--text-muted)] text-xs mt-0.5">Quote will be valid for 7 days from creation</p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Customer Name */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                  Customer Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ahmed Al-Mansouri"
                  className={inputCls}
                  {...field('customerName')}
                />
              </div>

              {/* Phone + Email */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Phone</label>
                  <input type="tel" placeholder="+971 50 000 0000" className={inputCls} {...field('phone')} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Email</label>
                  <input type="email" placeholder="customer@email.com" className={inputCls} {...field('email')} />
                </div>
              </div>

              {/* Vehicle Type + Vehicle Name/Plate */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Vehicle Type</label>
                  <select className={inputCls} {...field('vehicleType')}>
                    <option value="">Select type</option>
                    {VEHICLE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Vehicle Name / Plate</label>
                  <input type="text" placeholder="Toyota Camry / DXB A 12345" className={inputCls} {...field('vehicleName')} />
                </div>
              </div>

              {/* Pickup + Return Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Pickup Date <span className="text-red-400">*</span>
                  </label>
                  <input type="date" required className={inputCls} {...field('pickupDate')} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Return Date <span className="text-red-400">*</span>
                  </label>
                  <input type="date" required className={inputCls} {...field('returnDate')} />
                </div>
              </div>

              {/* Daily Rate + Deposit */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Daily Rate (AED) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    className={inputCls}
                    {...field('dailyRate')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Deposit Amount (AED)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    className={inputCls}
                    {...field('depositAmount')}
                  />
                </div>
              </div>

              {/* Live Calculation Preview */}
              {(liveDays > 0 || liveRate > 0) && (
                <div className="bg-[var(--bg-surface)]/60 border border-teal-500/20 rounded-xl p-4 space-y-2">
                  <div className="text-xs font-semibold text-teal-400 uppercase tracking-wider mb-3">Live Quote Calculation</div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--text-muted)]">Rental Period</span>
                    <span className="text-[var(--text-main)] font-medium">{liveDays} day{liveDays !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--text-muted)]">Daily Rate</span>
                    <span className="text-[var(--text-main)] font-medium">{fmtAED(liveRate)}</span>
                  </div>
                  <div className="flex justify-between text-sm border-t border-[var(--border-subtle)] pt-2">
                    <span className="text-[var(--text-muted)]">Subtotal</span>
                    <span className="text-[var(--text-main)] font-medium">{fmtAED(liveSubtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--text-muted)]">VAT (5%)</span>
                    <span className="text-amber-400 font-medium">{fmtAED(liveVat)}</span>
                  </div>
                  <div className="flex justify-between text-base border-t border-[var(--border-subtle)] pt-2 mt-1">
                    <span className="text-[var(--text-main)] font-bold">Grand Total</span>
                    <span className="text-teal-300 font-bold text-lg">{fmtAED(liveGrand)}</span>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Notes</label>
                <textarea
                  rows={3}
                  placeholder="Additional terms, conditions, or remarks..."
                  className={inputCls + ' resize-none'}
                  value={formData.notes}
                  onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))}
                />
              </div>

              {/* Form Actions */}
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || liveDays < 1 || liveRate <= 0}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity shadow-lg shadow-teal-900/30"
                >
                  {saving ? 'Creating...' : `Create Quote ${liveGrand > 0 ? '· ' + fmtAED(liveGrand) : ''}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
