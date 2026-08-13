'use client';

/**
 * RAC RevPAC Dashboard — the morning-coffee page for fleet operators.
 * Headline KPI is RevPAC (Revenue Per Available Car / day) with industry
 * benchmark colour-coding. Plus utilization, ADR, ALoR, conversion %,
 * damage recovery, per-category and per-channel breakdowns.
 */

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, RefreshCw, TrendingUp, Car, Sparkles } from 'lucide-react';

interface CategoryKpis {
  category: string;
  fleetSize: number;
  rentedCarDays: number;
  availableCarDays: number;
  utilizationPct: number;
  totalRevenue: number;
  revPAC: number;
  averageDailyRate: number;
  bookingCount: number;
}
interface ChannelKpis {
  channel: string;
  bookingCount: number;
  revenue: number;
  revenuePctOfTotal: number;
  averageLengthOfRental: number;
}
interface AnalyticsResult {
  periodFrom: string;
  periodTo: string;
  daysInPeriod: number;
  fleetSize: number;
  totalBookings: number;
  totalRevenue: number;
  totalRentedCarDays: number;
  totalAvailableCarDays: number;
  fleetUtilizationPct: number;
  revPAC: number;
  averageDailyRate: number;
  averageLengthOfRental: number;
  pendingBookings: number;
  confirmedBookings: number;
  activeBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  conversionPct: number;
  damageClaimsCount: number;
  damageBilledTotal: number;
  damageRecoveredTotal: number;
  damageRecoveryRatePct: number;
  byCategory: CategoryKpis[];
  byChannel: ChannelKpis[];
  snapshotAt: string;
}

const CHANNEL_COLORS: Record<string, string> = {
  DIRECT: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  CORPORATE: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  AGENCY: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  ONLINE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  UNKNOWN: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

function todayMinusDays(days: number): string {
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function revPacTone(revPac: number): { label: string; classes: string } {
  if (revPac >= 350) return { label: 'Best-in-class', classes: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
  if (revPac >= 200) return { label: 'On benchmark', classes: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' };
  if (revPac >= 100) return { label: 'Below benchmark', classes: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
  return { label: 'Underperforming', classes: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
}

function utilizationTone(pct: number): string {
  if (pct >= 75) return 'text-emerald-300';
  if (pct >= 55) return 'text-cyan-300';
  if (pct >= 35) return 'text-amber-300';
  return 'text-rose-300';
}

export default function RevpacDashboardPage() {
  const [from, setFrom] = useState(todayMinusDays(30));
  const [to, setTo] = useState(todayMinusDays(0));
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rental/analytics/dashboard?from=${from}&to=${to}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Server returned ${res.status}`);
        return;
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const tone = data ? revPacTone(data.revPAC) : null;

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/rental" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-400">
            <ChevronLeft className="h-3 w-3" /> Back to dashboard
          </Link>
          <h1 className="text-3xl font-bold text-white mt-2 flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-teal-400" />
            RevPAC Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Revenue Per Available Car. The single most-watched RAC KPI. UAE
            mid-market benchmark: AED 200–300/day. Best-in-class: AED 350+.
          </p>
        </div>
        <div className="flex gap-3 items-end">
          <div>
            <label className="text-xs text-slate-400 block mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-white text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-white text-sm"
            />
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-900/30 border border-rose-700 p-4 text-rose-200 text-sm">{error}</div>
      )}

      {data && tone && (
        <>
          {/* Headline RevPAC card */}
          <div className="rounded-2xl bg-gradient-to-br from-slate-800/70 to-teal-900/20 border border-teal-500/30 p-8">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-wider">RevPAC · per available car / day</div>
                <div className="text-5xl font-bold text-white mt-2">
                  AED {data.revPAC.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
                <div className={`mt-3 inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${tone.classes}`}>
                  {tone.label}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400 uppercase tracking-wider">Period revenue</div>
                <div className="text-2xl font-bold text-emerald-300 mt-2">
                  AED {data.totalRevenue.toLocaleString()}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {data.daysInPeriod} day{data.daysInPeriod === 1 ? '' : 's'} · fleet of {data.fleetSize}
                </div>
              </div>
            </div>
          </div>

          {/* KPI grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi
              label="Fleet Utilization"
              value={`${data.fleetUtilizationPct}%`}
              sub={`${data.totalRentedCarDays.toLocaleString()} / ${data.totalAvailableCarDays.toLocaleString()} car-days`}
              valueClass={utilizationTone(data.fleetUtilizationPct)}
            />
            <Kpi
              label="Avg Daily Rate (ADR)"
              value={`AED ${data.averageDailyRate.toLocaleString()}`}
              sub="Revenue / rented car-days"
            />
            <Kpi
              label="Avg Length of Rental"
              value={`${data.averageLengthOfRental.toFixed(1)} days`}
            />
            <Kpi
              label="Booking Conversion"
              value={`${data.conversionPct}%`}
              sub={`${data.pendingBookings} pending · ${data.cancelledBookings} cancelled`}
            />
          </div>

          {/* Booking funnel + Damage recovery */}
          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-800/40 border border-slate-700 p-5">
              <div className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Booking Funnel</div>
              <div className="space-y-2">
                <FunnelRow label="Pending"   value={data.pendingBookings}   total={data.totalBookings} tone="amber" />
                <FunnelRow label="Confirmed" value={data.confirmedBookings} total={data.totalBookings} tone="cyan"  />
                <FunnelRow label="Active"    value={data.activeBookings}    total={data.totalBookings} tone="blue"  />
                <FunnelRow label="Completed" value={data.completedBookings} total={data.totalBookings} tone="emerald" />
                <FunnelRow label="Cancelled" value={data.cancelledBookings} total={data.totalBookings} tone="rose"  />
              </div>
            </div>

            <div className="rounded-xl bg-slate-800/40 border border-slate-700 p-5">
              <div className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Damage Recovery</div>
              <div className="space-y-2 text-sm">
                <Row label="Claims" value={data.damageClaimsCount.toString()} />
                <Row label="Billed total"     value={`AED ${data.damageBilledTotal.toLocaleString()}`} />
                <Row label="Recovered total"  value={`AED ${data.damageRecoveredTotal.toLocaleString()}`} />
                <div className="pt-2 mt-2 border-t border-slate-700 flex items-center justify-between">
                  <span className="text-slate-400">Recovery rate</span>
                  <span className={`font-bold ${data.damageRecoveryRatePct >= 80 ? 'text-emerald-300' : data.damageRecoveryRatePct >= 50 ? 'text-amber-300' : 'text-rose-300'}`}>
                    {data.damageRecoveryRatePct}%
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1 italic">
                  Industry benchmark: ~70-85% with AI damage classifier (R5)
                </div>
              </div>
            </div>
          </div>

          {/* By Category */}
          <div className="rounded-xl bg-slate-800/40 border border-slate-700 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Car className="h-4 w-4 text-slate-400" />
              <div className="text-sm font-semibold text-slate-300 uppercase tracking-wider">RevPAC by Category</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-400 text-left border-b border-slate-700">
                    <th className="pb-2">Category</th>
                    <th className="pb-2 text-right">Fleet</th>
                    <th className="pb-2 text-right">Rented car-days</th>
                    <th className="pb-2 text-right">Utilization</th>
                    <th className="pb-2 text-right">Revenue</th>
                    <th className="pb-2 text-right">ADR</th>
                    <th className="pb-2 text-right">RevPAC</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byCategory.length === 0 ? (
                    <tr><td colSpan={7} className="py-6 text-center text-slate-500">No bookings in this period.</td></tr>
                  ) : data.byCategory.map((c) => {
                    const t = revPacTone(c.revPAC);
                    return (
                      <tr key={c.category} className="border-b border-slate-800">
                        <td className="py-2 font-mono text-cyan-300 text-xs">{c.category}</td>
                        <td className="py-2 text-right text-slate-300">{c.fleetSize}</td>
                        <td className="py-2 text-right text-slate-300">{c.rentedCarDays.toLocaleString()}</td>
                        <td className={`py-2 text-right font-medium ${utilizationTone(c.utilizationPct)}`}>{c.utilizationPct}%</td>
                        <td className="py-2 text-right text-white">AED {c.totalRevenue.toLocaleString()}</td>
                        <td className="py-2 text-right text-slate-300">AED {c.averageDailyRate.toLocaleString()}</td>
                        <td className="py-2 text-right">
                          <span className={`px-2 py-0.5 rounded-full text-xs border ${t.classes} font-semibold`}>
                            AED {c.revPAC.toLocaleString()}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* By Channel */}
          <div className="rounded-xl bg-slate-800/40 border border-slate-700 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-slate-400" />
              <div className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Channel Mix</div>
            </div>
            {data.byChannel.length === 0 ? (
              <div className="text-slate-500 py-6 text-center">No channels recorded.</div>
            ) : (
              <div className="space-y-3">
                {data.byChannel.map((c) => (
                  <div key={c.channel}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${CHANNEL_COLORS[c.channel] ?? CHANNEL_COLORS.UNKNOWN}`}>
                          {c.channel}
                        </span>
                        <span className="text-slate-400 text-xs">
                          {c.bookingCount} booking{c.bookingCount === 1 ? '' : 's'} · avg {c.averageLengthOfRental} d/rental
                        </span>
                      </div>
                      <span className="text-white font-bold">
                        AED {c.revenue.toLocaleString()}
                        <span className="text-slate-400 text-xs font-normal ml-2">{c.revenuePctOfTotal}%</span>
                      </span>
                    </div>
                    <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-teal-500 to-cyan-500"
                        style={{ width: `${c.revenuePctOfTotal}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500 text-right italic">
            Snapshot at {new Date(data.snapshotAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="rounded-xl bg-slate-800/40 border border-slate-700 p-4">
      <div className="text-xs text-slate-400 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${valueClass ?? 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  );
}

function FunnelRow({ label, value, total, tone }: { label: string; value: number; total: number; tone: 'amber' | 'cyan' | 'blue' | 'emerald' | 'rose' }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const colors = {
    amber: 'bg-amber-500',
    cyan: 'bg-cyan-500',
    blue: 'bg-blue-500',
    emerald: 'bg-emerald-500',
    rose: 'bg-rose-500',
  }[tone];
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-400">{value} <span className="text-slate-600">({pct.toFixed(0)}%)</span></span>
      </div>
      <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
        <div className={`h-full ${colors}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
