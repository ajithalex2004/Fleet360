'use client';
import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTenantPortal } from '../layout';

/* ─────────────────────────── Types ─────────────────────────── */
interface FleetSummary {
  total: number;
  available: number;
  rented: number;
  maintenance: number;
  maxVehicles?: number;
}

interface Booking {
  id: string;
  bookingRef?: string;
  booking_ref?: string;
  customerName?: string;
  customer_name?: string;
  vehicleReg?: string;
  vehicle_reg?: string;
  vehicleModel?: string;
  startDate?: string;
  start_date?: string;
  endDate?: string;
  end_date?: string;
  status: string;
  amount?: number;
  currency?: string;
}

/* ─────────────────────────── Helpers ─────────────────────────── */
function fmt(n: number, currency = 'AED') {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n ?? 0);
}

function fmtDate(d: string | undefined | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short' }); }
  catch { return d; }
}

const STATUS_BADGE: Record<string, string> = {
  CONFIRMED:  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  ACTIVE:     'bg-blue-500/20 text-blue-300 border-blue-500/30',
  PENDING:    'bg-amber-500/20 text-amber-300 border-amber-500/30',
  COMPLETED:  'bg-slate-500/20 text-slate-300 border-slate-500/30',
  CANCELLED:  'bg-red-500/20 text-red-300 border-red-500/30',
  RETURNED:   'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
};

function KpiCard({ icon, label, value, sub, colorClass = 'border-cyan-500/20 bg-cyan-500/5' }: {
  icon: string; label: string; value: string | number; sub?: string; colorClass?: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${colorClass}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-white mt-1">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
}

/* ─────────────────────────── Page ─────────────────────────── */
export default function TenantRACPage() {
  const params = useParams();
  const slug = (params?.tenantSlug as string) ?? '';
  const { tenant } = useTenantPortal();

  const [fleet, setFleet]         = useState<FleetSummary | null>(null);
  const [bookings, setBookings]   = useState<Booking[]>([]);
  const [revenue, setRevenue]     = useState<number | null>(null);
  const [agreements, setAgreements] = useState<number>(0);
  const [loadingFleet, setLoadingFleet]     = useState(true);
  const [loadingBookings, setLoadingBookings] = useState(true);

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';

  useEffect(() => {
    if (!tenant) return;

    // Fleet summary
    fetch(`/api/fleet?tenantId=${tenant.id}&summary=true`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && (d.total !== undefined || d.summary)) {
          setFleet(d.summary ?? d);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingFleet(false));

    // Recent bookings
    fetch(`/api/bookings?tenantId=${tenant.id}&limit=10&sort=createdAt_desc`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const rows = Array.isArray(d) ? d : d?.bookings ?? d?.data ?? [];
        setBookings(rows);
      })
      .catch(() => {})
      .finally(() => setLoadingBookings(false));

    // Monthly revenue from rental
    fetch(`/api/rental?tenantId=${tenant.id}&from=${monthStart}&to=${today}&summary=true`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setRevenue(d?.totalRevenue ?? d?.revenue ?? null))
      .catch(() => {});

    // Agreements count
    fetch(`/api/rental?tenantId=${tenant.id}&type=agreements&count=true`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setAgreements(d?.count ?? d?.total ?? 0))
      .catch(() => {});
  }, [tenant, today, monthStart]);

  const fleetData: FleetSummary = fleet ?? { total: 0, available: 0, rented: 0, maintenance: 0, maxVehicles: undefined };
  const usagePct = fleetData.total > 0 ? Math.round((fleetData.rented / fleetData.total) * 100) : 0;
  const limitPct = fleetData.maxVehicles ? Math.round((fleetData.total / fleetData.maxVehicles) * 100) : 0;
  const nearLimit = fleetData.maxVehicles && limitPct >= 90;

  if (!tenant) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">🚗 Rent-A-Car</h1>
          <p className="text-slate-400 text-sm mt-1">{tenant.name} · RAC module overview</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/portal/${slug}/rac/bookings`}
            className="px-4 py-2 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-sm font-medium hover:bg-cyan-500/30 transition-colors">
            + New Booking
          </Link>
          <Link href={`/portal/${slug}/rac`}
            className="px-4 py-2 rounded-xl bg-slate-700 text-slate-300 border border-white/10 text-sm font-medium hover:bg-slate-600 transition-colors">
            + Add Vehicle
          </Link>
          <Link href={`/portal/${slug}/rac/agreements`}
            className="px-4 py-2 rounded-xl bg-slate-700 text-slate-300 border border-white/10 text-sm font-medium hover:bg-slate-600 transition-colors">
            📋 View Agreements
          </Link>
        </div>
      </div>

      {/* Subscription limit warning */}
      {nearLimit && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 flex items-center gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="text-amber-300 font-semibold text-sm">Vehicle Limit Warning</p>
            <p className="text-amber-400/80 text-xs mt-0.5">
              You have {fleetData.total} of {fleetData.maxVehicles} allowed vehicles ({limitPct}% of limit).
              Contact your account manager to upgrade your plan.
            </p>
          </div>
        </div>
      )}

      {/* Fleet KPIs */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Fleet Summary</h2>
        {loadingFleet ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="rounded-2xl border border-white/5 bg-slate-800/40 h-24 animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon="🚘" label="Total Vehicles" value={fleetData.total}
              sub={fleetData.maxVehicles ? `of ${fleetData.maxVehicles} max` : undefined}
              colorClass="border-slate-500/20 bg-slate-500/5" />
            <KpiCard icon="✅" label="Available" value={fleetData.available}
              colorClass="border-emerald-500/20 bg-emerald-500/5" />
            <KpiCard icon="🔑" label="On Rent" value={fleetData.rented}
              sub={`${usagePct}% utilisation`}
              colorClass="border-blue-500/20 bg-blue-500/5" />
            <KpiCard icon="🔧" label="In Maintenance" value={fleetData.maintenance}
              colorClass="border-amber-500/20 bg-amber-500/5" />
          </div>
        )}
      </section>

      {/* Revenue + agreements row */}
      <section>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <KpiCard icon="💰" label="Revenue This Month"
            value={revenue !== null ? fmt(revenue) : '—'}
            sub="From active rentals"
            colorClass="border-emerald-500/20 bg-emerald-500/5" />
          <KpiCard icon="📋" label="Active Agreements"
            value={agreements || '—'}
            sub="Rental agreements in force"
            colorClass="border-cyan-500/20 bg-cyan-500/5" />
        </div>
      </section>

      {/* Recent bookings */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Recent Bookings</h2>
          <Link href={`/portal/${slug}/rac/bookings`} className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
            View all →
          </Link>
        </div>
        <div className="rounded-2xl border border-white/8 bg-slate-800/20 overflow-hidden">
          {loadingBookings ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : bookings.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-3xl mb-3">📅</p>
              <p className="text-slate-400 text-sm font-medium">No bookings yet</p>
              <p className="text-slate-600 text-xs mt-1">Your rental bookings will appear here once created</p>
              <Link href={`/portal/${slug}/rac/bookings`}
                className="mt-4 inline-flex items-center px-4 py-2 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-sm font-medium hover:bg-cyan-500/30 transition-colors">
                Create first booking →
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Ref</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Vehicle</th>
                  <th className="px-4 py-3 text-center">Dates</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map(b => {
                  const ref     = b.bookingRef ?? b.booking_ref;
                  const cust    = b.customerName ?? b.customer_name;
                  const veh     = b.vehicleReg ?? b.vehicle_reg;
                  const start   = b.startDate ?? b.start_date;
                  const end     = b.endDate ?? b.end_date;
                  const st      = b.status?.toUpperCase() ?? 'PENDING';
                  return (
                    <tr key={b.id} className="border-b border-white/5 hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-cyan-400">{ref ?? b.id.slice(0,8)}</td>
                      <td className="px-4 py-3 text-slate-300 truncate max-w-[120px]">{cust ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{veh ?? b.vehicleModel ?? '—'}</td>
                      <td className="px-4 py-3 text-center text-xs text-slate-500">
                        {fmtDate(start)} → {fmtDate(end)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_BADGE[st] ?? STATUS_BADGE.PENDING}`}>
                          {st}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-white">
                        {b.amount != null ? fmt(b.amount, b.currency) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
