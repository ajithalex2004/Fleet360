'use client';
import React, { useEffect, useState } from 'react';

interface KPIData {
  fleet: { total: number; available: number; inMaintenance: number; allocated: number; expiringDocs: number; openWorkOrders: number; expiringInsurance: number };
  bookings: { total: number; active: number; pending: number; confirmed: number };
  maintenance: { total: number; critical: number; high: number };
  alerts: { total: number; critical: number; high: number };
}

interface Props { greeting?: string; }

function KPITile({ icon, label, value, sub, color, pulse }: { icon: string; label: string; value: string | number; sub?: string; color: string; pulse?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 bg-slate-900/50 border-white/8 hover:border-white/15 transition-all`}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-xl">{icon}</span>
        {pulse && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse mt-1" />}
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs font-medium text-white mt-0.5">{label}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function MiniBar({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

export default function KPIDashboard({ greeting }: Props) {
  const [kpi, setKpi] = useState<KPIData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [fleetRes, bookingsRes, mainRes, alertsRes] = await Promise.allSettled([
        fetch('/api/fleet/stats', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/bookings', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/maintenance-requests', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/alerts', { cache: 'no-store' }).then(r => r.json()),
      ]);

      const fleet    = fleetRes.status    === 'fulfilled' ? fleetRes.value    : {};
      const rawBook  = bookingsRes.status === 'fulfilled' ? bookingsRes.value : [];
      const rawMain  = mainRes.status     === 'fulfilled' ? mainRes.value     : [];
      const rawAlert = alertsRes.status   === 'fulfilled' ? alertsRes.value   : [];

      const books  = Array.isArray(rawBook)  ? rawBook  : rawBook.data  ?? [];
      const maint  = Array.isArray(rawMain)  ? rawMain  : rawMain.data  ?? [];
      const alerts = Array.isArray(rawAlert) ? rawAlert : rawAlert.data ?? [];

      setKpi({
        fleet: {
          total: fleet.totalVehicles ?? 0,
          available: fleet.available ?? 0,
          inMaintenance: fleet.inMaintenance ?? 0,
          allocated: fleet.allocated ?? 0,
          expiringDocs: fleet.expiringDocs ?? 0,
          openWorkOrders: fleet.openWorkOrders ?? 0,
          expiringInsurance: fleet.expiringInsurance ?? 0,
        },
        bookings: {
          total: books.length,
          active: books.filter((b: any) => b.status === 'ACTIVE').length,
          pending: books.filter((b: any) => b.status === 'PENDING').length,
          confirmed: books.filter((b: any) => b.status === 'CONFIRMED').length,
        },
        maintenance: {
          total: maint.length,
          critical: maint.filter((m: any) => m.priority === 'Critical').length,
          high: maint.filter((m: any) => m.priority === 'High').length,
        },
        alerts: {
          total: alerts.length,
          critical: alerts.filter((a: any) => a.severity === 'CRITICAL').length,
          high: alerts.filter((a: any) => a.severity === 'HIGH').length,
        },
      });
      setLastUpdated(new Date());
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); const t = setInterval(fetchAll, 30000); return () => clearInterval(t); }, []);

  if (loading) return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/50 p-5 w-full max-w-2xl space-y-3 animate-pulse">
      <div className="h-4 bg-slate-700 rounded w-1/2 mb-4" />
      <div className="grid grid-cols-4 gap-3">{[...Array(8)].map((_, i) => <div key={i} className="h-20 bg-slate-700/50 rounded-xl" />)}</div>
    </div>
  );

  if (!kpi) return null;

  const utilizationPct = kpi.fleet.total > 0
    ? Math.round(((kpi.fleet.total - kpi.fleet.available) / kpi.fleet.total) * 100)
    : 0;

  const hasCritical = kpi.alerts.critical > 0 || kpi.maintenance.critical > 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/50 backdrop-blur-sm p-5 w-full max-w-2xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🎯</span>
          <div>
            <h3 className="text-sm font-semibold text-white">Operations Dashboard</h3>
            {greeting && <p className="text-xs text-slate-400 mt-0.5">{greeting}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasCritical && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded-lg border border-red-500/30 animate-pulse">⚡ Action Required</span>}
          <button onClick={fetchAll} className="text-xs text-slate-400 hover:text-white bg-slate-700/60 px-2 py-1 rounded-lg">↻</button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-4 gap-2">
        <KPITile icon="🚗" label="Total Fleet"     value={kpi.fleet.total}          color="text-white"         pulse />
        <KPITile icon="✅" label="Available"       value={kpi.fleet.available}      color="text-emerald-400"   sub={`${Math.round((kpi.fleet.available/Math.max(kpi.fleet.total,1))*100)}% of fleet`} />
        <KPITile icon="📋" label="Active Bookings" value={kpi.bookings.active}      color="text-cyan-400"      sub={`${kpi.bookings.pending} pending`} />
        <KPITile icon="🔧" label="Maintenance"     value={kpi.maintenance.total}    color={kpi.maintenance.critical > 0 ? 'text-red-400' : 'text-amber-400'} sub={kpi.maintenance.critical > 0 ? `${kpi.maintenance.critical} critical` : 'All under control'} />
        <KPITile icon="⚠️" label="Alerts"          value={kpi.alerts.total}         color={kpi.alerts.critical > 0 ? 'text-red-400' : 'text-slate-300'} sub={kpi.alerts.critical > 0 ? `${kpi.alerts.critical} critical` : 'No critical'} />
        <KPITile icon="📄" label="Doc Expiries"    value={kpi.fleet.expiringDocs}   color={kpi.fleet.expiringDocs > 0 ? 'text-amber-400' : 'text-slate-400'} sub="Next 30 days" />
        <KPITile icon="🛡️" label="Insur. Expiries" value={kpi.fleet.expiringInsurance} color={kpi.fleet.expiringInsurance > 0 ? 'text-orange-400' : 'text-slate-400'} sub="Next 30 days" />
        <KPITile icon="⚙️" label="Work Orders"     value={kpi.fleet.openWorkOrders} color={kpi.fleet.openWorkOrders > 0 ? 'text-purple-400' : 'text-slate-400'} sub="Open" />
      </div>

      {/* Utilization bar */}
      <div className="bg-slate-900/50 rounded-xl p-4 border border-white/5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Fleet Utilization</span>
          <span className={`text-lg font-bold ${utilizationPct >= 75 ? 'text-emerald-400' : utilizationPct >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{utilizationPct}%</span>
        </div>
        <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-blue-500 transition-all duration-700"
            style={{ width: `${utilizationPct}%` }} />
        </div>
        <div className="flex justify-between text-xs text-slate-600 mt-1.5">
          <span>0%</span>
          <span>Target: 80%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Fleet breakdown */}
      <div className="bg-slate-900/50 rounded-xl p-4 border border-white/5 space-y-2">
        <div className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">Fleet Breakdown</div>
        {[
          { label: 'Available',    value: kpi.fleet.available,     color: 'bg-emerald-500' },
          { label: 'In Service',   value: kpi.fleet.allocated,     color: 'bg-blue-500' },
          { label: 'Maintenance',  value: kpi.fleet.inMaintenance, color: 'bg-amber-500' },
          { label: 'Other',        value: Math.max(0, kpi.fleet.total - kpi.fleet.available - kpi.fleet.allocated - kpi.fleet.inMaintenance), color: 'bg-slate-500' },
        ].map(row => (
          <div key={row.label} className="flex items-center gap-3">
            <span className="text-xs text-slate-400 w-20 shrink-0">{row.label}</span>
            <MiniBar value={row.value} total={kpi.fleet.total} color={row.color} />
            <span className="text-xs text-white font-semibold w-4 text-right">{row.value}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-600">
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Live · Auto-refreshes every 30s</span>
        <span>Updated {lastUpdated.toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
