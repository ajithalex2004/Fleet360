'use client';
import React, { useEffect } from 'react';
import Link from 'next/link';
import { Car } from 'lucide-react';
import { PageHeader, KpiCard, StatGrid } from '@/components/ui/page-theme';
import { useFetchedData } from '@/hooks/useFetchedData';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatRentalCategoryLabel } from '@/lib/rental/categories';

interface Booking {
  id: string;
  bookingRef?: string;
  customer?: { fullName: string; companyName?: string | null };
  customerName?: string;
  customer_name?: string;
  customerId: string;
  vehicleCategory?: string;
  pickupDate: string;
  dropoffDate: string;
  totalAmount?: number;
  status?: string;
}

interface Agreement {
  id: string;
  status?: string;
  totalAmount?: number;
}

interface DamageClaim {
  id: string;
  status?: string;
}

interface CustomerRow {
  id: string;
  blacklisted?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  CONFIRMED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  ACTIVE:    'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  COMPLETED: 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
  CANCELLED: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
};

const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function unwrapArray<T>(d: unknown): T[] {
  if (Array.isArray(d)) return d as T[];
  const obj = asRecord(d);
  if (obj) {
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.bookings)) return obj.bookings as T[];
    if (Array.isArray(obj.agreements)) return obj.agreements as T[];
    if (Array.isArray(obj.claims)) return obj.claims as T[];
    if (Array.isArray(obj.customers)) return obj.customers as T[];
  }
  return [];
}

function unwrapTotal(d: unknown, fallback: number): number {
  const obj = asRecord(d);
  if (!obj) return fallback;
  const direct = toFiniteNumber(obj.total);
  if (direct !== null) return direct;
  const pag = asRecord(obj.pagination);
  if (pag) {
    const pagTotal = toFiniteNumber(pag.total);
    if (pagTotal !== null) return pagTotal;
  }
  const sum = asRecord(obj.summary);
  if (sum) {
    const sumAll = toFiniteNumber(sum.ALL ?? sum.total);
    if (sumAll !== null) return sumAll;
  }
  return fallback;
}

function unwrapSummaryCount(d: unknown, key: string): number | null {
  const obj = asRecord(d);
  if (!obj) return null;
  const sum = asRecord(obj.summary);
  if (!sum) return null;
  return toFiniteNumber(sum[key] ?? sum[key.toLowerCase()]);
}

function extractAnalyticsMetrics(raw: unknown) {
  const root = asRecord(raw);
  if (!root || root.error) return null;
  const data = asRecord(root.data) ?? root;
  const kpis = asRecord(data.kpis) ?? asRecord(data.summary) ?? data;
  const revObj = asRecord(data.revenue) ?? asRecord(data.financials) ?? asRecord(kpis.revenue);
  const claimsObj = asRecord(data.claims) ?? asRecord(data.damageClaims);
  const custObj = asRecord(data.customers);
  const agrObj = asRecord(data.agreements);
  const bkgObj = asRecord(data.bookings);

  const activeRentals =
    toFiniteNumber(kpis.activeRentals) ??
    toFiniteNumber(kpis.activeAgreements) ??
    toFiniteNumber(agrObj?.active) ??
    toFiniteNumber(data.activeRentals) ??
    toFiniteNumber(data.activeAgreements);

  const allTimeRev =
    toFiniteNumber(kpis.allTimeRevenue) ??
    toFiniteNumber(kpis.totalRevenue) ??
    toFiniteNumber(kpis.invoicedRevenue) ??
    toFiniteNumber(revObj?.allTime) ??
    toFiniteNumber(revObj?.total) ??
    toFiniteNumber(revObj?.totalRevenue) ??
    toFiniteNumber(revObj?.invoicedTotal) ??
    toFiniteNumber(data.totalRevenue);

  const periodRev =
    toFiniteNumber(kpis.periodRevenue) ??
    toFiniteNumber(kpis.mtdRevenue) ??
    toFiniteNumber(kpis.monthlyRevenue) ??
    toFiniteNumber(typeof kpis.revenue === 'number' ? kpis.revenue : null) ??
    toFiniteNumber(revObj?.period) ??
    toFiniteNumber(revObj?.mtd) ??
    toFiniteNumber(data.periodRevenue) ??
    toFiniteNumber(typeof data.revenue === 'number' ? data.revenue : null);

  const openClaims =
    toFiniteNumber(kpis.openClaims) ??
    toFiniteNumber(kpis.openDamageClaims) ??
    toFiniteNumber(claimsObj?.open) ??
    toFiniteNumber(claimsObj?.OPEN) ??
    toFiniteNumber(data.openClaims);

  const totalClaims =
    toFiniteNumber(kpis.totalClaims) ??
    toFiniteNumber(claimsObj?.total) ??
    toFiniteNumber(claimsObj?.ALL);

  const totalCustomers =
    toFiniteNumber(kpis.totalCustomers) ??
    toFiniteNumber(custObj?.total) ??
    toFiniteNumber(data.totalCustomers);

  const blacklistedCustomers =
    toFiniteNumber(kpis.blacklistedCustomers) ??
    toFiniteNumber(custObj?.blacklisted);

  // Extract booking status breakdown if provided as Record or Array
  const statusCounts: Partial<Record<string, number>> = {};
  const rawBreakdown =
    data.bookingsByStatus ??
    data.bookingBreakdown ??
    data.statusBreakdown ??
    kpis.bookingsByStatus ??
    kpis.bookingBreakdown ??
    bkgObj?.byStatus ??
    bkgObj?.breakdown;

  if (Array.isArray(rawBreakdown)) {
    for (const item of rawBreakdown) {
      const row = asRecord(item);
      if (row) {
        const st = String(row.status ?? row.key ?? '').toUpperCase();
        const cnt = toFiniteNumber(row.count ?? row._count ?? row.total);
        if (st && cnt !== null) statusCounts[st] = cnt;
      }
    }
  } else {
    const mapObj = asRecord(rawBreakdown);
    if (mapObj) {
      for (const [k, v] of Object.entries(mapObj)) {
        const cnt = toFiniteNumber(v);
        if (cnt !== null) statusCounts[k.toUpperCase()] = cnt;
      }
    }
  }

  return {
    activeRentals,
    allTimeRev,
    periodRev,
    openClaims,
    totalClaims,
    totalCustomers,
    blacklistedCustomers,
    statusCounts: Object.keys(statusCounts).length > 0 ? statusCounts : null,
  };
}

export default function RentalDashboard() {
  const { tLabel } = useLanguage();

  const { data: analyticsRaw, refresh: refreshAnalytics } =
    useFetchedData<unknown>('/api/rental/analytics/dashboard');
  const { data: bookingsRaw, loading: bookingsLoading, refresh: refreshBookings } =
    useFetchedData<unknown>('/api/rental/bookings?limit=100');
  const { data: agreementsRaw, loading: agreementsLoading, refresh: refreshAgreements } =
    useFetchedData<unknown>('/api/rental/agreements?limit=100');
  const { data: claimsRaw, loading: claimsLoading, refresh: refreshClaims } =
    useFetchedData<unknown>('/api/rental/damage-claims?limit=100');
  const { data: customersRaw, loading: customersLoading, refresh: refreshCustomers } =
    useFetchedData<unknown>('/api/rental/customers?limit=100');

  const analytics  = extractAnalyticsMetrics(analyticsRaw);
  const bookings   = unwrapArray<Booking>(bookingsRaw);
  const agreements = unwrapArray<Agreement>(agreementsRaw);
  const claims     = unwrapArray<DamageClaim>(claimsRaw);
  const customers  = unwrapArray<CustomerRow>(customersRaw);
  const loading    = bookingsLoading || agreementsLoading || claimsLoading || customersLoading;

  useEffect(() => {
    const w = window as unknown as { fleet360?: Record<string, () => void> };
    w.fleet360 = w.fleet360 ?? {};
    w.fleet360.refreshRental = () => {
      refreshAnalytics();
      refreshBookings();
      refreshAgreements();
      refreshClaims();
      refreshCustomers();
    };
    return () => { delete w.fleet360?.refreshRental; };
  }, [refreshAnalytics, refreshBookings, refreshAgreements, refreshClaims, refreshCustomers]);

  const getBookingStatusCount = (statusKey: string): number => {
    const fromAnalytics = analytics?.statusCounts?.[statusKey];
    if (fromAnalytics !== undefined) return fromAnalytics;
    const fromSummary = unwrapSummaryCount(bookingsRaw, statusKey);
    if (fromSummary !== null) return fromSummary;
    return bookings.filter((b) => (b.status ?? 'PENDING').toUpperCase() === statusKey).length;
  };

  const activeBookings  = getBookingStatusCount('ACTIVE');
  const pendingBookings = getBookingStatusCount('PENDING');
  const activeAgrCount  =
    unwrapSummaryCount(agreementsRaw, 'ACTIVE') ??
    agreements.filter((a) => (a.status ?? '').toUpperCase() === 'ACTIVE').length;

  const activeRentalsValue =
    analytics?.activeRentals ?? Math.max(activeBookings, activeAgrCount);

  const totalCustomersCount =
    analytics?.totalCustomers ?? unwrapTotal(customersRaw, customers.length);
  const blacklistedCount =
    analytics?.blacklistedCustomers ??
    unwrapSummaryCount(customersRaw, 'blacklisted') ??
    customers.filter((c) => c.blacklisted).length;

  const totalClaimsCount =
    analytics?.totalClaims ?? unwrapTotal(claimsRaw, claims.length);
  const openClaimsCount =
    analytics?.openClaims ??
    unwrapSummaryCount(claimsRaw, 'OPEN') ??
    claims.filter((c) => (c.status ?? '').toUpperCase() === 'OPEN').length;

  const fallbackBookingsRevenue = bookings
    .filter((b) => (b.status ?? '').toUpperCase() !== 'CANCELLED')
    .reduce((s, b) => s + (Number(b.totalAmount) || 0), 0);
  const fallbackAgreementsRevenue = agreements
    .filter((a) => (a.status ?? '').toUpperCase() !== 'CANCELLED')
    .reduce((s, a) => s + (Number(a.totalAmount) || 0), 0);
  const fallbackRevenue = Math.max(fallbackBookingsRevenue, fallbackAgreementsRevenue);

  let revenueAmount = fallbackRevenue;
  let revenueSublabel = tLabel('All time');
  if (analytics?.allTimeRev != null && (analytics.allTimeRev > 0 || fallbackRevenue === 0)) {
    revenueAmount = analytics.allTimeRev;
    revenueSublabel =
      analytics.periodRev != null && analytics.periodRev !== analytics.allTimeRev
        ? `${tLabel('Period')}: AED ${analytics.periodRev.toLocaleString()}`
        : tLabel('All time');
  } else if (analytics?.periodRev != null && (analytics.periodRev > 0 || fallbackRevenue === 0)) {
    revenueAmount = analytics.periodRev;
    revenueSublabel = tLabel('Current period');
  }

  const totalBookingsCount = unwrapTotal(bookingsRaw, bookings.length);

  const recentBookings = [...bookings]
    .sort((a, b) => new Date(b.pickupDate).getTime() - new Date(a.pickupDate).getTime())
    .slice(0, 8);

  const statCards = [
    {
      title: 'Active Rentals',
      value: activeRentalsValue,
      change: `${pendingBookings} ${tLabel('pending')} · ${activeAgrCount} ${tLabel('agreements')}`,
      accent: 'emerald' as const,
    },
    {
      title: 'Total Revenue',
      value: `AED ${revenueAmount.toLocaleString()}`,
      change: revenueSublabel,
      accent: 'amber' as const,
    },
    {
      title: 'Customers',
      value: totalCustomersCount,
      change: `${blacklistedCount} ${tLabel('blacklisted')}`,
      accent: 'cyan' as const,
    },
    {
      title: 'Open Claims',
      value: openClaimsCount,
      change: `${totalClaimsCount} ${tLabel('total')}`,
      accent: 'rose' as const,
    },
  ];

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-[var(--text-muted)] animate-pulse">{tLabel('Loading dashboard...')}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="RAC Dashboard"
        subtitle="Rent-a-Car — Real-time overview"
        icon={Car}
        accent="emerald"
      />

      {/* Stat Cards */}
      <StatGrid cols={4}>
        {statCards.map((card) => (
          <KpiCard
            key={card.title}
            label={card.title}
            value={card.value}
            sub={card.change}
            accent={card.accent}
          />
        ))}
      </StatGrid>

      {/* Booking Status Breakdown */}
      <StatGrid cols={5}>
        {BOOKING_STATUSES.map((s, idx) => {
          const accents = ['amber', 'cyan', 'emerald', 'slate', 'rose'] as const;
          return (
            <KpiCard
              key={s}
              label={s}
              value={getBookingStatusCount(s)}
              accent={accents[idx % accents.length]}
            />
          );
        })}
      </StatGrid>

      {/* Recent Bookings */}
      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-main)]">
            {tLabel('Recent Bookings')}
            <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
              ({totalBookingsCount} {tLabel('total')})
            </span>
          </h2>
          <Link href="/rental/bookings" className="text-sm text-emerald-400 hover:text-emerald-300">
            {tLabel('View all')}
          </Link>
        </div>
        {recentBookings.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-8">
            {tLabel('No bookings yet.')}{' '}
            <Link href="/rental/bookings" className="text-emerald-400 hover:underline">
              {tLabel('Create one.')}
            </Link>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="px-4 py-3 text-left rtl:text-right text-xs font-semibold text-[var(--text-muted)]">{tLabel('REF')}</th>
                <th className="px-4 py-3 text-left rtl:text-right text-xs font-semibold text-[var(--text-muted)]">{tLabel('CUSTOMER')}</th>
                <th className="px-4 py-3 text-left rtl:text-right text-xs font-semibold text-[var(--text-muted)]">{tLabel('CATEGORY')}</th>
                <th className="px-4 py-3 text-left rtl:text-right text-xs font-semibold text-[var(--text-muted)]">{tLabel('PICKUP')}</th>
                <th className="px-4 py-3 text-left rtl:text-right text-xs font-semibold text-[var(--text-muted)]">{tLabel('RETURN')}</th>
                <th className="px-4 py-3 text-left rtl:text-right text-xs font-semibold text-[var(--text-muted)]">{tLabel('AMOUNT')}</th>
                <th className="px-4 py-3 text-left rtl:text-right text-xs font-semibold text-[var(--text-muted)]">{tLabel('STATUS')}</th>
              </tr>
            </thead>
            <tbody>
              {recentBookings.map((b) => {
                const status = (b.status ?? 'PENDING').toUpperCase();
                return (
                  <tr key={b.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-[var(--text-main)] font-mono">
                      <Link href={`/rental/bookings?id=${encodeURIComponent(b.id)}`} className="hover:text-emerald-400">
                        {b.bookingRef ?? b.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--text-main)]">
                      {b.customer?.companyName ?? b.customer?.fullName ?? b.customerName ?? b.customer_name ?? b.customerId}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--text-main)]">
                      {b.vehicleCategory ? formatRentalCategoryLabel(b.vehicleCategory) : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--text-main)]">
                      {b.pickupDate ? new Date(b.pickupDate).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--text-main)]">
                      {b.dropoffDate ? new Date(b.dropoffDate).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-[var(--text-main)]">
                      {b.totalAmount != null ? `AED ${Number(b.totalAmount).toLocaleString()}` : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[status] ?? STATUS_COLORS.PENDING}`}>
                        {tLabel(status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Counter (Pick-Up & Return)', href: '/rental/counter',      color: 'from-teal-600 to-cyan-600' },
          { label: 'New Booking',                href: '/rental/bookings',     color: 'from-emerald-600 to-teal-600' },
          { label: 'Master Price List',          href: '/rental/rates',        color: 'from-amber-600 to-orange-600' },
          { label: 'Customers & B2B',            href: '/rental/customers',    color: 'from-blue-600 to-indigo-600' },
        ].map((link) => (
          <Link
            key={link.label}
            href={link.href}
            className={`block text-center py-3 px-4 rounded-xl bg-gradient-to-r ${link.color} text-white text-sm font-medium hover:opacity-90 transition-all`}
          >
            {tLabel(link.label)}
          </Link>
        ))}
      </div>
    </div>
  );
}
