'use client';
/**
 * School Bus analytics, from /api/school-bus/reports: how each route is
 * used and how its trips go (last 30 days), enrolment and this month's
 * fees, and where riders are picked up. Every figure comes from the
 * tenant's routes, allocations, trips and school-bus invoices.
 */
import { useEffect, useState } from 'react';

interface RouteUtil {
  routeCode: string; routeName: string; emirate: string; vehicle: string;
  capacity: number; total: number; utilPct: number; monthlyRev: number; revPerRider: number;
}
interface RouteTrips { routeCode: string; routeName: string; tripType: string; trips: number; marked: number; boarded: number; boardingRate: number }
interface AreaDetail { area: string; emirate: string; routes: number; totalRiders: number; distribution: number }
interface Reports {
  overview: {
    kpis: { activeRoutes: number; totalVehicles: number; totalStudents: number; fleetCapacity: number; totalEnrolled: number; capacityUsedPct: number; monthlyRevenue: number };
    busModeSplit: { twoWay: number; pickupOnly: number; dropOnly: number; total: number };
  };
  routeUtilization: { routes: RouteUtil[] };
  tripEfficiency: { kpis: { totalMarked: number; totalBoarded: number; boardingRate: number }; byRoute: RouteTrips[] };
  areaDistribution: { kpis: { areasServed: number }; byEmirate: Array<{ emirate: string; riders: number }>; areaDetails: AreaDetail[] };
  feeAnalysis: { kpis: { monthlyRevenue: number; payingRiders: number; avgPerRider: number } };
}

const aed = (n: number) => `AED ${Math.round(n).toLocaleString('en-AE')}`;
const pctColor = (p: number) => (p >= 90 ? 'text-red-400' : p >= 70 ? 'text-amber-400' : 'text-emerald-400');

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4">
      <p className="text-xs text-[var(--text-faint)]">{label}</p>
      <p className={`text-2xl font-bold ${value === '—' ? 'text-[var(--text-faint)]' : 'text-[var(--text-main)]'}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-faint)] mt-0.5">{sub}</p>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-10 text-center text-sm text-[var(--text-faint)]">{text}</div>;
}

export default function SchoolBusAnalyticsPage() {
  const [tab, setTab] = useState<'routes' | 'enrolment' | 'areas'>('routes');
  const [data, setData] = useState<Reports | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/school-bus/reports', { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? `Could not load analytics (${res.status})`);
        if (!cancelled) setData(json as Reports);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load analytics'); });
    return () => { cancelled = true; };
  }, []);

  const k = data?.overview.kpis;
  const trips = data?.tripEfficiency;
  // Trips per route, both directions together.
  const tripsByRoute = new Map<string, { trips: number; marked: number; boarded: number }>();
  for (const t of trips?.byRoute ?? []) {
    const cur = tripsByRoute.get(t.routeCode) ?? { trips: 0, marked: 0, boarded: 0 };
    tripsByRoute.set(t.routeCode, { trips: cur.trips + t.trips, marked: cur.marked + t.marked, boarded: cur.boarded + t.boarded });
  }
  const routes = [...(data?.routeUtilization.routes ?? [])].sort((a, b) => b.utilPct - a.utilPct);
  // Seat use from each route's allocated riders against its seats.
  const seats = routes.reduce((s, r) => s + r.capacity, 0);
  const riders = routes.reduce((s, r) => s + r.total, 0);
  const split = data?.overview.busModeSplit;
  const fees = data?.feeAnalysis.kpis;
  const areas = data?.areaDistribution;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-main)]">School Bus Analytics</h1>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">Route use, trips in the last 30 days, enrolment, fees this month and pickup areas</p>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Active routes" value={k ? String(k.activeRoutes) : '—'} sub={k ? `${k.totalVehicles} buses` : undefined} />
        <Kpi label="Students riding" value={k ? k.totalStudents.toLocaleString('en-AE') : '—'} sub={seats > 0 ? `${Math.round((riders / seats) * 100)}% of ${seats} seats` : undefined} />
        <Kpi
          label="Boarding rate (30 days)"
          value={trips && trips.kpis.totalMarked > 0 ? `${trips.kpis.boardingRate}%` : '—'}
          sub={trips && trips.kpis.totalMarked > 0 ? `${trips.kpis.totalBoarded} of ${trips.kpis.totalMarked} boarded` : 'No trips recorded'}
        />
        <Kpi label="Fees invoiced this month" value={fees && fees.monthlyRevenue > 0 ? aed(fees.monthlyRevenue) : '—'} sub={fees && fees.payingRiders > 0 ? `${fees.payingRiders} invoices` : 'No invoices yet'} />
      </div>

      <div className="flex gap-2 border-b border-[var(--border-subtle)]">
        {([['routes', 'Route performance'], ['enrolment', 'Enrolment & fees'], ['areas', 'Pickup areas']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === id ? 'border-blue-500 text-[var(--text-main)]' : 'border-transparent text-[var(--text-faint)] hover:text-[var(--text-muted)]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {!data && !error ? (
        <Empty text="Loading analytics…" />
      ) : tab === 'routes' ? (
        routes.length === 0 ? <Empty text="No active school bus routes yet." /> : (
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-[var(--text-faint)]">
                  {['Route', 'Bus', 'Riders / seats', 'Seat use', 'Trips (30d)', 'Boarding rate'].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {routes.map((r) => {
                  const t = tripsByRoute.get(r.routeCode);
                  return (
                    <tr key={r.routeCode}>
                      <td className="px-4 py-3"><p className="font-medium text-[var(--text-main)]">{r.routeName}</p><p className="text-xs text-[var(--text-faint)]">{r.routeCode} · {r.emirate}</p></td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{r.vehicle || '—'}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{r.total} / {r.capacity}</td>
                      <td className={`px-4 py-3 font-semibold ${pctColor(r.utilPct)}`}>{r.capacity ? `${r.utilPct}%` : '—'}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{t?.trips ?? 0}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{t && t.marked > 0 ? `${Math.round((t.boarded / t.marked) * 1000) / 10}%` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'enrolment' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--text-main)] mb-3">Service type</h3>
            {!split || split.total === 0 ? <p className="text-sm text-[var(--text-faint)]">No active allocations yet.</p> : (
              <ul className="space-y-2 text-sm">
                {[['Two-way', split.twoWay], ['Pickup only', split.pickupOnly], ['Drop-off only', split.dropOnly]].map(([label, n]) => (
                  <li key={label as string} className="flex justify-between text-[var(--text-muted)]">
                    <span>{label}</span>
                    <span className="font-medium text-[var(--text-main)]">{n as number} · {Math.round(((n as number) / split.total) * 100)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--text-main)] mb-3">Fees by route (this month)</h3>
            {routes.filter((r) => r.monthlyRev > 0).length === 0 ? <p className="text-sm text-[var(--text-faint)]">No school bus invoices this month yet.</p> : (
              <ul className="space-y-2 text-sm">
                {routes.filter((r) => r.monthlyRev > 0).sort((a, b) => b.monthlyRev - a.monthlyRev).map((r) => (
                  <li key={r.routeCode} className="flex justify-between text-[var(--text-muted)]">
                    <span>{r.routeName}</span>
                    <span className="font-medium text-[var(--text-main)]">{aed(r.monthlyRev)}{r.revPerRider ? ` · ${aed(r.revPerRider)}/rider` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        !areas || areas.areaDetails.length === 0 ? <Empty text="No pickup areas yet: allocate students to stops to see where riders are." /> : (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-5">
              <h3 className="text-sm font-semibold text-[var(--text-main)] mb-3">Riders by emirate</h3>
              <ul className="space-y-2 text-sm">
                {areas.byEmirate.map((e) => (
                  <li key={e.emirate} className="flex justify-between text-[var(--text-muted)]"><span>{e.emirate}</span><span className="font-medium text-[var(--text-main)]">{e.riders}</span></li>
                ))}
              </ul>
            </div>
            <div className="md:col-span-2 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-[var(--text-faint)]">
                    {['Pickup area', 'Emirate', 'Routes', 'Riders', 'Share'].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {areas.areaDetails.map((a) => (
                    <tr key={a.area}>
                      <td className="px-4 py-3 font-medium text-[var(--text-main)]">{a.area}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{a.emirate}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{a.routes}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{a.totalRiders}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{a.distribution}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
