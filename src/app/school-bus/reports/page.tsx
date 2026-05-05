'use client';
import { useState, useEffect, useRef } from 'react';

/* ──────────────────────── types ───────────────────────────── */
interface KpiOverview {
  activeRoutes: number; totalVehicles: number;
  totalRiders: number; totalStudents: number; totalStaff: number;
  fleetCapacity: number; totalEnrolled: number; capacityUsedPct: number;
  monthlyRevenue: number; feeScheduleCount: number;
}
interface RouteUtil { routeCode: string; routeName: string; studentCount: number; capacity: number; }
interface BusModeSplit { twoWay: number; pickupOnly: number; dropOnly: number; total: number; }
interface RevByRoute { routeCode: string; routeName: string; revenue: number; }

interface RouteUtilRow {
  routeCode: string; routeName: string; emirate: string;
  vehicle: string; vehicleLabel: string; vehicleOwnership: string;
  capacity: number; students: number; staff: number; total: number;
  utilPct: number; monthlyRev: number; revPerRider: number;
}

interface TripEffKpis { totalMarked: number; totalBoarded: number; totalAbsent: number; ownTransport: number; boardingRate: number; }
interface DailyRate { date: string; marked: number; boarded: number; rate: number; }
interface EffRow {
  routeCode: string; routeName: string; tripType: string;
  trips: number; marked: number; boarded: number; absent: number; ownTransport: number; boardingRate: number;
}

interface AreaKpis { areasServed: number; totalRiders: number; }
interface ByEmirate { emirate: string; riders: number; }
interface TopArea { area: string; riders: number; }
interface AreaDetail { area: string; emirate: string; routes: number; students: number; staff: number; totalRiders: number; distribution: number; }

interface FeeKpis { monthlyRevenue: number; payingRiders: number; avgPerRider: number; feeScheduleCount: number; }
interface FeePerRider { routeCode: string; routeName: string; feePerRider: number; }
interface FeeScheduleRow {
  routeCode: string; routeName: string; feeName: string; busMode: string;
  frequency: string; amount: number; riders: number; monthlyRev: number; avgPerRider: number;
}

interface ReportData {
  overview: {
    kpis: KpiOverview;
    routeUtil: RouteUtil[];
    busModeSplit: BusModeSplit;
    revenueByRoute: RevByRoute[];
  };
  routeUtilization: { routes: RouteUtilRow[] };
  tripEfficiency: { kpis: TripEffKpis; dailyRates: DailyRate[]; byRoute: EffRow[] };
  areaDistribution: { kpis: AreaKpis; byEmirate: ByEmirate[]; topAreas: TopArea[]; areaDetails: AreaDetail[] };
  feeAnalysis: { kpis: FeeKpis; revenueByRoute: RevByRoute[]; feePerRider: FeePerRider[]; scheduleDetails: FeeScheduleRow[] };
}

const TABS = [
  { id: 'overview',          label: 'Overview',          icon: '📊' },
  { id: 'routeUtilization',  label: 'Route Utilization',  icon: '%'  },
  { id: 'tripEfficiency',    label: 'Trip Efficiency',    icon: '↗'  },
  { id: 'areaDistribution',  label: 'Area Distribution',  icon: '📍' },
  { id: 'feeAnalysis',       label: 'Fee Analysis',       icon: '$'  },
] as const;
type TabId = typeof TABS[number]['id'];

function fmtAED(n: number): string {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-AE', { day: '2-digit', month: 'short' });
}

/* ── Horizontal bar ── */
function HBar({ value, max, color = 'bg-yellow-500/70' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ── Utilisation colour (dark-friendly) ── */
function utilColor(pct: number) {
  if (pct >= 90) return { bar: 'bg-red-500',    text: 'text-red-400',    dot: 'bg-red-500'    };
  if (pct >= 70) return { bar: 'bg-amber-400',  text: 'text-amber-400',  dot: 'bg-amber-400'  };
  return             { bar: 'bg-emerald-500', text: 'text-emerald-400', dot: 'bg-emerald-500' };
}

/* ── Ownership badge ── */
function OwnerBadge({ type }: { type: string }) {
  const t = (type ?? '').toLowerCase();
  const cfg =
    t === 'vendor' || t === 'contracted'
      ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
      : t === 'leased'
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  const label = t === 'vendor' || t === 'contracted' ? 'Vendor' : t === 'leased' ? 'Leased' : 'Owned';
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cfg}`}>{label}</span>;
}

/* ── BusMode badge ── */
function ModeBadge({ mode }: { mode: string }) {
  const m = (mode ?? '').toLowerCase();
  const cfg =
    m.includes('two') || m === 'twoway'
      ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
      : m.includes('pickup')
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : 'bg-slate-700 text-slate-300 border-slate-600';
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cfg}`}>{mode}</span>;
}

/* ── KPI card (dark) ── */
function KpiCard({
  title, value, sub, icon, accent = 'border-l-yellow-500', iconCls = 'text-yellow-400 bg-yellow-500/10',
  valueSize = 'text-3xl',
}: {
  title: string; value: string; sub: string; icon: string;
  accent?: string; iconCls?: string; valueSize?: string;
}) {
  return (
    <div className={`bg-slate-900 border border-white/8 border-l-4 ${accent} rounded-xl p-5 flex items-start justify-between`}>
      <div className="min-w-0 pr-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</p>
        <p className={`font-bold text-white mt-1 leading-tight break-all ${valueSize}`}>{value}</p>
        <p className="text-xs text-slate-500 mt-1">{sub}</p>
      </div>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${iconCls}`}>
        {icon}
      </div>
    </div>
  );
}

/* ── Section card ── */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
      {title && (
        <div className="px-5 py-4 border-b border-white/5">
          <p className="text-sm font-semibold text-white">{title}</p>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ── Empty state ── */
function Empty({ msg }: { msg: string }) {
  return <p className="text-sm text-slate-600 py-8 text-center italic">{msg}</p>;
}

/* ══════════════════════════════════════════════════════════════
   TAB 1 — OVERVIEW
══════════════════════════════════════════════════════════════ */
function OverviewTab({ data }: { data: ReportData['overview'] }) {
  const k = data.kpis;
  const maxStudents = Math.max(...data.routeUtil.map(r => r.studentCount), 1);
  const maxRevenue  = Math.max(...data.revenueByRoute.map(r => r.revenue), 1);
  const bs = data.busModeSplit;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          title="Active Routes" value={String(k.activeRoutes)}
          sub={`${k.totalVehicles} vehicle${k.totalVehicles !== 1 ? 's' : ''}`}
          icon="🚌" accent="border-l-blue-500" iconCls="text-blue-400 bg-blue-500/10"
        />
        <KpiCard
          title="Total Riders" value={String(k.totalRiders)}
          sub={`${k.totalStudents} students${k.totalStaff > 0 ? `, ${k.totalStaff} staff` : ''}`}
          icon="👥" accent="border-l-emerald-500" iconCls="text-emerald-400 bg-emerald-500/10"
        />
        <KpiCard
          title="Fleet Capacity" value={`${k.fleetCapacity} seats`}
          sub={`${k.capacityUsedPct}% utilized`}
          icon="🪑" accent="border-l-blue-500" iconCls="text-blue-400 bg-blue-500/10"
        />
        <KpiCard
          title="Monthly Revenue" value={fmtAED(k.monthlyRevenue)}
          sub={`${k.feeScheduleCount} fee schedule${k.feeScheduleCount !== 1 ? 's' : ''}`}
          icon="$" accent="border-l-yellow-500" iconCls="text-yellow-400 bg-yellow-500/10"
          valueSize="text-xl"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Route Utilization">
          {data.routeUtil.length === 0 ? <Empty msg="No route data available" /> : (
            <div className="space-y-3">
              {data.routeUtil.slice(0, 8).map(r => (
                <div key={r.routeCode} className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 w-20 flex-shrink-0 text-right truncate">{r.routeCode || r.routeName.slice(0, 8)}</span>
                  <HBar value={r.studentCount} max={maxStudents} color="bg-emerald-500/60" />
                  <span className="text-sm font-bold text-white w-8 text-right">{r.studentCount}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Bus Mode Split">
          {bs.total === 0 ? <Empty msg="No allocation data available" /> : (
            <div className="space-y-3">
              {[
                { label: 'Two-Way',     val: bs.twoWay,     color: 'bg-blue-500/60'    },
                { label: 'Pickup Only', val: bs.pickupOnly, color: 'bg-emerald-500/60' },
                { label: 'Drop Only',   val: bs.dropOnly,   color: 'bg-slate-500/70'   },
              ].map(m => (
                <div key={m.label} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-24 flex-shrink-0">{m.label}</span>
                  <HBar value={m.val} max={bs.total} color={m.color} />
                  <span className="text-sm font-bold text-white w-28 text-right">
                    {m.val} ({bs.total > 0 ? ((m.val / bs.total) * 100).toFixed(1) : '0.0'}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Revenue by Route">
        {data.revenueByRoute.length === 0 || data.revenueByRoute.every(r => r.revenue === 0) ? (
          <Empty msg="No revenue data for current month. Add fee schedules via Finance → Invoices." />
        ) : (
          <div className="space-y-3">
            {data.revenueByRoute.map(r => (
              <div key={r.routeCode} className="flex items-center gap-3">
                <span className="text-xs text-slate-500 w-20 flex-shrink-0 text-right">{r.routeCode}</span>
                <HBar value={r.revenue} max={maxRevenue} color="bg-yellow-500/60" />
                <span className="text-sm font-bold text-white w-20 text-right">{Math.round(r.revenue).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 2 — ROUTE UTILIZATION
══════════════════════════════════════════════════════════════ */
function RouteUtilizationTab({ data }: { data: ReportData['routeUtilization'] }) {
  const routes = data.routes;

  return (
    <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 bg-slate-800/60">
              {['ROUTE','EMIRATE','VEHICLE','TYPE','CAPACITY','STUDENTS','STAFF','TOTAL','UTILIZATION','MONTHLY REV','REV / RIDER'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {routes.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-14 text-center text-slate-600">No active routes found</td></tr>
            ) : routes.map(r => {
              const uc = utilColor(r.utilPct);
              return (
                <tr key={r.routeCode} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-4">
                    <p className="font-bold text-white">{r.routeCode}</p>
                    <p className="text-xs text-slate-500 mt-0.5 max-w-[160px] truncate">{r.routeName}</p>
                  </td>
                  <td className="px-4 py-4 text-slate-400">{r.emirate}</td>
                  <td className="px-4 py-4 text-slate-300">{r.vehicle || r.vehicleLabel || '—'}</td>
                  <td className="px-4 py-4"><OwnerBadge type={r.vehicleOwnership} /></td>
                  <td className="px-4 py-4 text-slate-300 font-medium">{r.capacity}</td>
                  <td className="px-4 py-4 text-slate-300">{r.students}</td>
                  <td className="px-4 py-4 text-slate-300">{r.staff}</td>
                  <td className="px-4 py-4 font-bold text-white">{r.total}</td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2 min-w-[140px]">
                      <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${uc.bar}`} style={{ width: `${Math.min(r.utilPct, 100)}%` }} />
                      </div>
                      <span className={`text-xs font-bold ${uc.text} w-12`}>{r.utilPct.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    {r.monthlyRev > 0
                      ? <span className="font-semibold text-emerald-400">AED {r.monthlyRev.toLocaleString()}.00</span>
                      : <span className="text-slate-600">AED 0.00</span>
                    }
                  </td>
                  <td className="px-4 py-4 text-slate-400">
                    {r.revPerRider > 0 ? `AED ${r.revPerRider.toLocaleString()}.00` : 'AED 0.00'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 border-t border-white/5 bg-slate-800/30 flex gap-5 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> &lt;70% — Healthy</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> 70–89% — Near capacity</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> ≥90% — Over-utilized</span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 3 — TRIP EFFICIENCY
══════════════════════════════════════════════════════════════ */
function TripEfficiencyTab({ data }: { data: ReportData['tripEfficiency'] }) {
  const k = data.kpis;
  const maxRate = Math.max(...data.dailyRates.map(d => d.rate), 1);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-4">
        <KpiCard title="Total Marked"   value={k.totalMarked.toLocaleString()}  sub="across all trips"        icon="👥" accent="border-l-blue-500"    iconCls="text-blue-400 bg-blue-500/10"    />
        <KpiCard title="Boarded"        value={k.totalBoarded.toLocaleString()} sub={`${k.boardingRate}% boarding rate`} icon="✅" accent="border-l-emerald-500" iconCls="text-emerald-400 bg-emerald-500/10" />
        <KpiCard title="Absent"         value={k.totalAbsent.toLocaleString()}  sub="did not board"            icon="⚠️" accent="border-l-red-500"     iconCls="text-red-400 bg-red-500/10"      />
        <KpiCard title="Own Transport"  value={String(k.ownTransport)}           sub="alternative used"         icon="🚗" accent="border-l-amber-500"   iconCls="text-amber-400 bg-amber-500/10"  />
      </div>

      <Card title="Daily Boarding Rate">
        {data.dailyRates.length === 0 ? <Empty msg="No trip data in the last 30 days" /> : (
          <div className="flex items-end gap-2 h-36 overflow-x-auto pb-1">
            {[...data.dailyRates].reverse().map(d => {
              const h   = maxRate > 0 ? Math.max(6, (d.rate / maxRate) * 100) : 6;
              const bad = d.rate < 60;
              return (
                <div key={d.date} className="flex flex-col items-center gap-1.5 flex-shrink-0 min-w-[56px]">
                  <span className={`text-xs font-bold ${bad ? 'text-red-400' : 'text-slate-300'}`}>
                    {d.rate.toFixed(1)}%
                  </span>
                  <div
                    className={`w-10 rounded-t-md transition-all ${bad ? 'bg-red-500/50 border border-red-500/30' : 'bg-emerald-500/50 border border-emerald-500/20'}`}
                    style={{ height: `${h}%` }}
                    title={`${d.date}: ${d.boarded}/${d.marked} boarded`}
                  />
                  <span className="text-[10px] text-slate-600 text-center leading-tight">{fmtDate(d.date)}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <p className="text-sm font-semibold text-white">Efficiency by Route &amp; Trip Type</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-slate-800/60">
                {['ROUTE','TRIP TYPE','TRIPS','MARKED','BOARDED','ABSENT','OWN TRANSPORT','BOARDING RATE'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.byRoute.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-14 text-center text-slate-600">No trip records found</td></tr>
              ) : data.byRoute.map((r, i) => {
                const br = r.boardingRate;
                const barColor = br >= 80 ? 'bg-red-500' : br >= 60 ? 'bg-amber-400' : 'bg-slate-600';
                const txtColor = br >= 80 ? 'text-red-400' : br >= 60 ? 'text-amber-400' : 'text-slate-500';
                return (
                  <tr key={i} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-4">
                      <p className="font-bold text-white">{r.routeCode}</p>
                      <p className="text-xs text-slate-500 mt-0.5 max-w-[160px] truncate">{r.routeName}</p>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                        r.tripType === 'Pickup'
                          ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                          : 'bg-slate-700 text-slate-300 border-slate-600'
                      }`}>{r.tripType}</span>
                    </td>
                    <td className="px-4 py-4 text-slate-400">{r.trips}</td>
                    <td className="px-4 py-4 text-slate-300">{r.marked}</td>
                    <td className="px-4 py-4 font-semibold text-emerald-400">{r.boarded}</td>
                    <td className="px-4 py-4 text-red-400">{r.absent}</td>
                    <td className="px-4 py-4 text-amber-400">{r.ownTransport}</td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(br, 100)}%` }} />
                        </div>
                        <span className={`text-xs font-bold ${txtColor} w-12`}>{br.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 4 — AREA DISTRIBUTION
══════════════════════════════════════════════════════════════ */
function AreaDistributionTab({ data }: { data: ReportData['areaDistribution'] }) {
  const k = data.kpis;
  const maxEmirate = Math.max(...data.byEmirate.map(e => e.riders), 1);
  const maxArea    = Math.max(...data.topAreas.map(a => a.riders), 1);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <KpiCard title="Areas Served" value={String(k.areasServed)} sub="distinct pickup areas" icon="📍" accent="border-l-blue-500"    iconCls="text-blue-400 bg-blue-500/10"    />
        <KpiCard title="Total Riders" value={String(k.totalRiders)} sub="across all areas"      icon="👥" accent="border-l-emerald-500" iconCls="text-emerald-400 bg-emerald-500/10" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Riders by Emirate">
          {data.byEmirate.length === 0 ? <Empty msg="No area data available" /> : (
            <div className="space-y-3">
              {data.byEmirate.map(e => (
                <div key={e.emirate} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-28 flex-shrink-0 text-right">{e.emirate}</span>
                  <HBar value={e.riders} max={maxEmirate} color="bg-blue-500/60" />
                  <span className="text-sm font-bold text-white w-8 text-right">{e.riders}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Top Areas by Riders">
          {data.topAreas.length === 0 ? <Empty msg="No allocation stop data available" /> : (
            <div className="space-y-3">
              {data.topAreas.map(a => (
                <div key={a.area} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-28 flex-shrink-0 text-right truncate" title={a.area}>{a.area}</span>
                  <HBar value={a.riders} max={maxArea} color="bg-emerald-500/60" />
                  <span className="text-sm font-bold text-white w-8 text-right">{a.riders}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <p className="text-sm font-semibold text-white">Area Details</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-slate-800/60">
                {['AREA','EMIRATE','ROUTES','STUDENTS','STAFF','TOTAL RIDERS','DISTRIBUTION'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.areaDetails.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-14 text-center text-slate-600">
                  No area data. Assign pickup stop names to seat allocations to see area distribution.
                </td></tr>
              ) : data.areaDetails.map((a, i) => (
                <tr key={i} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-4 font-bold text-white">{a.area}</td>
                  <td className="px-4 py-4 text-slate-400">{a.emirate}</td>
                  <td className="px-4 py-4 text-slate-400">{a.routes}</td>
                  <td className="px-4 py-4 text-slate-300">{a.students}</td>
                  <td className="px-4 py-4 text-slate-300">{a.staff}</td>
                  <td className="px-4 py-4 font-bold text-white">{a.totalRiders}</td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                      <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500/70 rounded-full" style={{ width: `${a.distribution}%` }} />
                      </div>
                      <span className="text-xs font-bold text-blue-400">{a.distribution.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 5 — FEE ANALYSIS
══════════════════════════════════════════════════════════════ */
function FeeAnalysisTab({ data }: { data: ReportData['feeAnalysis'] }) {
  const k = data.kpis;
  const maxRev      = Math.max(...data.revenueByRoute.map(r => r.revenue), 1);
  const maxFeeRider = Math.max(...data.feePerRider.map(r => r.feePerRider), 1);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <KpiCard title="Monthly Revenue" value={fmtAED(k.monthlyRevenue)} sub={`${k.feeScheduleCount} fee schedule${k.feeScheduleCount !== 1 ? 's' : ''}`} icon="$"  accent="border-l-emerald-500" iconCls="text-emerald-400 bg-emerald-500/10" valueSize="text-xl" />
        <KpiCard title="Paying Riders"   value={String(k.payingRiders)}    sub="with active fee schedules"  icon="👥" accent="border-l-blue-500"    iconCls="text-blue-400 bg-blue-500/10"    />
        <KpiCard title="Avg per Rider"   value={fmtAED(k.avgPerRider)}     sub="monthly average"            icon="↗" accent="border-l-yellow-500"  iconCls="text-yellow-400 bg-yellow-500/10" valueSize="text-2xl" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Revenue by Route">
          {data.revenueByRoute.length === 0 || data.revenueByRoute.every(r => r.revenue === 0)
            ? <Empty msg="No revenue data for this month" />
            : (
              <div className="space-y-3">
                {data.revenueByRoute.map(r => (
                  <div key={r.routeCode} className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 w-20 flex-shrink-0 text-right">{r.routeCode}</span>
                    <HBar value={r.revenue} max={maxRev} color="bg-emerald-500/60" />
                    <span className="text-sm font-bold text-white w-20 text-right">{Math.round(r.revenue).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
        </Card>

        <Card title="Fee per Rider by Route">
          {data.feePerRider.length === 0 || data.feePerRider.every(r => r.feePerRider === 0)
            ? <Empty msg="No fee-per-rider data available" />
            : (
              <div className="space-y-3">
                {data.feePerRider.map(r => (
                  <div key={r.routeCode} className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 w-20 flex-shrink-0 text-right">{r.routeCode}</span>
                    <HBar value={r.feePerRider} max={maxFeeRider} color="bg-blue-500/60" />
                    <span className="text-sm font-bold text-white w-16 text-right">{r.feePerRider.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
        </Card>
      </div>

      <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <p className="text-sm font-semibold text-white">Fee Schedule Details</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-slate-800/60">
                {['ROUTE','FEE SCHEDULE','BUS MODE','FREQUENCY','AMOUNT','RIDERS','MONTHLY REV','AVG / RIDER'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.scheduleDetails.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-14 text-center text-slate-600">
                  No fee schedule data. Create School Bus invoices in Finance module.
                </td></tr>
              ) : data.scheduleDetails.map((r, i) => (
                <tr key={i} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-4">
                    <p className="font-bold text-white">{r.routeCode}</p>
                    <p className="text-xs text-slate-500 mt-0.5 max-w-[160px] truncate">{r.routeName}</p>
                  </td>
                  <td className="px-4 py-4 text-slate-400">{r.feeName}</td>
                  <td className="px-4 py-4"><ModeBadge mode={r.busMode} /></td>
                  <td className="px-4 py-4 text-slate-400">{r.frequency}</td>
                  <td className="px-4 py-4 text-slate-300">AED {r.amount.toLocaleString()}.00</td>
                  <td className="px-4 py-4 text-slate-300">{r.riders}</td>
                  <td className="px-4 py-4">
                    {r.monthlyRev > 0
                      ? <span className="font-semibold text-emerald-400">AED {r.monthlyRev.toLocaleString()}.00</span>
                      : <span className="text-slate-600">AED 0.00</span>
                    }
                  </td>
                  <td className="px-4 py-4 text-slate-400">AED {r.avgPerRider.toLocaleString()}.00</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   PRINT & EXPORT UTILITIES
══════════════════════════════════════════════════════════════ */

/* Generic CSV downloader */
function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* Build CSV rows per active tab */
function getTabCSV(tab: TabId, data: ReportData): { filename: string; headers: string[]; rows: (string | number)[][] } {
  const date = new Date().toISOString().slice(0, 10);

  if (tab === 'overview') {
    const k = data.overview.kpis;
    return {
      filename: `school-bus-overview-${date}.csv`,
      headers: ['Metric', 'Value'],
      rows: [
        ['Active Routes',       k.activeRoutes],
        ['Total Vehicles',      k.totalVehicles],
        ['Total Riders',        k.totalRiders],
        ['Total Students',      k.totalStudents],
        ['Fleet Capacity (seats)', k.fleetCapacity],
        ['Enrolled',            k.totalEnrolled],
        ['Capacity Utilisation %', k.capacityUsedPct],
        ['Monthly Revenue (AED)',  k.monthlyRevenue.toFixed(2)],
        ['Fee Schedules',       k.feeScheduleCount],
        ['', ''],
        ['--- Route Utilization ---', ''],
        ['Route Code', 'Route Name', 'Students', 'Capacity'],
        ...data.overview.routeUtil.map(r => [r.routeCode, r.routeName, r.studentCount, r.capacity]),
        ['', ''],
        ['--- Bus Mode Split ---', ''],
        ['Mode', 'Count'],
        ['Two-Way',     data.overview.busModeSplit.twoWay],
        ['Pickup Only', data.overview.busModeSplit.pickupOnly],
        ['Drop Only',   data.overview.busModeSplit.dropOnly],
      ],
    };
  }

  if (tab === 'routeUtilization') {
    return {
      filename: `school-bus-route-utilization-${date}.csv`,
      headers: ['Route Code','Route Name','Emirate','Vehicle','Type','Capacity','Students','Staff','Total','Utilisation %','Monthly Rev (AED)','Rev per Rider (AED)'],
      rows: data.routeUtilization.routes.map(r => [
        r.routeCode, r.routeName, r.emirate,
        r.vehicle || r.vehicleLabel, r.vehicleOwnership,
        r.capacity, r.students, r.staff, r.total,
        r.utilPct.toFixed(1),
        r.monthlyRev.toFixed(2),
        r.revPerRider.toFixed(2),
      ]),
    };
  }

  if (tab === 'tripEfficiency') {
    const k = data.tripEfficiency.kpis;
    return {
      filename: `school-bus-trip-efficiency-${date}.csv`,
      headers: ['Route Code','Route Name','Trip Type','Trips','Marked','Boarded','Absent','Own Transport','Boarding Rate %'],
      rows: [
        ['SUMMARY', '', '', '', k.totalMarked, k.totalBoarded, k.totalAbsent, k.ownTransport, k.boardingRate],
        ...data.tripEfficiency.byRoute.map(r => [
          r.routeCode, r.routeName, r.tripType,
          r.trips, r.marked, r.boarded, r.absent, r.ownTransport,
          r.boardingRate.toFixed(1),
        ]),
      ],
    };
  }

  if (tab === 'areaDistribution') {
    return {
      filename: `school-bus-area-distribution-${date}.csv`,
      headers: ['Area','Emirate','Routes','Students','Staff','Total Riders','Distribution %'],
      rows: data.areaDistribution.areaDetails.map(a => [
        a.area, a.emirate, a.routes, a.students, a.staff, a.totalRiders, a.distribution.toFixed(1),
      ]),
    };
  }

  /* feeAnalysis */
  return {
    filename: `school-bus-fee-analysis-${date}.csv`,
    headers: ['Route Code','Route Name','Fee Schedule','Bus Mode','Frequency','Amount (AED)','Riders','Monthly Rev (AED)','Avg per Rider (AED)'],
    rows: data.feeAnalysis.scheduleDetails.map(r => [
      r.routeCode, r.routeName, r.feeName, r.busMode,
      r.frequency, r.amount.toFixed(2), r.riders,
      r.monthlyRev.toFixed(2), r.avgPerRider.toFixed(2),
    ]),
  };
}

/* Build a clean print-ready HTML document for the active tab */
function generatePrintHTML(tab: TabId, data: ReportData, genAt: string | null): string {
  const tabLabel = { overview: 'Overview', routeUtilization: 'Route Utilization', tripEfficiency: 'Trip Efficiency', areaDistribution: 'Area Distribution', feeAnalysis: 'Fee Analysis' }[tab];
  const now = new Date().toLocaleString('en-AE');
  const css = `
    body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 24px; }
    h1   { font-size: 20px; margin: 0 0 4px; }
    h2   { font-size: 14px; margin: 20px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    .meta { font-size: 11px; color: #666; margin-bottom: 20px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 20px; }
    .kpi { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
    .kpi-title { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: .05em; }
    .kpi-value { font-size: 20px; font-weight: bold; margin: 4px 0 2px; }
    .kpi-sub   { font-size: 10px; color: #888; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #f5f5f5; text-align: left; padding: 7px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #555; border: 1px solid #e0e0e0; }
    td { padding: 7px 10px; border: 1px solid #e8e8e8; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    .bar-wrap { display: inline-block; width: 80px; height: 6px; background: #e0e0e0; border-radius: 3px; vertical-align: middle; margin-right: 6px; }
    .bar-fill  { height: 100%; border-radius: 3px; background: #22c55e; }
    .green { color: #16a34a; } .red { color: #dc2626; } .amber { color: #d97706; }
    .badge { display: inline-block; padding: 1px 7px; border-radius: 20px; font-size: 10px; border: 1px solid #ccc; }
    @media print { button { display: none; } }
  `;

  function kpiBlock(items: { label: string; value: string; sub?: string }[]) {
    return `<div class="kpi-grid">${items.map(k => `
      <div class="kpi">
        <div class="kpi-title">${k.label}</div>
        <div class="kpi-value">${k.value}</div>
        ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ''}
      </div>`).join('')}</div>`;
  }

  function tableBlock(headers: string[], rows: (string | number)[][], colClasses: string[] = []) {
    const ths = headers.map(h => `<th>${h}</th>`).join('');
    const trs = rows.map(r =>
      `<tr>${r.map((cell, ci) => `<td class="${colClasses[ci] ?? ''}">${cell}</td>`).join('')}</tr>`
    ).join('');
    return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
  }

  let body = '';

  if (tab === 'overview') {
    const k  = data.overview.kpis;
    const bs = data.overview.busModeSplit;
    body += kpiBlock([
      { label: 'Active Routes',    value: String(k.activeRoutes),   sub: `${k.totalVehicles} vehicles`          },
      { label: 'Total Riders',     value: String(k.totalRiders),    sub: `${k.totalStudents} students`           },
      { label: 'Fleet Capacity',   value: `${k.fleetCapacity} seats`, sub: `${k.capacityUsedPct}% utilized`     },
      { label: 'Monthly Revenue',  value: `AED ${k.monthlyRevenue.toLocaleString('en-AE',{minimumFractionDigits:2})}`, sub: `${k.feeScheduleCount} fee schedules` },
    ]);
    body += '<h2>Route Utilization</h2>';
    body += tableBlock(['Route Code','Route Name','Students','Capacity'],
      data.overview.routeUtil.map(r => [r.routeCode, r.routeName, r.studentCount, r.capacity]));
    body += '<h2>Bus Mode Split</h2>';
    body += tableBlock(['Mode','Count','%'],[
      ['Two-Way',     bs.twoWay,     bs.total > 0 ? `${((bs.twoWay/bs.total)*100).toFixed(1)}%`     : '0.0%'],
      ['Pickup Only', bs.pickupOnly, bs.total > 0 ? `${((bs.pickupOnly/bs.total)*100).toFixed(1)}%` : '0.0%'],
      ['Drop Only',   bs.dropOnly,   bs.total > 0 ? `${((bs.dropOnly/bs.total)*100).toFixed(1)}%`   : '0.0%'],
    ]);
    body += '<h2>Revenue by Route</h2>';
    body += tableBlock(['Route Code','Route Name','Monthly Revenue (AED)'],
      data.overview.revenueByRoute.map(r => [r.routeCode, r.routeName, r.revenue.toFixed(2)]));
  }

  if (tab === 'routeUtilization') {
    body += tableBlock(
      ['Route Code','Route Name','Emirate','Vehicle','Type','Cap','Students','Staff','Total','Util %','Monthly Rev (AED)','Rev/Rider'],
      data.routeUtilization.routes.map(r => [
        r.routeCode, r.routeName, r.emirate,
        r.vehicle || r.vehicleLabel, r.vehicleOwnership,
        r.capacity, r.students, r.staff, r.total,
        `${r.utilPct.toFixed(1)}%`,
        r.monthlyRev.toFixed(2), r.revPerRider.toFixed(2),
      ]),
      ['','','','','','','','','','','green','']
    );
    body += '<p style="font-size:10px;color:#666;">🟢 &lt;70% Healthy &nbsp; 🟡 70–89% Near capacity &nbsp; 🔴 ≥90% Over-utilized</p>';
  }

  if (tab === 'tripEfficiency') {
    const k = data.tripEfficiency.kpis;
    body += kpiBlock([
      { label: 'Total Marked',   value: k.totalMarked.toLocaleString()  },
      { label: 'Boarded',        value: k.totalBoarded.toLocaleString(), sub: `${k.boardingRate}% boarding rate` },
      { label: 'Absent',         value: k.totalAbsent.toLocaleString()   },
      { label: 'Own Transport',  value: String(k.ownTransport)            },
    ]);
    body += '<h2>Daily Boarding Rates (last 30 days)</h2>';
    body += tableBlock(['Date','Marked','Boarded','Boarding Rate %'],
      data.tripEfficiency.dailyRates.map(d => [d.date, d.marked, d.boarded, `${d.rate.toFixed(1)}%`]));
    body += '<h2>Efficiency by Route &amp; Trip Type</h2>';
    body += tableBlock(
      ['Route Code','Route Name','Trip Type','Trips','Marked','Boarded','Absent','Own Transport','Boarding Rate %'],
      data.tripEfficiency.byRoute.map(r => [
        r.routeCode, r.routeName, r.tripType, r.trips,
        r.marked, r.boarded, r.absent, r.ownTransport, `${r.boardingRate.toFixed(1)}%`,
      ])
    );
  }

  if (tab === 'areaDistribution') {
    const k = data.areaDistribution.kpis;
    body += kpiBlock([
      { label: 'Areas Served', value: String(k.areasServed), sub: 'distinct pickup areas' },
      { label: 'Total Riders', value: String(k.totalRiders), sub: 'across all areas'       },
    ]);
    body += '<h2>Riders by Emirate</h2>';
    body += tableBlock(['Emirate','Riders'], data.areaDistribution.byEmirate.map(e => [e.emirate, e.riders]));
    body += '<h2>Area Details</h2>';
    body += tableBlock(
      ['Area','Emirate','Routes','Students','Staff','Total Riders','Distribution %'],
      data.areaDistribution.areaDetails.map(a => [
        a.area, a.emirate, a.routes, a.students, a.staff, a.totalRiders, `${a.distribution.toFixed(1)}%`,
      ])
    );
  }

  if (tab === 'feeAnalysis') {
    const k = data.feeAnalysis.kpis;
    body += kpiBlock([
      { label: 'Monthly Revenue', value: `AED ${k.monthlyRevenue.toLocaleString('en-AE',{minimumFractionDigits:2})}`, sub: `${k.feeScheduleCount} schedules` },
      { label: 'Paying Riders',   value: String(k.payingRiders), sub: 'with active schedules' },
      { label: 'Avg per Rider',   value: `AED ${k.avgPerRider.toLocaleString('en-AE',{minimumFractionDigits:2})}`, sub: 'monthly average' },
    ]);
    body += '<h2>Fee Schedule Details</h2>';
    body += tableBlock(
      ['Route Code','Route Name','Fee Schedule','Bus Mode','Frequency','Amount (AED)','Riders','Monthly Rev (AED)','Avg/Rider (AED)'],
      data.feeAnalysis.scheduleDetails.map(r => [
        r.routeCode, r.routeName, r.feeName, r.busMode,
        r.frequency, r.amount.toFixed(2), r.riders,
        r.monthlyRev.toFixed(2), r.avgPerRider.toFixed(2),
      ]),
      ['','','','','','','','green','']
    );
    body += '<h2>Revenue by Route</h2>';
    body += tableBlock(['Route Code','Route Name','Monthly Revenue (AED)'],
      data.feeAnalysis.revenueByRoute.map(r => [r.routeCode, r.routeName, r.revenue.toFixed(2)]));
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>School Bus Report — ${tabLabel}</title><style>${css}</style></head><body>
    <h1>🏫 School Bus Report — ${tabLabel}</h1>
    <p class="meta">Generated: ${now}${genAt ? ` · Data as of: ${new Date(genAt).toLocaleString('en-AE')}` : ''}</p>
    ${body}
    <script>window.onload=function(){window.print();}<\/script>
  </body></html>`;
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════ */
export default function SchoolBusReportsPage() {
  const [activeTab, setActiveTab]     = useState<TabId>('overview');
  const [data, setData]               = useState<ReportData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [genAt, setGenAt]             = useState<string | null>(null);
  const [exportOpen, setExportOpen]   = useState(false);
  const exportRef                     = useRef<HTMLDivElement>(null);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/school-bus/reports?tenantId=default');
      const json = await res.json();
      if (json.error) { setError(json.error); return; }
      setData(json as ReportData);
      setGenAt(json.generatedAt ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadReport(); }, []);

  /* Close export dropdown on outside click */
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function handlePrint() {
    if (!data) return;
    setExportOpen(false);
    const html = generatePrintHTML(activeTab, data, genAt);
    const win  = window.open('', '_blank', 'width=1000,height=700');
    if (!win) return;
    win.document.write(html);
    win.document.close();
  }

  function handleExportCSV() {
    if (!data) return;
    setExportOpen(false);
    const { filename, headers, rows } = getTabCSV(activeTab, data);
    downloadCSV(filename, headers, rows);
  }

  const tabLabel = TABS.find(t => t.id === activeTab)?.label ?? '';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">📈 School Bus Reports</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Operational insights · Route utilization · Trip efficiency · Revenue analysis
          </p>
        </div>
        <div className="flex items-center gap-3">
          {genAt && (
            <span className="text-xs text-slate-500">
              Updated {new Date(genAt).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}

          {/* Refresh */}
          <button
            onClick={loadReport}
            disabled={loading}
            className="flex items-center gap-1.5 bg-slate-800 border border-white/10 text-slate-300 text-sm px-4 py-2 rounded-lg hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50">
            {loading ? '⏳' : '↻'} Refresh
          </button>

          {/* Export dropdown */}
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => setExportOpen(p => !p)}
              disabled={!data || loading}
              className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-semibold text-sm px-4 py-2 rounded-lg transition-colors">
              <span>⬇</span> Export
              <span className="text-xs opacity-70">{exportOpen ? '▲' : '▼'}</span>
            </button>

            {exportOpen && data && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-slate-900 border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
                {/* Current tab label */}
                <div className="px-4 py-2.5 border-b border-white/5 bg-slate-800/60">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Current tab: {tabLabel}
                  </p>
                </div>

                {/* Print */}
                <button
                  onClick={handlePrint}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-200 hover:bg-slate-800 transition-colors text-left">
                  <span className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center text-blue-400 text-base flex-shrink-0">🖨️</span>
                  <div>
                    <p className="font-medium">Print / Save as PDF</p>
                    <p className="text-xs text-slate-500">Opens print dialog</p>
                  </div>
                </button>

                {/* Export CSV */}
                <button
                  onClick={handleExportCSV}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-200 hover:bg-slate-800 transition-colors text-left border-t border-white/5">
                  <span className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-400 text-base flex-shrink-0">📊</span>
                  <div>
                    <p className="font-medium">Export as CSV</p>
                    <p className="text-xs text-slate-500">Download spreadsheet</p>
                  </div>
                </button>

                {/* Divider + all tabs note */}
                <div className="px-4 py-2.5 border-t border-white/5 bg-slate-800/40">
                  <p className="text-xs text-slate-600 italic">Exports data for the active tab only</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-white/10">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === t.id
                ? 'border-yellow-500 text-yellow-300'
                : 'border-transparent text-slate-500 hover:text-slate-300 hover:border-slate-600'
            }`}>
            <span className="text-xs opacity-80">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 bg-slate-900 rounded-xl animate-pulse border border-white/5" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-48 bg-slate-900 rounded-xl animate-pulse border border-white/5" />
            ))}
          </div>
          <div className="h-40 bg-slate-900 rounded-xl animate-pulse border border-white/5" />
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-8 text-center">
          <p className="text-red-400 font-semibold mb-1">Failed to load report</p>
          <p className="text-red-500/70 text-xs mb-4 font-mono">{error}</p>
          <button onClick={loadReport} className="bg-red-500/20 border border-red-500/30 text-red-300 text-sm px-4 py-2 rounded-lg hover:bg-red-500/30 transition-colors">
            ↻ Retry
          </button>
        </div>
      ) : !data ? null : (
        <>
          {activeTab === 'overview'         && <OverviewTab          data={data.overview} />}
          {activeTab === 'routeUtilization' && <RouteUtilizationTab  data={data.routeUtilization} />}
          {activeTab === 'tripEfficiency'   && <TripEfficiencyTab    data={data.tripEfficiency} />}
          {activeTab === 'areaDistribution' && <AreaDistributionTab  data={data.areaDistribution} />}
          {activeTab === 'feeAnalysis'      && <FeeAnalysisTab       data={data.feeAnalysis} />}
        </>
      )}
    </div>
  );
}
