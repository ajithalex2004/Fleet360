'use client';
import React, { useState, useEffect, useCallback } from 'react';

const SERVICE_STYLE: Record<string, { label: string; icon: string; color: string }> = {
  RENTAL:         { label: 'Rent-a-Car',     icon: '🚗', color: 'text-emerald-400' },
  LEASING:        { label: 'Leasing',         icon: '📋', color: 'text-blue-400'   },
  STAFF_TRANSPORT:{ label: 'Staff Transport', icon: '🚌', color: 'text-purple-400' },
  EXECUTIVE:      { label: 'Executive',       icon: '⭐', color: 'text-amber-400'  },
  LOGISTICS:      { label: 'Logistics',       icon: '🚛', color: 'text-orange-400' },
  SCHOOL_BUS:     { label: 'School Bus',      icon: '🏫', color: 'text-yellow-400' },
};

function parseNotes(notes: string | null): Record<string, string> {
  if (!notes) return {};
  try { return JSON.parse(notes); } catch { return {}; }
}

interface Booking {
  id: string;
  bookingRef: string | null;
  requestorName: string | null;
  requestorEmail: string | null;
  serviceType: string;
  vehicleCategory: string | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  status: string | null;
  createdAt: string | null;
}

export default function PendingApprovals() {
  const [bookings,      setBookings]     = useState<Booking[]>([]);
  const [loading,       setLoading]      = useState(true);
  const [error,         setError]        = useState('');
  const [processingId,  setProcessingId] = useState('');
  const [lastAction,    setLastAction]   = useState<{ ref: string; action: 'APPROVED' | 'REJECTED' } | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res  = await fetch('/api/bookings?status=PENDING&limit=100');
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setBookings(Array.isArray(data) ? data : data.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pending bookings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (booking: Booking, action: 'CONFIRMED' | 'CANCELLED') => {
    try {
      setProcessingId(booking.id);
      const res = await fetch(`/api/bookings/${booking.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: action }),
      });
      if (!res.ok) throw new Error(await res.text());
      const label = action === 'CONFIRMED' ? 'APPROVED' : 'REJECTED';
      setLastAction({ ref: booking.bookingRef ?? booking.id.slice(0, 8), action: label as any });
      setTimeout(() => setLastAction(null), 4000);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to ${action.toLowerCase()} booking`);
    } finally {
      setProcessingId('');
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Pending Approvals</h1>
          <p className="text-slate-400 mt-1">Review and approve pending booking requests</p>
        </div>
        <button onClick={load}
          className="text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-1.5 transition-colors">
          ↻ Refresh
        </button>
      </div>

      {/* Action feedback */}
      {lastAction && (
        <div className={`rounded-xl px-4 py-3 flex items-center gap-3 border ${
          lastAction.action === 'APPROVED'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-red-500/10 border-red-500/30 text-red-300'
        }`}>
          <span>{lastAction.action === 'APPROVED' ? '✅' : '❌'}</span>
          <span className="text-sm font-medium">
            Booking <span className="font-mono">{lastAction.ref}</span> has been {lastAction.action.toLowerCase()}
          </span>
        </div>
      )}

      {/* Summary KPI */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-sm font-medium mb-1">Awaiting Review</p>
            <p className="text-4xl font-bold text-amber-400">{bookings.length}</p>
            <p className="text-slate-500 text-xs mt-1">Pending booking requests</p>
          </div>
          <span className="text-5xl">⏳</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl px-5 py-4 text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Bookings list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-slate-800/60 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-16 text-center">
          <div className="text-5xl mb-3">✅</div>
          <p className="text-slate-300 font-medium">All clear — no pending approvals</p>
          <p className="text-slate-500 text-sm mt-1">All booking requests have been processed</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map(booking => {
            const svc    = SERVICE_STYLE[booking.serviceType] ?? { label: booking.serviceType, icon: '📋', color: 'text-slate-400' };
            const parsed = parseNotes(booking.notes);
            const route  = parsed.origin && parsed.destination
              ? `${parsed.origin} → ${parsed.destination}`
              : parsed.origin ?? parsed.destination ?? booking.vehicleCategory ?? null;

            return (
              <div key={booking.id}
                className="bg-slate-800/50 border border-white/10 hover:border-white/20 rounded-2xl p-5 transition-all">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Top row */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono text-white text-sm font-bold">
                        {booking.bookingRef ?? booking.id.slice(0, 10)}
                      </span>
                      <span className={`flex items-center gap-1 text-xs font-medium ${svc.color}`}>
                        {svc.icon} {svc.label}
                      </span>
                      <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full text-xs font-medium">
                        PENDING
                      </span>
                    </div>

                    {/* Requestor */}
                    <div className="flex items-center gap-4 text-xs text-slate-400">
                      <span>👤 {booking.requestorName ?? 'Unknown'}</span>
                      {booking.requestorEmail && <span>📧 {booking.requestorEmail}</span>}
                    </div>

                    {/* Route / Category */}
                    {route && (
                      <p className="text-slate-300 text-xs">📍 {route}</p>
                    )}

                    {/* Dates */}
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      {booking.startDate && (
                        <span>Start: {new Date(booking.startDate).toLocaleDateString('en-AE', { day:'2-digit', month:'short', year:'numeric' })}</span>
                      )}
                      {booking.endDate && (
                        <span>End: {new Date(booking.endDate).toLocaleDateString('en-AE', { day:'2-digit', month:'short', year:'numeric' })}</span>
                      )}
                      {booking.createdAt && (
                        <span>Submitted: {new Date(booking.createdAt).toLocaleDateString('en-AE')}</span>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleAction(booking, 'CONFIRMED')}
                      disabled={processingId === booking.id}
                      className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 text-xs font-semibold px-4 py-2 rounded-xl transition-all disabled:opacity-40">
                      {processingId === booking.id ? '…' : '✓ Approve'}
                    </button>
                    <button
                      onClick={() => handleAction(booking, 'CANCELLED')}
                      disabled={processingId === booking.id}
                      className="bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 text-xs font-semibold px-4 py-2 rounded-xl transition-all disabled:opacity-40">
                      {processingId === booking.id ? '…' : '✕ Reject'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Guidelines */}
      <div className="bg-violet-500/10 border border-violet-500/30 rounded-2xl p-6">
        <h2 className="text-sm font-bold text-violet-300 mb-3">Approval Guidelines</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-400">
          {[
            'Verify requestor details match company records',
            'Check vehicle availability for requested dates',
            'Ensure budget compliance and authorization level',
            'Review any special requirements or notes',
            'Logistics trips: assign vehicle + driver in Dispatch Board after approval',
            'Approvals automatically notify the requestor by email',
          ].map(g => (
            <div key={g} className="flex items-start gap-2">
              <span className="text-violet-500 flex-shrink-0">•</span>
              <span>{g}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
