'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  BusFront, Map as MapIcon, Calendar, Clock as ClockIcon, Users, AlertTriangle, FileText, ArrowRight, Sparkles,
  Timer, Scale, BarChart3, Layers, Smartphone, Shield, GitMerge, Repeat, Calculator, Zap, Leaf,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/bus-ops/theme';
import { useFetchedData } from '@/hooks/useFetchedData';

export default function BusOpsDashboard() {
  // Session-scoped fetch cache — 1st visit hits the cached server endpoints
  // (unstable_cache + private s-maxage), 2nd visit in the same tab is
  // instant from the in-memory Map.
  const { data: routesRaw,    loading: routesLoading }    = useFetchedData<any[]>('/api/bus-ops/routes');
  const { data: schedulesRaw, loading: schedulesLoading } = useFetchedData<any[]>('/api/bus-ops/schedules');
  const { data: staffRaw,     loading: staffLoading }     = useFetchedData<any[]>('/api/bus-ops/staff');
  const { data: incidentsRaw, loading: incidentsLoading } = useFetchedData<any[]>('/api/bus-ops/incidents');
  const { data: requestsRaw,  loading: requestsLoading }  = useFetchedData<any[]>('/api/bus-ops/transport-requests');
  const { data: me } = useFetchedData<{ role?: string }>('/api/auth/me');
  const isTenantAdmin = me?.role === 'TENANT_ADMIN' || me?.role === 'SUPER_ADMIN';

  const routes    = Array.isArray(routesRaw)    ? routesRaw    : [];
  const schedules = Array.isArray(schedulesRaw) ? schedulesRaw : [];
  const staff     = Array.isArray(staffRaw)     ? staffRaw     : [];
  const incidents = Array.isArray(incidentsRaw) ? incidentsRaw : [];
  const requests  = Array.isArray(requestsRaw)  ? requestsRaw  : [];
  const loading   = routesLoading || schedulesLoading || staffLoading || incidentsLoading || requestsLoading;
  const todayTrips    = schedules.filter((s: any) => {
    const d = new Date(s.departureTime);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });
  const activeTrips   = schedules.filter((s: any) => ['STARTED','EN_ROUTE','DEPARTED','IN_TRANSIT'].includes(s.status ?? ''));
  const openIncidents = incidents.filter((i: any) => i.status === 'OPEN');
  const pendingReqs   = requests.filter((r: any) => r.status === 'PENDING');

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-[var(--text-muted)] animate-pulse">Loading dashboard...</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Transportation"
        subtitle="Real-time overview of routes, trips, passengers, and incidents."
        icon={BusFront}
        accent="violet"
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Link href="/bus-ops/routes"><KpiCard label="Active Routes"      value={routes.filter((r:any)=>r.isActive).length} icon={MapIcon}        accent="cyan" /></Link>
        <Link href="/bus-ops/schedules"><KpiCard label="Today's Trips"   value={todayTrips.length}                          icon={Calendar}       accent="emerald" /></Link>
        <Link href="/bus-ops/schedules"><KpiCard label="In Progress"     value={activeTrips.length}                         icon={ClockIcon}      accent="amber" /></Link>
        <Link href="/bus-ops/staff"><KpiCard label="Staff Registered"   value={staff.filter((s:any)=>s.isActive).length}  icon={Users}          accent="violet" /></Link>
        <Link href="/bus-ops/incidents"><KpiCard label="Open Incidents"  value={openIncidents.length}                       icon={AlertTriangle}  accent="rose" /></Link>
        <Link href="/bus-ops/passengers"><KpiCard label="Pending Requests" value={pendingReqs.length}                       icon={FileText}       accent="slate" /></Link>
      </div>

      {/* Today's Trips */}
      <Panel
        title="Today's Trips"
        icon={Calendar}
        accent="violet"
        actions={
          <Link href="/bus-ops/schedules" className="text-xs text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        }
      >
        {todayTrips.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-6 text-sm">
            No trips scheduled for today. <Link href="/bus-ops/schedules" className="text-violet-300 hover:underline">Create one.</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {todayTrips.slice(0,6).map((t: any) => (
              <div key={t.id} className="rounded-xl bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] p-4 hover:border-[var(--border-subtle)] transition-colors">
                <div className="flex items-start justify-between mb-2 gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--text-main)] text-sm">{t.tripNumber ?? t.id.slice(0,8)}</div>
                    <div className="text-[var(--text-muted)] text-xs truncate">{t.route?.name ?? '—'} · {t.shiftType ?? '—'} · {t.direction ?? '—'}</div>
                  </div>
                  <StatusPill status={t.status ?? 'SCHEDULED'} />
                </div>
                <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                  <span className="inline-flex items-center gap-1"><ClockIcon className="w-3 h-3" /> {new Date(t.departureTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
                  <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {t.confirmedCount ?? 0}/{t.capacity ?? 30}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Active Incidents + Quick Links */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel
          title="Open Incidents"
          icon={AlertTriangle}
          accent="rose"
          actions={
            <Link href="/bus-ops/incidents" className="text-xs text-rose-300 hover:text-rose-200 inline-flex items-center gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          }
        >
          {openIncidents.length === 0 ? (
            <div className="text-center text-[var(--text-muted)] py-6 text-sm">No open incidents</div>
          ) : (
            <div className="space-y-2">
              {openIncidents.slice(0,4).map((inc: any) => (
                <div key={inc.id} className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)]">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${inc.severity === 'CRITICAL' ? 'bg-rose-500' : inc.severity === 'HIGH' ? 'bg-orange-500' : inc.severity === 'MEDIUM' ? 'bg-amber-500' : 'bg-slate-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--text-main)] truncate">{inc.incidentNo} — {inc.incidentType}</div>
                    <div className="text-xs text-[var(--text-faint)] truncate">{inc.location ?? '—'} · {new Date(inc.incidentDate).toLocaleDateString()}</div>
                  </div>
                  <StatusPill status={inc.severity === 'CRITICAL' || inc.severity === 'HIGH' ? 'danger' : 'warning'} label={inc.severity} />
                </div>
              ))}
            </div>
          )}
        </Panel>


        {isTenantAdmin && (
          <Panel title="Planning" icon={Shield} accent="violet">
            <p className="text-xs text-[var(--text-faint)] mb-3">
              Author PCE rules first, then analyse and apply route consolidations. Constraints gate every apply.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                {
                  label: 'Planning Constraints (PCE)',
                  href: '/bus-ops/planning-constraints',
                  icon: Shield,
                  desc: 'BLOCK / WARN / PENALTY rules for plans & merges',
                },
                {
                  label: 'Route Consolidation',
                  href: '/bus-ops/route-consolidation',
                  icon: GitMerge,
                  desc: 'Analyse pairs, apply merges, history & revert',
                },
                {
                  label: 'Planning Engine',
                  href: '/bus-ops/planning-engine',
                  icon: Sparkles,
                  desc: 'Runcutting / blocking / roster, plus CBA and headway rules',
                },
                {
                  label: 'Vehicle/Resource Optimization',
                  href: '/bus-ops/vehicle-resource-optimization',
                  icon: Repeat,
                  desc: 'Sequential vehicle reuse opportunities — advisory only',
                },
              ].map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex items-start gap-3 p-3 rounded-xl bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] hover:border-violet-500/30 hover:bg-[var(--bg-surface)]/60 transition-all"
                  >
                    <Icon className="w-4 h-4 text-violet-300 shrink-0 mt-0.5" strokeWidth={1.75} />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[var(--text-main)]">{link.label}</div>
                      <div className="text-[11px] text-[var(--text-faint)] mt-0.5">{link.desc}</div>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-[var(--text-faint)] shrink-0 mt-0.5 ml-auto" />
                  </Link>
                );
              })}
            </div>
          </Panel>
        )}

        <Panel title="Quick Actions" icon={Sparkles} accent="violet">
          <div className="grid grid-cols-2 gap-2">
            {[
              // Headway and CBA moved inside this gate along with the rest.
              // They used to render for every role, but both now live behind
              // the Planning Engine's bus-ops:admin:planning-core guard — an
              // ungated tile would just walk the user into a permission wall.
              ...(isTenantAdmin ? [
                { label: 'Planning Engine',   href: '/bus-ops/planning-engine',            icon: Sparkles, accent: 'violet' as const, badge: 'P0' },
                { label: 'PCE Constraints',   href: '/bus-ops/planning-constraints',       icon: Shield,   accent: 'violet' as const },
                { label: 'Route Consolidation', href: '/bus-ops/route-consolidation',      icon: GitMerge, accent: 'violet' as const },
                { label: 'Vehicle/Resource Optimization', href: '/bus-ops/vehicle-resource-optimization', icon: Repeat, accent: 'violet' as const },
                { label: 'Headway Mgmt',      href: '/bus-ops/planning-engine?tab=headway', icon: Timer,   accent: 'cyan' as const,   badge: 'P1' },
                { label: 'Operational Rules Engine', href: '/bus-ops/planning-engine?tab=cba', icon: Scale, accent: 'amber' as const,  badge: 'P1' },
              ] : []),
              { label: 'Shift SLA Monitor', href: '/bus-ops/sla-monitor',  icon: Shield,        accent: 'rose' as const,   badge: 'P0' },
              { label: 'Driver Fatigue & Rest', href: '/bus-ops/drivers/fatigue', icon: Shield, accent: 'rose' as const, badge: 'P1' },
              // Shifts and vehicle-document expiry are owned by Driver
              // Management and Fleet respectively (shared resources across
              // every module, not bus-ops-exclusive) — these link out rather
              // than duplicating a second CRUD surface here. RVE's D3 "no
              // shift" warning and its vehicle-document checks both read
              // from exactly what these two screens manage.
              { label: 'Driver Shifts',     href: '/driver-mgmt/shifts',    icon: ClockIcon,     accent: 'rose' as const,   badge: 'Drivers' },
              { label: 'Vehicle Doc Expiry', href: '/fleet/documents',      icon: FileText,      accent: 'amber' as const,  badge: 'Fleet' },
              { label: 'Ad-Hoc / Overtime Dispatch', href: '/bus-ops/adhoc-dispatch', icon: Zap, accent: 'amber' as const, badge: 'P0' },
              { label: 'Cost Allocation & Recharge', href: '/bus-ops/cost-allocation', icon: Calculator, accent: 'emerald' as const, badge: 'P0' },
              { label: 'ESG Carbon Footprint', href: '/bus-ops/esg',       icon: Leaf,          accent: 'emerald' as const,badge: 'P2' },
              { label: 'Power BI Connector',href: '/bus-ops/powerbi',      icon: BarChart3,     accent: 'emerald' as const,badge: 'P1' },
              { label: 'Multilayer GIS',    href: '/bus-ops/gis',          icon: Layers,        accent: 'rose' as const,   badge: 'P1' },
              { label: 'Rider App (PWA)',   href: '/bus-ops/passenger/app',icon: Smartphone,    accent: 'cyan' as const,   badge: 'P1' },
              { label: 'Add Route',         href: '/bus-ops/routes',       icon: MapIcon,       accent: 'cyan' as const },
              { label: 'New Trip',          href: '/bus-ops/schedules',    icon: Calendar,      accent: 'emerald' as const },
              { label: 'Register Staff',    href: '/bus-ops/staff',        icon: Users,         accent: 'violet' as const },
              { label: 'Log Incident',      href: '/bus-ops/incidents',    icon: AlertTriangle, accent: 'rose' as const },
              { label: 'Manage Passengers', href: '/bus-ops/passengers',   icon: Users,         accent: 'amber' as const },
            ].map(link => {
              const Icon = link.icon;
              return (
                <Link key={link.label} href={link.href}
                  className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] hover:border-[var(--border-subtle)] hover:bg-[var(--bg-surface)]/60 transition-all">
                  <Icon className="w-4 h-4 text-[var(--text-muted)] shrink-0" strokeWidth={1.75} />
                  <span className="text-xs text-[var(--text-main)] truncate flex-1">{link.label}</span>
                  {(link as any).badge && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      (link as any).badge === 'P0'
                        ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                        : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    }`}>{(link as any).badge}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}
