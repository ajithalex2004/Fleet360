'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Booking {
  id: string;
  bookingRef: string | null;
  serviceType: string;
  requestorName: string | null;
  requestorEmail: string | null;
  startDate: string | null;
  endDate: string | null;
  vehicleCategory: string | null;
  vehicleId: string | null;
  status: string | null;
  notes: string | null;
  createdAt: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  PENDING:   'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  APPROVED:  'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  CONFIRMED: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  ACTIVE:    'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  COMPLETED: 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
  CANCELLED: 'bg-red-500/20 text-red-400 border border-red-500/30',
  REJECTED:  'bg-red-500/20 text-red-400 border border-red-500/30',
};

const SERVICE_STYLE: Record<string, { label: string; color: string; icon: string }> = {
  RENTAL:         { label: 'Rent-a-Car',      color: 'text-emerald-400', icon: '🚗' },
  LEASING:        { label: 'Leasing',          color: 'text-blue-400',    icon: '📋' },
  STAFF_TRANSPORT:{ label: 'Staff Transport',  color: 'text-purple-400',  icon: '🚌' },
  EXECUTIVE:      { label: 'Executive',        color: 'text-amber-400',   icon: '⭐' },
  LOGISTICS:      { label: 'Logistics',        color: 'text-orange-400',  icon: '🚛' },
  SCHOOL_BUS:     { label: 'School Bus',       color: 'text-yellow-400',  icon: '🏫' },
};

function parseNotes(notes: string | null): Record<string, string> {
  if (!notes) return {};
  try { return JSON.parse(notes); } catch { return {}; }
}

function statusStyle(s: string | null) {
  return STATUS_STYLE[s ?? ''] ?? 'bg-slate-500/20 text-slate-400 border border-slate-500/20';
}

// ── Service cards ─────────────────────────────────────────────────────────────

const SERVICE_CARDS = [
  {
    type: 'RENTAL',
    title: 'Rent-a-Car',
    desc: 'Short-term vehicle rental for flexible needs',
    icon: '🚗',
    gradient: 'from-emerald-600 to-teal-600',
    badge: 'RENTAL',
    badgeColor: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400',
    href: '/booking-portal/new?type=RENTAL',
  },
  {
    type: 'LEASING',
    title: 'Vehicle Leasing',
    desc: 'Long-term lease contracts for corporate fleets',
    icon: '📋',
    gradient: 'from-blue-600 to-indigo-600',
    badge: 'LEASING',
    badgeColor: 'bg-blue-500/20 border-blue-500/30 text-blue-400',
    href: '/booking-portal/new?type=LEASING',
  },
  {
    type: 'STAFF_TRANSPORT',
    title: 'Staff Transport',
    desc: 'Register for regular shuttle and bus services',
    icon: '🚌',
    gradient: 'from-purple-600 to-violet-600',
    badge: 'SHUTTLE',
    badgeColor: 'bg-purple-500/20 border-purple-500/30 text-purple-400',
    href: '/booking-portal/new?type=STAFF_TRANSPORT',
  },
  {
    type: 'EXECUTIVE',
    title: 'Executive Vehicle',
    desc: 'Premium vehicles for executive travel and events',
    icon: '⭐',
    gradient: 'from-amber-600 to-yellow-600',
    badge: 'PREMIUM',
    badgeColor: 'bg-amber-500/20 border-amber-500/30 text-amber-400',
    href: '/booking-portal/new?type=EXECUTIVE',
  },
  {
    type: 'LOGISTICS',
    title: 'Logistics Trip',
    desc: 'Schedule freight and delivery dispatch with route planning',
    icon: '🚛',
    gradient: 'from-orange-600 to-amber-600',
    badge: 'LOGISTICS',
    badgeColor: 'bg-orange-500/20 border-orange-500/30 text-orange-400',
    href: '/booking-portal/new?type=LOGISTICS',
  },
  {
    type: 'SCHOOL_BUS',
    title: 'School Bus',
    desc: 'Student transportation requests and route enrollment',
    icon: '🏫',
    gradient: 'from-yellow-500 to-amber-500',
    badge: 'SCHOOL',
    badgeColor: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400',
    href: '/booking-portal/new?type=SCHOOL_BUS',
  },
];

const ALL_TYPES = ['ALL', 'RENTAL', 'LEASING', 'STAFF_TRANSPORT', 'EXECUTIVE', 'LOGISTICS', 'SCHOOL_BUS'];

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BookingPortal() {
  const [bookings,    setBookings]    = useState<Booking[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [typeFilter,  setTypeFilter]  = useState('ALL');
  const [search,      setSearch]      = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res  = await fetch('/api/bookings?limit=200');
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setBookings(Array.isArray(data) ? data : data.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = bookings.filter(b => {
    const matchType   = typeFilter === 'ALL' || b.serviceType === typeFilter;
    const matchSearch = !search ||
      [b.bookingRef, b.requestorName, b.requestorEmail, b.serviceType]
        .some(v => v?.toLowerCase().includes(search.toLowerCase()));
    return matchType && matchSearch;
  });

  const counts = ALL_TYPES.reduce((acc, t) => ({
    ...acc,
    [t]: t === 'ALL' ? bookings.length : bookings.filter(b => b.serviceType === t).length,
  }), {} as Record<string, number>);

  // Summary KPIs
  const pending   = bookings.filter(b => b.status === 'PENDING').length;
  const active    = bookings.filter(b => b.status === 'ACTIVE').length;
  const completed = bookings.filter(b => b.status === 'COMPLETED').length;

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Booking Portal</h1>
          <p className="text-slate-400 mt-1">Unified transport booking across all services</p>
        </div>
        <Link href="/booking-portal/new"
          className="bg-gradient-to-r from-violet-600 to-purple-600 hover:opacity-90 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-violet-500/20">
          ➕ New Booking
        </Link>
      </div>

      {/* ── Summary tiles ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Bookings', value: bookings.length, color: 'text-white',         icon: '📋' },
          { label: 'Pending',        value: pending,         color: 'text-amber-400',      icon: '⏳' },
          { label: 'Active',         value: active,          color: 'text-emerald-400',    icon: '🟢' },
          { label: 'Completed',      value: completed,       color: 'text-slate-400',      icon: '✅' },
        ].map(t => (
          <div key={t.label} className="bg-slate-800/50 border border-white/10 rounded-2xl p-4">
            <div className="text-xl mb-1">{t.icon}</div>
            <div className={`text-2xl font-bold ${t.color}`}>{t.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{t.label}</div>
          </div>
        ))}
      </div>

      {/* ── Service cards ── */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">Book a Service</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SERVICE_CARDS.map(card => (
            <Link key={card.type} href={card.href}>
              <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 hover:border-white/30 hover:bg-slate-800/80 transition-all cursor-pointer group h-full">
                <div className="flex items-start justify-between mb-4">
                  <span className="text-4xl">{card.icon}</span>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${card.badgeColor}`}>
                    {card.badge}
                  </span>
                </div>
                <h3 className="text-base font-bold text-white mb-1 group-hover:text-violet-300 transition-colors">
                  {card.title}
                </h3>
                <p className="text-slate-400 text-sm">{card.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Bookings table ── */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">All Bookings</h2>
            <p className="text-slate-500 text-xs mt-0.5">{filtered.length} of {bookings.length} shown</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-1.5 transition-colors">
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Type filter tabs */}
        <div className="px-6 py-3 border-b border-white/10 flex gap-2 overflow-x-auto">
          {ALL_TYPES.map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                typeFilter === t
                  ? 'bg-violet-500/20 text-violet-300 border-violet-500/30'
                  : 'text-slate-400 border-white/10 hover:text-white hover:border-white/20'
              }`}>
              {SERVICE_STYLE[t]?.icon} {t === 'ALL' ? 'All' : SERVICE_STYLE[t]?.label ?? t}
              <span className="ml-1 opacity-60">({counts[t]})</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-white/10">
          <input type="text" placeholder="Search by ref, name, email, service type…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/40"
          />
        </div>

        {error && (
          <div className="px-6 py-4 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm">
            ⚠️ {error}
          </div>
        )}

        {loading ? (
          <div className="px-6 py-8 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-slate-700/40 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-5xl mb-3">📭</div>
            <p className="text-slate-400 font-medium">
              {bookings.length === 0 ? 'No bookings yet' : 'No bookings match your filter'}
            </p>
            <p className="text-slate-600 text-sm mt-1">
              {bookings.length === 0
                ? 'Click "New Booking" above to create your first one'
                : 'Try changing the service type or search term'}
            </p>
            {bookings.length === 0 && (
              <Link href="/booking-portal/new"
                className="mt-4 inline-block bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all">
                Create First Booking
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-6 py-3">Ref</th>
                  <th className="text-left px-6 py-3">Service</th>
                  <th className="text-left px-6 py-3">Requestor</th>
                  <th className="text-left px-6 py-3">Route / Category</th>
                  <th className="text-left px-6 py-3">Start</th>
                  <th className="text-left px-6 py-3">Status</th>
                  <th className="text-right px-6 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(b => {
                  const svc    = SERVICE_STYLE[b.serviceType] ?? { label: b.serviceType, color: 'text-slate-400', icon: '📋' };
                  const parsed = parseNotes(b.notes);
                  const route  = parsed.origin && parsed.destination
                    ? `${parsed.origin} → ${parsed.destination}`
                    : parsed.origin ?? parsed.destination ?? b.vehicleCategory ?? '—';

                  return (
                    <tr key={b.id} className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4">
                        <span className="font-mono text-xs text-white">
                          {b.bookingRef ?? b.id.slice(0, 10)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`flex items-center gap-1.5 text-xs font-medium ${svc.color}`}>
                          {svc.icon} {svc.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="text-slate-200 text-xs">{b.requestorName ?? '—'}</p>
                          {b.requestorEmail && (
                            <p className="text-slate-500 text-xs">{b.requestorEmail}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 max-w-xs">
                        <p className="text-slate-300 text-xs truncate">{route}</p>
                      </td>
                      <td className="px-6 py-4 text-slate-400 text-xs">
                        {b.startDate
                          ? new Date(b.startDate).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' })
                          : '—'}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusStyle(b.status)}`}>
                          {b.status ?? 'PENDING'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {b.serviceType === 'LOGISTICS' ? (
                          <Link href="/logistics/dispatch"
                            className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
                            Dispatch →
                          </Link>
                        ) : (
                          <button className="text-xs text-violet-400 hover:text-violet-300 transition-colors">
                            View
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
