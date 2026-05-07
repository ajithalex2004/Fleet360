import Link from 'next/link';
import { Wrench, Inbox, Clock, DollarSign, Activity, Plus } from 'lucide-react';
import { PageHeader, KpiCard, Panel } from '@/components/ui/page-theme';

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
        <KpiCard label="Active requests"   value={12}      sub="↑ 2 since last week"     icon={Inbox}      accent="blue"   />
        <KpiCard label="Pending approvals" value={4}       sub="Requires attention"      icon={Clock}      accent="amber"  />
        <KpiCard label="Monthly cost"      value="AED 8,450" sub="↑ 12% vs last month"   icon={DollarSign} accent="emerald"/>
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
