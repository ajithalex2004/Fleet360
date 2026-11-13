'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CalendarCheck,
  Car,
  Clock,
  CreditCard,
  FileSignature,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { formatRentalCategoryLabel } from '@/lib/rental/categories';
import { canBookRacPortal, useRacPortalSession } from './rac-portal-shell';

interface RecentBooking {
  id: string;
  bookingRef: string;
  vehicleCategory: string;
  pickupDate: string;
  dropoffDate: string;
  pickupLocation: string | null;
  totalAmount: number;
  currency: string;
  status: string;
  vehicle: { make: string; model: string; plateNumber: string } | null;
  preauth: {
    authorizationCode: string | null;
    amount: number;
    cardBrand: string;
    cardLast4: string;
    status: string;
  } | null;
}

interface ActiveAgreement {
  id: string;
  agreementNo: string;
  startDate: string;
  endDate: string;
  dailyRate: number;
  totalAmount: number;
  currency: string;
  status: string;
  signedByCustomer: boolean;
  vehicle: { make: string; model: string; plateNumber: string } | null;
}

const STATUS_BADGE: Record<string, string> = {
  CONFIRMED: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  ACTIVE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  PENDING: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  COMPLETED: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  CANCELLED: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

function fmtAed(amount: number, currency = 'AED') {
  return `${currency} ${Number(amount ?? 0).toLocaleString('en-AE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function RacPortalDashboardPage() {
  const { user, customer, tenant, stats, me } = useRacPortalSession();
  const [recentBookings, setRecentBookings] = useState<RecentBooking[]>([]);
  const [activeAgreements, setActiveAgreements] = useState<ActiveAgreement[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadDashboardLists = useCallback(async () => {
    setLoadingLists(true);
    setLoadError(null);
    try {
      const [bRes, aRes] = await Promise.all([
        fetch('/api/rac-portal/bookings', { cache: 'no-store' }),
        fetch('/api/rac-portal/agreements', { cache: 'no-store' }),
      ]);
      if (!bRes.ok || !aRes.ok) {
        setLoadError('Unable to load all live corporate reservations and agreements.');
      }
      if (bRes.ok) {
        const bData = await bRes.json();
        setRecentBookings((bData?.bookings ?? []).slice(0, 5));
      }
      if (aRes.ok) {
        const aData = await aRes.json();
        const ags = (aData?.agreements ?? []) as ActiveAgreement[];
        setActiveAgreements(ags.filter((a) => a.status === 'ACTIVE').slice(0, 5));
      }
    } catch {
      setLoadError('Network error while loading corporate operational summary.');
    } finally {
      setLoadingLists(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboardLists();
  }, [loadDashboardLists]);

  if (!me || !customer || !tenant || !stats) return null;

  const canBook = canBookRacPortal(user?.role);
  const creditLimit = customer.creditLimit;
  const usedPct =
    creditLimit > 0
      ? Math.min(100, Math.round((customer.outstandingBalance / creditLimit) * 100))
      : 0;

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-4 text-rose-200 text-xs flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            {loadError}
          </span>
          <button
            type="button"
            onClick={() => void loadDashboardLists()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-100 font-semibold shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}

      {/* Executive Hero Banner */}
      <div className="rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/40 p-6 lg:p-7 flex flex-col lg:flex-row lg:items-center justify-between gap-5 shadow-xl">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold">
            <Building2 className="w-3.5 h-3.5" />
            {customer.companyName ?? customer.fullName}
            {customer.corporateCode && (
              <span className="text-cyan-400/70 font-mono">· {customer.corporateCode}</span>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Corporate Mobility Command Center
          </h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            Real-time fleet availability from <span className="text-slate-200 font-medium">{tenant.name}</span> with contracted corporate tariffs, instant PCI-safe card pre-authorization holds, digital e-signing, and self-service extensions.
          </p>
        </div>

        {canBook && (
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Link
              href="/rac-portal/book"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 hover:opacity-95 text-white font-bold text-sm shadow-lg shadow-cyan-500/25 transition-all"
            >
              <Sparkles className="w-4 h-4" />
              Search Live Fleet & Book Online
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}
      </div>

      {/* Corporate Credit Facility Bar */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Corporate Credit Facility & Payment Terms
            </p>
            <p className="text-sm text-slate-300 mt-0.5">
              {creditLimit > 0 ? (
                <>
                  Approved Credit Line:{' '}
                  <span className="font-bold text-white">{fmtAed(creditLimit)}</span> · Available:{' '}
                  <span className="font-bold text-emerald-400">
                    {fmtAed(customer.availableCredit)}
                  </span>
                </>
              ) : (
                <>
                  Card Pre-Authorization Backed Corporate Account · Net-{customer.paymentTermsDays || 30} Invoicing
                </>
              )}
            </p>
          </div>
          <span className="px-3 py-1 rounded-full bg-slate-800 border border-white/10 text-xs font-medium text-slate-300">
            Net {customer.paymentTermsDays || 30} Days
          </span>
        </div>

        {creditLimit > 0 && (
          <div className="space-y-1.5">
            <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  usedPct >= 85
                    ? 'bg-rose-500'
                    : usedPct >= 65
                      ? 'bg-amber-500'
                      : 'bg-gradient-to-r from-cyan-500 to-emerald-500'
                }`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Utilized: {fmtAed(customer.outstandingBalance)} ({usedPct}%)</span>
              <span>Remaining Facility: {fmtAed(customer.availableCredit)}</span>
            </div>
          </div>
        )}
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Active Rentals
            </span>
            <FileSignature className="w-5 h-5 text-emerald-400" />
          </div>
          <p className="text-3xl font-black text-white mt-2">{stats.activeAgreementsCount}</p>
          <Link
            href="/rac-portal/agreements"
            className="inline-block mt-2 text-xs text-emerald-300 hover:underline"
          >
            Manage agreements & extensions →
          </Link>
        </div>

        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Open Reservations
            </span>
            <CalendarCheck className="w-5 h-5 text-cyan-400" />
          </div>
          <p className="text-3xl font-black text-white mt-2">{stats.activeBookingsCount}</p>
          <Link
            href="/rac-portal/bookings"
            className="inline-block mt-2 text-xs text-cyan-300 hover:underline"
          >
            View confirmed bookings →
          </Link>
        </div>

        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Active Card Holds
            </span>
            <ShieldCheck className="w-5 h-5 text-amber-400" />
          </div>
          <p className="text-2xl font-black text-white mt-2">
            {fmtAed(stats.activePreAuthTotal)}
          </p>
          <p className="text-xs text-amber-300/80 mt-1">
            {stats.activePreAuthCount} active AUTHORIZED hold{stats.activePreAuthCount === 1 ? '' : 's'}
          </p>
        </div>

        <div
          className={`rounded-2xl border p-5 ${
            customer.outstandingBalance > 0
              ? 'border-rose-500/25 bg-rose-500/5'
              : 'border-slate-700 bg-slate-900/60'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Open Balance
            </span>
            <CreditCard className="w-5 h-5 text-rose-400" />
          </div>
          <p className="text-2xl font-black text-white mt-2">
            {fmtAed(customer.outstandingBalance)}
          </p>
          <Link
            href="/rac-portal/invoices"
            className="inline-block mt-2 text-xs text-cyan-300 hover:underline"
          >
            {customer.outstandingBalance > 0 ? 'View & settle invoices →' : 'All settled · View ledger →'}
          </Link>
        </div>
      </div>

      {/* Live Two-Column Operational Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Reservations */}
        <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Car className="w-4 h-4 text-cyan-400" />
              Recent Online Reservations
            </h2>
            <Link href="/rac-portal/bookings" className="text-xs text-cyan-400 hover:text-cyan-300">
              View all →
            </Link>
          </div>

          {loadingLists ? (
            <div className="py-8 text-center text-xs text-slate-500">Loading reservations…</div>
          ) : recentBookings.length === 0 ? (
            <div className="rounded-xl border border-white/5 bg-slate-950/50 p-6 text-center space-y-2">
              <p className="text-sm text-slate-400">No reservations placed yet.</p>
              {canBook && (
                <Link
                  href="/rac-portal/book"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/25"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Book first corporate vehicle
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {recentBookings.map((b) => (
                <div
                  key={b.id}
                  className="rounded-xl border border-white/5 bg-slate-950/60 p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-cyan-300">
                        {b.bookingRef}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          STATUS_BADGE[b.status] ?? STATUS_BADGE.PENDING
                        }`}
                      >
                        {b.status}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-white mt-1 truncate">
                      {b.vehicle
                        ? `${b.vehicle.make} ${b.vehicle.model} · ${b.vehicle.plateNumber}`
                        : formatRentalCategoryLabel(b.vehicleCategory, { short: true })}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {new Date(b.pickupDate).toLocaleDateString('en-GB')} →{' '}
                      {new Date(b.dropoffDate).toLocaleDateString('en-GB')}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-white">
                      {fmtAed(b.totalAmount, b.currency)}
                    </p>
                    {b.preauth && (
                      <p className="text-[10px] font-mono text-emerald-300 mt-0.5">
                        {b.preauth.authorizationCode} · **** {b.preauth.cardLast4}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Active Agreements */}
        <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <FileSignature className="w-4 h-4 text-emerald-400" />
              Active Fleet Agreements
            </h2>
            <Link
              href="/rac-portal/agreements"
              className="text-xs text-cyan-400 hover:text-cyan-300"
            >
              View all →
            </Link>
          </div>

          {loadingLists ? (
            <div className="py-8 text-center text-xs text-slate-500">Loading agreements…</div>
          ) : activeAgreements.length === 0 ? (
            <div className="rounded-xl border border-white/5 bg-slate-950/50 p-6 text-center space-y-1">
              <p className="text-sm text-slate-400">No vehicles currently out on active agreement.</p>
              <p className="text-xs text-slate-500">
                Confirmed reservations convert to active agreements upon counter handover.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {activeAgreements.map((a) => (
                <div
                  key={a.id}
                  className="rounded-xl border border-white/5 bg-slate-950/60 p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-emerald-300">
                        {a.agreementNo}
                      </span>
                      {a.signedByCustomer ? (
                        <span className="text-[10px] text-emerald-400 font-medium">✓ E-Signed</span>
                      ) : (
                        <span className="text-[10px] text-amber-300 font-medium">Signature Pending</span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-white mt-1 truncate">
                      {a.vehicle
                        ? `${a.vehicle.make} ${a.vehicle.model} · ${a.vehicle.plateNumber}`
                        : 'Assigned Fleet Vehicle'}
                    </p>
                    <p className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Due back {new Date(a.endDate).toLocaleDateString('en-GB')}
                    </p>
                  </div>

                  {canBook && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/rac-portal/agreements?extend=${encodeURIComponent(a.id)}`}
                        className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-xs font-semibold text-cyan-300 transition-colors"
                      >
                        Extend
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
