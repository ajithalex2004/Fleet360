'use client';
import React, { useState, useEffect, useCallback } from 'react';

export default function BusOpsDashboard() {
  const [data, setData]     = useState<any>({ routes: [], schedules: [], staff: [], incidents: [], requests: [] });
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, sRes, stRes, iRes, reqRes] = await Promise.all([
        fetch('/api/bus-ops/routes'),
        fetch('/api/bus-ops/schedules'),
        fetch('/api/bus-ops/staff'),
        fetch('/api/bus-ops/incidents'),
        fetch('/api/bus-ops/transport-requests'),
      ]);
      const [routes, schedules, staff, incidents, requests] = await Promise.all([
        rRes.json(), sRes.json(), stRes.json(), iRes.json(), reqRes.json(),
      ]);
      setData({
        routes:    Array.isArray(routes)    ? routes    : [],
        schedules: Array.isArray(schedules) ? schedules : [],
        staff:     Array.isArray(staff)     ? staff     : [],
        incidents: Array.isArray(incidents) ? incidents : [],
        requests:  Array.isArray(requests)  ? requests  : [],
      });
    } catch { /* show empty state */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const { routes, schedules, staff, incidents, requests } = data;
  const todayTrips    = schedules.filter((s: any) => {
    const d = new Date(s.departureTime);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });
  const activeTrips   = schedules.filter((s: any) => ['DEPARTED','IN_TRANSIT'].includes(s.status ?? ''));
  const openIncidents = incidents.filter((i: any) => i.status === 'OPEN');
  const pendingReqs   = requests.filter((r: any) => r.status === 'PENDING');

  const statCards = [
    { title: 'Active Routes',       value: routes.filter((r:any)=>r.isActive).length,  color: 'from-blue-500 to-indigo-600',     href: '/bus-ops/routes' },
    { title: 'Today\'s Trips',      value: todayTrips.length,                           color: 'from-emerald-500 to-teal-600',    href: '/bus-ops/schedules' },
    { title: 'Trips In Progress',   value: activeTrips.length,                          color: 'from-amber-500 to-orange-600',    href: '/bus-ops/schedules' },
    { title: 'Staff Registered',    value: staff.filter((s:any)=>s.isActive).length,   color: 'from-violet-500 to-purple-600',   href: '/bus-ops/staff' },
    { title: 'Open Incidents',      value: openIncidents.length,                        color: 'from-rose-500 to-pink-600',       href: '/bus-ops/incidents' },
    { title: 'Pending Requests',    value: pendingReqs.length,                          color: 'from-slate-500 to-slate-600',     href: '/bus-ops/passengers' },
  ];

  const STATUS_COLORS: Record<string,string> = {
    SCHEDULED:  'bg-blue-500/20 text-blue-400 border-blue-500/30',
    DEPARTED:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
    IN_TRANSIT: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    COMPLETED:  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    CANCELLED:  'bg-rose-500/20 text-rose-400 border-rose-500/30',
  };

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading dashboard...</div></div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Staff Transportation</h1>
        <p className="text-slate-400">Bus Operations — Real-time overview</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {statCards.map(card => (
          <a key={card.title} href={card.href}
            className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${card.color} p-5 hover:opacity-90 transition-all`}>
            <div className="text-3xl font-bold text-white">{card.value}</div>
            <div className="mt-1 text-xs font-medium text-white/80">{card.title}</div>
          </a>
        ))}
      </div>

      {/* Today's Trips */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Today's Trips</h2>
          <a href="/bus-ops/schedules" className="text-sm text-emerald-400 hover:text-emerald-300">View all schedules</a>
        </div>
        {todayTrips.length === 0 ? (
          <div className="text-center text-slate-400 py-8">No trips scheduled for today. <a href="/bus-ops/schedules" className="text-emerald-400 hover:underline">Create one.</a></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {todayTrips.slice(0,6).map((t: any) => (
              <div key={t.id} className="bg-slate-700/50 border border-white/10 rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-medium text-white text-sm">{t.tripNumber ?? t.id.slice(0,8)}</div>
                    <div className="text-slate-400 text-xs">{t.route?.name ?? '-'} ({t.shiftType ?? '-'} | {t.direction ?? '-'})</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[t.status ?? 'SCHEDULED']}`}>
                    {t.status ?? 'SCHEDULED'}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span>Departs {new Date(t.departureTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
                  <span>{t.confirmedCount ?? 0}/{t.capacity ?? 30} pax</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Incidents + Quick Links */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Open Incidents</h2>
            <a href="/bus-ops/incidents" className="text-sm text-rose-400 hover:text-rose-300">View all</a>
          </div>
          {openIncidents.length === 0 ? (
            <div className="text-center text-slate-400 py-6">No open incidents</div>
          ) : (
            <div className="space-y-3">
              {openIncidents.slice(0,4).map((inc: any) => (
                <div key={inc.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-700/50">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${inc.severity === 'CRITICAL' ? 'bg-red-500' : inc.severity === 'HIGH' ? 'bg-orange-500' : inc.severity === 'MEDIUM' ? 'bg-amber-500' : 'bg-slate-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{inc.incidentNo} — {inc.incidentType}</div>
                    <div className="text-xs text-slate-400">{inc.location ?? '-'} · {new Date(inc.incidentDate).toLocaleDateString()}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded border ${inc.severity === 'CRITICAL' ? 'bg-red-500/20 text-red-400 border-red-500/30' : inc.severity === 'HIGH' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30'}`}>{inc.severity}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Add Route',           href: '/bus-ops/routes',    color: 'from-blue-600 to-indigo-600' },
              { label: 'New Trip',            href: '/bus-ops/schedules', color: 'from-emerald-600 to-teal-600' },
              { label: 'Register Staff',      href: '/bus-ops/staff',     color: 'from-violet-600 to-purple-600' },
              { label: 'Log Incident',        href: '/bus-ops/incidents', color: 'from-rose-600 to-pink-600' },
              { label: 'Manage Passengers',   href: '/bus-ops/passengers',color: 'from-amber-600 to-orange-600' },
              { label: 'Trip Requests',       href: '/bus-ops/passengers',color: 'from-slate-600 to-slate-500' },
            ].map(link => (
              <a key={link.label} href={link.href}
                className={`block text-center py-3 px-2 rounded-xl bg-gradient-to-r ${link.color} text-white text-xs font-medium hover:opacity-90 transition-all`}>
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
