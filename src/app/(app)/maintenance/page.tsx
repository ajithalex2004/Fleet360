'use client';
import Link from 'next/link';
import { Wrench, Activity, Plus } from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui/page-theme';

export default function MaintenanceDashboard() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance"
        subtitle="Service requests, work orders, invoices and predictive analytics."
        icon={Wrench}
        accent="blue"
        actions={
          <Link
            href="/maintenance/create"
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 hover:opacity-90 transition-all"
          >
            <Plus className="w-4 h-4" /> New request
          </Link>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          { label: 'Active requests',   value: 12,           sub: '↑ 2 since last week',   tone: 'from-blue-500 to-indigo-600' },
          { label: 'Pending approvals', value: 4,            sub: 'Requires attention',     tone: 'from-amber-500 to-orange-600' },
          { label: 'Monthly cost',      value: 'AED 8,450',  sub: '↑ 12% vs last month',    tone: 'from-emerald-500 to-teal-600' },
        ].map(card => (
          <div key={card.label} className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${card.tone} p-5 shadow-sm`}>
            <p className="text-sm font-medium text-white/80">{card.label}</p>
            <p className="mt-3 text-3xl font-bold text-white">{card.value}</p>
            <p className="mt-1 text-xs text-white/60">{card.sub}</p>
          </div>
        ))}
      </div>

      <Panel title="Recent activity" subtitle="Service requests and work-order events" icon={Activity} accent="blue">
        <div className="h-56 flex items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/20">
          <div className="text-center">
            <Activity className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-500 text-sm font-medium">Activity feed</p>
            <p className="text-xs text-slate-600 mt-1">Data will populate here</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
