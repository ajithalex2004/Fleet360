'use client';
import React, { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';
import {
  RENTAL_VEHICLE_CATEGORIES,
  formatRentalCategoryLabel,
  normalizeRentalCategory,
} from '@/lib/rental/categories';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Quotation {
  id: string;
  quote_no: string;
  inquiry_id?: string;
  customer_name: string;
  customerName?: string;
  email?: string;
  phone?: string;
  vehicle_type?: string;
  vehicleCategory?: string;
  vehicle_name?: string;
  pickup_date: string;
  pickupDate?: string;
  return_date: string;
  returnDate?: string;
  rental_days: number;
  daily_rate: number | string;
  dailyRate?: number | string;
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
  convertedTo?: string;
  created_at: string;
}

interface SummaryEntry {
  status: string;
  count: string;
  total: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_TABS = ['ALL', 'DRAFT', 'SENT', 'ACCEPTED', 'CONVERTED', 'REJECTED', 'EXPIRED'];

const STATUS_COLORS: Record<string, string> = {
  DRAFT:     'bg-[var(--bg-surface-hover)]/30 text-[var(--text-muted)] border-[var(--border-strong)]/40',
  SENT:      'bg-blue-500/20 text-blue-400 border-blue-500/30',
  ACCEPTED:  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  CONVERTED: 'bg-teal-500/20 text-teal-300 border-teal-500/35',
  REJECTED:  'bg-red-500/20 text-red-400 border-red-500/30',
  EXPIRED:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

const STATUS_ACTION: Record<string, { next: string; label: string; color: string }[]> = {
  DRAFT:     [{ next: 'SENT',     label: 'Send Quote', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30' }],
  SENT:      [
    { next: 'ACCEPTED', label: 'Accept',     color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30' },
    { next: 'REJECTED', label: 'Reject',     color: 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30' },
  ],
  ACCEPTED:  [],
  CONVERTED: [],
  REJECTED:  [],
  EXPIRED:   [],
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

function buildBookingHref(q: Quotation): string {
  const cName = q.customerName ?? q.customer_name ?? '';
  const rawCat = q.vehicleCategory ?? q.vehicle_type ?? '';
  const cat = rawCat ? normalizeRentalCategory(rawCat) || rawCat : '';
  const pickup = (q.pickupDate ?? q.pickup_date ?? '').slice(0, 10);
  const dropoff = (q.returnDate ?? q.return_date ?? '').slice(0, 10);
  const rate = String(q.dailyRate ?? q.daily_rate ?? '');
  return (
    `/rental/bookings?quoteId=${encodeURIComponent(q.id)}` +
    `&customerName=${encodeURIComponent(cName)}` +
    `&category=${encodeURIComponent(cat)}` +
    `&pickupDate=${encodeURIComponent(pickup)}` +
    `&dropoffDate=${encodeURIComponent(dropoff)}` +
    `&dailyRate=${encodeURIComponent(rate)}`
  );
}

// ── Empty form ────────────────────────────────────────────────────────────────
const emptyForm = {
  inquiryId: '',
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
function QuotationsPageInner() {
  const searchParams = useSearchParams();
  const autoOpenedInquiryRef = useRef<string | null>(null);

  const [quotations, setQuotations]   = useState<Quotation[]>([]);
  const [summary, setSummary]         = useState<SummaryEntry[]>([]);
  const [activeTab, setActiveTab]     = useState('ALL');
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [notice, setNotice]           = useState('');
  const [showModal, setShowModal]     = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [convertingId, setConvertingId]   = useState<string | null>(null);
  const [formData, setFormData]       = useState({ ...emptyForm });

  // ── Pre-open New Quotation modal when ?inquiryId= is present ──────────────
  useEffect(() => {
    const inquiryId = searchParams.get('inquiryId');
    if (!inquiryId || autoOpenedInquiryRef.current === inquiryId) return;
    autoOpenedInquiryRef.current = inquiryId;

    const rawCat = searchParams.get('category') ?? searchParams.get('vehicleType') ?? '';
    const normCat = rawCat ? normalizeRentalCategory(rawCat) || rawCat : '';

    setFormData({
      ...emptyForm,
      inquiryId,
      customerName: searchParams.get('customerName') ?? '',
      phone: searchParams.get('customerPhone') ?? searchParams.get('phone') ?? '',
      email: searchParams.get('customerEmail') ?? searchParams.get('email') ?? '',
      vehicleType: normCat,
      pickupDate: (searchParams.get('pickupDate') ?? '').slice(0, 10),
      returnDate: (searchParams.get('returnDate') ?? '').slice(0, 10),
    });
    setShowModal(true);
  }, [searchParams]);

  // ── Live calculation ──────────────────────────────────────────────────────
  const liveDays     = calcDays(formData.pickupDate, formData.returnDate);
  const liveRate     = parseFloat(formData.dailyRate) || 0;
  const liveSubtotal = liveDays * liveRate;
  const liveVat      = liveSubtotal * VAT_RATE;
  const liveGrand    = liveSubtotal + liveVat;

  // ── Derived summary KPIs ──────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const total = summary.reduce((a, s) => a + parseInt(s.count ?? '0'), 0);
    const wonEntries     = summary.filter(s => ['ACCEPTED', 'CONVERTED'].includes(s.status));
    const pendingEntries = summary.filter(s => ['DRAFT', 'SENT'].includes(s.status));
    const acceptedVal    = wonEntries.reduce((a, s) => a + toNum(s.total), 0);
    const pendingVal     = pendingEntries.reduce((a, s) => a + toNum(s.total), 0);
    const acceptedCount  = wonEntries.reduce((a, s) => a + parseInt(s.count ?? '0'), 0);
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
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(json?.error ?? 'Failed to load quotations'));
        setQuotations([]);
        return;
      }
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
      const normalizedType = formData.vehicleType
        ? normalizeRentalCategory(formData.vehicleType) || formData.vehicleType
        : null;
      const res = await fetch('/api/rental/quotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(formData.inquiryId ? { inquiryId: formData.inquiryId } : {}),
          customerName:  formData.customerName,
          phone:         formData.phone || null,
          email:         formData.email || null,
          vehicleType:   normalizedType,
          vehicleName:   formData.vehicleName || null,
          pickupDate:    formData.pickupDate,
          returnDate:    formData.returnDate,
          dailyRate:     liveRate,
          depositAmount: parseFloat(formData.depositAmount) || 0,
          notes:         formData.notes || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? 'Failed to create quotation'));
      setShowModal(false);
      setFormData({ ...emptyForm });
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
    setError('');
    try {
      const res = await fetch('/api/rental/quotations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: q.id, status: newStatus }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(json?.error ?? 'Failed to update quote status'));
        return;
      }
      loadData();
    } catch {
      setError('Failed to update quote status');
    } finally {
      setActionLoading(null);
    }
  };

  // ── 1-Click Convert Quotation → Booking ───────────────────────────────────
  const handleOneClickConvertToBooking = async (q: Quotation) => {
    setConvertingId(q.id);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/rental/quotations/${encodeURIComponent(q.id)}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(json?.error ?? `Failed to convert quote (${res.status})`));
        return;
      }
      const bRef = json?.booking?.bookingRef ?? json?.convertedTo ?? '';
      setNotice(
        `Quotation ${q.quote_no} converted to Booking${bRef ? ` (${bRef})` : ''}.`,
      );
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Quote conversion failed');
    } finally {
      setConvertingId(null);
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

      {/* Conversion Notice */}
      {notice && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 text-emerald-300 text-sm flex items-center justify-between">
          <span>✅ {notice}</span>
          <button onClick={() => setNotice('')} className="text-emerald-300 hover:text-emerald-100 ml-4">✕</button>
        </div>
      )}

      {/* KPI Cards */}
      <StatGrid cols={4}>
        <KpiCard label="Total Quotes" value={kpi.total} sub="all time" accent="slate" />
        <KpiCard label="Accepted Value" value={fmtAED(kpi.acceptedVal)} sub="confirmed revenue" accent="emerald" />
        <KpiCard label="Pending Value" value={fmtAED(kpi.pendingVal)} sub="draft + sent" accent="cyan" />
        <KpiCard label="Conversion Rate" value={`${kpi.convRate}%`} sub="accepted / total" accent="violet" />
      </StatGrid>

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
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${activeTab === tab ? 'bg-white/20' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'}`}>
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
                  const dStatus =
                    expired && !['ACCEPTED', 'CONVERTED', 'REJECTED'].includes(q.status)
                      ? 'EXPIRED'
                      : q.status;
                  const actions = STATUS_ACTION[dStatus] ?? [];
                  const rawCat = q.vehicleCategory ?? q.vehicle_type;
                  const convertedRef = q.converted_to ?? q.convertedTo ?? '';
                  const canOneClickConvert = ['DRAFT', 'SENT', 'ACCEPTED'].includes(dStatus);
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
                        <div className="text-sm font-medium text-[var(--text-main)]">{q.customerName ?? q.customer_name}</div>
                        {q.phone && <div className="text-xs text-[var(--text-muted)] mt-0.5">{q.phone}</div>}
                      </td>

                      {/* Vehicle */}
                      <td className="px-4 py-3">
                        <div className="text-sm text-[var(--text-main)]">
                          {rawCat ? formatRentalCategoryLabel(rawCat) : '—'}
                        </div>
                        {q.vehicle_name && <div className="text-xs text-[var(--text-faint)] mt-0.5">{q.vehicle_name}</div>}
                      </td>

                      {/* Dates */}
                      <td className="px-4 py-3">
                        <div className="text-xs text-[var(--text-muted)]">{fmtDate(q.pickupDate ?? q.pickup_date)}</div>
                        <div className="text-xs text-[var(--text-faint)]">→ {fmtDate(q.returnDate ?? q.return_date)}</div>
                      </td>

                      {/* Days */}
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-semibold text-[var(--text-main)]">{q.rental_days}d</span>
                      </td>

                      {/* Daily Rate */}
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm text-[var(--text-main)]">{fmtAED(q.dailyRate ?? q.daily_rate)}</span>
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
                        <div className="flex flex-col items-start gap-1">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_COLORS[dStatus] ?? STATUS_COLORS.DRAFT}`}>
                            {dStatus}
                          </span>
                          {convertedRef && (
                            <Link
                              href={`/rental/bookings?id=${encodeURIComponent(convertedRef)}`}
                              className="font-mono text-[11px] px-2 py-0.5 rounded bg-teal-500/15 border border-teal-500/30 text-teal-300 hover:bg-teal-500/25"
                            >
                              ↳ {convertedRef}
                            </Link>
                          )}
                        </div>
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
                          {canOneClickConvert && (
                            <button
                              type="button"
                              disabled={convertingId === q.id}
                              onClick={() => handleOneClickConvertToBooking(q)}
                              className="text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 hover:bg-emerald-500/30 font-semibold whitespace-nowrap transition-colors disabled:opacity-50"
                              title="1-Click atomic conversion to Rental Booking"
                            >
                              {convertingId === q.id ? 'Converting…' : 'Convert to Booking'}
                            </button>
                          )}
                          {dStatus === 'ACCEPTED' && (
                            <Link
                              href={buildBookingHref(q)}
                              className="text-xs px-2.5 py-1.5 rounded-lg bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25 font-medium whitespace-nowrap transition-colors"
                            >
                              Draft Booking ↗
                            </Link>
                          )}
                          {dStatus === 'CONVERTED' && convertedRef && (
                            <Link
                              href={`/rental/bookings?id=${encodeURIComponent(convertedRef)}`}
                              className="text-xs px-2.5 py-1.5 rounded-lg bg-teal-500/20 text-teal-300 border border-teal-500/35 hover:bg-teal-500/30 font-medium whitespace-nowrap transition-colors"
                            >
                              View Booking →
                            </Link>
                          )}
                          {actions.length === 0 && !canOneClickConvert && dStatus !== 'CONVERTED' && (
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
                <p className="text-[var(--text-muted)] text-xs mt-0.5">
                  {formData.inquiryId
                    ? 'Creating quotation from linked customer inquiry · valid for 7 days'
                    : 'Quote will be valid for 7 days from creation'}
                </p>
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

              {/* Vehicle Category + Vehicle Name/Plate */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Vehicle Category</label>
                  <select className={inputCls} {...field('vehicleType')}>
                    <option value="">Select category</option>
                    {VEHICLE_TYPE_OPTIONS.map(v => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
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

export default function QuotationsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-[var(--text-muted)] text-sm animate-pulse">
          Loading quotations...
        </div>
      }
    >
      <QuotationsPageInner />
    </Suspense>
  );
}
