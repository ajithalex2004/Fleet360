'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Smartphone,
  Plus,
  MessageSquare,
  CalendarCheck,
  Clock,
  CheckCircle2,
  FileCheck,
  CarFront,
  Sparkles,
  Truck,
  ShieldCheck,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import { usePermissions } from '@/contexts/PermissionContext';
import { PassengerDriverChat } from '@/components/booking/PassengerDriverChat';

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

export const SERVICE_MODULE_MAP: Record<string, string> = {
  RENTAL:          'rental',
  LEASING:         'leasing',
  STAFF_TRANSPORT: 'bus-ops',
  EXECUTIVE:       'dispatch',
  LOGISTICS:       'logistics',
  SCHOOL_BUS:      'school-bus',
};

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
  const { hasModule, tenant } = usePermissions();
  const [bookings,    setBookings]    = useState<Booking[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [typeFilter,  setTypeFilter]  = useState('ALL');
  const [search,      setSearch]      = useState('');

  // Dynamically filter service cards based on tenant's enabled modules
  const visibleCards = React.useMemo(() => {
    if (!tenant || !tenant.enabledModules || tenant.enabledModules.length === 0) {
      return SERVICE_CARDS;
    }
    return SERVICE_CARDS.filter((card) => {
      const requiredModule = SERVICE_MODULE_MAP[card.type];
      return !requiredModule || hasModule(requiredModule);
    });
  }, [hasModule, tenant]);

  const activeTypes = React.useMemo(() => {
    const cardTypes = visibleCards.map((c) => c.type);
    return ['ALL', ...cardTypes];
  }, [visibleCards]);

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

  const [activeChat, setActiveChat] = useState<{
    ref: string;
    model?: string;
    plate?: string;
    driverName?: string;
  } | null>(null);

  useEffect(() => { load(); }, [load]);

  const filtered = bookings.filter(b => {
    const matchType   = typeFilter === 'ALL' || b.serviceType === typeFilter;
    const matchSearch = !search ||
      [b.bookingRef, b.requestorName, b.requestorEmail, b.serviceType]
        .some(v => v?.toLowerCase().includes(search.toLowerCase()));
    return matchType && matchSearch;
  });

  const counts = activeTypes.reduce((acc, t) => ({
    ...acc,
    [t]: t === 'ALL' ? bookings.length : bookings.filter(b => b.serviceType === t).length,
  }), {} as Record<string, number>);

  // Summary KPIs
  const pending   = bookings.filter(b => b.status === 'PENDING').length;
  const active    = bookings.filter(b => b.status === 'ACTIVE').length;
  const completed = bookings.filter(b => b.status === 'COMPLETED').length;

  return (
    <div className="obsidian-glass dark [color-scheme:dark] space-y-6 text-white bg-[#0b0d14]">
      {/* ── Executive Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            Fleet360 <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400 bg-clip-text text-transparent">Booking Portal</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">Multi-modal booking & freight dispatch console across all transport domains</p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/booking-portal/new"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 hover:scale-[1.02] hover:brightness-110 transition-all"
          >
            <Plus className="w-4 h-4 text-white font-bold" /> New Booking Request
          </Link>
        </div>
      </div>

      {/* ── Summary tiles ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Bookings', value: bookings.length, color: 'text-white', icon: CalendarCheck, iconColor: 'text-cyan-400' },
          { label: 'Pending Approval', value: pending, color: 'text-cyan-400', icon: Clock, iconColor: 'text-cyan-400' },
          { label: 'Active Trips', value: active, color: 'text-emerald-400', icon: CheckCircle2, iconColor: 'text-emerald-400' },
          { label: 'Completed', value: completed, color: 'text-slate-400', icon: FileCheck, iconColor: 'text-slate-400' },
        ].map(t => {
          const Icon = t.icon;
          return (
            <div key={t.label} className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl shadow-black/80">
              <div className="w-10 h-10 rounded-xl bg-slate-950/80 border border-white/10 flex items-center justify-center mb-3">
                <Icon className={`w-5 h-5 ${t.iconColor}`} />
              </div>
              <div className={`text-2xl font-extrabold font-mono ${t.color}`}>{t.value}</div>
              <div className="text-xs text-cyan-400 mt-1 uppercase font-bold tracking-wider">{t.label}</div>
            </div>
          );
        })}
      </div>

      {/* ── Service cards ── */}
      <div>
        <h2 className="text-lg font-extrabold text-white mb-4">Book by Service Category</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleCards.map(card => (
            <Link key={card.type} href={card.href}>
              <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 hover:border-cyan-400/60 rounded-2xl p-6 transition-all duration-200 hover:scale-[1.02] active:scale-100 flex flex-col justify-between space-y-4 shadow-xl shadow-black/80 group cursor-pointer h-full">
                <div>
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-slate-950/80 border border-white/10 flex items-center justify-center text-cyan-400 group-hover:scale-110 group-hover:border-cyan-400 shadow-lg shadow-cyan-500/10 transition-all">
                      {card.type === 'RENTAL' && <CarFront className="w-6 h-6 text-cyan-400" />}
                      {card.type === 'LEASING' && <FileCheck className="w-6 h-6 text-cyan-400" />}
                      {card.type === 'STAFF_TRANSPORT' && <CarFront className="w-6 h-6 text-cyan-400" />}
                      {card.type === 'EXECUTIVE' && <Sparkles className="w-6 h-6 text-cyan-400" />}
                      {card.type === 'LOGISTICS' && <Truck className="w-6 h-6 text-cyan-400" />}
                      {card.type === 'SCHOOL_BUS' && <ShieldCheck className="w-6 h-6 text-cyan-400" />}
                    </div>
                    <span className="text-[10px] font-mono font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 px-2.5 py-1 rounded-full tracking-wider">
                      {card.badge}
                    </span>
                  </div>
                  <h3 className="text-base font-extrabold text-white mb-1 group-hover:text-cyan-300 transition-colors">
                    {card.title}
                  </h3>
                  <p className="text-slate-400 text-xs leading-relaxed">{card.desc}</p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-white/5 text-xs text-cyan-400 font-semibold group-hover:translate-x-1 transition-transform">
                  <span>Start Booking</span>
                  <span>→</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Bookings table ── */}
      <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl shadow-black/80">
        <div className="px-6 py-4 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-cyan-950/30 via-slate-900/30 to-transparent">
          <div>
            <h2 className="text-base font-bold text-white">All Bookings & Manifests</h2>
            <p className="text-slate-400 text-xs mt-0.5">{filtered.length} of {bookings.length} shown</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="text-xs text-cyan-300 hover:text-white border border-white/10 bg-slate-950/80 rounded-lg px-3 py-1.5 transition-colors">
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Type filter tabs */}
        <div className="px-6 py-3 border-b border-amber-500/15 flex gap-2 overflow-x-auto bg-zinc-950/40">
          {activeTypes.map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                typeFilter === t
                  ? 'bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-600 text-black shadow-md shadow-amber-500/25'
                  : 'text-zinc-400 border border-white/5 hover:text-white hover:bg-zinc-900/60'
              }`}>
              {SERVICE_STYLE[t]?.icon} {t === 'ALL' ? 'All Services' : SERVICE_STYLE[t]?.label ?? t}
              <span className="ml-1 opacity-70">({counts[t] ?? 0})</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-amber-500/15 bg-zinc-950/20">
          <input type="text" placeholder="Search by reference number, requestor, email, or service…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-zinc-900/90 border border-amber-500/20 rounded-xl px-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
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
            <p className="text-zinc-300 font-medium">
              {bookings.length === 0 ? 'No bookings recorded yet' : 'No bookings match your filter criteria'}
            </p>
            <p className="text-zinc-500 text-sm mt-1">
              {bookings.length === 0
                ? 'Click "New Booking Request" above to dispatch your first booking'
                : 'Try changing the service category or search term'}
            </p>
            {bookings.length === 0 && (
              <Link href="/booking-portal/new"
                className="mt-5 inline-block bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-600 text-black font-bold text-sm px-6 py-3 rounded-xl shadow-lg shadow-amber-500/20 hover:scale-[1.02] transition-all">
                Create First Booking →
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-amber-500/20 text-amber-300/70 text-[11px] font-mono uppercase tracking-wider bg-zinc-950/60">
                  <th className="text-left px-6 py-3.5">Ref #</th>
                  <th className="text-left px-6 py-3.5">Service Category</th>
                  <th className="text-left px-6 py-3.5">Requestor & Contact</th>
                  <th className="text-left px-6 py-3.5">Corridor / Asset Class</th>
                  <th className="text-left px-6 py-3.5">Schedule</th>
                  <th className="text-left px-6 py-3.5">Status</th>
                  <th className="text-right px-6 py-3.5">Dispatch Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(b => {
                  const svc    = SERVICE_STYLE[b.serviceType] ?? { label: b.serviceType, color: 'text-zinc-400', icon: '📋' };
                  const parsed = parseNotes(b.notes);
                  const route  = parsed.origin && parsed.destination
                    ? `${parsed.origin} → ${parsed.destination}`
                    : parsed.origin ?? parsed.destination ?? b.vehicleCategory ?? '—';

                  return (
                    <tr key={b.id} className="border-b border-white/5 last:border-0 hover:bg-zinc-900/60 transition-colors">
                      <td className="px-6 py-4">
                        <span className="font-mono text-xs font-bold text-amber-400">
                          {b.bookingRef ?? b.id.slice(0, 10)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`flex items-center gap-1.5 text-xs font-semibold ${svc.color}`}>
                          {svc.icon} {svc.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="text-zinc-200 text-xs font-medium">{b.requestorName ?? '—'}</p>
                          {b.requestorEmail && (
                            <p className="text-zinc-500 text-[11px] font-mono">{b.requestorEmail}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 max-w-xs">
                        <p className="text-zinc-300 text-xs truncate">{route}</p>
                      </td>
                      <td className="px-6 py-4 text-zinc-400 text-xs font-mono">
                        {b.startDate
                          ? new Date(b.startDate).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' })
                          : '—'}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-mono font-bold ${statusStyle(b.status)}`}>
                          {b.status ?? 'PENDING'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() =>
                              setActiveChat({
                                ref: b.bookingRef || b.id.slice(0, 10),
                                model: parsed.sampleModels || 'Assigned Vehicle',
                                plate: 'DXB A 10293',
                                driverName: 'Ahmed Al-Sayed',
                              })
                            }
                            className="inline-flex items-center gap-1 text-xs text-amber-300 hover:text-white bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1 rounded-lg border border-amber-500/30 transition-colors"
                          >
                            <MessageSquare className="w-3 h-3 text-amber-400" />
                            Chat
                          </button>
                          {b.serviceType === 'LOGISTICS' ? (
                            <Link href="/logistics/dispatch"
                              className="text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors">
                              Dispatch →
                            </Link>
                          ) : (
                            <button className="text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors">
                              View
                            </button>
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

      {/* Floating Passenger - Driver Live Chat Drawer */}
      {activeChat && (
        <PassengerDriverChat
          isOpen={!!activeChat}
          onClose={() => setActiveChat(null)}
          bookingRef={activeChat.ref}
          driverName={activeChat.driverName}
          vehicleModel={activeChat.model}
          vehiclePlate={activeChat.plate}
        />
      )}
    </div>
  );
}
