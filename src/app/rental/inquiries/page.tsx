'use client';
import { useRentalMasterData } from '@/hooks/useRentalMasterData';
import React, { useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Inquiry {
  id: string;
  inquiry_no: string;
  customer_name: string;
  email?: string;
  phone: string;
  vehicle_type?: string;
  pickup_location?: string;
  pickup_date?: string;
  return_date?: string;
  rental_days?: number;
  status: string;
  source: string;
  assigned_to?: string;
  notes?: string;
  converted_to?: string;
  created_at: string;
}

interface StatusCount {
  status: string;
  count: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_TABS = ['ALL', 'NEW', 'CONTACTED', 'QUOTED', 'CONVERTED', 'LOST'];

const STATUS_COLORS: Record<string, string> = {
  NEW:       'bg-blue-500/20 text-blue-400 border-blue-500/30',
  CONTACTED: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  QUOTED:    'bg-violet-500/20 text-violet-400 border-violet-500/30',
  CONVERTED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  LOST:      'bg-red-500/20 text-red-400 border-red-500/30',
};

const STATUS_SUMMARY_COLORS: Record<string, { bg: string; text: string; border: string; icon: string }> = {
  NEW:       { bg: 'bg-blue-500/10',    text: 'text-blue-400',    border: 'border-blue-500/20',    icon: '🔵' },
  CONTACTED: { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/20',   icon: '📞' },
  QUOTED:    { bg: 'bg-violet-500/10',  text: 'text-violet-400',  border: 'border-violet-500/20',  icon: '📋' },
  CONVERTED: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', icon: '✅' },
  LOST:      { bg: 'bg-red-500/10',     text: 'text-red-400',     border: 'border-red-500/20',     icon: '❌' },
};

const STATUSES = ['NEW', 'CONTACTED', 'QUOTED', 'CONVERTED', 'LOST'];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const calcDays = (pickup?: string, ret?: string): number | null => {
  if (!pickup || !ret) return null;
  const diff = Math.ceil((new Date(ret).getTime() - new Date(pickup).getTime()) / 86400000);
  return diff > 0 ? diff : null;
};

// ── Empty form ────────────────────────────────────────────────────────────────
const emptyForm = {
  customerName: '',
  phone: '',
  email: '',
  vehicleType: '',
  pickupLocation: '',
  pickupDate: '',
  returnDate: '',
  source: 'WALK_IN',
  assignedTo: '',
  notes: '',
  status: 'NEW',
};

// ── Main Component ────────────────────────────────────────────────────────────
export default function InquiriesPage() {
  const { masterData } = useRentalMasterData();
  const [inquiries, setInquiries]     = useState<Inquiry[]>([]);
  const [counts, setCounts]           = useState<StatusCount[]>([]);
  const [activeTab, setActiveTab]     = useState('ALL');
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [showModal, setShowModal]     = useState(false);
  const [editItem, setEditItem]       = useState<Inquiry | null>(null);
  const [statusLoading, setStatusLoading] = useState<string | null>(null);
  const [formData, setFormData]       = useState({ ...emptyForm });

  // Derived: rental days from form dates
  const formDays = calcDays(formData.pickupDate, formData.returnDate);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const sp = new URLSearchParams({ limit: '100' });
      if (activeTab !== 'ALL') sp.set('status', activeTab);
      if (search) sp.set('search', search);
      const res = await fetch('/api/rental/inquiries?' + sp.toString());
      const json = await res.json();
      setInquiries(json.data ?? []);
      setCounts(json.counts ?? []);
    } catch {
      setError('Failed to load inquiries');
    } finally {
      setLoading(false);
    }
  }, [activeTab, search]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Count helpers ──────────────────────────────────────────────────────────
  const getCount = (status: string) => {
    if (status === 'ALL') return counts.reduce((a, c) => a + parseInt(c.count ?? '0'), 0);
    return parseInt(counts.find(c => c.status === status)?.count ?? '0');
  };

  // ── Modal helpers ──────────────────────────────────────────────────────────
  const openNew = () => {
    setEditItem(null);
    setFormData({ ...emptyForm });
    setShowModal(true);
  };

  const openEdit = (item: Inquiry) => {
    setEditItem(item);
    setFormData({
      customerName:   item.customer_name,
      phone:          item.phone,
      email:          item.email ?? '',
      vehicleType:    item.vehicle_type ?? '',
      pickupLocation: item.pickup_location ?? '',
      pickupDate:     item.pickup_date ? item.pickup_date.slice(0, 10) : '',
      returnDate:     item.return_date ? item.return_date.slice(0, 10) : '',
      source:         item.source ?? 'WALK_IN',
      assignedTo:     item.assigned_to ?? '',
      notes:          item.notes ?? '',
      status:         item.status ?? 'NEW',
    });
    setShowModal(true);
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        customerName:   formData.customerName,
        phone:          formData.phone,
        email:          formData.email || null,
        vehicleType:    formData.vehicleType || null,
        pickupLocation: formData.pickupLocation || null,
        pickupDate:     formData.pickupDate || null,
        returnDate:     formData.returnDate || null,
        source:         formData.source,
        assignedTo:     formData.assignedTo || null,
        notes:          formData.notes || null,
        status:         formData.status,
      };

      if (editItem) {
        const res = await fetch('/api/rental/inquiries', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editItem.id, ...payload }),
        });
        if (!res.ok) throw new Error('Failed to update');
      } else {
        const res = await fetch('/api/rental/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to create');
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // ── Quick status change ────────────────────────────────────────────────────
  const handleStatusChange = async (item: Inquiry, newStatus: string) => {
    if (newStatus === item.status) return;
    setStatusLoading(item.id);
    try {
      await fetch('/api/rental/inquiries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, status: newStatus }),
      });
      loadData();
    } catch {
      setError('Failed to update status');
    } finally {
      setStatusLoading(null);
    }
  };

  // ── Field helper ───────────────────────────────────────────────────────────
  const field = (key: keyof typeof formData) => ({
    value: formData[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setFormData(p => ({ ...p, [key]: e.target.value })),
  });

  const inputCls = 'w-full px-4 py-2.5 rounded-lg bg-slate-700/60 border border-white/10 text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/40 transition-colors text-sm';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0c1a3e] p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">RAC Inquiries</h1>
          <p className="text-slate-400 text-sm mt-1">Track and manage rental leads before booking is confirmed</p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-teal-900/30"
        >
          <span className="text-lg leading-none">+</span> New Inquiry
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {['NEW', 'CONTACTED', 'QUOTED', 'CONVERTED', 'LOST'].map(s => {
          const c = STATUS_SUMMARY_COLORS[s];
          const cnt = getCount(s);
          return (
            <button
              key={s}
              onClick={() => setActiveTab(s)}
              className={`${c.bg} border ${c.border} rounded-2xl p-4 text-left hover:brightness-110 transition-all ${activeTab === s ? 'ring-2 ring-offset-2 ring-offset-slate-950 ring-teal-500' : ''}`}
            >
              <div className="text-2xl mb-1">{c.icon}</div>
              <div className={`text-2xl font-bold ${c.text}`}>{cnt}</div>
              <div className="text-slate-400 text-xs font-medium mt-0.5">{s}</div>
            </button>
          );
        })}
      </div>

      {/* Filter tabs + Search */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
        <div className="flex gap-1 bg-slate-900 border border-white/10 rounded-xl p-1 flex-wrap">
          {STATUS_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab
                  ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab}
              {tab !== 'ALL' && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${activeTab === tab ? 'bg-white/20' : 'bg-slate-700 text-slate-300'}`}>
                  {getCount(tab)}
                </span>
              )}
              {tab === 'ALL' && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${activeTab === tab ? 'bg-white/20' : 'bg-slate-700 text-slate-300'}`}>
                  {getCount('ALL')}
                </span>
              )}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, phone, email..."
          className="flex-1 max-w-xs px-4 py-2 rounded-xl bg-slate-900 border border-white/10 text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none text-sm"
        />
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm animate-pulse">
            Loading inquiries...
          </div>
        ) : inquiries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="text-4xl">📋</div>
            <p className="text-slate-400 text-sm">No inquiries found</p>
            <button onClick={openNew} className="text-teal-400 text-sm hover:text-teal-300 underline underline-offset-2">
              Create the first one
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead>
                <tr className="border-b border-white/5 bg-slate-800/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Inquiry No</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Phone / Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Vehicle Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Pickup Location</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Dates</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Days</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {inquiries.map((inq, i) => (
                  <tr
                    key={inq.id}
                    className={`border-b border-white/5 hover:bg-white/[0.03] transition-colors ${i % 2 === 0 ? '' : 'bg-slate-800/10'}`}
                  >
                    {/* Inquiry No */}
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-teal-400 font-semibold">{inq.inquiry_no}</span>
                    </td>

                    {/* Customer */}
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-white">{inq.customer_name}</div>
                      {inq.assigned_to && (
                        <div className="text-xs text-slate-500 mt-0.5">→ {inq.assigned_to}</div>
                      )}
                    </td>

                    {/* Phone / Email */}
                    <td className="px-4 py-3">
                      <div className="text-sm text-white">{inq.phone}</div>
                      {inq.email && <div className="text-xs text-slate-400 mt-0.5">{inq.email}</div>}
                    </td>

                    {/* Vehicle Type */}
                    <td className="px-4 py-3 text-sm text-slate-200">
                      {inq.vehicle_type ?? '—'}
                    </td>

                    {/* Pickup Location */}
                    <td className="px-4 py-3 text-sm text-slate-200 max-w-[140px] truncate">
                      {inq.pickup_location ?? '—'}
                    </td>

                    {/* Dates */}
                    <td className="px-4 py-3">
                      {inq.pickup_date || inq.return_date ? (
                        <div className="text-xs text-slate-300 space-y-0.5">
                          <div>{fmtDate(inq.pickup_date)}</div>
                          <div className="text-slate-500">→ {fmtDate(inq.return_date)}</div>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-xs">—</span>
                      )}
                    </td>

                    {/* Rental Days */}
                    <td className="px-4 py-3">
                      {inq.rental_days ? (
                        <span className="text-sm font-semibold text-white">{inq.rental_days}d</span>
                      ) : '—'}
                    </td>

                    {/* Status Badge */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_COLORS[inq.status] ?? 'bg-slate-600/20 text-slate-400 border-slate-600/30'}`}>
                        {inq.status}
                      </span>
                    </td>

                    {/* Source */}
                    <td className="px-4 py-3">
                      <span className="text-xs text-slate-400 bg-slate-700/40 px-2 py-1 rounded-md">
                        {inq.source?.replace('_', ' ')}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(inq)}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/25 hover:bg-blue-500/25 transition-colors"
                        >
                          Edit
                        </button>
                        <select
                          value={inq.status}
                          disabled={statusLoading === inq.id}
                          onChange={e => handleStatusChange(inq, e.target.value)}
                          className="text-xs px-2 py-1.5 rounded-lg bg-slate-700/60 border border-white/10 text-slate-300 hover:border-teal-500/50 focus:outline-none focus:border-teal-500 cursor-pointer disabled:opacity-50 transition-colors"
                        >
                          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-slate-900 border border-white/10 rounded-2xl shadow-2xl">
            {/* Modal Header */}
            <div className="sticky top-0 z-10 bg-slate-900 border-b border-white/10 px-6 py-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">
                  {editItem ? 'Edit Inquiry' : 'New Inquiry'}
                </h2>
                {editItem && (
                  <p className="text-xs text-teal-400 font-mono mt-0.5">{editItem.inquiry_no}</p>
                )}
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Customer Name + Phone */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
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
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    Phone <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="+971 50 000 0000"
                    className={inputCls}
                    {...field('phone')}
                  />
                </div>
              </div>

              {/* Email + Vehicle Type */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Email</label>
                  <input
                    type="email"
                    placeholder="customer@email.com"
                    className={inputCls}
                    {...field('email')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Vehicle Type</label>
                  <select className={inputCls} {...field('vehicleType')}>
                    <option value="">Select vehicle type</option>
                    {masterData.vehicleCategories.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>

              {/* Pickup Location */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Pickup Location</label>
                <input
                  type="text"
                  placeholder="Dubai Airport Terminal 3, DXB"
                  className={inputCls}
                  {...field('pickupLocation')}
                />
              </div>

              {/* Dates + Days preview */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Pickup Date</label>
                  <input type="date" className={inputCls} {...field('pickupDate')} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Return Date</label>
                  <input type="date" className={inputCls} {...field('returnDate')} />
                </div>
              </div>
              {formDays !== null && (
                <div className="flex items-center gap-2 bg-teal-500/10 border border-teal-500/25 rounded-xl px-4 py-2.5">
                  <span className="text-teal-400 text-sm">📅</span>
                  <span className="text-teal-300 text-sm font-semibold">{formDays} rental day{formDays !== 1 ? 's' : ''}</span>
                </div>
              )}

              {/* Source + Assigned To */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Source</label>
                  <select className={inputCls} {...field('source')}>
                    {masterData.inquirySources.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Assigned To</label>
                  <input
                    type="text"
                    placeholder="Staff name or ID"
                    className={inputCls}
                    {...field('assignedTo')}
                  />
                </div>
              </div>

              {/* Status (edit mode only) */}
              {editItem && (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Status</label>
                  <select className={inputCls} {...field('status')}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Notes</label>
                <textarea
                  rows={3}
                  placeholder="Any special requirements or comments..."
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
                  className="px-5 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity shadow-lg shadow-teal-900/30"
                >
                  {saving ? 'Saving...' : editItem ? 'Update Inquiry' : 'Create Inquiry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
