'use client';
import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import SlideOverDrawer, { DrawerTab, DrawerAction } from '@/components/ui/SlideOverDrawer';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import {
  RENTAL_VEHICLE_CATEGORIES,
  formatRentalCategoryLabel,
  normalizeRentalCategory,
} from '@/lib/rental/categories';
import {
  Calendar,
  Car,
  User,
  MapPin,
  FileText,
  ShieldCheck,
  ArrowRightLeft,
  ClipboardCheck,
  Plus,
  Trash2,
  UserPlus,
} from 'lucide-react';

interface Customer {
  id: string;
  fullName: string;
  companyName?: string | null;
  email?: string;
  phone?: string;
  nationality?: string;
}

interface FleetVehicleOption {
  id: string;
  plateNo: string;
  make: string;
  model: string;
  category?: string;
}

interface AncillaryCatalogRow {
  id: string;
  code: string;
  name: string;
  rateAmount: number;
  rateType: string;
}

interface AdditionalDriverDraft {
  fullName: string;
  drivingLicenseNo: string;
  licenseExpiry: string;
  licenseIssuingCountry: string;
  feeAmount: number;
}

interface Booking {
  id: string;
  bookingRef?: string;
  customerId: string;
  customer?: Customer;
  vehicleCategory?: string;
  vehicleId?: string;
  vehicle?: {
    id: string;
    plateNumber?: string | null;
    plateNo?: string | null;
    make?: string | null;
    model?: string | null;
  } | null;
  ancillaries?: Array<{
    id?: string;
    ancillaryId?: string;
    name?: string;
    code?: string;
    quantity: number;
    lineTotal?: number;
  }>;
  additionalDrivers?: Array<{
    id?: string;
    fullName: string;
    drivingLicenseNo: string;
    licenseExpiry?: string | null;
  }>;
  pickupDate: string;
  dropoffDate: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  totalDays?: number;
  dailyRate?: number;
  totalAmount?: number;
  status?: string;
  channel?: string;
  notes?: string;
  createdAt?: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  CONFIRMED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  ACTIVE:    'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  COMPLETED: 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
  CANCELLED: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
};

const CHANNELS = ['DIRECT', 'CORPORATE', 'AGENCY', 'ONLINE'];

const CATEGORY_OPTIONS = RENTAL_VEHICLE_CATEGORIES.map((cat) => {
  const code =
    typeof (cat as unknown) === 'string'
      ? String(cat)
      : String(
          (cat as { value?: string; code?: string }).value ??
            (cat as { code?: string }).code ??
            ''
        );
  return {
    value: code,
    label: formatRentalCategoryLabel(code),
  };
});

function resolveCategoryCode(raw: string | null | undefined): string {
  if (!raw) return '';
  const norm = normalizeRentalCategory(raw);
  if (norm) return norm;
  return raw.trim();
}

function BookingsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [bookings, setBookings]           = useState<Booking[]>([]);
  const [customers, setCustomers]         = useState<Customer[]>([]);
  const [page, setPage]                   = useState(1);
  const [total, setTotal]                 = useState(0);
  const [totalPages, setTotalPages]       = useState(1);
  const [statusFilter, setStatusFilter]   = useState('All');
  const [showModal, setShowModal]         = useState(false);
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [sweeping, setSweeping]           = useState(false);
  const [permitFor, setPermitFor]         = useState<Booking | null>(null);
  const [permitDestination, setPermitDestination] = useState('OMAN');
  const [permitBorder, setPermitBorder]   = useState('');
  const [permitPurpose, setPermitPurpose] = useState('Tourism');

  // Slide-over drawer inspection state
  const [inspectingBooking, setInspectingBooking] = useState<Booking | null>(null);
  const [drawerTab, setDrawerTab] = useState<string>('overview');

  const [formData, setFormData] = useState({
    customerId: '',
    vehicleId: '',
    vehicleCategory: '',
    pickupDate: '',
    dropoffDate: '',
    pickupLocation: '',
    dropoffLocation: '',
    dailyRate: '',
    channel: 'DIRECT',
    notes: '',
  });

  // Ancillaries, Additional Drivers & Concrete Plate Availability state
  const [ancillaryCatalog, setAncillaryCatalog] = useState<AncillaryCatalogRow[]>([]);
  const [ancillaryQtys, setAncillaryQtys] = useState<Record<string, number>>({});
  const [additionalDrivers, setAdditionalDrivers] = useState<AdditionalDriverDraft[]>([]);
  const [driverDraft, setDriverDraft] = useState({
    fullName: '',
    drivingLicenseNo: '',
    licenseExpiry: '',
    licenseIssuingCountry: 'AE',
    feeAmount: '50',
  });
  const [modalVehicles, setModalVehicles] = useState<FleetVehicleOption[]>([]);
  const [loadingModalVehicles, setLoadingModalVehicles] = useState(false);

  // Confirm Booking + Concrete Plate Allocation Modal state
  const [confirmTarget, setConfirmTarget] = useState<Booking | null>(null);
  const [confirmVehicleId, setConfirmVehicleId] = useState('');
  const [confirmVehicles, setConfirmVehicles] = useState<FleetVehicleOption[]>([]);
  const [loadingConfirmVehicles, setLoadingConfirmVehicles] = useState(false);

  const handledParamsRef = useRef<string>('');
  const pendingCustomerNameRef = useRef<string>('');

  const limit = 20;

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/rental/ancillaries', { cache: 'no-store' });
        if (res.ok) {
          const d = await res.json();
          const raw = Array.isArray(d) ? d : (d?.ancillaries ?? d?.data ?? []);
          setAncillaryCatalog(
            (Array.isArray(raw) ? raw : [])
              .filter((a: Record<string, unknown>) => a.isActive !== false)
              .map((a: Record<string, unknown>) => ({
                id: String(a.id ?? ''),
                code: String(a.code ?? ''),
                name: String(a.name ?? 'Extra'),
                rateAmount: Number(a.rateAmount ?? a.rate_amount ?? 0),
                rateType: String(a.rateType ?? a.rate_type ?? 'PER_DAY'),
              })),
          );
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    if (!showModal) return;
    let cancelled = false;
    async function loadModalFleet() {
      setLoadingModalVehicles(true);
      try {
        const today = new Date().toISOString().slice(0, 10);
        const pDate = formData.pickupDate || today;
        const dDate = formData.dropoffDate || pDate;
        const sp = new URLSearchParams({
          pickupDate: pDate,
          dropoffDate: dDate,
          startDate: pDate,
          endDate: dDate,
        });
        if (formData.vehicleCategory) sp.set('category', formData.vehicleCategory);
        const res = await fetch(`/api/rental/availability?${sp.toString()}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const d = await res.json();
        const raw = Array.isArray(d) ? d : (d?.vehicles ?? d?.data ?? []);
        if (cancelled) return;
        setModalVehicles(
          (Array.isArray(raw) ? raw : []).map((v: Record<string, unknown>) => ({
            id: String(v.id ?? ''),
            plateNo: String(v.plateNo ?? v.plateNumber ?? v.plate_no ?? v.registrationNo ?? 'NO-PLATE'),
            make: String(v.make ?? ''),
            model: String(v.model ?? ''),
            category: v.category ? String(v.category) : undefined,
          })),
        );
      } catch {
        if (!cancelled) setModalVehicles([]);
      } finally {
        if (!cancelled) setLoadingModalVehicles(false);
      }
    }
    void loadModalFleet();
    return () => {
      cancelled = true;
    };
  }, [showModal, formData.pickupDate, formData.dropoffDate, formData.vehicleCategory]);

  useEffect(() => {
    if (!confirmTarget) return;
    setConfirmVehicleId(confirmTarget.vehicleId ?? '');
    let cancelled = false;
    async function loadConfirmFleet() {
      setLoadingConfirmVehicles(true);
      try {
        const pDate = confirmTarget!.pickupDate.slice(0, 10);
        const dDate = confirmTarget!.dropoffDate.slice(0, 10);
        const sp = new URLSearchParams({
          pickupDate: pDate,
          dropoffDate: dDate,
          startDate: pDate,
          endDate: dDate,
        });
        if (confirmTarget!.vehicleCategory) sp.set('category', confirmTarget!.vehicleCategory);
        const res = await fetch(`/api/rental/availability?${sp.toString()}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const d = await res.json();
        const raw = Array.isArray(d) ? d : (d?.vehicles ?? d?.data ?? []);
        if (cancelled) return;
        setConfirmVehicles(
          (Array.isArray(raw) ? raw : []).map((v: Record<string, unknown>) => ({
            id: String(v.id ?? ''),
            plateNo: String(v.plateNo ?? v.plateNumber ?? v.plate_no ?? v.registrationNo ?? 'NO-PLATE'),
            make: String(v.make ?? ''),
            model: String(v.model ?? ''),
            category: v.category ? String(v.category) : undefined,
          })),
        );
      } catch {
        if (!cancelled) setConfirmVehicles([]);
      } finally {
        if (!cancelled) setLoadingConfirmVehicles(false);
      }
    }
    void loadConfirmFleet();
    return () => {
      cancelled = true;
    };
  }, [confirmTarget]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const sp = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (statusFilter !== 'All') {
        sp.set('status', statusFilter);
      }
      const [bRes, cRes] = await Promise.all([
        fetch(`/api/rental/bookings?${sp.toString()}`, { cache: 'no-store' }),
        fetch('/api/rental/customers?limit=200', { cache: 'no-store' }),
      ]);
      const [bData, cData] = await Promise.all([
        bRes.json().catch(() => ({})),
        cRes.json().catch(() => ({})),
      ]);

      const bRows: Booking[] = Array.isArray(bData)
        ? bData
        : Array.isArray(bData?.data)
          ? bData.data
          : Array.isArray(bData?.bookings)
            ? bData.bookings
            : [];
      setBookings(bRows);

      const tot = typeof bData?.total === 'number' ? bData.total : bRows.length;
      setTotal(tot);
      setTotalPages(
        typeof bData?.totalPages === 'number'
          ? Math.max(1, bData.totalPages)
          : Math.max(1, Math.ceil(tot / limit))
      );

      const unwrappedCustomers: Customer[] = Array.isArray(cData?.data)
        ? cData.data
        : Array.isArray(cData)
          ? cData
          : Array.isArray(cData?.customers)
            ? cData.customers
            : [];
      setCustomers(unwrappedCustomers);
    } catch {
      setError('Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle deep-link query params:
  // 1) ?from=copilot&data=...
  // 2) ?vehicleId=...&category=...&pickupDate=...&dropoffDate=...
  // 3) ?quoteId=...&customerName=...&category=...&pickupDate=...&dropoffDate=...&dailyRate=...
  // 4) ?id=...
  useEffect(() => {
    const paramSig = searchParams.toString();
    if (!paramSig || handledParamsRef.current === paramSig) return;
    handledParamsRef.current = paramSig;

    const fromParam = searchParams.get('from');
    const dataParam = searchParams.get('data');
    const idParam = searchParams.get('id');
    const quoteId = searchParams.get('quoteId');
    const customerIdParam = searchParams.get('customerId');
    const customerNameParam = searchParams.get('customerName');
    const vehicleIdParam = searchParams.get('vehicleId');
    const categoryParam = searchParams.get('category');
    const pickupDateParam = searchParams.get('pickupDate');
    const dropoffDateParam = searchParams.get('dropoffDate');
    const dailyRateParam = searchParams.get('dailyRate');

    if (fromParam === 'copilot' && dataParam) {
      try {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(dataParam) as Record<string, unknown>;
        } catch {
          parsed = JSON.parse(decodeURIComponent(dataParam)) as Record<string, unknown>;
        }
        const anc = Array.isArray(parsed.ancillaries)
          ? (parsed.ancillaries as Array<{ description?: string; quantity?: number }>)
              .map((a) => `${a.description ?? 'Extra'} ×${a.quantity ?? 1}`)
              .join(', ')
          : '';
        const noteParts = [
          parsed.insuranceTier ? `Insurance: ${parsed.insuranceTier}` : '',
          anc ? `Ancillaries: ${anc}` : '',
          parsed.pricingRationale ? String(parsed.pricingRationale) : '',
        ].filter(Boolean);

        const ch = String(parsed.channel ?? 'DIRECT').toUpperCase();
        setFormData((prev) => ({
          ...prev,
          vehicleCategory: resolveCategoryCode(String(parsed.vehicleCategory ?? '')),
          pickupDate: String(parsed.pickupDate ?? '').slice(0, 10),
          dropoffDate: String(parsed.dropoffDate ?? '').slice(0, 10),
          pickupLocation: String(parsed.pickupLocation ?? ''),
          dropoffLocation: String(parsed.dropoffLocation ?? ''),
          dailyRate:
            parsed.appliedDailyRate != null
              ? String(parsed.appliedDailyRate)
              : parsed.dailyRate != null
                ? String(parsed.dailyRate)
                : '',
          channel: CHANNELS.includes(ch) ? ch : 'DIRECT',
          notes: noteParts.join(' | '),
        }));
        setShowModal(true);
      } catch {
        setError('Could not parse AI Copilot proposal payload');
      }
      return;
    }

    if (quoteId || vehicleIdParam || categoryParam || pickupDateParam || dropoffDateParam) {
      if (customerNameParam && !customerIdParam) {
        pendingCustomerNameRef.current = customerNameParam.trim();
      }
      setFormData((prev) => ({
        ...prev,
        customerId: customerIdParam ?? prev.customerId,
        vehicleId: vehicleIdParam ?? '',
        vehicleCategory: categoryParam ? resolveCategoryCode(categoryParam) : prev.vehicleCategory,
        pickupDate: pickupDateParam ? pickupDateParam.slice(0, 10) : prev.pickupDate,
        dropoffDate: dropoffDateParam ? dropoffDateParam.slice(0, 10) : prev.dropoffDate,
        dailyRate: dailyRateParam ?? prev.dailyRate,
        notes: quoteId
          ? `Converted from Quotation ${quoteId}${customerNameParam ? ` (${customerNameParam})` : ''}`
          : vehicleIdParam
            ? `Selected available vehicle (${vehicleIdParam.slice(0, 8)})`
            : prev.notes,
      }));
      setShowModal(true);
      return;
    }

    if (idParam) {
      (async () => {
        try {
          const res = await fetch(`/api/rental/bookings/${encodeURIComponent(idParam)}`, {
            cache: 'no-store',
          });
          if (res.ok) {
            const d = await res.json();
            const found = (d?.booking ?? d) as Booking;
            if (found?.id) {
              setInspectingBooking(found);
              setDrawerTab('overview');
            }
          }
        } catch {
          /* fallback handled when bookings list loads */
        }
      })();
    }
  }, [searchParams]);

  // Match ?id=... from loaded bookings if single fetch didn't populate yet, and match ?customerName=...
  useEffect(() => {
    const idParam = searchParams.get('id');
    if (idParam && !inspectingBooking && bookings.length > 0) {
      const match = bookings.find((b) => b.id === idParam || b.bookingRef === idParam);
      if (match) {
        setInspectingBooking(match);
        setDrawerTab('overview');
      }
    }
  }, [bookings, inspectingBooking, searchParams]);

  useEffect(() => {
    if (pendingCustomerNameRef.current && customers.length > 0) {
      const target = pendingCustomerNameRef.current.toLowerCase();
      const matched =
        customers.find(
          (c) =>
            c.fullName.toLowerCase() === target ||
            (c.companyName ?? '').toLowerCase() === target
        ) ??
        customers.find(
          (c) =>
            c.fullName.toLowerCase().includes(target) ||
            (c.companyName ?? '').toLowerCase().includes(target)
        );
      if (matched) {
        setFormData((prev) => (prev.customerId ? prev : { ...prev, customerId: matched.id }));
        pendingCustomerNameRef.current = '';
      }
    }
  }, [customers]);

  const addAdditionalDriver = () => {
    if (!driverDraft.fullName.trim() || !driverDraft.drivingLicenseNo.trim() || !driverDraft.licenseExpiry) {
      setError('Additional driver requires full name, license number, and license expiry.');
      return;
    }
    setError('');
    setAdditionalDrivers((prev) => [
      ...prev,
      {
        fullName: driverDraft.fullName.trim(),
        drivingLicenseNo: driverDraft.drivingLicenseNo.trim(),
        licenseExpiry: driverDraft.licenseExpiry,
        licenseIssuingCountry: driverDraft.licenseIssuingCountry.trim().toUpperCase() || 'AE',
        feeAmount: Math.max(0, parseFloat(driverDraft.feeAmount) || 0),
      },
    ]);
    setDriverDraft({
      fullName: '',
      drivingLicenseNo: '',
      licenseExpiry: '',
      licenseIssuingCountry: 'AE',
      feeAmount: '50',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customerId || !formData.vehicleCategory || !formData.pickupDate || !formData.dropoffDate) {
      setError('Please fill all required fields');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const ancillariesPayload = Object.entries(ancillaryQtys)
        .filter(([, q]) => q > 0)
        .map(([ancillaryId, quantity]) => ({ ancillaryId, quantity }));

      const res = await fetch('/api/rental/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: formData.customerId,
          vehicleId: formData.vehicleId || undefined,
          vehicleCategory: formData.vehicleCategory,
          pickupDate: formData.pickupDate,
          dropoffDate: formData.dropoffDate,
          pickupLocation: formData.pickupLocation || undefined,
          dropoffLocation: formData.dropoffLocation || undefined,
          dailyRate: formData.dailyRate ? parseFloat(formData.dailyRate) : undefined,
          channel: formData.channel,
          notes: formData.notes || undefined,
          ...(ancillariesPayload.length > 0 ? { ancillaries: ancillariesPayload } : {}),
          ...(additionalDrivers.length > 0 ? { additionalDrivers } : {}),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? 'Failed to create booking');
      if (d.workflow?.status === 'IN_PROGRESS') {
        alert(`Booking ${d.bookingRef ?? ''} sent for approval through "${d.workflow.name}"${d.workflow.level ? `, waiting for "${d.workflow.level}"` : ''}. It can be confirmed once approved.`);
      }
      setShowModal(false);
      setFormData({
        customerId: '',
        vehicleId: '',
        vehicleCategory: '',
        pickupDate: '',
        dropoffDate: '',
        pickupLocation: '',
        dropoffLocation: '',
        dailyRate: '',
        channel: 'DIRECT',
        notes: '',
      });
      setAncillaryQtys({});
      setAdditionalDrivers([]);
      loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create booking');
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (id: string, action: 'confirm' | 'activate' | 'complete' | 'cancel', extra?: Record<string, unknown>) => {
    setActionLoading(`${id}:${action}`);
    try {
      const res = await fetch(`/api/rental/bookings/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extra ?? {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed to ${action} booking (HTTP ${res.status})`);

      if (inspectingBooking && inspectingBooking.id === id) {
        setInspectingBooking(prev => prev ? { ...prev, status: data.booking?.status || action.toUpperCase() } : null);
      }
      loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : `Failed to ${action} booking`);
      loadData();
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = statusFilter === 'All'
    ? bookings
    : bookings.filter(b => (b.status ?? 'PENDING').toUpperCase() === statusFilter);

  const runPenaltySweep = async () => {
    setSweeping(true);
    try {
      const res = await fetch('/api/rental/bookings/sweep-penalties', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Sweep failed (HTTP ${res.status})`);
      alert(
        `Sweep complete:\n` +
        `  ${data.noShow ?? 0} no-show flipped & charged\n` +
        `  ${data.lateReturn ?? 0} late-return charged\n` +
        `  ${data.skipped ?? 0} skipped (already today)\n` +
        `  ${data.errors?.length ?? 0} errors`
      );
      loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Sweep failed');
    } finally {
      setSweeping(false);
    }
  };

  const DRAWER_TABS: DrawerTab[] = [
    { id: 'overview', label: 'Overview', icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'customer', label: 'Customer', icon: <User className="w-3.5 h-3.5" /> },
    { id: 'compliance', label: 'Cross-Border Permit', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  ];

  const getDrawerActions = (b: Booking): DrawerAction[] => {
    const status = (b.status ?? 'PENDING').toUpperCase();
    const actions: DrawerAction[] = [];

    actions.push({
      label: 'Vehicle Inspection →',
      variant: 'secondary',
      onClick: () => router.push(`/rental/bookings/${b.id}/inspect`),
    });
    if (status === 'PENDING' || status === 'CONFIRMED') {
      actions.push({
        label: 'Go to Counter Handover →',
        variant: 'primary',
        onClick: () => router.push(`/rental/counter?bookingId=${b.id}`),
      });
    }
    if (status === 'PENDING') {
      actions.push({
        label: 'Confirm & Assign Plate',
        variant: 'primary',
        onClick: () => setConfirmTarget(b),
      });
    }
    if (status === 'CONFIRMED' || status === 'PENDING') {
      actions.push({
        label: 'Activate (Handover)',
        variant: 'secondary',
        onClick: () => handleAction(b.id, 'activate'),
      });
    }
    if (status === 'CONFIRMED' || status === 'ACTIVE') {
      actions.push({
        label: 'Issue Permit',
        variant: 'secondary',
        onClick: () => { setPermitFor(b); },
      });
    }
    if (status === 'ACTIVE') {
      actions.push({
        label: 'Complete Return',
        variant: 'secondary',
        onClick: () => handleAction(b.id, 'complete'),
      });
    }
    if (!['COMPLETED', 'CANCELLED'].includes(status)) {
      actions.push({
        label: 'Cancel Booking',
        variant: 'danger',
        onClick: () => {
          if (confirm('Cancel this booking?')) {
            handleAction(b.id, 'cancel', { reason: 'User requested' });
          }
        },
      });
    }
    return actions;
  };

  if (loading && bookings.length === 0) return (
    <div className="flex items-center justify-center h-full min-h-[300px]">
      <div className="text-[var(--text-muted)] animate-pulse font-medium">Loading bookings...</div>
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mb-1">Rental Bookings</h1>
          <p className="text-[var(--text-muted)] text-xs">
            Manage all rental reservations &amp; fleet allocation — {total} total
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={runPenaltySweep}
            disabled={sweeping}
            title="Detect no-show + late-return bookings and apply penalty fees"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20 transition-all disabled:opacity-50"
          >
            {sweeping ? 'Sweeping…' : '⚠ Run Penalty Sweep'}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-xs font-semibold text-white hover:opacity-90 transition-all shadow-sm"
          >
            + New Booking
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      <StatGrid cols={5}>
        {(['All', 'PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED'] as const).map((s, idx) => {
          const accents = ['slate', 'amber', 'cyan', 'emerald', 'violet'] as const;
          return (
            <KpiCard
              key={s}
              label={s === 'All' ? 'All Bookings' : s.charAt(0) + s.slice(1).toLowerCase()}
              value={s === 'All' ? total : bookings.filter(b => (b.status ?? 'PENDING') === s).length}
              accent={accents[idx % accents.length]}
              active={statusFilter === s}
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
            />
          );
        })}
      </StatGrid>

      {/* Bookings Table */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 overflow-x-auto shadow-sm">
        {filtered.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-12 text-sm">No bookings found</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Ref</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Customer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Category</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Pickup</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Return</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Days</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => {
                const status = (b.status ?? 'PENDING').toUpperCase();
                const isActing = actionLoading?.startsWith(b.id);
                return (
                  <tr
                    key={b.id}
                    onClick={() => { setInspectingBooking(b); setDrawerTab('overview'); }}
                    className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer group"
                  >
                    <td className="px-4 py-4 text-sm font-semibold font-mono text-emerald-500">
                      {b.bookingRef ?? b.id.slice(0,8)}
                    </td>
                    <td className="px-4 py-4 text-sm font-medium text-[var(--text-main)]">
                      {b.customer?.companyName ?? b.customer?.fullName ?? b.customerId}
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--text-main)]">
                      <div className="flex flex-col gap-1 items-start">
                        <span className="px-2 py-0.5 rounded-md bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-xs font-medium">
                          {b.vehicleCategory ? formatRentalCategoryLabel(b.vehicleCategory) : '-'}
                        </span>
                        {(b.vehicle?.plateNumber || b.vehicle?.plateNo) && (
                          <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-[11px] font-mono text-cyan-300">
                            🚗 {b.vehicle.plateNumber ?? b.vehicle.plateNo}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--text-muted)]">{new Date(b.pickupDate).toLocaleDateString()}</td>
                    <td className="px-4 py-4 text-sm text-[var(--text-muted)]">{new Date(b.dropoffDate).toLocaleDateString()}</td>
                    <td className="px-4 py-4 text-sm text-[var(--text-main)] font-medium">{b.totalDays ?? '-'}</td>
                    <td className="px-4 py-4 text-sm font-semibold text-[var(--text-main)]">
                      {b.totalAmount ? `AED ${Number(b.totalAmount).toLocaleString()}` : '-'}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[status] ?? STATUS_COLORS.PENDING}`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-2 flex-wrap items-center">
                        <button
                          onClick={() => { setInspectingBooking(b); setDrawerTab('overview'); }}
                          className="text-xs px-2 py-1 rounded bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] border border-[var(--border-subtle)]"
                          title="Inspect booking details"
                        >
                          Details ↗
                        </button>
                        {status === 'PENDING' && (
                          <button
                            onClick={() => setConfirmTarget(b)}
                            disabled={!!isActing}
                            className="text-xs px-2.5 py-1 rounded bg-blue-500/20 text-blue-300 border border-blue-500/35 hover:bg-blue-500/30 disabled:opacity-50 font-semibold"
                          >
                            Confirm &amp; Plate
                          </button>
                        )}
                        {(status === 'CONFIRMED' || status === 'PENDING') && (
                          <Link
                            href={`/rental/counter?bookingId=${b.id}`}
                            className="text-xs px-2.5 py-1 rounded bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/35 font-semibold"
                          >
                            Go to Counter Handover →
                          </Link>
                        )}
                        {(status === 'CONFIRMED' || status === 'ACTIVE') && (
                          <button
                            onClick={() => setPermitFor(b)}
                            className="text-xs px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 font-medium"
                            title="Issue cross-border travel permit"
                          >
                            Permit
                          </button>
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs font-medium hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-xs text-[var(--text-muted)]">
            Page {page} of {totalPages} ({total} bookings)
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs font-medium hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}

      {/* Slide-Over BookingDetailDrawer */}
      {inspectingBooking && (
        <SlideOverDrawer
          isOpen={!!inspectingBooking}
          onClose={() => setInspectingBooking(null)}
          title={`Booking ${inspectingBooking.bookingRef ?? inspectingBooking.id.slice(0, 8)}`}
          subtitle={`ID: ${inspectingBooking.id}`}
          badge={{
            text: (inspectingBooking.status ?? 'PENDING').toUpperCase(),
            variant: (inspectingBooking.status === 'ACTIVE' ? 'emerald' : inspectingBooking.status === 'CONFIRMED' ? 'blue' : inspectingBooking.status === 'COMPLETED' ? 'slate' : 'amber'),
          }}
          tabs={DRAWER_TABS}
          activeTab={drawerTab}
          onTabChange={setDrawerTab}
          actions={getDrawerActions(inspectingBooking)}
          width="xl"
        >
          {drawerTab === 'overview' && (
            <div className="space-y-6">
              {/* Quick Operational Workflow Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Link
                  href={`/rental/bookings/${inspectingBooking.id}/inspect`}
                  className="inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-blue-500/15 border border-blue-500/35 text-blue-300 hover:bg-blue-500/25 text-xs font-semibold transition-colors"
                >
                  <ClipboardCheck className="w-4 h-4" />
                  Vehicle Inspection →
                </Link>
                <Link
                  href={`/rental/counter?bookingId=${inspectingBooking.id}`}
                  className="inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-teal-500/15 border border-teal-500/35 text-teal-300 hover:bg-teal-500/25 text-xs font-semibold transition-colors"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  Counter Handover →
                </Link>
              </div>

              {/* Top Highlights Banner */}
              <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)]">
                <div>
                  <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold">Total Amount</div>
                  <div className="text-lg font-bold text-emerald-500 mt-0.5">
                    {inspectingBooking.totalAmount ? `AED ${Number(inspectingBooking.totalAmount).toLocaleString()}` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold">Duration</div>
                  <div className="text-lg font-bold text-[var(--text-main)] mt-0.5">
                    {inspectingBooking.totalDays ? `${inspectingBooking.totalDays} Days` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold">Daily Rate</div>
                  <div className="text-lg font-bold text-[var(--text-main)] mt-0.5">
                    {inspectingBooking.dailyRate ? `AED ${inspectingBooking.dailyRate}/day` : '—'}
                  </div>
                </div>
              </div>

              {/* Booking Schedule */}
              <div>
                <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-3">Schedule &amp; Locations</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-emerald-500 font-semibold">
                      <Calendar className="w-3.5 h-3.5" /> Pickup Schedule
                    </div>
                    <div className="text-sm font-bold text-[var(--text-main)]">
                      {new Date(inspectingBooking.pickupDate).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-[var(--text-muted)]" />
                      {inspectingBooking.pickupLocation || 'Main Hub / Desk'}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-amber-500 font-semibold">
                      <Calendar className="w-3.5 h-3.5" /> Return Schedule
                    </div>
                    <div className="text-sm font-bold text-[var(--text-main)]">
                      {new Date(inspectingBooking.dropoffDate).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-[var(--text-muted)]" />
                      {inspectingBooking.dropoffLocation || 'Main Hub / Desk'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Vehicle & Channel details */}
              <div>
                <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-3">Category &amp; Channel</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <div className="text-xs text-[var(--text-muted)]">Vehicle Category</div>
                    <div className="text-sm font-bold text-[var(--text-main)] mt-1 flex items-center gap-2">
                      <Car className="w-4 h-4 text-emerald-500" />
                      {inspectingBooking.vehicleCategory
                        ? formatRentalCategoryLabel(inspectingBooking.vehicleCategory)
                        : 'Not specified'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <div className="text-xs text-[var(--text-muted)]">Booking Channel</div>
                    <div className="text-sm font-bold text-[var(--text-main)] mt-1">
                      {inspectingBooking.channel || 'DIRECT'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {inspectingBooking.notes && (
                <div>
                  <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Remarks &amp; Notes</h3>
                  <div className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/50 text-xs text-[var(--text-main)] leading-relaxed">
                    {inspectingBooking.notes}
                  </div>
                </div>
              )}
            </div>
          )}

          {drawerTab === 'customer' && (
            <div className="space-y-6">
              <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center font-bold text-lg flex-shrink-0">
                  {inspectingBooking.customer?.fullName?.charAt(0) || 'C'}
                </div>
                <div>
                  <div className="text-base font-bold text-[var(--text-main)]">
                    {inspectingBooking.customer?.companyName || inspectingBooking.customer?.fullName || inspectingBooking.customerId}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] font-mono">
                    Customer ID: {inspectingBooking.customerId}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Full Name</span>
                  <span className="text-xs font-semibold text-[var(--text-main)]">{inspectingBooking.customer?.fullName ?? '—'}</span>
                </div>
                <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Email Address</span>
                  <span className="text-xs font-semibold text-[var(--text-main)]">{inspectingBooking.customer?.email ?? 'Not provided'}</span>
                </div>
                <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Phone Number</span>
                  <span className="text-xs font-semibold text-[var(--text-main)]">{inspectingBooking.customer?.phone ?? 'Not provided'}</span>
                </div>
              </div>
            </div>
          )}

          {drawerTab === 'compliance' && (
            <div className="space-y-5">
              <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs leading-relaxed">
                Issue official bilingual cross-border authorization permits for vehicles travelling from UAE into Oman, Saudi Arabia, Bahrain, Qatar or Kuwait.
              </div>
              <button
                onClick={() => setPermitFor(inspectingBooking)}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 text-white font-semibold text-xs hover:opacity-90 transition-opacity flex items-center justify-center gap-2 shadow-sm"
              >
                <ShieldCheck className="w-4 h-4" /> Open Permit Generator Modal
              </button>
            </div>
          )}

        </SlideOverDrawer>
      )}

      {/* New Booking Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[var(--text-main)]">New Booking</h2>
              <button onClick={() => setShowModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-sm">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formData.vehicleId && (
                <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
                  <span>Pre-selected Vehicle ID: <strong className="font-mono">{formData.vehicleId}</strong></span>
                  <button
                    type="button"
                    onClick={() => setFormData((p) => ({ ...p, vehicleId: '' }))}
                    className="text-emerald-300 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Customer *</label>
                  <SearchableSelect
                    value={formData.customerId}
                    onChange={(val) => setFormData(p => ({ ...p, customerId: val }))}
                    placeholder="Select customer..."
                    searchPlaceholder="Type customer name, phone, or email..."
                    accent="emerald"
                    isClearable
                    options={customers.map(c => ({
                      value: c.id,
                      label: c.companyName ? `${c.companyName} (${c.fullName})` : c.fullName,
                      sublabel: [c.phone, c.email].filter(Boolean).join(' • ') || undefined,
                      badge: c.nationality,
                    }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Vehicle Category *</label>
                  <SearchableSelect
                    value={formData.vehicleCategory}
                    onChange={(val) => setFormData(p => ({ ...p, vehicleCategory: val }))}
                    placeholder="Select category..."
                    searchPlaceholder="Type category..."
                    accent="emerald"
                    options={CATEGORY_OPTIONS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Pickup Date *</label>
                  <input type="date" value={formData.pickupDate} onChange={e => setFormData(p => ({...p, pickupDate: e.target.value}))} required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Return Date *</label>
                  <input type="date" value={formData.dropoffDate} onChange={e => setFormData(p => ({...p, dropoffDate: e.target.value}))} required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Pickup Location</label>
                  <input type="text" value={formData.pickupLocation} onChange={e => setFormData(p => ({...p, pickupLocation: e.target.value}))} placeholder="e.g., Dubai Airport"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs placeholder-[var(--text-muted)] focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Return Location</label>
                  <input type="text" value={formData.dropoffLocation} onChange={e => setFormData(p => ({...p, dropoffLocation: e.target.value}))} placeholder="e.g., Downtown Dubai"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs placeholder-[var(--text-muted)] focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Daily Rate (AED)</label>
                  <input type="number" value={formData.dailyRate} onChange={e => setFormData(p => ({...p, dailyRate: e.target.value}))} placeholder="150" min="0" step="0.01"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs placeholder-[var(--text-muted)] focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Channel</label>
                  <select value={formData.channel} onChange={e => setFormData(p => ({...p, channel: e.target.value}))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs focus:border-emerald-500 focus:outline-none">
                    {CHANNELS.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">
                    Concrete Vehicle Plate (Optional — Allocate Now or at Confirm/Handover)
                  </label>
                  <select
                    value={formData.vehicleId}
                    onChange={(e) => setFormData((p) => ({ ...p, vehicleId: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="">
                      {loadingModalVehicles
                        ? 'Checking fleet availability…'
                        : '— Allocate plate later (confirm / counter handover) —'}
                    </option>
                    {modalVehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plateNo} — {v.make} {v.model}
                        {v.category ? ` (${v.category})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Ancillaries Catalog Toggles */}
              {ancillaryCatalog.length > 0 && (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 p-3.5 space-y-2">
                  <div className="text-xs font-semibold text-[var(--text-muted)]">
                    Ancillaries &amp; Optional Add-Ons
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {ancillaryCatalog.map((anc) => {
                      const qty = ancillaryQtys[anc.id] ?? 0;
                      return (
                        <div
                          key={anc.id}
                          className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs ${
                            qty > 0
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                              : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-main)]'
                          }`}
                        >
                          <div className="truncate pr-2">
                            <div className="font-medium truncate">{anc.name}</div>
                            <div className="text-[10px] text-[var(--text-muted)] font-mono">
                              AED {anc.rateAmount}/{anc.rateType === 'PER_RENTAL' ? 'trip' : 'day'}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                setAncillaryQtys((p) => ({
                                  ...p,
                                  [anc.id]: Math.max(0, (p[anc.id] ?? 0) - 1),
                                }))
                              }
                              className="w-6 h-6 rounded bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-xs font-bold"
                            >
                              -
                            </button>
                            <span className="w-4 text-center font-mono font-bold">{qty}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setAncillaryQtys((p) => ({
                                  ...p,
                                  [anc.id]: (p[anc.id] ?? 0) + 1,
                                }))
                              }
                              className="w-6 h-6 rounded bg-emerald-600/40 border border-emerald-500/40 text-xs font-bold text-white"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Additional Drivers Builder */}
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 p-3.5 space-y-2.5">
                <div className="text-xs font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5 text-emerald-400" />
                  Additional Authorized Drivers ({additionalDrivers.length})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <input
                    type="text"
                    placeholder="Driver full name"
                    value={driverDraft.fullName}
                    onChange={(e) => setDriverDraft((p) => ({ ...p, fullName: e.target.value }))}
                    className="px-2.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)]"
                  />
                  <input
                    type="text"
                    placeholder="License #"
                    value={driverDraft.drivingLicenseNo}
                    onChange={(e) => setDriverDraft((p) => ({ ...p, drivingLicenseNo: e.target.value }))}
                    className="px-2.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-mono text-[var(--text-main)]"
                  />
                  <input
                    type="date"
                    value={driverDraft.licenseExpiry}
                    onChange={(e) => setDriverDraft((p) => ({ ...p, licenseExpiry: e.target.value }))}
                    className="px-2.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)]"
                  />
                  <button
                    type="button"
                    onClick={addAdditionalDriver}
                    className="px-3 py-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white text-xs font-semibold flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Driver
                  </button>
                </div>
                {additionalDrivers.length > 0 && (
                  <div className="space-y-1">
                    {additionalDrivers.map((drv, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs"
                      >
                        <span>
                          <strong>{drv.fullName}</strong> · Lic{' '}
                          <span className="font-mono">{drv.drivingLicenseNo}</span> (Exp {drv.licenseExpiry})
                        </span>
                        <button
                          type="button"
                          onClick={() => setAdditionalDrivers((p) => p.filter((_, i) => i !== idx))}
                          className="text-rose-400 hover:text-rose-200"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Notes</label>
                <textarea value={formData.notes} onChange={e => setFormData(p => ({...p, notes: e.target.value}))} rows={2} placeholder="Additional notes..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs placeholder-[var(--text-muted)] focus:border-emerald-500 focus:outline-none resize-none" />
              </div>
              <div className="flex gap-3 justify-end pt-4">
                <button type="button" onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-main)] text-xs hover:bg-[var(--bg-surface-hover)]">Cancel</button>
                <button type="submit" disabled={saving}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold text-xs hover:opacity-90 disabled:opacity-50 shadow-sm">
                  {saving ? 'Creating...' : 'Create Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Booking & Concrete Vehicle Plate Allocation Modal */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--text-main)]">
                Confirm Booking &amp; Assign Vehicle Plate
              </h2>
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-sm"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Confirming{' '}
              <span className="font-mono font-bold text-emerald-400">
                {confirmTarget.bookingRef ?? confirmTarget.id.slice(0, 8)}
              </span>{' '}
              for {confirmTarget.customer?.companyName ?? confirmTarget.customer?.fullName ?? 'customer'}. Selecting a concrete plate locks it as <code className="font-mono">RESERVED</code> for this booking window.
            </p>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">
                Concrete Fleet Vehicle Plate ({confirmTarget.vehicleCategory ?? 'Any Category'})
              </label>
              <select
                value={confirmVehicleId}
                onChange={(e) => setConfirmVehicleId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs"
              >
                <option value="">
                  {loadingConfirmVehicles
                    ? 'Loading available fleet…'
                    : '— Confirm category-only (assign plate at Counter Handover) —'}
                </option>
                {confirmVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plateNo} — {v.make} {v.model}
                    {v.category ? ` (${v.category})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                className="px-4 py-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-main)] text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading === `${confirmTarget.id}:confirm`}
                onClick={async () => {
                  const target = confirmTarget;
                  setConfirmTarget(null);
                  await handleAction(
                    target.id,
                    'confirm',
                    confirmVehicleId ? { vehicleId: confirmVehicleId } : {},
                  );
                }}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs disabled:opacity-50"
              >
                {confirmVehicleId ? 'Confirm & Reserve Plate' : 'Confirm Booking'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cross-border permit modal */}
      {permitFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-[var(--text-main)]">Cross-Border Permit</h2>
              <button onClick={() => setPermitFor(null)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-lg">×</button>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-6">
              For booking <span className="font-mono text-emerald-500 font-bold">{permitFor.bookingRef ?? permitFor.id.slice(0,8)}</span>
              {' · '}{permitFor.customer?.fullName ?? '—'}
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Destination *</label>
                <select value={permitDestination} onChange={e => setPermitDestination(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs focus:border-amber-500 focus:outline-none">
                  <option value="OMAN">Sultanate of Oman</option>
                  <option value="KSA">Kingdom of Saudi Arabia</option>
                  <option value="BAHRAIN">Kingdom of Bahrain</option>
                  <option value="QATAR">State of Qatar</option>
                  <option value="KUWAIT">State of Kuwait</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Border Crossing</label>
                <input type="text" value={permitBorder} onChange={e => setPermitBorder(e.target.value)}
                  placeholder="e.g., Hatta / Wajaja"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs placeholder-[var(--text-muted)] focus:border-amber-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Purpose</label>
                <input type="text" value={permitPurpose} onChange={e => setPermitPurpose(e.target.value)}
                  placeholder="Tourism / Business / Family Visit"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs placeholder-[var(--text-muted)] focus:border-amber-500 focus:outline-none" />
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Validity defaults to the booking pickup → drop-off window. PDF opens in a new tab; bilingual EN + AR available.
              </p>
            </div>
            <div className="flex gap-3 justify-end pt-6 mt-4 border-t border-[var(--border-subtle)]">
              <button onClick={() => setPermitFor(null)} className="px-4 py-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-main)] text-xs hover:bg-[var(--bg-surface-hover)]">Close</button>
              {(['en','ar'] as const).map(lng => (
                <a key={lng}
                  href={`/api/rental/bookings/${permitFor.id}/cross-border-permit?lang=${lng}&destination=${permitDestination}` +
                        `${permitBorder ? `&border=${encodeURIComponent(permitBorder)}` : ''}` +
                        `${permitPurpose ? `&purpose=${encodeURIComponent(permitPurpose)}` : ''}`}
                  target="_blank" rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 text-white text-xs font-semibold hover:opacity-90 shadow-sm"
                >
                  Issue · {lng.toUpperCase()}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BookingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full min-h-[300px]">
          <div className="text-[var(--text-muted)] animate-pulse font-medium">Loading bookings...</div>
        </div>
      }
    >
      <BookingsPageInner />
    </Suspense>
  );
}
