'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';
import {
  RENTAL_VEHICLE_CATEGORIES,
  formatRentalCategoryLabel,
  normalizeRentalCategory,
} from '@/lib/rental/categories';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Inquiry {
  id: string;
  inquiry_no: string;
  customer_name: string;
  customerName?: string;
  email?: string;
  customerEmail?: string;
  phone: string;
  customerPhone?: string;
  vehicle_type?: string;
  vehicleCategory?: string;
  pickup_location?: string;
  pickup_date?: string;
  pickupDate?: string;
  return_date?: string;
  returnDate?: string;
  rental_days?: number;
  status: string;
  source: string;
  assigned_to?: string;
  notes?: string;
  converted_to?: string;
  convertedTo?: string;
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

type CategoryItem = string | { value?: string; code?: string; label?: string };
const VEHICLE_TYPE_OPTIONS = (RENTAL_VEHICLE_CATEGORIES as readonly CategoryItem[]).map((item) => {
  const value = typeof item === 'string' ? item : String(item.value ?? item.code ?? '');
  const label =
    typeof item === 'string'
      ? formatRentalCategoryLabel(value)
      : item.label ?? formatRentalCategoryLabel(value);
  return { value, label };
});

const SOURCES = ['WALK_IN', 'PHONE', 'WEBSITE', 'WHATSAPP', 'REFERRAL'];
const STATUSES = ['NEW', 'CONTACTED', 'QUOTED', 'CONVERTED', 'LOST'];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const calcDays = (pickup?: string, ret?: string): number | null => {
  if (!pickup || !ret) return null;
  const diff = Math.ceil((new Date(ret).getTime() - new Date(pickup).getTime()) / 86400000);
  return diff > 0 ? diff : null;
};

function buildQuoteHref(inq: Inquiry): string {
  const cName = inq.customerName ?? inq.customer_name ?? '';
  const cPhone = inq.customerPhone ?? inq.phone ?? '';
  const cEmail = inq.customerEmail ?? inq.email ?? '';
  const rawCat = inq.vehicleCategory ?? inq.vehicle_type ?? '';
  const cat = rawCat ? normalizeRentalCategory(rawCat) || rawCat : '';
  const pickup = (inq.pickupDate ?? inq.pickup_date ?? '').slice(0, 10);
  const ret = (inq.returnDate ?? inq.return_date ?? '').slice(0, 10);

  let href =
    `/rental/quotations?inquiryId=${encodeURIComponent(inq.id)}` +
    `&customerName=${encodeURIComponent(cName)}` +
    `&customerPhone=${encodeURIComponent(cPhone)}` +
    `&customerEmail=${encodeURIComponent(cEmail)}` +
    `&category=${encodeURIComponent(cat)}`;
  if (pickup) href += `&pickupDate=${encodeURIComponent(pickup)}`;
  if (ret) href += `&returnDate=${encodeURIComponent(ret)}`;
  return href;
}

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
  const [inquiries, setInquiries]     = useState<Inquiry[]>([]);
  const [counts, setCounts]           = useState<StatusCount[]>([]);
  const [activeTab, setActiveTab]     = useState('ALL');
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [notice, setNotice]           = useState('');
  const [showModal, setShowModal]     = useState(false);
  const [editItem, setEditItem]       = useState<Inquiry | null>(null);
  const [statusLoading, setStatusLoading] = useState<string | null>(null);
  const [convertingKey, setConvertingKey] = useState<string | null>(null);
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
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(json?.error ?? 'Failed to load inquiries'));
        setInquiries([]);
        return;
      }
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
    const rawCat = item.vehicleCategory ?? item.vehicle_type ?? '';
    setEditItem(item);
    setFormData({
      customerName:   item.customerName ?? item.customer_name,
      phone:          item.customerPhone ?? item.phone,
      email:          item.customerEmail ?? item.email ?? '',
      vehicleType:    rawCat ? normalizeRentalCategory(rawCat) || rawCat : '',
      pickupLocation: item.pickup_location ?? '',
      pickupDate:     (item.pickupDate ?? item.pickup_date ?? '').slice(0, 10),
      returnDate:     (item.returnDate ?? item.return_date ?? '').slice(0, 10),
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
      const normalizedType = formData.vehicleType
        ? normalizeRentalCategory(formData.vehicleType) || formData.vehicleType
        : null;
      const payload = {
        customerName:   formData.customerName,
        phone:          formData.phone,
        email:          formData.email || null,
        vehicleType:    normalizedType,
        pickupLocation: formData.pickupLocation || null,
        pickupDate:     formData.pickupDate || null,
        returnDate:     formData.returnDate || null,
        source:         formData.source,
        assignedTo:     formData.assignedTo || null,
        notes:          formData.notes || null,
        status:         formData.status,
      };

      const res = await fetch('/api/rental/inquiries', {
        method: editItem ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editItem ? { id: editItem.id, ...payload } : payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(json?.error ?? (editItem ? 'Failed to update inquiry' : 'Failed to create inquiry')));
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
    setError('');
    try {
      const res = await fetch('/api/rental/inquiries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, status: newStatus }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(json?.error ?? `Failed to update status (${res.status})`));
        return;
      }
      loadData();
    } catch {
      setError('Failed to update status');
    } finally {
      setStatusLoading(null);
    }
  };

  // ── 1-Click Convert Inquiry → Quotation or Booking ────────────────────────
  const handleOneClickConvert = async (item: Inquiry, target: 'QUOTATION' | 'BOOKING') => {
    const key = `${item.id}:${target}`;
    setConvertingKey(key);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/rental/inquiries/${encodeURIComponent(item.id)}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(json?.error ?? `Failed to convert inquiry (${res.status})`));
        return;
      }
      const ref =
        json?.convertedTo ??
        json?.quotation?.quote_no ??
        json?.quotation?.quoteNo ??
        json?.booking?.bookingRef ??
        '';
      setNotice(
        `Inquiry ${item.inquiry_no} converted to ${target === 'QUOTATION' ? 'Quotation' : 'Booking'}${
          ref ? ` (${ref})` : ''
        }.`,
      );
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setConvertingKey(null);
    }
  };

  // ── Field helper ───────────────────────────────────────────────────────────
  const field = (key: keyof typeof formData) => ({
    value: formData[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setFormData(p => ({ ...p, [key]: e.target.value })),
  });

  const inputCls = 'w-full px-4 py-2.5 rounded-lg bg-[var(--bg-surface-hover)]/60 border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/40 transition-colors text-sm';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] tracking-tight">RAC Inquiries</h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">Track and manage rental leads before booking is confirmed</p>
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
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-300 hover:text-red-200 text-xs">✕</button>
        </div>
      )}

      {/* Conversion Notice */}
      {notice && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 text-emerald-300 text-sm flex items-center justify-between gap-3">
          <span>✅ {notice}</span>
          <button onClick={() => setNotice('')} className="text-emerald-300 hover:text-emerald-100 text-xs">✕</button>
        </div>
      )}

      {/* Summary Cards */}
      <StatGrid cols={5}>
        {(['NEW', 'CONTACTED', 'QUOTED', 'CONVERTED', 'LOST'] as const).map((s, idx) => {
          const accents = ['cyan', 'violet', 'amber', 'emerald', 'rose'] as const;
          const cnt = getCount(s);
          return (
            <KpiCard
              key={s}
              label={s}
              value={cnt}
              accent={accents[idx % accents.length]}
              active={activeTab === s}
              onClick={() => setActiveTab(s)}
            />
          );
        })}
      </StatGrid>

      {/* Filter tabs + Search */}
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
              {tab !== 'ALL' && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${activeTab === tab ? 'bg-white/20' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'}`}>
                  {getCount(tab)}
                </span>
              )}
              {tab === 'ALL' && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${activeTab === tab ? 'bg-white/20' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'}`}>
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
          className="flex-1 max-w-xs px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-teal-500 focus:outline-none text-sm"
        />
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)] text-sm animate-pulse">
            Loading inquiries...
          </div>
        ) : inquiries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="text-4xl">📋</div>
            <p className="text-[var(--text-muted)] text-sm">No inquiries found</p>
            <button onClick={openNew} className="text-teal-400 text-sm hover:text-teal-300 underline underline-offset-2">
              Create the first one
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Inquiry No</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Phone / Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Vehicle Category</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Pickup Location</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Dates</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Days</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {inquiries.map((inq, i) => {
                  const rawCat = inq.vehicleCategory ?? inq.vehicle_type;
                  return (
                    <tr
                      key={inq.id}
                      className={`border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors ${i % 2 === 0 ? '' : 'bg-[var(--bg-surface)]/10'}`}
                    >
                      {/* Inquiry No */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-teal-400 font-semibold">{inq.inquiry_no}</span>
                      </td>

                      {/* Customer */}
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-[var(--text-main)]">{inq.customerName ?? inq.customer_name}</div>
                        {inq.assigned_to && (
                          <div className="text-xs text-[var(--text-faint)] mt-0.5">→ {inq.assigned_to}</div>
                        )}
                      </td>

                      {/* Phone / Email */}
                      <td className="px-4 py-3">
                        <div className="text-sm text-[var(--text-main)]">{inq.customerPhone ?? inq.phone}</div>
                        {(inq.customerEmail ?? inq.email) && (
                          <div className="text-xs text-[var(--text-muted)] mt-0.5">{inq.customerEmail ?? inq.email}</div>
                        )}
                      </td>

                      {/* Vehicle Category */}
                      <td className="px-4 py-3 text-sm text-[var(--text-main)]">
                        {rawCat ? formatRentalCategoryLabel(rawCat) : '—'}
                      </td>

                      {/* Pickup Location */}
                      <td className="px-4 py-3 text-sm text-[var(--text-main)] max-w-[140px] truncate">
                        {inq.pickup_location ?? '—'}
                      </td>

                      {/* Dates */}
                      <td className="px-4 py-3">
                        {inq.pickup_date || inq.return_date ? (
                          <div className="text-xs text-[var(--text-muted)] space-y-0.5">
                            <div>{fmtDate(inq.pickup_date)}</div>
                            <div className="text-[var(--text-faint)]">→ {fmtDate(inq.return_date)}</div>
                          </div>
                        ) : (
                          <span className="text-[var(--text-faint)] text-xs">—</span>
                        )}
                      </td>

                      {/* Rental Days */}
                      <td className="px-4 py-3">
                        {inq.rental_days ? (
                          <span className="text-sm font-semibold text-[var(--text-main)]">{inq.rental_days}d</span>
                        ) : '—'}
                      </td>

                      {/* Status Badge + Converted Ref */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_COLORS[inq.status] ?? 'bg-[var(--bg-surface-hover)]/20 text-[var(--text-muted)] border-[var(--border-strong)]/30'}`}>
                            {inq.status}
                          </span>
                          {(inq.converted_to || inq.convertedTo) && (() => {
                            const ref = String(inq.converted_to ?? inq.convertedTo ?? '');
                            const isQuoteRef = ref.toUpperCase().startsWith('RQT-');
                            return (
                              <Link
                                href={
                                  isQuoteRef
                                    ? `/rental/quotations`
                                    : `/rental/bookings?id=${encodeURIComponent(ref)}`
                                }
                                className="font-mono text-[11px] px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25"
                              >
                                ↳ {ref}
                              </Link>
                            );
                          })()}
                        </div>
                      </td>

                      {/* Source */}
                      <td className="px-4 py-3">
                        <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-surface-hover)]/40 px-2 py-1 rounded-md">
                          {inq.source?.replace('_', ' ')}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {inq.status !== 'CONVERTED' && inq.status !== 'LOST' && (
                            <>
                              <button
                                type="button"
                                disabled={convertingKey === `${inq.id}:QUOTATION` || convertingKey === `${inq.id}:BOOKING`}
                                onClick={() => handleOneClickConvert(inq, 'QUOTATION')}
                                className="text-xs px-2.5 py-1.5 rounded-lg bg-violet-500/20 text-violet-300 border border-violet-500/35 hover:bg-violet-500/30 font-semibold whitespace-nowrap transition-colors disabled:opacity-50"
                                title="1-Click instant Quotation creation"
                              >
                                {convertingKey === `${inq.id}:QUOTATION` ? 'Quoting…' : 'Convert to Quote'}
                              </button>
                              <button
                                type="button"
                                disabled={convertingKey === `${inq.id}:QUOTATION` || convertingKey === `${inq.id}:BOOKING`}
                                onClick={() => handleOneClickConvert(inq, 'BOOKING')}
                                className="text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 hover:bg-emerald-500/30 font-semibold whitespace-nowrap transition-colors disabled:opacity-50"
                                title="1-Click instant Booking creation"
                              >
                                {convertingKey === `${inq.id}:BOOKING` ? 'Booking…' : 'Convert to Booking'}
                              </button>
                            </>
                          )}
                          <Link
                            href={buildQuoteHref(inq)}
                            className="text-xs px-2.5 py-1.5 rounded-lg bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25 font-medium whitespace-nowrap transition-colors"
                          >
                            Draft Quote ↗
                          </Link>
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
                            className="text-xs px-2 py-1.5 rounded-lg bg-[var(--bg-surface-hover)]/60 border border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-teal-500/50 focus:outline-none focus:border-teal-500 cursor-pointer disabled:opacity-50 transition-colors"
                          >
                            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
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
                <h2 className="text-xl font-bold text-[var(--text-main)]">
                  {editItem ? 'Edit Inquiry' : 'New Inquiry'}
                </h2>
                {editItem && (
                  <p className="text-xs text-teal-400 font-mono mt-0.5">{editItem.inquiry_no}</p>
                )}
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Customer Name + Phone */}
              <div className="grid grid-cols-2 gap-4">
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
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
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

              {/* Email + Vehicle Category */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Email</label>
                  <input
                    type="email"
                    placeholder="customer@email.com"
                    className={inputCls}
                    {...field('email')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Vehicle Category</label>
                  <select className={inputCls} {...field('vehicleType')}>
                    <option value="">Select vehicle category</option>
                    {VEHICLE_TYPE_OPTIONS.map(v => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Pickup Location */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Pickup Location</label>
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
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Pickup Date</label>
                  <input type="date" className={inputCls} {...field('pickupDate')} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Return Date</label>
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
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Source</label>
                  <select className={inputCls} {...field('source')}>
                    {SOURCES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Assigned To</label>
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
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Status</label>
                  <select className={inputCls} {...field('status')}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Notes</label>
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
                  className="px-5 py-2.5 rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-sm font-medium transition-colors"
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
