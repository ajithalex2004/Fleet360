/**
 * Garage Assignments — read-only consumer view for the Maintenance module.
 * Shows which approved garages are handling active maintenance work orders.
 * Full garage CRUD is owned by Vendors at /vendors/garages.
 */
'use client';

import Link from 'next/link';
import { Building2, ExternalLink } from 'lucide-react';

const MOCK_ASSIGNMENTS = [
  { workOrder: 'WO-2026-001', vehicle: 'Toyota Hilux – DXB-A-12345', garage: 'Autopro Service Centre', status: 'UNDER_MAINTENANCE', since: '2026-08-09' },
  { workOrder: 'WO-2026-002', vehicle: 'Ford F-150 – SHJ-B-67890', garage: 'ProFix Auto Workshop', status: 'QUALITY_INSPECTION', since: '2026-08-10' },
  { workOrder: 'WO-2026-003', vehicle: 'Mitsubishi Canter – AUH-C-11111', garage: 'Gulf Motors Garage', status: 'REPAIR_COMPLETED', since: '2026-08-11' },
];

const statusColor: Record<string, string> = {
  UNDER_MAINTENANCE: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  QUALITY_INSPECTION: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  REPAIR_COMPLETED:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
};

export default function GarageAssignmentsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Garage Assignments</h1>
          <p className="mt-1 text-slate-500">Active work orders and their assigned garages.</p>
        </div>
        <Link
          href="/vendors/garages"
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-400 hover:text-white hover:border-white/20 transition-colors"
        >
          Manage garages
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Consumer view notice */}
      <div className="rounded-xl border border-slate-500/30 bg-slate-800/50 p-4 flex items-center gap-3">
        <Building2 className="h-5 w-5 text-slate-400 flex-shrink-0" />
        <p className="text-sm text-slate-400">
          <span className="font-semibold text-slate-300">Read-only consumer view.</span>{' '}
          Garage CRUD and onboarding is managed in{' '}
          <Link href="/vendors/garages" className="text-blue-400 underline hover:text-blue-300">
            Vendors → Garage management
          </Link>.
        </p>
      </div>

      {/* Assignments table */}
      <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900">
        <table className="min-w-full divide-y divide-white/10">
          <thead className="bg-slate-800/50">
            <tr>
              {['Work Order', 'Vehicle', 'Assigned Garage', 'Status', 'Since'].map(h => (
                <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {MOCK_ASSIGNMENTS.map(row => (
              <tr key={row.workOrder} className="hover:bg-white/5 transition-colors">
                <td className="px-5 py-4 text-sm font-mono text-blue-400">{row.workOrder}</td>
                <td className="px-5 py-4 text-sm text-white">{row.vehicle}</td>
                <td className="px-5 py-4 text-sm text-slate-300">{row.garage}</td>
                <td className="px-5 py-4">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusColor[row.status] ?? 'bg-slate-700/40 text-slate-400 border-white/10'}`}>
                    {row.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-5 py-4 text-sm text-slate-500">{row.since}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
