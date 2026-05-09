'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Car } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';

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
  COMPLETED: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  CANCELLED: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
};

export default function RentalDashboard() {
  const [bookings, setBookings]       = useState<Booking[]>([]);
  const [claims, setClaims]           = useState<DamageClaim[]>([]);
  const [customers, setCustomers]     = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, cRes, custRes] = await Promise.all([
        fetch('/api/rental/bookings'),
        fetch('/api/rental/damage-claims'),
        fetch('/api/rental/customers'),
      ]);
      const [bData, cData, custData] = await Promise.all([bRes.json(), cRes.json(), custRes.json()]);
      setBookings(Array.isArray(bData) ? bData : []);
      setClaims(Array.isArray(cData) ? cData : []);
      setCustomers(Array.isArray(custData) ? custData : []);
    } catch {
      // silently fail, show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

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
      <div className="text-slate-400 animate-pulse">Loading dashboard...</div>
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
            <div className="text-3xl font-bold text-white">{card.value}</div>
            <div className="mt-1 text-sm font-medium text-white/80">{card.title}</div>
            <div className="mt-1 text-xs text-white/60">{card.change}</div>
          </div>
        ))}
      </div>

      {/* Booking Status Breakdown */}
      <div className="grid grid-cols-5 gap-4">
        {['PENDING','CONFIRMED','ACTIVE','COMPLETED','CANCELLED'].map(s => (
          <div key={s} className="bg-slate-800/50 border border-white/10 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-white">{bookings.filter(b => (b.status ?? 'PENDING') === s).length}</div>
            <div className="text-xs text-slate-400 mt-1">{s.charAt(0) + s.slice(1).toLowerCase()}</div>
          </div>
        ))}
      </div>

      {/* Recent Bookings */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Recent Bookings</h2>
          <a href="/rental/bookings" className="text-sm text-emerald-400 hover:text-emerald-300">View all</a>
        </div>
        {recentBookings.length === 0 ? (
          <div className="text-center text-slate-400 py-8">No bookings yet. <a href="/rental/bookings" className="text-emerald-400 hover:underline">Create one.</a></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">REF</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">CUSTOMER</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">CATEGORY</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">PICKUP</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">RETURN</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">AMOUNT</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {recentBookings.map(b => {
                const status = (b.status ?? 'PENDING').toUpperCase();
                return (
                  <tr key={b.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-white">{b.bookingRef ?? b.id.slice(0,8)}</td>
                    <td className="px-4 py-3 text-sm text-white">{b.customer?.fullName ?? b.customerId}</td>
                    <td className="px-4 py-3 text-sm text-white">{b.vehicleCategory ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-200">{new Date(b.pickupDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-sm text-slate-200">{new Date(b.dropoffDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-sm font-medium text-white">
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
