'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Trip {
  id: string;
  booking_ref: string;
  status: string;
  service_type: string;
  start_date: string | null;
  end_date: string | null;
  origin_location: string | null;
  destination: string | null;
  customer_name: string | null;
  created_at: string | null;
  notes?: string | null;
}

// Full 10-stage badge map + legacy statuses
const STATUS_BADGE: Record<string, string> = {
  PENDING:          'bg-amber-500/20 text-amber-400 border-amber-500/30',
  APPROVED:         'bg-sky-500/20 text-sky-400 border-sky-500/30',
  CONFIRMED:        'bg-sky-500/20 text-sky-400 border-sky-500/30',
  ASSIGNED:         'bg-violet-500/20 text-violet-400 border-violet-500/30',
  DISPATCHED:       'bg-orange-500/20 text-orange-400 border-orange-500/30',
  ENROUTE_PICKUP:   'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  LOADED:           'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  ENROUTE_DELIVERY: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  ACTIVE:           'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  DELIVERED:        'bg-teal-500/20 text-teal-400 border-teal-500/30',
  POD_SUBMITTED:    'bg-green-500/20 text-green-400 border-green-500/30',
  CLOSED:           'bg-slate-500/20 text-slate-400 border-slate-500/30',
  COMPLETED:        'bg-slate-500/20 text-slate-400 border-slate-500/30',
  CANCELLED:        'bg-red-500/20 text-red-400 border-red-500/30',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Created', APPROVED: 'Approved', CONFIRMED: 'Approved',
  ASSIGNED: 'Assigned', DISPATCHED: 'Dispatched',
  ENROUTE_PICKUP: 'En-route Pickup', LOADED: 'Loaded',
  ENROUTE_DELIVERY: 'En-route Delivery', ACTIVE: 'En-route Delivery',
  DELIVERED: 'Delivered', POD_SUBMITTED: 'POD Submitted',
  CLOSED: 'Closed', COMPLETED: 'Closed', CANCELLED: 'Cancelled',
};

const ALL_STATUSES = [
  'ALL', 'PENDING', 'APPROVED', 'ASSIGNED', 'DISPATCHED',
  'ENROUTE_PICKUP', 'LOADED', 'ENROUTE_DELIVERY', 'DELIVERED',
  'POD_SUBMITTED', 'CLOSED', 'CANCELLED',
];

// Group tabs for cleaner UI
const TAB_GROUPS = [
  { key: 'ALL',        label: 'All' },
  { key: 'ACTIVE_ALL', label: '🚛 In Progress' },
  { key: 'DONE_ALL',   label: '✅ Completed' },
  { key: 'CANCELLED',  label: '❌ Cancelled' },
];

const ACTIVE_STATUSES  = new Set(['PENDING','APPROVED','CONFIRMED','ASSIGNED','DISPATCHED','ENROUTE_PICKUP','LOADED','ENROUTE_DELIVERY','ACTIVE']);
const DONE_STATUSES    = new Set(['DELIVERED','POD_SUBMITTED','CLOSED','COMPLETED']);

function parseNotes(notes: string | null | undefined) {
  if (!notes) return {};
  try { return JSON.parse(notes); } catch { return {}; }
}

export default function LogisticsTripsPage() {
  const [trips,     setTrips]     = useState<Trip[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');
  const [search,    setSearch]    = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bookings?serviceType=LOGISTICS&limit=500', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setTrips(Array.isArray(data) ? data : data.data ?? []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = trips.filter(t => {
    const matchTab = activeTab === 'ALL'        ? true
                   : activeTab === 'ACTIVE_ALL'  ? ACTIVE_STATUSES.has(t.status)
                   : activeTab === 'DONE_ALL'    ? DONE_STATUSES.has(t.status)
                   : t.status === activeTab;
    const matchSearch = !search || [t.booking_ref, t.customer_name, t.origin_location, t.destination]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()));
    return matchTab && matchSearch;
  });

  const tabCounts = {
    ALL:        trips.length,
    ACTIVE_ALL: trips.filter(t => ACTIVE_STATUSES.has(t.status)).length,
    DONE_ALL:   trips.filter(t => DONE_STATUSES.has(t.status)).length,
    CANCELLED:  trips.filter(t => t.status === 'CANCELLED').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Trips &amp; Dispatch</h1>
          <p className="text-slate-400 text-sm mt-0.5">Full 10-stage logistics lifecycle</p>
        </div>
        <Link href="/logistics/dispatch"
          className="bg-amber-500 hover:bg-amber-400 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors">
          🚦 Dispatch Board
        </Link>
      </div>

      {/* Group tabs */}
      <div className="flex gap-2 flex-wrap">
        {TAB_GROUPS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              activeTab === tab.key
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                : 'text-slate-400 border-white/10 hover:border-white/20 hover:text-white'
            }`}>
            {tab.label} <span className="ml-1 opacity-60">{tabCounts[tab.key as keyof typeof tabCounts] ?? ''}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by booking ref, customer, origin, destination…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40"
      />

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-800/60 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-16 text-center">
          <div className="text-5xl mb-3">🚛</div>
          <p className="text-slate-400">No logistics trips found</p>
          <p className="text-slate-600 text-xs mt-1">Bookings with service_type = LOGISTICS appear here</p>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3">Ref</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Type</th>
                <th className="text-left px-5 py-3">Route</th>
                <th className="text-left px-5 py-3">Customer</th>
                <th className="text-left px-5 py-3">Start</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(trip => {
                const notes = parseNotes(trip.notes);
                return (
                  <tr key={trip.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-white">{trip.booking_ref}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[trip.status] ?? STATUS_BADGE.PENDING}`}>
                        {STATUS_LABEL[trip.status] ?? trip.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {notes.shipmentType ? (
                        <span className="px-1.5 py-0.5 rounded text-xs font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20">
                          {notes.shipmentType}
                        </span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-300 max-w-xs truncate">
                      {trip.origin_location && trip.destination
                        ? `${trip.origin_location} → ${trip.destination}`
                        : trip.origin_location ?? trip.destination ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-300">{trip.customer_name ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      {trip.start_date ? new Date(trip.start_date).toLocaleDateString('en-AE') : '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link href={`/track/${encodeURIComponent(trip.booking_ref)}`} target="_blank"
                          className="text-xs text-slate-500 hover:text-slate-300 transition-colors" title="Customer tracker">
                          🔗 Track
                        </Link>
                        <Link href={`/logistics/trips/${trip.id}/documents`}
                          className="text-xs text-slate-500 hover:text-slate-300 transition-colors" title="Documents">
                          📎
                        </Link>
                        <Link href={`/logistics/trips/${trip.id}/manifest`}
                          className="text-xs text-slate-500 hover:text-slate-300 transition-colors" title="Cargo manifest">
                          📋
                        </Link>
                        <Link href={`/logistics/dispatch`}
                          className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
                          Board →
                        </Link>
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
  );
}
