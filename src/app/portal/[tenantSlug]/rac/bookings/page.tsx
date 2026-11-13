'use client';

import React, { Suspense, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { BACK_BUTTON } from '@/lib/ui/toggle';
import { useVerifiedPortalTenant } from '../_use-verified-portal-tenant';

interface Booking {
  id: string;
  customerId?: string | null;
  customer_id?: string | null;
  customerName?: string | null;
  customer_name?: string | null;
  bookingRef?: string | null;
  booking_ref?: string | null;
  vehicleCategory?: string | null;
  vehicle_category?: string | null;
  pickupDate: string;
  pickup_date?: string;
  dropoffDate: string;
  dropoff_date?: string;
  pickupLocation?: string | null;
  pickup_location?: string | null;
  dropoffLocation?: string | null;
  dropoff_location?: string | null;
  totalDays?: number | null;
  total_days?: number | null;
  totalAmount?: number | null;
  total_amount?: number | null;
  currency: string;
  status: string;
  channel?: string | null;
  customer?: {
    fullName?: string | null;
    companyName?: string | null;
  } | null;
}

function unwrapBookings(payload: unknown): Booking[] {
  if (Array.isArray(payload)) return payload as Booking[];
  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    for (const k of ['data', 'bookings', 'items', 'rows']) {
      if (Array.isArray(rec[k])) return rec[k] as Booking[];
    }
  }
  return [];
}

const STATUS_BG: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  CONFIRMED: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  COMPLETED: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  PENDING: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  CANCELLED: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

function PortalRacBookingsInner() {
  const params = useParams() ?? {};
  const search = useSearchParams() ?? new URLSearchParams();
  const tenantSlug = (params?.tenantSlug as string) ?? '';
  const customerId = search.get('customerId') ?? '';
  const guard = useVerifiedPortalTenant(tenantSlug);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = customerId ? `?customerId=${encodeURIComponent(customerId)}&limit=200` : '?limit=200';
      const res = await fetch(`/api/rental/bookings${qs}`, { cache: 'no-store' });
      const data = res.ok ? await res.json() : [];
      const rows = unwrapBookings(data);
      const filtered = customerId
        ? rows.filter((b) => (b.customerId ?? b.customer_id) === customerId)
        : rows;
      setBookings(filtered);
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    if (guard.status !== 'verified') return;
    load();
  }, [guard.status, load]);

  if (guard.status === 'checking') {
    return <div className="p-6 text-slate-500">Verifying tenant access…</div>;
  }

  if (guard.status === 'mismatch') {
    const targetPath = guard.expectedSlug
      ? `/portal/${guard.expectedSlug}/rac/bookings${customerId ? `?customerId=${encodeURIComponent(customerId)}` : ''}`
      : null;
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 space-y-3">
          <p className="text-rose-300 font-semibold text-base">Tenant Access Mismatch</p>
          <p className="text-slate-300 text-sm">
            Your signed-in session belongs to <span className="font-semibold text-white">{guard.tenant.name}</span>
            {guard.tenant.slug ? ` (${guard.tenant.slug})` : ''}, which does not match{' '}
            <span className="font-mono text-rose-200">/portal/{tenantSlug}/rac/bookings</span>. Cross-tenant booking data display has been blocked.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            {targetPath && (
              <Link
                href={targetPath}
                className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold hover:bg-cyan-400 transition-colors"
              >
                Switch to /portal/{guard.expectedSlug}/rac/bookings →
              </Link>
            )}
            <Link
              href="/platform"
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 border border-white/10 text-xs font-semibold hover:bg-slate-700 transition-colors"
            >
              Back to Platform
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (guard.status === 'unauthorized') {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div role="alert" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 space-y-3">
          <p className="text-amber-300 font-semibold text-base">Authentication Required</p>
          <p className="text-slate-300 text-sm">
            Unable to verify your tenant session for <span className="font-mono text-amber-200">/portal/{tenantSlug}/rac/bookings</span>.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 transition-colors"
          >
            Go to Staff Sign In →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <Link
            href={customerId ? `/portal/${tenantSlug}/rac/customers?customerId=${customerId}` : `/portal/${tenantSlug}/rac`}
            className={BACK_BUTTON}
          >
            ← {customerId ? 'Back to customer dashboard' : 'Back to RAC overview'}
          </Link>
          <h1 className="text-2xl font-bold mt-1">{customerId ? 'My Bookings' : 'Rental Bookings'}</h1>
          <p className="text-sm text-slate-400 mt-1">
            {bookings.length} booking{bookings.length === 1 ? '' : 's'} on record
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/portal/${tenantSlug}/rac/customers`}
            className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 text-xs font-medium hover:bg-slate-700 transition-colors"
          >
            👥 Filter by Customer
          </Link>
          <a
            href="/rac-portal"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold hover:bg-emerald-400 transition-colors"
          >
            🏢 Customer B2B Portal ↗
          </a>
        </div>
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
                {!customerId && <th className="px-4 py-3">Customer</th>}
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
              {bookings.map((b) => {
                const ref = b.bookingRef ?? b.booking_ref ?? b.id.slice(0, 8);
                const cat = b.vehicleCategory ?? b.vehicle_category ?? '—';
                const pickup = b.pickupDate ?? b.pickup_date ?? '';
                const dropoff = b.dropoffDate ?? b.dropoff_date ?? '';
                const pickupLoc = b.pickupLocation ?? b.pickup_location;
                const dropoffLoc = b.dropoffLocation ?? b.dropoff_location;
                const days = b.totalDays ?? b.total_days;
                const total = b.totalAmount ?? b.total_amount;
                const custName = b.customer?.companyName ?? b.customer?.fullName ?? b.customerName ?? b.customer_name ?? '—';
                return (
                  <tr key={b.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-mono text-cyan-300 text-xs">{ref}</td>
                    {!customerId && <td className="px-4 py-3 text-slate-300 text-xs">{custName}</td>}
                    <td className="px-4 py-3 text-white">{cat}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs">
                      {pickup ? new Date(pickup).toLocaleDateString('en-GB') : '—'}
                      {pickupLoc && <div className="text-[10px] text-slate-500">{pickupLoc}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs">
                      {dropoff ? new Date(dropoff).toLocaleDateString('en-GB') : '—'}
                      {dropoffLoc && <div className="text-[10px] text-slate-500">{dropoffLoc}</div>}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">{days ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-white font-medium">
                      {total != null ? `${b.currency || 'AED'} ${Number(total).toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{b.channel ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs border ${STATUS_BG[b.status] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                        {b.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500 italic">
        Read-only tenant mirror. Corporate customers can place online bookings with card pre-authorization in the standalone B2B portal (/rac-portal).
      </p>
    </div>
  );
}

export default function PortalRacBookingsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-500">Loading bookings…</div>}>
      <PortalRacBookingsInner />
    </Suspense>
  );
}
