'use client';

import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';
import {
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Sparkles,
  Calculator,
  Plus,
  Calendar,
  ExternalLink,
} from 'lucide-react';
import {
  RENTAL_VEHICLE_CATEGORIES,
  formatRentalCategoryLabel,
  normalizeRentalCategory,
} from '@/lib/rental/categories';

/* ─── Types ─── */
interface NormalizedRenewal {
  id: string;
  renewalNo: string;
  agreementId: string;
  agreementNo: string;
  customerName: string;
  vehicleName: string;
  vehicleNo: string;
  originalEndDate: string;
  newEndDate: string;
  extensionDays: number;
  dailyRate: number;
  renewalAmount: number;
  vatAmount: number;
  totalAmount: number;
  depositTopUp: number;
  status: string;
  approvedBy?: string;
  approvedAt?: string;
  notes?: string;
  createdAt: string;
}

interface KPIs {
  pendingCount: number;
  approvedTotal: number;
  thisMonthExtensions: number;
  avgExtensionDays: number;
}

interface ActiveAgreementOption {
  id: string;
  agreementNo: string;
  customerName: string;
  isCorporate: boolean;
  insurancePlanCode: string;
  vehicleCategory: string;
  vehiclePlate: string;
  vehicleName: string;
  endDate: string;
  dailyRate: number;
  currency: string;
}

interface MasterQuote {
  ruleName: string;
  vehicleCategory: string;
  totalDays: number;
  dailyRate: number;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  appliedRateEvent?: {
    eventCode?: string;
    code?: string;
    name?: string;
    multiplier?: number;
  } | null;
}

interface ConflictDetails {
  message: string;
  bookingRef?: string;
  customerName?: string;
  pickupDate?: string;
  dropoffDate?: string;
}

/* ─── Constants ─── */
const STATUS_TABS = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'];

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  APPROVED:  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  REJECTED:  'bg-red-500/20 text-red-400 border-red-500/30',
  COMPLETED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

type CategoryItem = string | { value?: string; code?: string; label?: string };
const VEHICLE_CATEGORIES = (RENTAL_VEHICLE_CATEGORIES as readonly CategoryItem[]).map((item) => {
  const value = typeof item === 'string' ? item : String(item.value ?? item.code ?? '');
  const label =
    typeof item === 'string'
      ? formatRentalCategoryLabel(value)
      : item.label ?? formatRentalCategoryLabel(value);
  return { value, label };
});

const INPUT_CLS =
  'w-full px-4 py-2.5 rounded-lg bg-[var(--bg-surface-hover)]/80 border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-teal-500 focus:outline-none text-sm transition-colors';
const LABEL_CLS = 'block text-sm font-medium text-[var(--text-muted)] mb-1.5';

/* ─── Helpers ─── */
function toNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fmt(n: number | string | undefined, decimals = 2) {
  const val = toNum(n, 0);
  return val.toLocaleString('en-AE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function diffDays(a: string, b: string) {
  if (!a || !b) return 0;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.ceil(ms / 86400000));
}

function addDaysIso(isoDate: string, days: number): string {
  if (!isoDate) return '';
  const dt = new Date(isoDate);
  if (Number.isNaN(dt.getTime())) return '';
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}

function fmtDateShort(dateStr?: string) {
  if (!dateStr) return '—';
  const dt = new Date(dateStr);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isExpiringSoon(dateStr?: string) {
  if (!dateStr) return false;
  const ts = new Date(dateStr).getTime();
  if (Number.isNaN(ts)) return false;
  const d = ts - Date.now();
  return d >= 0 && d < 7 * 86400000;
}

function normalizeRenewal(raw: Record<string, unknown>): NormalizedRenewal {
  const agreementObj = (raw.agreement as Record<string, unknown> | undefined) ?? undefined;
  const bookingObj = (agreementObj?.booking as Record<string, unknown> | undefined) ?? undefined;
  const customerObj = (bookingObj?.customer as Record<string, unknown> | undefined) ?? undefined;
  const vehicleObj =
    (raw.vehicle as Record<string, unknown> | undefined) ??
    (agreementObj?.vehicle as Record<string, unknown> | undefined) ??
    (bookingObj?.vehicle as Record<string, unknown> | undefined);

  const origEnd = String(
    raw.originalEndDate ??
      raw.original_end_date ??
      raw.previousEndDate ??
      raw.previous_end_date ??
      agreementObj?.endDate ??
      ''
  );
  const newEnd = String(
    raw.newEndDate ??
      raw.new_end_date ??
      raw.extendedTo ??
      raw.extended_to ??
      ''
  );

  const computedDays = diffDays(origEnd, newEnd);
  const extensionDays = toNum(
    raw.extensionDays ?? raw.extension_days ?? raw.extraDays ?? raw.extra_days,
    computedDays
  );
  const dailyRate = toNum(raw.dailyRate ?? raw.daily_rate ?? agreementObj?.dailyRate, 0);
  const subtotalFallback = +(extensionDays * dailyRate).toFixed(2);
  const renewalAmount = toNum(
    raw.renewalAmount ?? raw.renewal_amount ?? raw.subtotal ?? raw.sub_total,
    subtotalFallback
  );
  const vatAmount = toNum(
    raw.vatAmount ?? raw.vat_amount ?? raw.taxAmount ?? raw.tax_amount,
    +(renewalAmount * 0.05).toFixed(2)
  );
  const totalAmount = toNum(
    raw.totalAmount ?? raw.total_amount ?? raw.amount,
    +(renewalAmount + vatAmount).toFixed(2)
  );

  const vehMakeModel = vehicleObj
    ? `${String(vehicleObj.make ?? '')} ${String(vehicleObj.model ?? '')}`.trim()
    : '';

  return {
    id: String(raw.id ?? ''),
    renewalNo: String(
      raw.renewalNo ??
        raw.renewal_no ??
        raw.referenceNo ??
        `EXT-${String(raw.id ?? '').slice(0, 6).toUpperCase()}`
    ),
    agreementId: String(raw.agreementId ?? raw.agreement_id ?? agreementObj?.id ?? ''),
    agreementNo: String(
      raw.agreementNo ?? raw.agreement_no ?? agreementObj?.agreementNo ?? '—'
    ),
    customerName: String(
      raw.customerName ??
        raw.customer_name ??
        customerObj?.fullName ??
        '—'
    ),
    vehicleName: String(
      raw.vehicleName ??
        raw.vehicle_name ??
        (vehMakeModel || (bookingObj?.vehicleCategory ?? '—'))
    ),
    vehicleNo: String(
      raw.vehicleNo ??
        raw.vehicle_no ??
        raw.plateNumber ??
        vehicleObj?.plateNumber ??
        vehicleObj?.plateNo ??
        ''
    ),
    originalEndDate: origEnd,
    newEndDate: newEnd,
    extensionDays,
    dailyRate,
    renewalAmount,
    vatAmount,
    totalAmount,
    depositTopUp: toNum(raw.depositTopUp ?? raw.deposit_top_up, 0),
    status: String(raw.status ?? 'PENDING').toUpperCase(),
    approvedBy: raw.approvedBy ? String(raw.approvedBy) : raw.approved_by ? String(raw.approved_by) : undefined,
    approvedAt: raw.approvedAt ? String(raw.approvedAt) : raw.approved_at ? String(raw.approved_at) : undefined,
    notes: raw.notes ? String(raw.notes) : undefined,
    createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString()),
  };
}

function normalizeActiveAgreement(raw: Record<string, unknown>): ActiveAgreementOption {
  const booking = (raw.booking as Record<string, unknown> | undefined) ?? undefined;
  const customer = (booking?.customer as Record<string, unknown> | undefined) ?? undefined;
  const vehicle =
    (raw.vehicle as Record<string, unknown> | undefined) ??
    (booking?.vehicle as Record<string, unknown> | undefined);

  const makeModel = vehicle
    ? `${String(vehicle.make ?? '')} ${String(vehicle.model ?? '')}`.trim()
    : '';
  const rawCategory = String(raw.vehicleCategory ?? booking?.vehicleCategory ?? 'ECONOMY');
  const category = normalizeRentalCategory(rawCategory) || rawCategory || 'ECONOMY';
  const plate = String(
    raw.vehiclePlate ??
      raw.vehicleNo ??
      vehicle?.plateNumber ??
      vehicle?.plateNo ??
      vehicle?.registrationNo ??
      ''
  );
  const rawEnd = String(raw.endDate ?? booking?.dropoffDate ?? '');

  return {
    id: String(raw.id ?? ''),
    agreementNo: String(raw.agreementNo ?? raw.agreement_no ?? `RA-${String(raw.id ?? '').slice(0, 6)}`),
    customerName: String(raw.customerName ?? customer?.fullName ?? 'Walk-in Customer'),
    isCorporate: Boolean(raw.isCorporate ?? customer?.customerType === 'CORPORATE'),
    insurancePlanCode: String(raw.insurancePlanCode ?? ''),
    vehicleCategory: category || 'ECONOMY',
    vehiclePlate: plate,
    vehicleName: String(raw.vehicleName ?? (makeModel || category || 'Assigned Vehicle')),
    endDate: rawEnd ? rawEnd.slice(0, 10) : '',
    dailyRate: toNum(raw.dailyRate, 0),
    currency: String(raw.currency ?? 'AED'),
  };
}

function computeKpis(rows: NormalizedRenewal[]): KPIs {
  const now = new Date();
  const curMonth = now.getMonth();
  const curYear = now.getFullYear();

  const pendingCount = rows.filter((r) => r.status === 'PENDING').length;
  const approvedTotal = rows
    .filter((r) => r.status === 'APPROVED' || r.status === 'COMPLETED')
    .reduce((sum, r) => sum + r.totalAmount, 0);
  const thisMonthExtensions = rows.filter((r) => {
    const dt = new Date(r.createdAt);
    return !Number.isNaN(dt.getTime()) && dt.getMonth() === curMonth && dt.getFullYear() === curYear;
  }).length;
  const withDays = rows.filter((r) => r.extensionDays > 0);
  const avgExtensionDays =
    withDays.length > 0
      ? Math.round(withDays.reduce((s, r) => s + r.extensionDays, 0) / withDays.length)
      : 0;

  return { pendingCount, approvedTotal, thisMonthExtensions, avgExtensionDays };
}

/* ─── Default form state ─── */
const DEFAULT_FORM = {
  agreementId: '',
  agreementNo: '',
  customerName: '',
  vehicleCategory: 'ECONOMY',
  isCorporate: false,
  insurancePlanCode: '',
  vehicleName: '',
  vehicleNo: '',
  originalEndDate: '',
  newEndDate: '',
  dailyRate: '',
  depositTopUp: '',
  notes: '',
};

/* ═══════════════════════════════════════════════════════════ */
function RenewalsDeskInner() {
  const searchParams = useSearchParams();
  const preselectedAgreementId = searchParams.get('agreementId') ?? '';
  const autoOpenedRef = useRef(false);

  const [renewals, setRenewals] = useState<NormalizedRenewal[]>([]);
  const [kpis, setKpis] = useState<KPIs>({
    pendingCount: 0,
    approvedTotal: 0,
    thisMonthExtensions: 0,
    avgExtensionDays: 0,
  });
  const [activeAgreements, setActiveAgreements] = useState<ActiveAgreementOption[]>([]);
  const [agreementsLoading, setAgreementsLoading] = useState(false);

  const [activeTab, setActiveTab] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const [error, setError] = useState('');
  const [rbacError, setRbacError] = useState('');
  const [modalError, setModalError] = useState('');
  const [conflict, setConflict] = useState<ConflictDetails | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<NormalizedRenewal | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [rateManuallyEdited, setRateManuallyEdited] = useState(false);

  // Live Master Price List quote state
  const [masterQuote, setMasterQuote] = useState<MasterQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  /* ── derived calculations ── */
  const extDays = diffDays(form.originalEndDate, form.newEndDate);
  const dailyR = parseFloat(form.dailyRate) || 0;
  const renewAmt = +(extDays * dailyR).toFixed(2);
  const vatAmt = +(renewAmt * 0.05).toFixed(2);
  const totalAmt = +(renewAmt + vatAmt).toFixed(2);

  /* ── load renewals ── */
  const loadRenewals = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (activeTab !== 'ALL') params.set('status', activeTab);
      if (search) params.set('search', search);
      params.set('limit', '200');

      const res = await fetch(`/api/rental/renewals?${params}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setRbacError(String(json?.error ?? 'Requires permission to view extensions & renewals.'));
        setRenewals([]);
        return;
      }
      if (!res.ok) {
        setError(String(json?.error ?? 'Failed to load extensions & renewals'));
        setRenewals([]);
        return;
      }
      const rawList = Array.isArray(json)
        ? json
        : Array.isArray(json?.renewals)
          ? json.renewals
          : Array.isArray(json?.data)
            ? json.data
            : [];
      const normalized = (rawList as Record<string, unknown>[]).map(normalizeRenewal);
      setRenewals(normalized);

      if (json?.kpis && typeof json.kpis === 'object') {
        setKpis({
          pendingCount: toNum(json.kpis.pendingCount, 0),
          approvedTotal: toNum(json.kpis.approvedTotal, 0),
          thisMonthExtensions: toNum(json.kpis.thisMonthExtensions, 0),
          avgExtensionDays: toNum(json.kpis.avgExtensionDays, 0),
        });
      } else {
        setKpis(computeKpis(normalized));
      }
    } catch {
      setError('Failed to load extensions & renewals');
    } finally {
      setLoading(false);
    }
  }, [activeTab, search]);

  /* ── load ACTIVE agreements for modal dropdown ── */
  const loadActiveAgreements = useCallback(async () => {
    setAgreementsLoading(true);
    try {
      const res = await fetch('/api/rental/agreements?status=ACTIVE&limit=200', {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const rawRows = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.agreements)
            ? data.agreements
            : [];
      const mapped = (rawRows as Record<string, unknown>[]).map(normalizeActiveAgreement);
      setActiveAgreements(mapped);
    } catch {
      /* non-fatal */
    } finally {
      setAgreementsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRenewals();
  }, [loadRenewals]);

  useEffect(() => {
    loadActiveAgreements();
  }, [loadActiveAgreements]);

  /* ── helper to populate form from an agreement option ── */
  const applyAgreementToForm = useCallback((ag: ActiveAgreementOption) => {
    const defaultNewEnd = ag.endDate ? addDaysIso(ag.endDate, 3) : '';
    setRateManuallyEdited(false);
    setConflict(null);
    setModalError('');
    setForm({
      agreementId: ag.id,
      agreementNo: ag.agreementNo,
      customerName: ag.customerName,
      vehicleCategory: ag.vehicleCategory || 'ECONOMY',
      isCorporate: ag.isCorporate,
      insurancePlanCode: ag.insurancePlanCode,
      vehicleName: ag.vehicleName,
      vehicleNo: ag.vehiclePlate,
      originalEndDate: ag.endDate,
      newEndDate: defaultNewEnd,
      dailyRate: ag.dailyRate > 0 ? String(ag.dailyRate) : '',
      depositTopUp: '',
      notes: '',
    });
  }, []);

  /* ── handle ?agreementId=... auto-open ── */
  useEffect(() => {
    if (!preselectedAgreementId || autoOpenedRef.current || agreementsLoading) return;

    const match = activeAgreements.find((a) => a.id === preselectedAgreementId);
    if (match) {
      autoOpenedRef.current = true;
      applyAgreementToForm(match);
      setShowModal(true);
      return;
    }

    // Fallback: fetch specific agreement by ID if not yet in ACTIVE list
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/rental/agreements/${preselectedAgreementId}`, {
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const raw = await res.json();
        const obj = (raw?.agreement ?? raw) as Record<string, unknown>;
        if (obj?.id && !cancelled) {
          autoOpenedRef.current = true;
          const mapped = normalizeActiveAgreement(obj);
          setActiveAgreements((prev) =>
            prev.some((p) => p.id === mapped.id) ? prev : [mapped, ...prev]
          );
          applyAgreementToForm(mapped);
          setShowModal(true);
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [preselectedAgreementId, activeAgreements, agreementsLoading, applyAgreementToForm]);

  /* ── Live Master Price List Quote (`POST /api/rental/rates/calculate`) ── */
  useEffect(() => {
    if (!showModal || !form.originalEndDate || !form.newEndDate) {
      setMasterQuote(null);
      return;
    }
    const days = diffDays(form.originalEndDate, form.newEndDate);
    if (days <= 0) {
      setMasterQuote(null);
      return;
    }

    let cancelled = false;
    setQuoteLoading(true);

    (async () => {
      try {
        const res = await fetch('/api/rental/rates/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vehicleCategory: form.vehicleCategory || 'ECONOMY',
            pickupDate: form.originalEndDate,
            dropoffDate: form.newEndDate,
            customerType: form.isCorporate ? 'CORPORATE' : 'INDIVIDUAL',
            channel: form.isCorporate ? 'CORPORATE' : 'DIRECT',
            currency: 'AED',
            insurancePlanCode: form.insurancePlanCode || '',
          }),
        });
        if (!res.ok || cancelled) {
          if (!cancelled) setMasterQuote(null);
          return;
        }
        const q = await res.json();
        if (cancelled) return;

        const qDaily = toNum(q?.dailyRate, 0);
        if (qDaily > 0) {
          const quoteObj: MasterQuote = {
            ruleName: String(q.ruleName ?? 'Master Tariff'),
            vehicleCategory: String(q.vehicleCategory ?? form.vehicleCategory),
            totalDays: toNum(q.totalDays, days),
            dailyRate: qDaily,
            subtotal: toNum(q.subtotal, +(days * qDaily).toFixed(2)),
            taxRate: toNum(q.taxRate, 5),
            taxAmount: toNum(q.taxAmount, +(days * qDaily * 0.05).toFixed(2)),
            totalAmount: toNum(q.totalAmount, +(days * qDaily * 1.05).toFixed(2)),
            appliedRateEvent: q.appliedRateEvent ?? null,
          };
          setMasterQuote(quoteObj);

          // Auto-fill dailyRate from Master Price List if blank or not manually overridden
          if (!rateManuallyEdited) {
            setForm((prev) => ({ ...prev, dailyRate: String(qDaily) }));
          }
        } else {
          setMasterQuote(null);
        }
      } catch {
        if (!cancelled) setMasterQuote(null);
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    showModal,
    form.originalEndDate,
    form.newEndDate,
    form.vehicleCategory,
    form.isCorporate,
    form.insurancePlanCode,
    rateManuallyEdited,
  ]);

  /* ── open fresh modal ── */
  const openNewModal = () => {
    setForm(DEFAULT_FORM);
    setMasterQuote(null);
    setConflict(null);
    setModalError('');
    setRateManuallyEdited(false);
    setShowModal(true);
  };

  /* ── submit extension / renewal ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setModalError('');
    setConflict(null);
    setRbacError('');

    try {
      const res = await fetch('/api/rental/renewals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agreementId: form.agreementId || undefined,
          agreementNo: form.agreementNo || null,
          customerName: form.customerName,
          vehicleName: form.vehicleName,
          vehicleNo: form.vehicleNo || null,
          originalEndDate: form.originalEndDate || null,
          newEndDate: form.newEndDate || null,
          extendedTo: form.newEndDate || null,
          extensionDays: extDays,
          dailyRate: dailyR,
          depositTopUp: parseFloat(form.depositTopUp) || 0,
          notes: form.notes || null,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (res.status === 409) {
        const conflictObj = (json?.conflict ?? json?.conflictingBooking ?? {}) as Record<
          string,
          unknown
        >;
        setConflict({
          message: String(
            json?.error ??
              json?.message ??
              'Vehicle is already reserved for another customer during the requested extension dates.'
          ),
          bookingRef: conflictObj.bookingRef ? String(conflictObj.bookingRef) : undefined,
          customerName: conflictObj.customerName ? String(conflictObj.customerName) : undefined,
          pickupDate: conflictObj.pickupDate ? String(conflictObj.pickupDate) : undefined,
          dropoffDate: conflictObj.dropoffDate ? String(conflictObj.dropoffDate) : undefined,
        });
        return;
      }

      if (res.status === 403) {
        const msg = String(json?.error ?? 'Requires RAC Operator or Manager permission.');
        setModalError(`Access Denied (403): ${msg}`);
        setRbacError(msg);
        return;
      }

      if (!res.ok) {
        setModalError(String(json?.error ?? 'Failed to submit rental extension'));
        return;
      }

      setShowModal(false);
      setForm(DEFAULT_FORM);
      setMasterQuote(null);
      setConflict(null);
      loadRenewals();
      loadActiveAgreements();
    } catch {
      setModalError('Network error while creating extension request');
    } finally {
      setSaving(false);
    }
  };

  /* ── Approve / Reject / Complete status action ── */
  const updateStatus = async (id: string, status: 'APPROVED' | 'REJECTED' | 'COMPLETED') => {
    setActionBusyId(id);
    setError('');
    setRbacError('');
    try {
      const actionVerb =
        status === 'APPROVED' ? 'APPROVE' : status === 'REJECTED' ? 'REJECT' : 'COMPLETE';
      const res = await fetch('/api/rental/renewals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          renewalId: id,
          status,
          action: actionVerb,
          approvedBy: 'ADMIN',
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 403) {
        setRbacError(
          String(
            json?.error ??
              'Requires RAC Manager permission — Counter Operators cannot approve or reject extensions.'
          )
        );
        return;
      }

      if (res.status === 409) {
        setError(
          String(
            json?.error ??
              'Vehicle conflict (409): vehicle is already booked for another customer during these extension dates.'
          )
        );
        return;
      }

      if (!res.ok) {
        setError(String(json?.error ?? 'Failed to update extension status'));
        return;
      }

      loadRenewals();
      loadActiveAgreements();
    } catch {
      setError('Failed to update extension status');
    } finally {
      setActionBusyId(null);
    }
  };

  /* ── KPI cards ── */
  const kpiCards = [
    {
      label: 'Pending Extensions',
      value: kpis.pendingCount.toString(),
      sub: 'Awaiting manager approval',
      color: 'text-amber-400',
      border: 'border-amber-500/20',
    },
    {
      label: 'Approved Revenue',
      value: `AED ${fmt(kpis.approvedTotal)}`,
      sub: 'Approved & active extensions',
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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <RefreshCw className="w-6 h-6 text-teal-400" />
            <h1 className="text-2xl font-bold text-[var(--text-main)]">
              Extensions &amp; Renewals
            </h1>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {renewals.length} extension{renewals.length !== 1 ? 's' : ''} — unified RAC agreement
            extension &amp; Master Price List re-quoting desk
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/rental/agreements"
            className="rounded-xl border border-[var(--border-subtle)] px-4 py-2.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] transition-colors"
          >
            View Agreements
          </Link>
          <button
            onClick={openNewModal}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity shadow-lg shadow-teal-900/30"
          >
            <Plus className="w-4 h-4" />
            New Extension / Renewal
          </button>
        </div>
      </div>

      {/* RBAC 403 Alert */}
      {rbacError && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3.5 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-300">
                Requires RAC Manager Permission (403)
              </p>
              <p className="text-xs text-amber-200/80 mt-0.5">{rbacError}</p>
            </div>
          </div>
          <button
            onClick={() => setRbacError('')}
            className="text-amber-300/70 hover:text-amber-200 text-sm"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-300 hover:text-white text-xs">
            ✕
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <StatGrid cols={4}>
        {kpiCards.map((c, idx) => {
          const accents = ['amber', 'cyan', 'rose', 'emerald'] as const;
          return (
            <KpiCard
              key={c.label}
              label={c.label}
              value={c.value}
              sub={c.sub}
              accent={accents[idx % accents.length]}
            />
          );
        })}
      </StatGrid>

      {/* Status Tabs + Search */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
        <div className="flex gap-1 bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-1 flex-wrap">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab
                  ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white shadow'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search customer, agreement no, renewal no, plate..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 w-full sm:w-auto px-4 py-2 rounded-xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-teal-500 focus:outline-none text-sm"
        />
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl backdrop-blur-sm overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-[var(--text-muted)] animate-pulse text-sm">
              Loading extensions &amp; renewals…
            </div>
          </div>
        ) : renewals.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-16 space-y-2">
            <Calendar className="w-10 h-10 mx-auto text-[var(--text-faint)]" />
            <div className="font-medium">No extensions or renewals found</div>
            <p className="text-xs text-[var(--text-faint)]">
              Click &ldquo;New Extension / Renewal&rdquo; to extend an active rental agreement.
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[1100px]">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                {[
                  'Renewal No',
                  'Agreement',
                  'Customer',
                  'Vehicle / Plate',
                  'Original End',
                  'New End',
                  'Extra Days',
                  'Daily Rate',
                  'Total (AED)',
                  'Status',
                  'Actions',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {renewals.map((r) => {
                const expiring = isExpiringSoon(r.originalEndDate);
                const isBusy = actionBusyId === r.id;
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors ${
                      expiring ? 'bg-amber-500/5' : ''
                    }`}
                  >
                    <td className="px-4 py-3.5 text-sm font-mono text-teal-400 font-medium whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelected(r)}
                        className="hover:underline text-left"
                      >
                        {r.renewalNo}
                      </button>
                    </td>
                    <td className="px-4 py-3.5 text-sm font-mono text-[var(--text-muted)] whitespace-nowrap">
                      {r.agreementId ? (
                        <Link
                          href={`/rental/agreements?id=${encodeURIComponent(r.agreementId)}`}
                          className="text-teal-400 hover:text-teal-300 hover:underline inline-flex items-center gap-1"
                        >
                          <span>{r.agreementNo || 'View Agreement'}</span>
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      ) : (
                        r.agreementNo || '—'
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-[var(--text-main)] font-medium">
                      {r.customerName}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-[var(--text-muted)]">
                      <div className="text-[var(--text-main)]">{r.vehicleName}</div>
                      {r.vehicleNo && (
                        <div className="text-xs font-mono text-[var(--text-faint)]">
                          {r.vehicleNo}
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-4 py-3.5 text-sm whitespace-nowrap ${
                        expiring ? 'text-amber-400 font-semibold' : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {fmtDateShort(r.originalEndDate)}
                      {expiring && (
                        <span className="ml-1.5 text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
                          Soon
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-[var(--text-main)] whitespace-nowrap">
                      {fmtDateShort(r.newEndDate)}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-center">
                      <span className="font-bold text-cyan-400">+{r.extensionDays}</span>
                      <span className="text-[var(--text-faint)] text-xs ml-1">d</span>
                    </td>
                    <td className="px-4 py-3.5 text-sm font-mono text-[var(--text-muted)] whitespace-nowrap">
                      AED {fmt(r.dailyRate)}
                    </td>
                    <td className="px-4 py-3.5 text-sm font-mono font-semibold text-[var(--text-main)] whitespace-nowrap">
                      AED {fmt(r.totalAmount)}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                          STATUS_COLORS[r.status] ??
                          'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {r.status === 'PENDING' && (
                          <>
                            <button
                              disabled={isBusy}
                              onClick={() => updateStatus(r.id, 'APPROVED')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Approve
                            </button>
                            <button
                              disabled={isBusy}
                              onClick={() => updateStatus(r.id, 'REJECTED')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-semibold hover:bg-red-500/30 disabled:opacity-50 transition-colors"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Reject
                            </button>
                          </>
                        )}
                        {r.status === 'APPROVED' && (
                          <button
                            disabled={isBusy}
                            onClick={() => updateStatus(r.id, 'COMPLETED')}
                            className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs font-semibold hover:bg-blue-500/30 disabled:opacity-50 transition-colors"
                          >
                            Complete
                          </button>
                        )}
                        {r.agreementId && (
                          <Link
                            href={`/rental/agreements?id=${encodeURIComponent(r.agreementId)}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-xs font-medium transition-colors"
                          >
                            View Agreement
                          </Link>
                        )}
                        {!r.agreementId && r.status !== 'PENDING' && r.status !== 'APPROVED' && (
                          <span className="text-xs text-[var(--text-faint)]">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── SELECTED RENEWAL DETAIL MODAL ─── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--text-main)]">
                  Extension {selected.renewalNo}
                </h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {selected.customerName} · {selected.vehicleName}
                  {selected.vehicleNo ? ` (${selected.vehicleNo})` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl leading-none"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm bg-[var(--bg-surface-hover)]/40 border border-[var(--border-subtle)] rounded-xl p-4">
              <div>
                <div className="text-xs text-[var(--text-muted)]">Agreement</div>
                <div className="font-mono text-[var(--text-main)]">{selected.agreementNo}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)]">Status</div>
                <div className="font-semibold text-[var(--text-main)]">{selected.status}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)]">Original End</div>
                <div className="text-[var(--text-main)]">{fmtDateShort(selected.originalEndDate)}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)]">New End (+{selected.extensionDays}d)</div>
                <div className="text-[var(--text-main)]">{fmtDateShort(selected.newEndDate)}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)]">Daily Rate</div>
                <div className="font-mono text-[var(--text-main)]">AED {fmt(selected.dailyRate)}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)]">Total (incl. VAT)</div>
                <div className="font-mono font-bold text-teal-400">AED {fmt(selected.totalAmount)}</div>
              </div>
            </div>

            {selected.notes && (
              <div className="text-xs text-[var(--text-muted)] bg-[var(--bg-surface-hover)]/25 rounded-lg p-3">
                {selected.notes}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              {selected.agreementId && (
                <Link
                  href={`/rental/agreements?id=${encodeURIComponent(selected.agreementId)}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30 text-xs font-semibold transition-colors"
                >
                  View Agreement
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              )}
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="px-4 py-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-main)] text-xs font-medium hover:bg-[var(--bg-surface-hover)]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── NEW EXTENSION / RENEWAL MODAL ─── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
            {/* Modal header */}
            <div className="sticky top-0 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-7 py-5 flex items-center justify-between rounded-t-2xl z-10">
              <div>
                <h2 className="text-xl font-bold text-[var(--text-main)]">
                  New Extension / Renewal
                </h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Select an active rental agreement and preview live Master Price List rates
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setConflict(null);
                  setModalError('');
                }}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl leading-none transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-7 py-6 space-y-5">
              {/* 409 Vehicle Conflict Banner */}
              {conflict && (
                <div className="rounded-xl bg-rose-500/10 border border-rose-500/40 p-4 space-y-1.5">
                  <div className="flex items-center gap-2 text-rose-300 font-semibold text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>Vehicle Booking Conflict (409)</span>
                  </div>
                  <p className="text-xs text-rose-200/90">{conflict.message}</p>
                  {(conflict.bookingRef || conflict.pickupDate) && (
                    <p className="text-xs font-mono text-rose-300/80 pt-1">
                      {conflict.bookingRef ? `Booking ${conflict.bookingRef}` : ''}
                      {conflict.customerName ? ` · ${conflict.customerName}` : ''}
                      {conflict.pickupDate
                        ? ` · ${fmtDateShort(conflict.pickupDate)} → ${fmtDateShort(conflict.dropoffDate)}`
                        : ''}
                    </p>
                  )}
                </div>
              )}

              {/* Modal General / RBAC Error */}
              {modalError && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-xs text-amber-300">
                  {modalError}
                </div>
              )}

              {/* Active Agreement Selector Dropdown */}
              <div className="bg-[var(--bg-surface-hover)]/40 border border-teal-500/25 rounded-xl p-4 space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-teal-400">
                  Select Active Rental Agreement
                </label>
                <select
                  value={form.agreementId}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) {
                      setForm(DEFAULT_FORM);
                      setMasterQuote(null);
                      return;
                    }
                    const found = activeAgreements.find((a) => a.id === id);
                    if (found) applyAgreementToForm(found);
                  }}
                  className={INPUT_CLS}
                >
                  <option value="">
                    {agreementsLoading
                      ? 'Loading active agreements…'
                      : activeAgreements.length === 0
                        ? '— No ACTIVE agreements found (enter manually below) —'
                        : `— Choose from ${activeAgreements.length} ACTIVE agreement${activeAgreements.length === 1 ? '' : 's'} —`}
                  </option>
                  {activeAgreements.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.agreementNo} — {ag.customerName} —{' '}
                      {ag.vehiclePlate || ag.vehicleCategory} — Ends {fmtDateShort(ag.endDate)} —{' '}
                      {ag.currency} {fmt(ag.dailyRate)}/day
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[var(--text-faint)]">
                  Selecting an active agreement auto-fills customer, vehicle plate, current return
                  date, and category for live Master Price List calculation.
                </p>
              </div>

              {/* Agreement & Customer Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLS}>Agreement No</label>
                  <input
                    type="text"
                    value={form.agreementNo}
                    onChange={(e) => setForm((p) => ({ ...p, agreementNo: e.target.value }))}
                    placeholder="RA-0001"
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

              {/* Vehicle Info */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={LABEL_CLS}>Vehicle Category</label>
                  <select
                    value={form.vehicleCategory}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, vehicleCategory: e.target.value }))
                    }
                    className={INPUT_CLS}
                  >
                    {VEHICLE_CATEGORIES.map((cat) => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Vehicle Description *</label>
                  <input
                    type="text"
                    value={form.vehicleName}
                    onChange={(e) => setForm((p) => ({ ...p, vehicleName: e.target.value }))}
                    placeholder="e.g. Toyota Camry"
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
                    placeholder="e.g. DXB A 12345"
                    className={INPUT_CLS}
                  />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLS}>Current End Date *</label>
                  <input
                    type="date"
                    value={form.originalEndDate}
                    onChange={(e) => setForm((p) => ({ ...p, originalEndDate: e.target.value }))}
                    required
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>New Extended End Date *</label>
                  <input
                    type="date"
                    value={form.newEndDate}
                    min={
                      form.originalEndDate ? addDaysIso(form.originalEndDate, 1) : undefined
                    }
                    onChange={(e) => {
                      setConflict(null);
                      setForm((p) => ({ ...p, newEndDate: e.target.value }));
                    }}
                    required
                    className={INPUT_CLS}
                  />
                </div>
              </div>

              {/* Rate & Deposit Top-Up */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-[var(--text-muted)]">
                      Daily Rate (AED) *
                    </label>
                    {masterQuote && Math.abs(dailyR - masterQuote.dailyRate) > 0.01 && (
                      <button
                        type="button"
                        onClick={() => {
                          setForm((p) => ({ ...p, dailyRate: String(masterQuote.dailyRate) }));
                          setRateManuallyEdited(false);
                        }}
                        className="text-[11px] font-semibold text-teal-400 hover:text-teal-300"
                      >
                        Apply Master Rate (AED {fmt(masterQuote.dailyRate)})
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.dailyRate}
                    onChange={(e) => {
                      setRateManuallyEdited(true);
                      setForm((p) => ({ ...p, dailyRate: e.target.value }));
                    }}
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

              {/* Live Master Price List Extension Quote Panel */}
              {(extDays > 0 || quoteLoading) && (
                <div className="bg-[var(--bg-surface-hover)]/50 border border-teal-500/30 rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-teal-400 uppercase tracking-wider">
                      <Calculator className="w-4 h-4" />
                      <span>Live Master Price List Extension Quote</span>
                    </div>
                    {quoteLoading ? (
                      <span className="text-xs text-[var(--text-muted)] animate-pulse">
                        Calculating tariff…
                      </span>
                    ) : masterQuote ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-teal-500/15 text-teal-300 border border-teal-500/30 font-medium">
                          {masterQuote.ruleName}
                        </span>
                        {masterQuote.appliedRateEvent?.name && (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">
                            <Sparkles className="w-3 h-3" />
                            {masterQuote.appliedRateEvent.name}{' '}
                            {masterQuote.appliedRateEvent.multiplier
                              ? `(${Number(masterQuote.appliedRateEvent.multiplier).toFixed(2)}×)`
                              : ''}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[11px] text-[var(--text-faint)]">
                        Standard agreement rate calculation
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="flex justify-between">
                      <span className="text-sm text-[var(--text-muted)]">Extra Days</span>
                      <span className="text-sm font-bold text-cyan-400">{extDays} days</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-[var(--text-muted)]">Daily Rate</span>
                      <span className="text-sm font-mono font-semibold text-[var(--text-main)]">
                        AED {fmt(dailyR)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-[var(--text-muted)]">Subtotal</span>
                      <span className="text-sm font-mono font-semibold text-[var(--text-main)]">
                        AED {fmt(renewAmt)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-[var(--text-muted)]">5% VAT</span>
                      <span className="text-sm font-mono font-semibold text-amber-400">
                        AED {fmt(vatAmt)}
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-[var(--border-subtle)] pt-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-[var(--text-main)]">
                      Extension Total (incl. 5% VAT)
                    </span>
                    <span className="text-lg font-mono font-bold text-teal-400">
                      AED {fmt(totalAmt)}
                    </span>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className={LABEL_CLS}>Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  rows={2}
                  placeholder="Customer extension request details or authorization notes..."
                  className={INPUT_CLS + ' resize-none'}
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setConflict(null);
                    setModalError('');
                  }}
                  className="px-6 py-2.5 rounded-xl border border-[var(--border-subtle)] text-[var(--text-main)] text-sm hover:bg-[var(--bg-surface-hover)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || extDays <= 0}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {saving ? 'Submitting…' : 'Submit Extension'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RenewalsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="text-[var(--text-muted)] animate-pulse text-sm">
            Loading extensions &amp; renewals…
          </div>
        </div>
      }
    >
      <RenewalsDeskInner />
    </Suspense>
  );
}
