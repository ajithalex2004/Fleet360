'use client';
import React, { useEffect, useState } from 'react';

interface Booking {
  id: string; bookingRef?: string; status: string; type?: string;
  pickupLocation?: string; dropoffLocation?: string;
  scheduledPickup?: string; customerId?: string;
  vehicleId?: string; totalAmount?: number; createdAt: string;
}

interface Props { status?: string; limit?: number; title?: string; }

const statusConfig: Record<string, { color: string; bg: string; icon: string }> = {
  PENDING:   { color: 'text-amber-400',   bg: 'bg-amber-500/20 border-amber-500/30',   icon: '⏳' },
  CONFIRMED: { color: 'text-blue-400',    bg: 'bg-blue-500/20 border-blue-500/30',    icon: '✅' },
  ACTIVE:    { color: 'text-emerald-400', bg: 'bg-emerald-500/20 border-emerald-500/30', icon: '🚗' },
  COMPLETED: { color: 'text-slate-400',   bg: 'bg-slate-500/20 border-slate-500/30',   icon: '🏁' },
  CANCELLED: { color: 'text-red-400',     bg: 'bg-red-500/20 border-red-500/30',     icon: '❌' },
};

export default function BookingsCard({ status, limit = 10, title }: Props) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bookings', { cache: 'no-store' });
      let data = await res.json();
      if (!Array.isArray(data)) data = data.data ?? data.bookings ?? [];
      if (status) data = data.filter((b: Booking) => b.status?.toUpperCase() === status.toUpperCase());
      setBookings(data.slice(0, limit));
      setLastUpdated(new Date());
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchBookings(); }, []);

  const activeCount    = bookings.filter(b => b.status === 'ACTIVE').length;
  const pendingCount   = bookings.filter(b => b.status === 'PENDING').length;
  const confirmedCount = bookings.filter(b => b.status === 'CONFIRMED').length;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/50 backdrop-blur-sm p-5 w-full max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">📋</span>
          <h3 className="text-sm font-semibold text-white">{title ?? 'Bookings'}</h3>
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">{bookings.length}</span>
        </div>
        <button onClick={fetchBookings} className="text-xs text-slate-400 hover:text-white bg-slate-700/60 px-2 py-1 rounded-lg">↻</button>
      </div>

      {!loading && bookings.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {activeCount    > 0 && <span className="text-xs bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 px-2.5 py-1 rounded-full">🚗 {activeCount} Active</span>}
          {confirmedCount > 0 && <span className="text-xs bg-blue-500/15 border border-blue-500/30 text-blue-400 px-2.5 py-1 rounded-full">✅ {confirmedCount} Confirmed</span>}
          {pendingCount   > 0 && <span className="text-xs bg-amber-500/15 border border-amber-500/30 text-amber-400 px-2.5 py-1 rounded-full">⏳ {pendingCount} Pending</span>}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-slate-700/40 rounded-xl animate-pulse" />)}</div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">No bookings found</div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {bookings.map(b => {
            const cfg = statusConfig[b.status?.toUpperCase()] ?? statusConfig.PENDING;
            const created = new Date(b.createdAt);
            return (
              <div key={b.id} className="bg-slate-900/50 border border-white/5 rounded-xl p-3 hover:border-white/15 transition-all">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{cfg.icon}</span>
                    <span className="font-mono text-xs text-orange-400">{b.bookingRef || b.id.slice(0, 8).toUpperCase()}</span>
                    {b.type && <span className="text-xs bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">{b.type}</span>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-lg border ${cfg.bg} ${cfg.color}`}>{b.status}</span>
                </div>
                {(b.pickupLocation || b.dropoffLocation) && (
                  <div className="text-xs text-slate-400 mt-1">
                    {b.pickupLocation && <span>📍 {b.pickupLocation}</span>}
                    {b.pickupLocation && b.dropoffLocation && <span className="mx-1.5">→</span>}
                    {b.dropoffLocation && <span>{b.dropoffLocation}</span>}
                  </div>
                )}
                <div className="flex items-center justify-between mt-1.5 text-xs text-slate-600">
                  <span>{created.toLocaleDateString()}</span>
                  {b.totalAmount != null && <span className="text-emerald-400 font-semibold">AED {Number(b.totalAmount).toLocaleString()}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="text-xs text-slate-600 text-right">Updated {lastUpdated.toLocaleTimeString()}</div>
    </div>
  );
}
