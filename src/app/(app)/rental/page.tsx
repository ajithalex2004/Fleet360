'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Car } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import { useFetchedData, invalidate, invalidatePrefix } from '@/hooks/useFetchedData';

interface Booking {
  id: string;
  bookingRef?: string;
  customer?: { fullName: string };
  customerId: string;
  vehicleCategory?: string;
  pickupDate: string;
  dropoffDate: string;
  totalAmount?: number;
  status?: string;
}

interface DamageClaim {
  id: string;
  status?: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  CONFIRMED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  ACTIVE:    'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  COMPLETED: 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
  CANCELLED: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
};

export default function RentalDashboard() {
  // Session-scoped fetch cache — 1st visit hits the cached server endpoints
  // (unstable_cache + private s-maxage), 2nd visit in the same tab is
  // instant from the in-memory Map.
  const { data: bookingsRaw, loading: bookingsLoading,
          refresh: refreshBookings } =
    useFetchedData<Booking[]>('/api/rental/bookings');
  const { data: claimsRaw, loading: claimsLoading,
          refresh: refreshClaims } =
    useFetchedData<DamageClaim[]>('/api/rental/damage-claims');
  const { data: customersRaw, loading: customersLoading,
          refresh: refreshCustomers } =
    useFetchedData<any[]>('/api/rental/customers');

  const bookings  = Array.isArray(bookingsRaw) ? bookingsRaw : [];
  const claims    = Array.isArray(claimsRaw) ? claimsRaw : [];
  const customers = Array.isArray(customersRaw) ? customersRaw : [];
  const loading   = bookingsLoading || claimsLoading || customersLoading;

  // Expose a manual refresh trigger so other parts of the app can call
  // window.fleet360.refreshRental() after a write.
  useEffect(() => {
    const w = window as unknown as { fleet360?: Record<string, () => void> };
    w.fleet360 = w.fleet360 ?? {};
    w.fleet360.refreshRental = () => {
      refreshBookings(); refreshClaims(); refreshCustomers();
    };
    return () => { delete w.fleet360?.refreshRental; };
  }, [refreshBookings, refreshClaims, refreshCustomers]);

  const activeBookings    = bookings.filter(b => b.status === 'ACTIVE').length;
  const pendingBookings   = bookings.filter(b => b.status === 'PENDING').length;
  const openClaims        = claims.filter(c => c.status === 'OPEN').length;
  const monthRevenue      = bookings
    .filter(b => b.status !== 'CANCELLED')
    .reduce((s, b) => s + Number(b.totalAmount ?? 0), 0);
  const recentBookings    = [...bookings].sort((a,b) => new Date(b.pickupDate).getTime() - new Date(a.pickupDate).getTime()).slice(0, 8);

  const statCards = [
    { title: 'Active Bookings',   value: activeBookings,                    change: `${pendingBookings} pending`,         color: 'from-emerald-500 to-teal-600' },
    { title: 'Total Revenue',     value: `AED ${monthRevenue.toLocaleString()}`, change: 'All time',                      color: 'from-amber-500 to-orange-600' },
    { title: 'Customers',         value: customers.length,                  change: `${customers.filter(c=>c.blacklisted).length} blacklisted`, color: 'from-blue-500 to-indigo-600' },
    { title: 'Open Claims',       value: openClaims,                        change: `${claims.length} total`,             color: 'from-rose-500 to-pink-600' },
  ];

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-[var(--text-muted)] animate-pulse">Loading dashboard...</div>
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card) => (
          <div key={card.title} className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${card.color} p-6`}>
            <div className="text-3xl font-bold text-[var(--text-main)]">{card.value}</div>
            <div className="mt-1 text-sm font-medium text-[var(--text-main)]/80">{card.title}</div>
            <div className="mt-1 text-xs text-[var(--text-main)]/60">{card.change}</div>
          </div>
        ))}
      </div>

      {/* Booking Status Breakdown */}
      <div className="grid grid-cols-5 gap-4">
        {['PENDING','CONFIRMED','ACTIVE','COMPLETED','CANCELLED'].map(s => (
          <div key={s} className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-[var(--text-main)]">{bookings.filter(b => (b.status ?? 'PENDING') === s).length}</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">{s.charAt(0) + s.slice(1).toLowerCase()}</div>
          </div>
        ))}
      </div>

      {/* Recent Bookings */}
      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-main)]">Recent Bookings</h2>
          <a href="/rental/bookings" className="text-sm text-emerald-400 hover:text-emerald-300">View all</a>
        </div>
        {recentBookings.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-8">No bookings yet. <a href="/rental/bookings" className="text-emerald-400 hover:underline">Create one.</a></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">REF</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">CUSTOMER</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">CATEGORY</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">PICKUP</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">RETURN</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">AMOUNT</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {recentBookings.map(b => {
                const status = (b.status ?? 'PENDING').toUpperCase();
                return (
                  <tr key={b.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-[var(--text-main)]">{b.bookingRef ?? b.id.slice(0,8)}</td>
                    <td className="px-4 py-3 text-sm text-[var(--text-main)]">{b.customer?.fullName ?? b.customerId}</td>
                    <td className="px-4 py-3 text-sm text-[var(--text-main)]">{b.vehicleCategory ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-[var(--text-main)]">{new Date(b.pickupDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-sm text-[var(--text-main)]">{new Date(b.dropoffDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-sm font-medium text-[var(--text-main)]">
                      {b.totalAmount ? `AED ${Number(b.totalAmount).toLocaleString()}` : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[status] ?? STATUS_COLORS.PENDING}`}>
                        {status}
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
          { label: 'New Booking',     href: '/rental/bookings',      color: 'from-emerald-600 to-teal-600' },
          { label: 'Add Customer',    href: '/rental/customers',     color: 'from-blue-600 to-indigo-600' },
          { label: 'Check Availability', href: '/rental/availability', color: 'from-amber-600 to-orange-600' },
          { label: 'Damage Claims',   href: '/rental/damage-claims', color: 'from-rose-600 to-pink-600' },
        ].map(link => (
          <a key={link.label} href={link.href}
            className={`block text-center py-3 px-4 rounded-xl bg-gradient-to-r ${link.color} text-white text-sm font-medium hover:opacity-90 transition-all`}>
            {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}
