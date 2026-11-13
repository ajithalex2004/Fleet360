'use client';

/**
 * Grounded AI Rental Co-pilot — describe a rental in plain English or Arabic,
 * get an authoritative quote grounded in tenant PricingRules, RateEvents,
 * Ancillaries Master, and real Fleet availability, then create a booking in 1 click.
 */

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Sparkles,
  ChevronLeft,
  AlertTriangle,
  CheckCircle2,
  Car,
  ShieldCheck,
  Tag,
  ArrowUpRight,
  UserPlus,
  Search,
  Fuel,
  Gauge,
  Languages,
  CalendarRange,
} from 'lucide-react';
import { BACK_BUTTON } from '@/lib/ui/toggle';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';
import {
  RENTAL_VEHICLE_CATEGORIES,
  formatRentalCategoryLabel,
  normalizeRentalCategory,
} from '@/lib/rental/categories';

interface GroundedAncillary {
  ancillaryId?: string | null;
  code: string;
  nameEn?: string;
  nameAr?: string | null;
  description: string;
  quantity: number;
  unitCharge: number;
  isOneTime: boolean;
  pricingType?: string;
  totalCharge: number;
  source?: 'TENANT_CATALOGUE' | 'SYSTEM_TARIFF_FALLBACK';
}

interface Suggestion {
  vehicleCategory: string;
  exampleVehicles: string[];
  pickupLocation: string;
  dropoffLocation: string;
  pickupDate: string;
  dropoffDate: string;
  totalDays: number;
  channel: 'DIRECT' | 'CORPORATE' | 'AGENCY' | 'ONLINE';
  baseDailyRate: number;
  appliedDailyRate: number;
  lorDiscountPct: number;
  baseRentalCharge: number;
  insuranceTier: 'MINIMUM' | 'CDW' | 'LDW' | 'TP' | 'PAI' | 'SUPER_CDW';
  insuranceCharge: number;
  ancillaries: GroundedAncillary[];
  ancillariesTotal: number;
  subTotal: number;
  vatPct: number;
  vatAmount: number;
  totalAmount: number;
  securityDeposit: number;
  pricingRationale: string;
  detectedLanguage: 'en' | 'ar' | 'mixed';
  confidence: 'low' | 'medium' | 'high';
  warnings: string[];
}

interface AvailableVehicle {
  id: string;
  licensePlate: string;
  make: string;
  model: string;
  year: number | null;
  category: string;
  status: string;
  fuelPct: number;
  odometerKm: number | null;
  branchId: string | null;
}

interface AppliedPricingRule {
  id: string;
  name: string;
  vehicleCategory: string;
  baseDailyRate: number;
  weeklyRate: number | null;
  monthlyRate: number | null;
  includedKmPerDay: number;
  excessKmRate: number;
  gracePeriodMin: number;
}

interface ActiveRateEvent {
  id: string;
  eventCode: string;
  name: string;
  dateFrom: string;
  dateTo: string;
  multiplier: number;
  flatSurcharge: number;
  isApplied: boolean;
}

interface YieldLayer {
  layer: string;
  label: string;
  multiplier: number;
  dailyRateBefore: number;
  dailyRateAfter: number;
  rationale: string;
}

interface QuoteBreakdown {
  appliedRuleId: string | null;
  ruleName: string;
  appliedEventCode?: string | null;
  appliedEventName?: string | null;
  vehicleCategory: string;
  totalDays: number;
  currency: string;
  dailyRate: number;
  baseRentalCharge: number;
  insurancePlanCode: string | null;
  insuranceDailyRate: number;
  insuranceCharge: number;
  extraCharges: number;
  subtotal: number;
  promoCode: string | null;
  discountPct: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  includedKmPerDay: number;
  excessKmRate: number;
  gracePeriodMin: number;
  yieldTrace?: YieldLayer[];
}

interface UpgradeAlternative {
  vehicleCategory: string;
  categoryLabel: string;
  availableCount: number;
  availableVehicles: AvailableVehicle[];
  quoteBreakdown: QuoteBreakdown;
  dailyRate: number;
  totalAmount: number;
  rateDeltaPerDay: number;
  totalDeltaAmount: number;
  reasonEn: string;
  reasonAr: string;
}

interface Meta {
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

interface CustomerOption {
  id: string;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  customerType?: string | null;
  blacklisted?: boolean | null;
}

interface CreatedBookingSummary {
  id: string;
  bookingRef: string | null;
  status: string | null;
  vehicleCategory: string | null;
  vehicleId: string | null;
  pickupDate: string;
  dropoffDate: string;
  totalDays: number | null;
  dailyRate: number;
  totalAmount: number;
  currency: string;
}

const EXAMPLES = [
  {
    label: 'Tourist family + Oman NOC (EN)',
    brief:
      'Saudi tourist family, 2 adults + 3 kids, need a full-size SUV from DXB airport pickup this Saturday morning until next Friday evening. Add GPS, 2 child seats, full insurance, planning a trip to Oman.',
  },
  {
    label: 'Corporate weekly (EN)',
    brief:
      'Corporate client needs a mid-size sedan for visiting consultant, weekly rental Mon-Fri, pickup from Sharjah office, return to same. Standard insurance, no extras. Direct billing to company.',
  },
  {
    label: 'Quick weekend under-25 (EN)',
    brief:
      'Weekend self-drive, 2 days, compact car for a single driver under 25, Dubai City pickup, no airport. Just basic insurance.',
  },
  {
    label: 'رحلة فاخرة (AR)',
    brief:
      'سيارة فاخرة لمدة 10 أيام، استلام من فندق في دبي، تأمين شامل، سائق إضافي، جهاز واي فاي.',
  },
];

const CATEGORY_PALETTE = [
  'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  'bg-blue-500/20 text-blue-300 border-blue-500/40',
  'bg-teal-500/20 text-teal-300 border-teal-500/40',
  'bg-violet-500/20 text-violet-300 border-violet-500/40',
  'bg-amber-500/20 text-amber-300 border-amber-500/40',
  'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40',
  'bg-orange-500/20 text-orange-300 border-orange-500/40',
  'bg-rose-500/20 text-rose-300 border-rose-500/40',
];

const CATEGORY_COLORS: Record<string, string> = Object.fromEntries(
  RENTAL_VEHICLE_CATEGORIES.map((cat, idx) => [
    cat.value,
    CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length],
  ]),
);

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  medium: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  low: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

export default function RentalCopilotPage() {
  const router = useRouter();
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [quoteBreakdown, setQuoteBreakdown] = useState<QuoteBreakdown | null>(null);
  const [availableVehicles, setAvailableVehicles] = useState<AvailableVehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');
  const [appliedPricingRule, setAppliedPricingRule] = useState<AppliedPricingRule | null>(null);
  const [activeRateEvents, setActiveRateEvents] = useState<ActiveRateEvent[]>([]);
  const [groundedAncillaries, setGroundedAncillaries] = useState<GroundedAncillary[]>([]);
  const [upgradeAlternative, setUpgradeAlternative] = useState<UpgradeAlternative | null>(null);
  const [explanation, setExplanation] = useState<{ en: string; ar: string } | null>(null);
  const [explanationLang, setExplanationLang] = useState<'en' | 'ar'>('en');
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 1-Click Booking Modal / Panel State
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [customerMode, setCustomerMode] = useState<'EXISTING' | 'NEW'>('EXISTING');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [newCustomer, setNewCustomer] = useState({
    fullName: '',
    phone: '',
    email: '',
    nationality: 'UAE',
    drivingLicenseNo: '',
    licenseExpiry: '',
  });
  const [bookingStatus, setBookingStatus] = useState<'CONFIRMED' | 'PENDING'>('CONFIRMED');
  const [bookingNotes, setBookingNotes] = useState('');
  const [creatingBooking, setCreatingBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [createdBooking, setCreatedBooking] = useState<CreatedBookingSummary | null>(null);

  useEffect(() => {
    if (!showBookingModal || customerMode !== 'EXISTING') return;
    let cancelled = false;
    async function loadCustomers() {
      setLoadingCustomers(true);
      try {
        const qs = customerQuery.trim()
          ? `?search=${encodeURIComponent(customerQuery.trim())}`
          : '';
        const res = await fetch(`/api/rental/customers${qs}`);
        if (!res.ok) return;
        const data = await res.json();
        const list: CustomerOption[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.customers)
            ? data.customers
            : Array.isArray(data?.items)
              ? data.items
              : [];
        if (!cancelled) {
          const eligible = list.filter((c) => !c.blacklisted);
          setCustomerResults(eligible.slice(0, 25));
          if (!selectedCustomerId && eligible.length > 0) {
            setSelectedCustomerId(eligible[0].id);
          }
        }
      } catch {
        // non-fatal; user can switch to Quick Walk-In Customer
      } finally {
        if (!cancelled) setLoadingCustomers(false);
      }
    }
    const timer = setTimeout(loadCustomers, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showBookingModal, customerMode, customerQuery, selectedCustomerId]);

  async function handleGenerate() {
    if (brief.trim().length < 10) {
      setError("Please describe the customer's rental needs in at least one sentence.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuggestion(null);
    setQuoteBreakdown(null);
    setAvailableVehicles([]);
    setSelectedVehicleId('');
    setAppliedPricingRule(null);
    setActiveRateEvents([]);
    setGroundedAncillaries([]);
    setUpgradeAlternative(null);
    setExplanation(null);
    setCreatedBooking(null);
    setShowBookingModal(false);
    setMeta(null);

    try {
      const res = await fetch('/api/rental/bookings/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Server returned ${res.status}`);
        return;
      }
      const sug: Suggestion = data.suggestion;
      setSuggestion(sug);
      setQuoteBreakdown(data.quoteBreakdown ?? null);
      const vehs: AvailableVehicle[] = Array.isArray(data.availableVehicles)
        ? data.availableVehicles
        : [];
      setAvailableVehicles(vehs);
      setSelectedVehicleId(vehs[0]?.id ?? '');
      setAppliedPricingRule(data.appliedPricingRule ?? null);
      setActiveRateEvents(Array.isArray(data.activeRateEvents) ? data.activeRateEvents : []);
      setGroundedAncillaries(
        Array.isArray(data.ancillaries) ? data.ancillaries : sug.ancillaries ?? [],
      );
      setUpgradeAlternative(data.upgradeAlternative ?? null);
      setExplanation(data.explanation ?? null);
      setExplanationLang(sug.detectedLanguage === 'ar' ? 'ar' : 'en');
      setPromoCode(data.grounded?.intent?.promoCode ?? data.quoteBreakdown?.promoCode ?? null);
      setMeta(data.meta ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  function handleSwitchToUpgrade() {
    if (!suggestion || !upgradeAlternative) return;
    const up = upgradeAlternative;
    const qb = up.quoteBreakdown;
    const ancTotal = groundedAncillaries.reduce((s, a) => s + a.totalCharge, 0);

    setSuggestion({
      ...suggestion,
      vehicleCategory: up.vehicleCategory,
      exampleVehicles: up.availableVehicles
        .slice(0, 5)
        .map((v) => `${v.make} ${v.model} (${v.licensePlate})`),
      baseDailyRate: qb.dailyRate,
      appliedDailyRate: qb.dailyRate,
      lorDiscountPct: 0,
      baseRentalCharge: qb.baseRentalCharge,
      insuranceCharge: qb.insuranceCharge,
      ancillariesTotal: ancTotal,
      subTotal: qb.subtotal,
      vatPct: qb.taxRate,
      vatAmount: qb.taxAmount,
      totalAmount: qb.totalAmount,
      pricingRationale: explanationLang === 'ar' ? up.reasonAr : up.reasonEn,
    });
    setQuoteBreakdown(qb);
    setAvailableVehicles(up.availableVehicles);
    setSelectedVehicleId(up.availableVehicles[0]?.id ?? '');
    setAppliedPricingRule({
      id: qb.appliedRuleId ?? 'upgrade-rule',
      name: qb.ruleName,
      vehicleCategory: up.vehicleCategory,
      baseDailyRate: qb.dailyRate,
      weeklyRate: null,
      monthlyRate: null,
      includedKmPerDay: qb.includedKmPerDay,
      excessKmRate: qb.excessKmRate,
      gracePeriodMin: qb.gracePeriodMin,
    });
    setUpgradeAlternative(null);
  }

  async function handleCreateGroundedBooking() {
    if (!suggestion) return;
    setBookingError(null);

    if (customerMode === 'EXISTING' && !selectedCustomerId) {
      setBookingError('Select an existing customer or switch to Quick Walk-In Customer.');
      return;
    }
    if (customerMode === 'NEW' && newCustomer.fullName.trim().length < 2) {
      setBookingError('Enter the customer full name (at least 2 characters).');
      return;
    }

    setCreatingBooking(true);
    try {
      const payload: Record<string, unknown> = {
        action: 'CREATE_BOOKING',
        vehicleCategory: suggestion.vehicleCategory,
        vehicleId: selectedVehicleId || null,
        pickupDate: suggestion.pickupDate,
        dropoffDate: suggestion.dropoffDate,
        pickupLocation: suggestion.pickupLocation,
        dropoffLocation: suggestion.dropoffLocation,
        channel: suggestion.channel,
        insurancePlanCode: suggestion.insuranceTier,
        promoCode: promoCode || null,
        ancillaries: groundedAncillaries.map((a) => ({
          code: a.code,
          quantity: a.quantity,
        })),
        status: bookingStatus,
        notes: bookingNotes.trim() || undefined,
      };

      if (customerMode === 'EXISTING') {
        payload.customerId = selectedCustomerId;
      } else {
        payload.newCustomer = {
          fullName: newCustomer.fullName.trim(),
          phone: newCustomer.phone.trim() || undefined,
          email: newCustomer.email.trim() || undefined,
          nationality: newCustomer.nationality.trim() || undefined,
          drivingLicenseNo: newCustomer.drivingLicenseNo.trim() || undefined,
          licenseExpiry: newCustomer.licenseExpiry || undefined,
        };
      }

      const res = await fetch('/api/rental/bookings/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setBookingError(data.error ?? `Failed to create booking (${res.status})`);
        return;
      }
      setCreatedBooking(data.booking);
      setShowBookingModal(false);
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : 'Booking creation failed');
    } finally {
      setCreatingBooking(false);
    }
  }

  function applyToNewBooking() {
    if (!suggestion) return;
    const payload = encodeURIComponent(
      JSON.stringify({
        ...suggestion,
        selectedVehicleId: selectedVehicleId || undefined,
      }),
    );
    router.push(`/rental/bookings?from=copilot&data=${payload}`);
  }

  const isRtl = explanationLang === 'ar';
  const normalizedCatKey = suggestion
    ? normalizeRentalCategory(suggestion.vehicleCategory) ?? suggestion.vehicleCategory
    : '';

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <Link href="/rental/bookings" className={BACK_BUTTON}>
          <ChevronLeft className="h-3 w-3" /> Back to bookings
        </Link>
        <h1 className="text-2xl font-bold text-[var(--text-main)] mt-2 flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-teal-400" />
          Grounded AI Rental Co-pilot
        </h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Describe customer requirements in English or Arabic. Intent is extracted safely and
          grounded 100% in your live{' '}
          <span className="text-teal-300 font-medium">Pricing Rules</span>,{' '}
          <span className="text-cyan-300 font-medium">Seasonal Rate Events</span>,{' '}
          <span className="text-emerald-300 font-medium">Ancillaries Master</span>, and{' '}
          <span className="text-emerald-300 font-medium">Real Fleet Availability</span>.
        </p>
      </div>

      {/* Brief input */}
      <div className="bg-[var(--bg-surface)]/50 border border-teal-500/20 rounded-2xl p-6 backdrop-blur-sm">
        <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">
          Customer brief (English / العربية)
        </label>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={4}
          placeholder='e.g. "1 SUV for a Saudi family from DXB Saturday to next Friday, GPS + 2 child seats, full insurance, going to Oman."'
          className="w-full px-4 py-3 rounded-xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-teal-500 focus:outline-none transition resize-none"
        />
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="text-xs text-[var(--text-faint)] self-center mr-1">
            Try an example:
          </span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              onClick={() => setBrief(ex.brief)}
              className="text-xs px-3 py-1 rounded-full bg-[var(--bg-surface-hover)]/50 hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border border-[var(--border-strong)] transition"
            >
              {ex.label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between flex-wrap gap-3">
          <p className="text-xs text-[var(--text-faint)]">
            Zero-hallucination pricing · 100% grounded in Fleet360 Master Tariffs &amp; 5% UAE VAT
          </p>
          <button
            onClick={handleGenerate}
            disabled={busy || brief.trim().length < 10}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {busy ? 'Grounding Quote…' : 'Generate Grounded Quote'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-900/30 border border-rose-700 p-4 text-rose-200 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {createdBooking && (
        <div className="rounded-2xl bg-emerald-950/40 border border-emerald-500/40 p-5 flex items-center justify-between flex-wrap gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-emerald-300 font-semibold text-sm uppercase tracking-wider">
              <CheckCircle2 className="h-5 w-5" />
              Reservation Created ({createdBooking.bookingRef ?? createdBooking.id})
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Status:{' '}
              <span className="font-semibold text-[var(--text-main)]">
                {createdBooking.status}
              </span>{' '}
              · {formatRentalCategoryLabel(createdBooking.vehicleCategory)} ·{' '}
              {createdBooking.totalDays} day(s) · Authoritative Total:{' '}
              <span className="font-bold text-emerald-300">
                {createdBooking.currency} {createdBooking.totalAmount.toFixed(2)}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/rental/bookings"
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition flex items-center gap-1.5"
            >
              View in Bookings <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}

      {suggestion && (
        <div className="space-y-4">
          {/* Out-of-stock Upgrade Recommendation Banner */}
          {availableVehicles.length === 0 && upgradeAlternative && (
            <div className="rounded-2xl bg-amber-950/30 border border-amber-500/40 p-5 flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-1.5 max-w-2xl">
                <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold uppercase tracking-wider">
                  <AlertTriangle className="h-4 w-4" />
                  Requested Class Sold Out — In-Stock Upgrade Available
                </div>
                <p className="text-sm text-[var(--text-main)]">
                  {isRtl ? upgradeAlternative.reasonAr : upgradeAlternative.reasonEn}
                </p>
                <div className="text-xs text-amber-200/90">
                  Upgrade total:{' '}
                  <span className="font-semibold">
                    AED {upgradeAlternative.totalAmount.toFixed(2)}
                  </span>{' '}
                  (
                  {upgradeAlternative.rateDeltaPerDay >= 0 ? '+' : ''}
                  AED {upgradeAlternative.rateDeltaPerDay.toFixed(2)}/day vs requested class)
                </div>
              </div>
              <button
                onClick={handleSwitchToUpgrade}
                className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold transition flex items-center gap-1.5"
              >
                Switch to {formatRentalCategoryLabel(upgradeAlternative.vehicleCategory, { short: true })}{' '}
                ({upgradeAlternative.availableCount} in stock)
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Header card */}
          <div className="bg-[var(--bg-surface)]/50 border border-emerald-500/20 rounded-2xl p-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-300 uppercase tracking-wider">
                  Grounded Booking Proposal
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                    CATEGORY_COLORS[normalizedCatKey] ??
                    'bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border-[var(--border-strong)]'
                  }`}
                >
                  {formatRentalCategoryLabel(suggestion.vehicleCategory)}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                    availableVehicles.length > 0
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                  }`}
                >
                  {availableVehicles.length} Available in Fleet
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                    CONFIDENCE_COLORS[suggestion.confidence]
                  }`}
                >
                  {suggestion.confidence} confidence
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border border-[var(--border-strong)]">
                  {suggestion.detectedLanguage.toUpperCase()} · {suggestion.channel}
                </span>
                {meta && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--bg-surface-hover)]/50 text-[var(--text-muted)] border border-[var(--border-subtle)]">
                    {meta.modelUsed} · {meta.durationMs}ms
                  </span>
                )}
              </div>
            </div>

            <StatGrid cols={4} className="mt-4">
              <KpiCard
                label="Pickup"
                value={suggestion.pickupLocation}
                sub={suggestion.pickupDate}
                accent="cyan"
              />
              <KpiCard
                label="Drop-off"
                value={suggestion.dropoffLocation}
                sub={suggestion.dropoffDate}
                accent="violet"
              />
              <KpiCard
                label="Duration"
                value={`${suggestion.totalDays} day${suggestion.totalDays === 1 ? '' : 's'}`}
                sub={
                  appliedPricingRule
                    ? `${appliedPricingRule.includedKmPerDay} km/day included`
                    : undefined
                }
                accent="amber"
              />
              <KpiCard
                label="Grounded Daily Rate"
                value={`AED ${suggestion.appliedDailyRate.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`}
                sub={
                  suggestion.lorDiscountPct > 0
                    ? `base AED ${suggestion.baseDailyRate.toFixed(2)} (-${suggestion.lorDiscountPct}% tier)`
                    : appliedPricingRule
                      ? `Rule: ${appliedPricingRule.name}`
                      : 'No matched tariff rule'
                }
                accent="emerald"
              />
            </StatGrid>

            {/* Applied PricingRule & Active RateEvents Strip */}
            <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-2 text-xs">
              {appliedPricingRule ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-500/15 border border-teal-500/30 text-teal-200">
                  <Tag className="h-3.5 w-3.5 text-teal-400" />
                  Tariff: <strong>{appliedPricingRule.name}</strong> · Excess km: AED{' '}
                  {appliedPricingRule.excessKmRate}/km · Grace:{' '}
                  {appliedPricingRule.gracePeriodMin}m
                </span>
              ) : (
                <Link
                  href="/rental/rates"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-200 hover:bg-amber-500/25 transition"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                  Configure tariff in Pricing Rules →
                </Link>
              )}

              {activeRateEvents.map((ev) => (
                <span
                  key={ev.id || ev.eventCode}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${
                    ev.isApplied
                      ? 'bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-200'
                      : 'bg-[var(--bg-surface-hover)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                  }`}
                >
                  <CalendarRange className="h-3.5 w-3.5" />
                  {ev.name} ({ev.multiplier}×
                  {ev.flatSurcharge > 0 ? ` + AED ${ev.flatSurcharge}` : ''})
                </span>
              ))}
            </div>
          </div>

          {/* Live Fleet Inventory Picker */}
          <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-2">
                <Car className="h-4 w-4 text-teal-400" />
                Verified Available Fleet Units ({availableVehicles.length})
              </h3>
              {availableVehicles.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedVehicleId('')}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition ${
                    selectedVehicleId === ''
                      ? 'bg-teal-500/20 border-teal-500/50 text-teal-200'
                      : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                  }`}
                >
                  Category Guarantee Only (Assign at Counter)
                </button>
              )}
            </div>

            {availableVehicles.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                No unbooked active vehicles in{' '}
                <strong>{formatRentalCategoryLabel(suggestion.vehicleCategory)}</strong> for{' '}
                {suggestion.pickupDate} → {suggestion.dropoffDate}. You can still place a
                category waitlist booking (`PENDING`) or switch to an available upgrade above.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {availableVehicles.slice(0, 9).map((veh) => {
                  const isSelected = selectedVehicleId === veh.id;
                  return (
                    <button
                      key={veh.id}
                      type="button"
                      onClick={() => setSelectedVehicleId(veh.id)}
                      className={`text-left p-3 rounded-xl border transition ${
                        isSelected
                          ? 'bg-teal-500/15 border-teal-500/60 ring-1 ring-teal-500/40'
                          : 'bg-[var(--bg-surface)]/70 border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm text-[var(--text-main)]">
                          {veh.make} {veh.model}
                        </span>
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] text-teal-300">
                          {veh.licensePlate}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-3 text-xs text-[var(--text-muted)]">
                        {veh.year && <span>{veh.year}</span>}
                        <span className="inline-flex items-center gap-1">
                          <Fuel className="h-3 w-3 text-emerald-400" /> {veh.fuelPct}%
                        </span>
                        {veh.odometerKm != null && (
                          <span className="inline-flex items-center gap-1">
                            <Gauge className="h-3 w-3 text-cyan-400" />{' '}
                            {veh.odometerKm.toLocaleString()} km
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Authoritative Cost Breakdown */}
          <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">
              Authoritative Rate Breakdown (AED)
            </h3>
            <div className="space-y-2 text-sm">
              <Row
                label="Base vehicle rental"
                sub={`${suggestion.totalDays} day(s) × AED ${suggestion.appliedDailyRate.toFixed(2)}`}
                amount={suggestion.baseRentalCharge}
              />
              <Row
                label={`Insurance · ${suggestion.insuranceTier}`}
                sub={
                  quoteBreakdown?.insuranceDailyRate
                    ? `AED ${quoteBreakdown.insuranceDailyRate.toFixed(2)}/day × ${suggestion.totalDays}d`
                    : undefined
                }
                amount={suggestion.insuranceCharge}
              />
              {groundedAncillaries.length > 0 && (
                <>
                  <div className="pt-2 mt-2 border-t border-[var(--border-subtle)] text-xs text-[var(--text-muted)] uppercase tracking-wider">
                    Ancillaries &amp; Permits
                  </div>
                  {groundedAncillaries.map((a, i) => (
                    <Row
                      key={`${a.code}-${i}`}
                      label={a.description}
                      badge={
                        a.source === 'TENANT_CATALOGUE' ? 'Catalogue' : 'Standard Tariff'
                      }
                      sub={
                        a.isOneTime
                          ? `One-time × ${a.quantity}`
                          : `AED ${a.unitCharge.toFixed(2)}/day × ${a.quantity} × ${suggestion.totalDays}d`
                      }
                      amount={a.totalCharge}
                    />
                  ))}
                </>
              )}
              {quoteBreakdown && quoteBreakdown.discountAmount > 0 && (
                <Row
                  label={`Promo Discount (${quoteBreakdown.promoCode ?? 'PROMO'}) -${quoteBreakdown.discountPct}%`}
                  amount={-quoteBreakdown.discountAmount}
                />
              )}
              <Row label="Taxable Subtotal" amount={suggestion.subTotal} bold />
              <Row
                label={`UAE VAT (${suggestion.vatPct}%)`}
                amount={suggestion.vatAmount}
                muted
              />
            </div>

            {quoteBreakdown?.yieldTrace && quoteBreakdown.yieldTrace.length > 0 && (
              <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1.5">
                  Yield Engine Calculation Trace
                </div>
                <div className="space-y-1">
                  {quoteBreakdown.yieldTrace.map((yt, idx) => (
                    <div
                      key={idx}
                      className="text-xs text-[var(--text-muted)] flex items-center justify-between gap-2"
                    >
                      <span>
                        <strong className="text-teal-300">{yt.layer}</strong> · {yt.label}
                      </span>
                      <span className="font-mono text-[11px]">
                        AED {yt.dailyRateBefore.toFixed(2)} → AED {yt.dailyRateAfter.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 p-3.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 flex items-center justify-between">
              <span className="text-white font-bold">Total (incl. 5% VAT)</span>
              <span className="text-white text-xl font-bold">
                AED{' '}
                {suggestion.totalAmount.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            <div className="mt-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs text-amber-200">
              <span>Recommended refundable security deposit (card pre-auth)</span>
              <span className="font-bold">
                AED {suggestion.securityDeposit.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Bilingual Grounded Rationale */}
          <div className="bg-[var(--bg-surface)]/50 border border-cyan-500/20 rounded-2xl p-6">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-semibold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                <Languages className="h-4 w-4" /> Grounded Pricing Summary
              </h3>
              {explanation && (
                <div className="inline-flex rounded-lg border border-[var(--border-strong)] overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => setExplanationLang('en')}
                    className={`px-2.5 py-1 ${
                      explanationLang === 'en'
                        ? 'bg-cyan-600 text-white font-medium'
                        : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
                    }`}
                  >
                    EN
                  </button>
                  <button
                    type="button"
                    onClick={() => setExplanationLang('ar')}
                    className={`px-2.5 py-1 ${
                      explanationLang === 'ar'
                        ? 'bg-cyan-600 text-white font-medium'
                        : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
                    }`}
                  >
                    العربية
                  </button>
                </div>
              )}
            </div>
            <p
              dir={isRtl ? 'rtl' : 'ltr'}
              className="text-sm text-[var(--text-muted)] leading-relaxed"
            >
              {explanation
                ? explanationLang === 'ar'
                  ? explanation.ar
                  : explanation.en
                : suggestion.pricingRationale}
            </p>
          </div>

          {/* Warnings */}
          {suggestion.warnings.length > 0 && (
            <div className="bg-amber-900/20 border border-amber-500/30 rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-amber-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Operational &amp; KYC Checks
              </h3>
              <ul className="space-y-1">
                {suggestion.warnings.map((w, i) => (
                  <li key={i} className="text-sm text-amber-100">
                    • {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 1-Click Booking Creation Panel */}
          {showBookingModal && (
            <div className="bg-[var(--bg-surface)] border border-teal-500/40 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-[var(--text-main)] flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-teal-400" />
                  Create Reservation from Grounded Quote
                </h3>
                <div className="inline-flex rounded-lg border border-[var(--border-strong)] overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => setCustomerMode('EXISTING')}
                    className={`px-3 py-1.5 ${
                      customerMode === 'EXISTING'
                        ? 'bg-teal-600 text-white font-medium'
                        : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
                    }`}
                  >
                    Existing Customer
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomerMode('NEW')}
                    className={`px-3 py-1.5 ${
                      customerMode === 'NEW'
                        ? 'bg-teal-600 text-white font-medium'
                        : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
                    }`}
                  >
                    Quick Walk-In Customer
                  </button>
                </div>
              </div>

              {customerMode === 'EXISTING' ? (
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="h-4 w-4 text-[var(--text-faint)] absolute left-3 top-3" />
                    <input
                      type="text"
                      value={customerQuery}
                      onChange={(e) => setCustomerQuery(e.target.value)}
                      placeholder="Search customer by name, phone, or email…"
                      className="w-full pl-9 pr-4 py-2 rounded-xl bg-[var(--bg-surface-hover)]/60 border border-[var(--border-subtle)] text-sm text-[var(--text-main)]"
                    />
                  </div>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface-hover)]/60 border border-[var(--border-subtle)] text-sm text-[var(--text-main)]"
                  >
                    <option value="">
                      {loadingCustomers
                        ? 'Loading customers…'
                        : customerResults.length === 0
                          ? 'No matching customers — switch to Quick Walk-In'
                          : 'Select customer…'}
                    </option>
                    {customerResults.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName}
                        {c.phone ? ` · ${c.phone}` : ''}
                        {c.customerType ? ` (${c.customerType})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    type="text"
                    placeholder="Full name *"
                    value={newCustomer.fullName}
                    onChange={(e) =>
                      setNewCustomer((p) => ({ ...p, fullName: e.target.value }))
                    }
                    className="px-3 py-2 rounded-xl bg-[var(--bg-surface-hover)]/60 border border-[var(--border-subtle)] text-sm text-[var(--text-main)]"
                  />
                  <input
                    type="text"
                    placeholder="Mobile (+971…)"
                    value={newCustomer.phone}
                    onChange={(e) =>
                      setNewCustomer((p) => ({ ...p, phone: e.target.value }))
                    }
                    className="px-3 py-2 rounded-xl bg-[var(--bg-surface-hover)]/60 border border-[var(--border-subtle)] text-sm text-[var(--text-main)]"
                  />
                  <input
                    type="email"
                    placeholder="Email"
                    value={newCustomer.email}
                    onChange={(e) =>
                      setNewCustomer((p) => ({ ...p, email: e.target.value }))
                    }
                    className="px-3 py-2 rounded-xl bg-[var(--bg-surface-hover)]/60 border border-[var(--border-subtle)] text-sm text-[var(--text-main)]"
                  />
                  <input
                    type="text"
                    placeholder="Nationality (e.g. UAE, KSA, UK)"
                    value={newCustomer.nationality}
                    onChange={(e) =>
                      setNewCustomer((p) => ({ ...p, nationality: e.target.value }))
                    }
                    className="px-3 py-2 rounded-xl bg-[var(--bg-surface-hover)]/60 border border-[var(--border-subtle)] text-sm text-[var(--text-main)]"
                  />
                  <input
                    type="text"
                    placeholder="Driving License No."
                    value={newCustomer.drivingLicenseNo}
                    onChange={(e) =>
                      setNewCustomer((p) => ({
                        ...p,
                        drivingLicenseNo: e.target.value,
                      }))
                    }
                    className="px-3 py-2 rounded-xl bg-[var(--bg-surface-hover)]/60 border border-[var(--border-subtle)] text-sm text-[var(--text-main)]"
                  />
                  <input
                    type="date"
                    title="License Expiry Date"
                    value={newCustomer.licenseExpiry}
                    onChange={(e) =>
                      setNewCustomer((p) => ({ ...p, licenseExpiry: e.target.value }))
                    }
                    className="px-3 py-2 rounded-xl bg-[var(--bg-surface-hover)]/60 border border-[var(--border-subtle)] text-sm text-[var(--text-main)]"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Initial Booking Status
                  </label>
                  <select
                    value={bookingStatus}
                    onChange={(e) =>
                      setBookingStatus(e.target.value as 'CONFIRMED' | 'PENDING')
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-surface-hover)]/60 border border-[var(--border-subtle)] text-sm text-[var(--text-main)]"
                  >
                    <option value="CONFIRMED">
                      CONFIRMED (locks assigned vehicle if selected)
                    </option>
                    <option value="PENDING">PENDING (provisional hold)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Counter Remarks (optional)
                  </label>
                  <input
                    type="text"
                    value={bookingNotes}
                    onChange={(e) => setBookingNotes(e.target.value)}
                    placeholder="Flight number, delivery hotel room, VIP instructions…"
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-surface-hover)]/60 border border-[var(--border-subtle)] text-sm text-[var(--text-main)]"
                  />
                </div>
              </div>

              {bookingError && (
                <div className="rounded-xl bg-rose-900/30 border border-rose-700 p-3 text-rose-200 text-xs flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span>{bookingError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBookingModal(false)}
                  className="px-4 py-2 rounded-xl bg-[var(--bg-surface-hover)] text-[var(--text-muted)] text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={creatingBooking}
                  onClick={handleCreateGroundedBooking}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition"
                >
                  {creatingBooking
                    ? 'Creating Reservation…'
                    : `Confirm & Create Booking (AED ${suggestion.totalAmount.toFixed(2)})`}
                </button>
              </div>
            </div>
          )}

          {/* Action Bar */}
          <div className="flex gap-3 justify-end flex-wrap">
            <button
              onClick={() => {
                setSuggestion(null);
                setQuoteBreakdown(null);
                setMeta(null);
                setShowBookingModal(false);
              }}
              className="px-4 py-2 rounded-xl bg-[var(--bg-surface-hover)] text-[var(--text-main)] text-sm"
            >
              Try another brief
            </button>
            <button
              onClick={applyToNewBooking}
              className="px-5 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-sm font-medium transition"
            >
              Open in Booking Form
            </button>
            <button
              onClick={() => {
                setBookingError(null);
                setShowBookingModal(true);
              }}
              className="px-6 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-semibold hover:opacity-90 transition flex items-center gap-2"
            >
              <CheckCircle2 className="h-4 w-4" />
              1-Click Create Booking
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="font-semibold text-[var(--text-main)] mt-0.5">{value}</div>
      {sub && <div className="text-xs text-[var(--text-faint)] mt-0.5">{sub}</div>}
    </div>
  );
}

function Row({
  label,
  sub,
  badge,
  amount,
  bold,
  muted,
}: {
  label: string;
  sub?: string;
  badge?: string;
  amount: number;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${
        bold ? 'pt-2 mt-2 border-t border-[var(--border-subtle)]' : ''
      }`}
    >
      <div>
        <div className="flex items-center gap-2">
          <span
            className={
              bold
                ? 'font-semibold text-[var(--text-main)]'
                : muted
                  ? 'text-[var(--text-muted)]'
                  : 'text-[var(--text-muted)]'
            }
          >
            {label}
          </span>
          {badge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/15 border border-teal-500/30 text-teal-300">
              {badge}
            </span>
          )}
        </div>
        {sub && <div className="text-xs text-[var(--text-faint)]">{sub}</div>}
      </div>
      <div
        className={
          bold
            ? 'font-bold text-[var(--text-main)]'
            : muted
              ? 'text-[var(--text-muted)]'
              : 'text-[var(--text-main)]'
        }
      >
        {amount < 0 ? '-' : ''}AED{' '}
        {Math.abs(amount).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </div>
    </div>
  );
}
