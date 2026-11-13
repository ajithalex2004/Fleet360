'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CalendarCheck,
  Car,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { formatRentalCategoryLabel } from '@/lib/rental/categories';
import { canBookRacPortal, useRacPortalSession } from '../rac-portal-shell';

interface BookingItem {
  id: string;
  bookingRef: string;
  vehicleCategory: string;
  pickupDate: string;
  dropoffDate: string;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  totalDays: number;
  dailyRate: number;
  totalAmount: number;
  currency: string;
  status: string;
  notes: string | null;
  createdAt: string;
  vehicle: {
    id: string;
    make: string;
    model: string;
    plateNumber: string;
  } | null;
  preauth: {
    id: string;
    authorizationCode: string | null;
    amount: number;
    cardBrand: string;
    cardLast4: string;
    status: string;
    expiresAt: string | null;
  } | null;
  agreementId: string | null;
  agreementNo: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  ACTIVE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  PENDING: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  COMPLETED: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  CANCELLED: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

export default function RacPortalBookingsPage() {
  const { user } = useRacPortalSession();
  const canBook = canBookRacPortal(user?.role);

  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const loadBookings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/rac-portal/bookings', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data?.error ?? 'Failed to load corporate reservations.');
        return;
      }
      setBookings(data?.bookings ?? []);
    } catch {
      setLoadError('Network error while loading corporate reservations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookings.filter((b) => {
      if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
      if (!q) return true;
      return (
        b.bookingRef.toLowerCase().includes(q) ||
        b.vehicleCategory.toLowerCase().includes(q) ||
        formatRentalCategoryLabel(b.vehicleCategory).toLowerCase().includes(q) ||
        (b.vehicle?.plateNumber ?? '').toLowerCase().includes(q) ||
        `${b.vehicle?.make ?? ''} ${b.vehicle?.model ?? ''}`.toLowerCase().includes(q) ||
        (b.preauth?.authorizationCode ?? '').toLowerCase().includes(q)
      );
    });
  }, [bookings, query, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <CalendarCheck className="w-6 h-6 text-cyan-400" />
            Corporate Reservations
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Track online & corporate desk reservations, assigned fleet plates, and linked card pre-authorization holds.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => void loadBookings()}
            className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/10 text-slate-300"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canBook && (
            <Link
              href="/rac-portal/book"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 text-white text-xs font-bold shadow-lg shadow-cyan-500/20"
            >
              <Sparkles className="w-4 h-4" />
              New Online Booking
            </Link>
          )}
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-4 text-rose-200 text-xs flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            {loadError}
          </span>
          <button
            type="button"
            onClick={() => void loadBookings()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-100 font-semibold shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search booking ref, vehicle plate, model, or AUTH code…"
            className="w-full rounded-xl bg-slate-900 border border-white/10 pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl bg-slate-900 border border-white/10 px-4 py-2.5 text-sm text-white"
        >
          <option value="ALL">All Statuses ({bookings.length})</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="ACTIVE">Active / On Rent</option>
          <option value="PENDING">Pending</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/80 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-slate-500">Loading corporate reservations…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Car className="w-9 h-9 text-slate-600 mx-auto" />
            <p className="text-sm font-semibold text-slate-300">No matching reservations found</p>
            {canBook && (
              <Link
                href="/rac-portal/book"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-xs font-semibold text-cyan-300"
              >
                Search Live Fleet & Book Online →
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/60 border-b border-white/10 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3.5">Booking Ref</th>
                  <th className="px-4 py-3.5">Vehicle & Plate</th>
                  <th className="px-4 py-3.5">Pick-Up / Drop-Off</th>
                  <th className="px-4 py-3.5">Card Pre-Auth Hold</th>
                  <th className="px-4 py-3.5 text-right">Total</th>
                  <th className="px-4 py-3.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="font-mono text-xs font-bold text-cyan-300">{b.bookingRef}</div>
                      {b.agreementNo && (
                        <div className="text-[10px] text-emerald-300 font-mono mt-0.5">
                          Agreement: {b.agreementNo}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3.5">
                      {b.vehicle ? (
                        <div>
                          <p className="font-semibold text-white">
                            {b.vehicle.make} {b.vehicle.model}
                          </p>
                          <p className="text-xs font-mono text-slate-400">
                            {b.vehicle.plateNumber} ·{' '}
                            {formatRentalCategoryLabel(b.vehicleCategory, { short: true })}
                          </p>
                        </div>
                      ) : (
                        <span className="text-slate-300">
                          {formatRentalCategoryLabel(b.vehicleCategory, { short: true })}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-xs text-slate-300">
                      <div>
                        {new Date(b.pickupDate).toLocaleDateString('en-GB')} →{' '}
                        {new Date(b.dropoffDate).toLocaleDateString('en-GB')} ({b.totalDays}d)
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {b.pickupLocation ?? '—'} → {b.dropoffLocation ?? '—'}
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      {b.preauth ? (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-xs">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="font-mono text-emerald-300 font-semibold">
                            {b.preauth.authorizationCode}
                          </span>
                          <span className="text-slate-400">
                            · **** {b.preauth.cardLast4} · {b.preauth.status}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">Corporate Account</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-right font-mono font-bold text-white">
                      {b.currency} {b.totalAmount.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                    </td>

                    <td className="px-4 py-3.5 text-center">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          STATUS_STYLE[b.status] ?? STATUS_STYLE.PENDING
                        }`}
                      >
                        {b.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
