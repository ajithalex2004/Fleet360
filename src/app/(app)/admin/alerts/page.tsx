'use client';

/**
 * Platform Alert Engine — canonical home for all cross-module alerts.
 *
 * Modules that previously owned their own alert configuration and action
 * centres (e.g. Maintenance /alert-config + /action-centre) redirect here.
 * This page is the single place to configure alert rules, triage active
 * alerts, and review alert history across the entire Fleet360 platform.
 *
 * Phase A redirect targets:
 *   /maintenance/alert-config     → this page
 *   /maintenance/action-centre    → this page
 */

import Link from 'next/link';
import {
  Bell, Settings, Activity, History, AlertTriangle,
  ArrowRight, Wrench, Car, Fuel, FileText, Shield,
} from 'lucide-react';

const MODULE_SOURCES = [
  { icon: Wrench,    label: 'Maintenance',  description: 'Odometer thresholds, QC failures, invoice SLAs' },
  { icon: Car,       label: 'Fleet',        description: 'Registration, insurance, permit expiries' },
  { icon: Fuel,      label: 'Fuel',         description: 'Over-consumption, missing logs, anomalies' },
  { icon: FileText,  label: 'Compliance',   description: 'Document expiry, permit renewals' },
  { icon: Shield,    label: 'Incidents',    description: 'Active incidents, escalation SLAs' },
];

const SECTIONS = [
  {
    href:        '/admin/alerts/rules',
    icon:        Settings,
    label:       'Alert Rules',
    description: 'Configure thresholds, frequencies, and notification channels for every module.',
    accent:      'from-blue-500 to-indigo-600',
    bg:          'bg-blue-500/10 border-blue-500/30',
    iconColor:   'text-blue-400',
  },
  {
    href:        '/admin/alerts/active',
    icon:        Activity,
    label:       'Active Alerts',
    description: 'Triage, assign, and escalate open alerts across all fleet modules.',
    accent:      'from-amber-500 to-orange-600',
    bg:          'bg-amber-500/10 border-amber-500/30',
    iconColor:   'text-amber-400',
  },
  {
    href:        '/admin/alerts/history',
    icon:        History,
    label:       'Alert History',
    description: 'Audit trail of resolved and closed alerts with full escalation timeline.',
    accent:      'from-emerald-500 to-teal-600',
    bg:          'bg-emerald-500/10 border-emerald-500/30',
    iconColor:   'text-emerald-400',
  },
];

export default function PlatformAlertsPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="rounded-xl bg-amber-500/15 p-2.5">
              <Bell className="h-5 w-5 text-amber-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Platform Alert Engine</h1>
          </div>
          <p className="text-xs text-slate-500 ml-[52px]">
            Unified alert configuration and action centre for all Fleet360 modules.
          </p>
        </div>
      </div>

      {/* Migration notice */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 flex gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-300">
            Maintenance alert pages have been consolidated here
          </p>
          <p className="mt-0.5 text-xs text-amber-500">
            <span className="font-mono">/maintenance/alert-config</span> and{' '}
            <span className="font-mono">/maintenance/action-centre</span> now redirect to this
            page. Configure all cross-module alert rules from Alert Rules below.
          </p>
        </div>
      </div>

      {/* Three main sections */}
      <div className="grid gap-4 md:grid-cols-3">
        {SECTIONS.map(s => {
          const Icon = s.icon;
          return (
            <Link
              key={s.href}
              href={s.href}
              className={`group flex flex-col gap-4 rounded-xl border p-6 transition-all hover:shadow-lg hover:shadow-black/30 ${s.bg}`}
            >
              <div className="flex items-center justify-between">
                <Icon className={`h-6 w-6 ${s.iconColor}`} />
                <ArrowRight className="h-4 w-4 text-slate-600 transition-transform group-hover:translate-x-1" />
              </div>
              <div>
                <p className="font-semibold text-white">{s.label}</p>
                <p className="mt-1 text-xs text-slate-400">{s.description}</p>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Module sources */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
          Alert sources
        </h2>
        <div className="rounded-xl border border-white/10 bg-slate-900 divide-y divide-white/5">
          {MODULE_SOURCES.map(src => {
            const Icon = src.icon;
            return (
              <div key={src.label} className="flex items-center gap-4 px-5 py-3.5">
                <div className="rounded-lg bg-slate-800 p-2">
                  <Icon className="h-4 w-4 text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{src.label}</p>
                  <p className="text-xs text-slate-500">{src.description}</p>
                </div>
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                  Active
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
