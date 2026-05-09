'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

interface Booking {
  id: string;
  bookingRef: string | null;
  vehicleCategory: string | null;
  pickupDate: string;
  dropoffDate: string;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  totalDays: number | null;
  totalAmount: number | null;
  currency: string;
  status: string;
  channel: string | null;
}

const STATUS_BG: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  CONFIRMED: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  COMPLETED: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  PENDING: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  CANCELLED: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

export default function PortalRacBookingsPage() {
  const params = useParams();
  const search = useSearchParams();
  const tenantSlug = (params?.tenantSlug as string) ?? '';
  const customerId = search.get('customerId') ?? '';

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!customerId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/rental/bookings');
      const data = res.ok ? await res.json() : [];
      const mine = (Array.isArray(data) ? data : []).filter((b: any) => b.customerId === customerId);
      setBookings(mine);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  if (!customerId) {
    return (
      <div className="p-6">
        <p className="text-slate-400 text-sm">Pick a customer first.</p>
        <Link href={`/portal/${tenantSlug}/rac`} className="text-cyan-400 underline text-sm">
          ← Back to customer picker
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link href={`/portal/${tenantSlug}/rac/customers?customerId=${customerId}`} className="text-xs text-slate-500 hover:text-cyan-400">
          ← Back to dashboard
        </Link>
        <h1 className="text-2xl font-bold mt-1">My Bookings</h1>
        <p className="text-sm text-slate-400 mt-1">
          {bookings.length} booking{bookings.length === 1 ? '' : 's'} on record
        </p>
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : bookings.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-slate-400">
          No bookings yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr className="text-left text-xs text-slate-400">
                <th className="px-4 py-3">Ref</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Pickup</th>
                <th className="px-4 py-3">Drop-off</th>
                <th className="px-4 py-3 text-right">Days</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-mono text-cyan-300 text-xs">{b.bookingRef ?? b.id.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-white">{b.vehicleCategory ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">
                    {new Date(b.pickupDate).toLocaleDateString('en-GB')}
                    {b.pickupLocation && <div className="text-[10px] text-slate-500">{b.pickupLocation}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">
                    {new Date(b.dropoffDate).toLocaleDateString('en-GB')}
                    {b.dropoffLocation && <div className="text-[10px] text-slate-500">{b.dropoffLocation}</div>}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300">{b.totalDays ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-white font-medium">
                    {b.totalAmount != null ? `${b.currency} ${Number(b.totalAmount).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{b.channel ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs border ${STATUS_BG[b.status] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500 italic">
        Read-only view. To request changes, contact your account manager.
      </p>
    </div>
  );
}
