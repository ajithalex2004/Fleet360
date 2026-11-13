'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  Car,
  CheckCircle2,
  CreditCard,
  Info,
  Lock,
  MapPin,
  Plane,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import {
  RENTAL_VEHICLE_CATEGORIES,
  formatRentalCategoryLabel,
} from '@/lib/rental/categories';
import {
  canBookRacPortal,
  formatRacPortalRole,
  useRacPortalSession,
} from '../rac-portal-shell';

interface BranchOption {
  id: string;
  branchCode: string;
  branchName: string;
  emirate: string;
  address: string | null;
  operatingHours: string;
}

interface AncillaryOption {
  code: string;
  name: string;
  dailyRate: number;
}

interface AvailableVehicle {
  id: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  category: string;
  transmission?: string;
  seats?: number;
}

interface RateBreakdownLine {
  label: string;
  qty: number;
  unitLabel: string;
  unitPrice: number;
  amount: number;
  type: string;
}

interface CategoryAvailability {
  category: string;
  availableCount: number;
  sampleVehicles: AvailableVehicle[];
  quote: {
    ruleName: string;
    appliedEventName?: string | null;
    totalDays: number;
    currency: string;
    dailyRate: number;
    baseRentalCharge: number;
    insurancePlanCode: string | null;
    insuranceCharge: number;
    extraCharges: number;
    subtotal: number;
    taxRate: number;
    taxAmount: number;
    totalAmount: number;
    includedKmPerDay: number;
    breakdown: RateBreakdownLine[];
  };
  requiredPreAuthAmount: number;
  recommendedHoldAmount: number;
  preAuthBreakdown: {
    securityDeposit: number;
    estimatedRentalTotal: number;
    requiredPreAuthAmount: number;
    recommendedHoldAmount: number;
  };
}

interface PreAuthResponse {
  id: string;
  authorizationCode: string;
  amount: number;
  currency: string;
  cardBrand: string | null;
  cardLast4: string | null;
  status: string;
  expiresAt: string | null;
}

interface ConfirmedReceipt {
  booking: {
    id: string;
    bookingRef: string;
    vehicleCategory: string;
    pickupDate: string;
    dropoffDate: string;
    pickupLocation: string;
    dropoffLocation: string;
    totalDays: number;
    dailyRate: number;
    subtotal: number;
    vatAmount: number;
    totalAmount: number;
    depositAmount: number;
    currency: string;
    status: string;
    vehicle: {
      id: string;
      make: string;
      model: string;
      plateNumber: string;
    };
  };
  preauth: PreAuthResponse;
}

function toLocalDateTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultDateInput(hoursFromNow: number): string {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000);
  d.setMinutes(0, 0, 0);
  return toLocalDateTimeInput(d);
}

function parseValidDateTime(raw: string): Date | null {
  if (!raw || !raw.trim()) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function detectCardBrand(digits: string): string {
  if (digits.startsWith('4')) return 'VISA';
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'MASTERCARD';
  if (/^3[47]/.test(digits)) return 'AMEX';
  return 'VISA';
}

function tokenizeCardInBrowser(rawPan: string): {
  cardToken: string;
  cardLast4: string;
  cardBrand: string;
} {
  const digits = rawPan.replace(/\D/g, '');
  const cardLast4 = digits.slice(-4).padStart(4, '0');
  const cardBrand = detectCardBrand(digits);
  const randBytes = new Uint8Array(8);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(randBytes);
  }
  const hex = Array.from(randBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return {
    cardToken: `tok_b2b_${hex || Date.now().toString(36)}`,
    cardLast4,
    cardBrand,
  };
}

function fmtAed(n: number, currency = 'AED') {
  return `${currency} ${Number(n ?? 0).toLocaleString('en-AE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function RacPortalBookOnlinePage() {
  const { user, customer, me, refreshMe } = useRacPortalSession();
  const canBook = canBookRacPortal(user?.role);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1 state
  const [pickupDate, setPickupDate] = useState(() => defaultDateInput(24));
  const [dropoffDate, setDropoffDate] = useState(() => defaultDateInput(24 + 72));
  const [pickupLocation, setPickupLocation] = useState('DXB-T3');
  const [dropoffLocation, setDropoffLocation] = useState('DXB-T3');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [insuranceTier, setInsuranceTier] = useState<'BASIC' | 'STANDARD' | 'FULL_ZERO_EXCESS'>('STANDARD');
  const [selectedAncillaries, setSelectedAncillaries] = useState<string[]>([]);

  // Availability results
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [ancillaryCatalog, setAncillaryCatalog] = useState<AncillaryOption[]>([]);
  const [categories, setCategories] = useState<CategoryAvailability[]>([]);
  const [allVehicles, setAllVehicles] = useState<AvailableVehicle[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Step 2 selection
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(''); // '' = auto-assign
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [flightNumber, setFlightNumber] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');

  // Step 3 PCI-safe card hold state (raw digits live ONLY in local input state & cleared upon client tokenization)
  const [cardholderName, setCardholderName] = useState('');
  const [maskedCardInput, setMaskedCardInput] = useState('');
  const [expiryMonth, setExpiryMonth] = useState<number>(12);
  const [expiryYear, setExpiryYear] = useState<number>(() => new Date().getFullYear() + 2);
  const [cvvInput, setCvvInput] = useState('');
  const [holdAmount, setHoldAmount] = useState<number>(1500);
  const [authorizedHold, setAuthorizedHold] = useState<PreAuthResponse | null>(null);
  const [submittingHold, setSubmittingHold] = useState(false);
  const [holdError, setHoldError] = useState<string | null>(null);

  // Step 4 Confirmation Receipt
  const [receipt, setReceipt] = useState<ConfirmedReceipt | null>(null);

  // Hydrate default driver/cardholder from logged-in user
  useEffect(() => {
    if (me) {
      if (!driverName) setDriverName(me.user.fullName ?? me.customer.fullName ?? '');
      if (!driverPhone && me.customer.phone) setDriverPhone(me.customer.phone);
      if (!cardholderName) {
        setCardholderName(
          me.customer.companyName ?? me.user.fullName ?? me.customer.fullName ?? '',
        );
      }
    }
  }, [me, driverName, driverPhone, cardholderName]);

  const fetchAvailability = useCallback(
    async (advanceStep: boolean) => {
      if (user && !canBookRacPortal(user.role)) return;

      const pickupDt = parseValidDateTime(pickupDate);
      const dropoffDt = parseValidDateTime(dropoffDate);
      if (!pickupDt || !dropoffDt) {
        setSearchError('Please enter valid pick-up and drop-off dates and times.');
        return;
      }
      if (dropoffDt <= pickupDt) {
        setSearchError('Drop-off date and time must be after pick-up date and time.');
        return;
      }

      setSearching(true);
      setSearchError(null);
      try {
        const qs = new URLSearchParams({
          pickupDate: pickupDt.toISOString(),
          dropoffDate: dropoffDt.toISOString(),
          pickupLocation,
          insuranceTier,
        });
        if (categoryFilter && categoryFilter !== 'ALL') qs.set('category', categoryFilter);
        if (selectedAncillaries.length > 0) qs.set('ancillaries', selectedAncillaries.join(','));

        const res = await fetch(`/api/rac-portal/availability?${qs.toString()}`, {
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSearchError(data?.error ?? 'Unable to search fleet availability');
          return;
        }

        const loadedBranches = (data.branches ?? []) as BranchOption[];
        setBranches(loadedBranches);
        if (loadedBranches.length > 0 && !loadedBranches.some((b) => b.branchCode === pickupLocation)) {
          setPickupLocation(loadedBranches[0].branchCode);
          setDropoffLocation(loadedBranches[0].branchCode);
        }
        setAncillaryCatalog(data.ancillaryCatalog ?? []);
        const cats = (data.categories ?? []) as CategoryAvailability[];
        setCategories(cats);
        setAllVehicles(data.vehicles ?? []);

        if (cats.length > 0) {
          const first = cats.find((c) => c.category === selectedCategory) ?? cats[0];
          setSelectedCategory(first.category);
          setHoldAmount(first.recommendedHoldAmount);
        } else {
          setSelectedCategory(null);
        }

        if (advanceStep) {
          setStep(2);
        }
      } catch {
        setSearchError('Network error while querying live fleet availability.');
      } finally {
        setSearching(false);
      }
    },
    [
      user,
      pickupDate,
      dropoffDate,
      pickupLocation,
      insuranceTier,
      categoryFilter,
      selectedAncillaries,
      selectedCategory,
    ],
  );

  // Initial load to populate branches & ancillary catalogue for authorized bookers
  useEffect(() => {
    if (!user || !canBook) return;
    void fetchAvailability(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, canBook]);

  const activeCategoryObj = useMemo(
    () => categories.find((c) => c.category === selectedCategory) ?? null,
    [categories, selectedCategory],
  );

  const vehiclesInSelectedCategory = useMemo(
    () => allVehicles.filter((v) => v.category === selectedCategory),
    [allVehicles, selectedCategory],
  );

  const toggleAncillary = (code: string) => {
    setSelectedAncillaries((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const handleSelectCategory = (cat: CategoryAvailability) => {
    setSelectedCategory(cat.category);
    setSelectedVehicleId('');
    setHoldAmount(cat.recommendedHoldAmount);
    // Keep any already-authorized hold reusable unless its amount is below the new category's minimum deposit
    if (authorizedHold && authorizedHold.amount < cat.requiredPreAuthAmount) {
      setAuthorizedHold(null);
    }
  };

  const handleAuthorizeAndBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCategoryObj || !canBook) return;

    const pickupDt = parseValidDateTime(pickupDate);
    const dropoffDt = parseValidDateTime(dropoffDate);
    if (!pickupDt || !dropoffDt || dropoffDt <= pickupDt) {
      setHoldError('Pick-up and drop-off schedule is invalid. Please review Step 1 dates.');
      return;
    }

    setHoldError(null);
    setSubmittingHold(true);

    try {
      let currentPreAuth =
        authorizedHold && authorizedHold.amount >= activeCategoryObj.requiredPreAuthAmount
          ? authorizedHold
          : null;

      // Phase 1: Place PCI-safe card pre-authorization hold if not already placed
      if (!currentPreAuth) {
        const numericHold = Number(holdAmount);
        if (
          !Number.isFinite(numericHold) ||
          Number.isNaN(numericHold) ||
          numericHold < activeCategoryObj.requiredPreAuthAmount
        ) {
          setHoldError(
            `Hold amount must be at least AED ${activeCategoryObj.requiredPreAuthAmount.toLocaleString('en-AE')}.`,
          );
          setSubmittingHold(false);
          return;
        }
        if (Number.isNaN(Number(expiryMonth)) || Number.isNaN(Number(expiryYear))) {
          setHoldError('Please select a valid card expiry month and year.');
          setSubmittingHold(false);
          return;
        }

        const cleanDigits = maskedCardInput.replace(/\D/g, '');
        if (cleanDigits.length < 13 || cleanDigits.length > 19) {
          setHoldError('Please enter a valid 15 or 16-digit corporate card number.');
          setSubmittingHold(false);
          return;
        }
        if (cvvInput.replace(/\D/g, '').length < 3) {
          setHoldError('Please enter a valid 3 or 4-digit security code.');
          setSubmittingHold(false);
          return;
        }

        const { cardToken, cardLast4, cardBrand } = tokenizeCardInBrowser(cleanDigits);
        // Immediately scrub sensitive transient fields from browser state
        setMaskedCardInput(`•••• •••• •••• ${cardLast4}`);
        setCvvInput('');

        const paRes = await fetch('/api/rac-portal/preauth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: numericHold,
            currency: 'AED',
            cardToken,
            cardBrand,
            cardLast4,
            cardholderName: cardholderName.trim(),
            expiryMonth: Number(expiryMonth),
            expiryYear: Number(expiryYear),
            purpose: 'BOOKING',
            notes: `B2B Online Booking Hold — ${activeCategoryObj.category} (${pickupLocation})`,
          }),
        });
        const paData = await paRes.json().catch(() => ({}));
        if (!paRes.ok) {
          setHoldError(paData?.error ?? 'Card pre-authorization hold was declined.');
          setSubmittingHold(false);
          return;
        }
        currentPreAuth = paData.preauth as PreAuthResponse;
        setAuthorizedHold(currentPreAuth);
      }

      // Phase 2: Confirm reservation atomically with locked vehicle + preauthId
      const bkRes = await fetch('/api/rac-portal/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: activeCategoryObj.category,
          vehicleId: selectedVehicleId || undefined,
          pickupDate: pickupDt.toISOString(),
          dropoffDate: dropoffDt.toISOString(),
          pickupLocation,
          dropoffLocation,
          preauthId: currentPreAuth.id,
          driverName: driverName.trim() || undefined,
          driverPhone: driverPhone.trim() || undefined,
          flightNumber: flightNumber.trim() || undefined,
          specialRequests: specialRequests.trim() || undefined,
          insuranceTier,
          ancillaries: selectedAncillaries,
        }),
      });
      const bkData = await bkRes.json().catch(() => ({}));
      if (!bkRes.ok) {
        setHoldError(
          `${bkData?.error ?? 'Reservation could not be completed.'} Your pre-authorization hold (${currentPreAuth.authorizationCode}) is saved and reusable — retry below or select another vehicle without placing a duplicate hold.`,
        );
        setSubmittingHold(false);
        return;
      }

      setReceipt({
        booking: bkData.booking,
        preauth: bkData.preauth,
      });
      setStep(4);
      await refreshMe();
    } catch {
      setHoldError(
        authorizedHold
          ? `Network error while completing reservation. Your hold (${authorizedHold.authorizationCode}) is saved and reusable when you retry.`
          : 'Network error while completing your corporate reservation.',
      );
    } finally {
      setSubmittingHold(false);
    }
  };

  if (user && !canBook) {
    const roleMeta = formatRacPortalRole(user.role);
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-slate-900/90 p-8 max-w-2xl mx-auto text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6 text-amber-400" />
        </div>
        <h1 className="text-xl font-black text-white">Booking Role Required</h1>
        <p className="text-sm text-slate-300 leading-relaxed">
          Your account for{' '}
          <strong className="text-white">{customer?.companyName ?? customer?.fullName}</strong> is
          currently assigned the <strong className="text-amber-300">{roleMeta.fullLabel}</strong>{' '}
          role. Only <strong className="text-cyan-300">Corporate Booker</strong> or{' '}
          <strong className="text-violet-300">Corporate B2B Admin</strong> users can place online
          vehicle reservations and booking card holds.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link
            href="/rac-portal"
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-semibold text-white"
          >
            Back to Overview
          </Link>
          <Link
            href="/rac-portal/bookings"
            className="px-4 py-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-xs font-semibold text-cyan-300"
          >
            View Existing Reservations →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Wizard Header & Stepper */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-cyan-400" />
            Online Corporate Fleet Booking
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Live physical vehicle availability, contracted Master Price List tariffs, and instant PCI-safe card pre-authorization.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold">
          {[
            { n: 1, label: '1. Dates & Branch' },
            { n: 2, label: '2. Fleet & Tariff' },
            { n: 3, label: '3. Card Pre-Auth' },
          ].map((s) => (
            <div
              key={s.n}
              className={`px-3 py-1.5 rounded-full border transition-colors ${
                step === s.n
                  ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40'
                  : step > s.n
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-slate-900 text-slate-500 border-white/10'
              }`}
            >
              {s.label}
            </div>
          ))}
        </div>
      </div>

      {/* ─────────────────── STEP 1: SEARCH DATES & LOCATIONS ─────────────────── */}
      {step === 1 && (
        <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-6 lg:p-7 space-y-6 shadow-xl">
          {searchError && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3.5 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{searchError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                Pick-Up Branch / Hub
              </label>
              <select
                value={pickupLocation}
                onChange={(e) => {
                  setPickupLocation(e.target.value);
                  if (dropoffLocation === pickupLocation) setDropoffLocation(e.target.value);
                }}
                className="w-full rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.branchCode}>
                    {b.branchName} ({b.emirate})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-teal-400" />
                Drop-Off Branch / Hub
              </label>
              <select
                value={dropoffLocation}
                onChange={(e) => setDropoffLocation(e.target.value)}
                className="w-full rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.branchCode}>
                    {b.branchName} ({b.emirate})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                Pick-Up Date & Time
              </label>
              <input
                type="datetime-local"
                value={pickupDate}
                onChange={(e) => setPickupDate(e.target.value)}
                className="w-full rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-teal-400" />
                Drop-Off Date & Time
              </label>
              <input
                type="datetime-local"
                value={dropoffDate}
                onChange={(e) => setDropoffDate(e.target.value)}
                className="w-full rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Preferred Category
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="ALL">All Corporate Categories</option>
                {RENTAL_VEHICLE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Corporate Insurance & Excess Tier
              </label>
              <select
                value={insuranceTier}
                onChange={(e) =>
                  setInsuranceTier(e.target.value as 'BASIC' | 'STANDARD' | 'FULL_ZERO_EXCESS')
                }
                className="w-full rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="BASIC">Basic Third-Party & Standard Excess (Included)</option>
                <option value="STANDARD">Standard Corporate CDW — Reduced Excess (+AED 35/day)</option>
                <option value="FULL_ZERO_EXCESS">
                  Super CDW — Full Zero Excess & Reduced Deposit (+AED 75/day)
                </option>
              </select>
            </div>
          </div>

          {ancillaryCatalog.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-white/10">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Optional Corporate Add-Ons
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {ancillaryCatalog.map((anc) => {
                  const checked = selectedAncillaries.includes(anc.code);
                  return (
                    <button
                      key={anc.code}
                      type="button"
                      onClick={() => toggleAncillary(anc.code)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        checked
                          ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
                          : 'bg-slate-800/50 border-white/10 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <p className="text-xs font-bold">{anc.name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        AED {anc.dailyRate}/day
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={searching}
              onClick={() => void fetchAvailability(true)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 hover:opacity-95 disabled:opacity-50 text-white font-bold text-sm shadow-lg shadow-cyan-500/25 transition-all"
            >
              {searching ? 'Checking Live Fleet…' : 'Search Live Fleet & Corporate Rates'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────── STEP 2: SELECT VEHICLE & CORPORATE RATE ─────────────────── */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4" /> Modify Dates, Branch, or Coverage
            </button>
            <span className="text-xs text-slate-400">
              {pickupLocation} → {dropoffLocation}
            </span>
          </div>

          {authorizedHold && (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3.5 text-xs text-emerald-200 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                Saved Card Hold <strong>{authorizedHold.authorizationCode}</strong> (
                {fmtAed(authorizedHold.amount, authorizedHold.currency)}) will be reused automatically if your selected category deposit is ≤{' '}
                {fmtAed(authorizedHold.amount, authorizedHold.currency)}.
              </span>
            </div>
          )}

          {categories.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-slate-900 p-10 text-center space-y-3">
              <Car className="w-10 h-10 text-slate-500 mx-auto" />
              <p className="text-base font-bold text-white">
                No Available Vehicles Match This Window
              </p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                All physical Rent-A-Car fleet units in the selected category are currently reserved or on active rental during this window. Try broadening your category filter or adjusting dates.
              </p>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-semibold"
              >
                Adjust Search Parameters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left 2 cols: Category Cards + Specific Plate + Driver Info */}
              <div className="lg:col-span-2 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {categories.map((cat) => {
                    const isSelected = cat.category === selectedCategory;
                    const sample = cat.sampleVehicles[0];
                    return (
                      <button
                        key={cat.category}
                        type="button"
                        onClick={() => handleSelectCategory(cat)}
                        className={`text-left rounded-2xl border p-5 transition-all space-y-3 ${
                          isSelected
                            ? 'bg-cyan-500/15 border-cyan-500/50 shadow-lg shadow-cyan-500/10'
                            : 'bg-slate-900/80 border-white/10 hover:border-white/25'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-black text-white tracking-wide">
                              {formatRentalCategoryLabel(cat.category, { short: true })}
                            </p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {sample ? `${sample.make} ${sample.model} or similar` : 'Corporate Fleet'}
                            </p>
                          </div>
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-bold text-emerald-300">
                            {cat.availableCount} Available
                          </span>
                        </div>

                        <div className="pt-2 border-t border-white/10 flex items-baseline justify-between">
                          <div>
                            <span className="text-lg font-black text-white">
                              AED {cat.quote.dailyRate.toLocaleString('en-AE')}
                            </span>
                            <span className="text-xs text-slate-400"> / day</span>
                          </div>
                          <span className="text-xs font-semibold text-cyan-300">
                            Total: {fmtAed(cat.quote.totalAmount, cat.quote.currency)}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-400 flex items-center justify-between">
                          <span>{cat.quote.includedKmPerDay} km/day included</span>
                          <span className="text-amber-300">
                            Hold: AED {cat.requiredPreAuthAmount.toLocaleString('en-AE')}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {activeCategoryObj && (
                  <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 space-y-4">
                    <h3 className="text-sm font-bold text-white">
                      Vehicle Model Preference & Corporate Driver Details
                    </h3>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Select Specific Fleet Vehicle (Optional)
                      </label>
                      <select
                        value={selectedVehicleId}
                        onChange={(e) => setSelectedVehicleId(e.target.value)}
                        className="w-full rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      >
                        <option value="">
                          Auto-Assign Best Available{' '}
                          {formatRentalCategoryLabel(activeCategoryObj.category, { short: true })}{' '}
                          at Lock Time (Recommended)
                        </option>
                        {vehiclesInSelectedCategory.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.make} {v.model}
                            {v.year ? ` · ${v.year}` : ''}
                            {v.color ? ` · ${v.color}` : ''}
                            {v.transmission ? ` · ${v.transmission}` : ''}
                            {v.seats ? ` · ${v.seats} seats` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-cyan-400" /> Driver Name
                        </label>
                        <input
                          type="text"
                          value={driverName}
                          onChange={(e) => setDriverName(e.target.value)}
                          placeholder="Employee / Guest Name"
                          className="w-full rounded-xl bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                          Driver Mobile
                        </label>
                        <input
                          type="tel"
                          value={driverPhone}
                          onChange={(e) => setDriverPhone(e.target.value)}
                          placeholder="+971 50 000 0000"
                          className="w-full rounded-xl bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                          <Plane className="w-3.5 h-3.5 text-cyan-400" /> Flight # (Optional)
                        </label>
                        <input
                          type="text"
                          value={flightNumber}
                          onChange={(e) => setFlightNumber(e.target.value)}
                          placeholder="e.g. EK 204"
                          className="w-full rounded-xl bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Special Delivery / Counter Notes
                      </label>
                      <input
                        type="text"
                        value={specialRequests}
                        onChange={(e) => setSpecialRequests(e.target.value)}
                        placeholder="VIP executive handover, cost-center PO reference, etc."
                        className="w-full rounded-xl bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Right Col: Itemized Corporate Tariff & Pre-Auth Breakdown */}
              {activeCategoryObj && (
                <div className="rounded-2xl border border-cyan-500/30 bg-slate-900/95 p-5 space-y-4 h-fit">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                      Corporate Rate Quote
                    </p>
                    <p className="text-sm font-bold text-white mt-0.5">
                      {activeCategoryObj.quote.ruleName}
                    </p>
                    {activeCategoryObj.quote.appliedEventName && (
                      <p className="text-[11px] text-amber-300 mt-0.5">
                        Includes active event tariff: {activeCategoryObj.quote.appliedEventName}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2 pt-3 border-t border-white/10 text-xs">
                    {activeCategoryObj.quote.breakdown.map((line, idx) => (
                      <div key={idx} className="flex items-start justify-between gap-2">
                        <span className="text-slate-300">{line.label}</span>
                        <span className="font-mono font-semibold text-white shrink-0">
                          {fmtAed(line.amount, activeCategoryObj.quote.currency)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-3 border-t border-white/10 flex items-baseline justify-between">
                    <span className="text-sm font-bold text-white">Total Rental (incl. VAT)</span>
                    <span className="text-xl font-black text-cyan-300">
                      {fmtAed(activeCategoryObj.quote.totalAmount, activeCategoryObj.quote.currency)}
                    </span>
                  </div>

                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 p-3.5 space-y-1.5 text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-amber-300">
                      <ShieldCheck className="w-4 h-4" />
                      Mandatory Security Pre-Authorization
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Security Deposit Base:</span>
                      <span className="font-mono">
                        {fmtAed(activeCategoryObj.preAuthBreakdown.securityDeposit)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Minimum Required Hold:</span>
                      <span className="font-mono font-semibold text-white">
                        {fmtAed(activeCategoryObj.requiredPreAuthAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between text-amber-200 font-semibold">
                      <span>Recommended Hold:</span>
                      <span className="font-mono">
                        {fmtAed(activeCategoryObj.recommendedHoldAmount)}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 hover:opacity-95 text-white font-bold text-sm shadow-lg shadow-cyan-500/20 inline-flex items-center justify-center gap-2"
                  >
                    Proceed to Card Pre-Auth
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────── STEP 3: CARD PRE-AUTH & INSTANT CONFIRMATION ─────────────────── */}
      {step === 3 && activeCategoryObj && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleAuthorizeAndBook}
            className="lg:col-span-2 rounded-2xl border border-white/10 bg-slate-900/95 p-6 space-y-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4" /> Back to Vehicle Selection
              </button>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-semibold text-emerald-300">
                <Lock className="w-3 h-3" /> Client-Side Tokenized PCI-DSS
              </span>
            </div>

            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-cyan-400" />
                Corporate Card Pre-Authorization Hold
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Places a temporary issuer hold (not an immediate charge) to guarantee your vehicle allocation. Raw card numbers and CVV are tokenized locally in your browser and never sent to Fleet360 servers.
              </p>
            </div>

            {holdError && (
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3.5 text-rose-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{holdError}</span>
              </div>
            )}

            {authorizedHold && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      Saved Card Hold · {authorizedHold.authorizationCode}
                    </p>
                    <p className="text-xs text-slate-300 mt-0.5">
                      {authorizedHold.cardBrand} •••• {authorizedHold.cardLast4} · Hold{' '}
                      {fmtAed(authorizedHold.amount, authorizedHold.currency)}
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-200 text-[10px] font-bold">
                    REUSABLE — NO DUPLICATE HOLD
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-300 pt-1 border-t border-emerald-500/20">
                  <span>
                    Retrying confirmation or choosing another vehicle in Step 2 will reuse this existing hold.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthorizedHold(null);
                      setMaskedCardInput('');
                      setCvvInput('');
                    }}
                    className="text-cyan-300 hover:underline font-semibold shrink-0"
                  >
                    Use different card
                  </button>
                </div>
              </div>
            )}

            {!authorizedHold && (
              <>
                <div className="rounded-xl bg-cyan-500/10 border border-cyan-500/25 p-3.5 text-xs text-cyan-200 flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Sandbox Gateway Note:</span> Enter any 16-digit card number with a future expiry to authorize immediately (e.g.{' '}
                    <code className="font-mono text-white">4242 4242 4242 4242</code>). Use a card ending in{' '}
                    <code className="font-mono text-rose-300">0002</code> to test bank decline handling.
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2 space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Cardholder / Corporate Entity Name
                    </label>
                    <input
                      type="text"
                      required
                      value={cardholderName}
                      onChange={(e) => setCardholderName(e.target.value)}
                      placeholder="ACME MIDDLE EAST LLC"
                      className="w-full rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                  </div>

                  <div className="sm:col-span-2 space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Corporate Card Number (Tokenized Locally)
                    </label>
                    <input
                      type="text"
                      required
                      inputMode="numeric"
                      autoComplete="off"
                      value={maskedCardInput}
                      onChange={(e) => setMaskedCardInput(e.target.value)}
                      placeholder="4242 •••• •••• 4242"
                      className="w-full rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Exp Month
                      </label>
                      <select
                        value={expiryMonth}
                        onChange={(e) => setExpiryMonth(Number(e.target.value))}
                        className="w-full rounded-xl bg-slate-800 border border-white/10 px-3 py-2.5 text-sm text-white"
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                          <option key={m} value={m}>
                            {String(m).padStart(2, '0')}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Exp Year
                      </label>
                      <select
                        value={expiryYear}
                        onChange={(e) => setExpiryYear(Number(e.target.value))}
                        className="w-full rounded-xl bg-slate-800 border border-white/10 px-3 py-2.5 text-sm text-white"
                      >
                        {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() + i).map(
                          (y) => (
                            <option key={y} value={y}>
                              {y}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Security Code (Verified Locally)
                    </label>
                    <input
                      type="password"
                      required
                      maxLength={4}
                      inputMode="numeric"
                      autoComplete="off"
                      value={cvvInput}
                      onChange={(e) => setCvvInput(e.target.value)}
                      placeholder="•••"
                      className="w-full rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm font-mono text-white"
                    />
                  </div>

                  <div className="sm:col-span-2 space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Pre-Authorization Hold Amount (AED) — Min AED {activeCategoryObj.requiredPreAuthAmount}
                    </label>
                    <input
                      type="number"
                      min={activeCategoryObj.requiredPreAuthAmount}
                      step="50"
                      value={holdAmount}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setHoldAmount(Number.isNaN(val) ? 0 : val);
                      }}
                      className="w-full rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm font-mono text-white"
                    />
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={submittingHold}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:opacity-95 disabled:opacity-50 text-white font-bold text-sm shadow-lg shadow-emerald-500/20 inline-flex items-center justify-center gap-2 transition-all"
            >
              <ShieldCheck className="w-5 h-5" />
              {submittingHold
                ? 'Authorizing Hold & Locking Vehicle…'
                : authorizedHold
                  ? `Retry Reservation Using Hold ${authorizedHold.authorizationCode}`
                  : `Authorize ${fmtAed(holdAmount)} Hold & Confirm Booking`}
            </button>
          </form>

          {/* Summary Sidebar */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 space-y-4 h-fit">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Reservation Summary
            </h3>
            <div className="space-y-2 text-xs text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Category:</span>
                <span className="font-bold text-white">
                  {formatRentalCategoryLabel(activeCategoryObj.category, { short: true })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Duration:</span>
                <span>{activeCategoryObj.quote.totalDays} Day(s)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Pick-up:</span>
                <span>{pickupLocation}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Drop-off:</span>
                <span>{dropoffLocation}</span>
              </div>
              {driverName && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Driver:</span>
                  <span>{driverName}</span>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-white/10 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-300">
                <span>Subtotal:</span>
                <span>{fmtAed(activeCategoryObj.quote.subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>UAE VAT (5%):</span>
                <span>{fmtAed(activeCategoryObj.quote.taxAmount)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-white pt-1">
                <span>Contracted Rental Total:</span>
                <span className="text-cyan-300">
                  {fmtAed(activeCategoryObj.quote.totalAmount)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────── STEP 4: CONFIRMATION RECEIPT ─────────────────── */}
      {step === 4 && receipt && (
        <div className="rounded-2xl border border-emerald-500/35 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/30 p-7 space-y-6 shadow-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-white/10">
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-7 h-7 text-emerald-400" />
              </div>
              <div>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold uppercase tracking-wider">
                  Instant Allocation Confirmed
                </span>
                <h2 className="text-2xl font-black text-white mt-1">
                  Booking {receipt.booking.bookingRef}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Physical fleet unit locked & guaranteed by Pre-Authorization{' '}
                  <span className="font-mono text-emerald-300 font-semibold">
                    {receipt.preauth.authorizationCode}
                  </span>
                </p>
              </div>
            </div>

            <div className="text-left sm:text-right">
              <p className="text-xs text-slate-400">Contracted Total (incl. 5% VAT)</p>
              <p className="text-2xl font-black text-cyan-300">
                {fmtAed(receipt.booking.totalAmount, receipt.booking.currency)}
              </p>
              <p className="text-xs text-emerald-300 font-mono">
                Card Hold: {fmtAed(receipt.preauth.amount, receipt.preauth.currency)} (
                {receipt.preauth.cardBrand} **** {receipt.preauth.cardLast4})
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="rounded-xl bg-slate-950/60 border border-white/10 p-4 space-y-1">
              <p className="text-slate-400 uppercase font-semibold">Allocated Fleet Vehicle</p>
              <p className="text-base font-bold text-white">
                {receipt.booking.vehicle.make} {receipt.booking.vehicle.model}
              </p>
              <p className="font-mono text-cyan-300">
                Plate: {receipt.booking.vehicle.plateNumber} ·{' '}
                {formatRentalCategoryLabel(receipt.booking.vehicleCategory, { short: true })}
              </p>
            </div>

            <div className="rounded-xl bg-slate-950/60 border border-white/10 p-4 space-y-1">
              <p className="text-slate-400 uppercase font-semibold">Pick-Up Schedule</p>
              <p className="text-sm font-bold text-white">{receipt.booking.pickupLocation}</p>
              <p className="text-slate-300">
                {new Date(receipt.booking.pickupDate).toLocaleString('en-AE')}
              </p>
            </div>

            <div className="rounded-xl bg-slate-950/60 border border-white/10 p-4 space-y-1">
              <p className="text-slate-400 uppercase font-semibold">Drop-Off Schedule</p>
              <p className="text-sm font-bold text-white">{receipt.booking.dropoffLocation}</p>
              <p className="text-slate-300">
                {new Date(receipt.booking.dropoffDate).toLocaleString('en-AE')}
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-slate-800/50 border border-white/10 p-4 text-xs text-slate-300 space-y-1">
            <p className="font-bold text-white">Counter Handover Instructions:</p>
            <p>
              Present booking reference <strong className="text-cyan-300 font-mono">{receipt.booking.bookingRef}</strong>, valid UAE/International Driving License, and Emirates ID/Passport at the corporate priority desk. Your security deposit hold (<strong className="text-emerald-300 font-mono">{receipt.preauth.authorizationCode}</strong>) is already verified on file.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/rac-portal/bookings"
              className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors"
            >
              View All Corporate Reservations →
            </Link>
            <button
              type="button"
              onClick={() => {
                setReceipt(null);
                setAuthorizedHold(null);
                setStep(1);
              }}
              className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-white font-semibold text-xs transition-colors"
            >
              Book Another Vehicle
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
