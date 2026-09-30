/**
 * Garage Assignments — read-only consumer view for the Maintenance module.
 * Open maintenance requests that have a garage assigned, from
 * /api/maintenance-requests. Full garage CRUD is owned by Vendors at
 * /vendors/garages.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, ExternalLink } from 'lucide-react';
import { isSlaMonitored, toMaintenanceStatus } from '@/lib/maintenance/sla-requests';
import { MaintenanceStatus } from '@/types/maintenance';

interface Assignment {
  id: string;
  workOrder: string;
  vehicle: string;
  garage: string;
  status: string;
  since: string | null;
}

const statusColor: Partial<Record<MaintenanceStatus, string>> = {
  [MaintenanceStatus.UNDER_MAINTENANCE]:  'bg-blue-500/20 text-blue-300 border-blue-500/30',
  [MaintenanceStatus.QUALITY_INSPECTION]: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  [MaintenanceStatus.INSPECTION_FAILED]:  'bg-red-500/20 text-red-300 border-red-500/30',
  [MaintenanceStatus.REPAIR_COMPLETED]:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
};

/** Open requests with a garage, oldest first. */
function toAssignments(rows: Array<Record<string, unknown>>): Assignment[] {
  return rows
    .filter((r) => r.garageId && !r.completionDate && isSlaMonitored({ id: String(r.id), status: r.status as string | null }))
    .map((r) => {
      const v = (r.Vehicle ?? null) as Record<string, unknown> | null;
      const g = (r.Garage ?? null) as Record<string, unknown> | null;
      return {
        id: String(r.id),
        workOrder: typeof r.workOrderNo === 'string' && r.workOrderNo ? r.workOrderNo : String(r.id).slice(0, 8),
        vehicle: v ? [[v.make, v.model].filter(Boolean).join(' '), v.licensePlate].filter(Boolean).join(' – ') : String(r.vehicleId ?? '—'),
        garage: (g?.name as string | undefined) || '—',
        status: String(r.status ?? ''),
        since: (r.requestDate ?? r.createdAt ?? null) as string | null,
      };
    })
    .sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''));
}

export default function GarageAssignmentsPage() {
  const [rows, setRows] = useState<Assignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/maintenance-requests', { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? `Could not load maintenance requests (${res.status})`);
        if (!cancelled) setRows(toAssignments(Array.isArray(json) ? json : []));
      })
      .catch((e) => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Could not load maintenance requests'); setRows([]); } });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Garage Assignments</h1>
          <p className="text-xs mt-1 text-[var(--text-faint)]">Open maintenance requests and the garage handling each.</p>
        </div>
        <Link
          href="/vendors/garages"
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors"
        >
          Manage garages
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="rounded-xl border border-slate-500/30 bg-[var(--bg-surface)]/50 p-4 flex items-center gap-3">
        <Building2 className="h-5 w-5 text-[var(--text-muted)] flex-shrink-0" />
        <p className="text-sm text-[var(--text-muted)]">
          <span className="font-semibold text-[var(--text-muted)]">Read-only view.</span>{' '}
          Garages are added and managed in{' '}
          <Link href="/vendors/garages" className="text-blue-400 underline hover:text-blue-300">Vendors → Garage management</Link>;
          a garage is assigned on each maintenance request.
        </p>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <table className="min-w-full divide-y divide-white/10">
          <thead className="bg-[var(--bg-surface)]/50">
            <tr>
              {['Work Order', 'Vehicle', 'Assigned Garage', 'Status', 'Since'].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-faint)]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows === null ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-[var(--text-faint)]">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-[var(--text-faint)]">No open maintenance requests are assigned to a garage.</td></tr>
            ) : rows.map((row) => {
              const s = toMaintenanceStatus(row.status);
              return (
                <tr key={row.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                  <td className="px-5 py-4 text-sm font-mono">
                    <Link href={`/maintenance/requests/${row.id}`} className="text-blue-400 hover:underline">{row.workOrder}</Link>
                  </td>
                  <td className="px-5 py-4 text-sm text-[var(--text-main)]">{row.vehicle}</td>
                  <td className="px-5 py-4 text-sm text-[var(--text-muted)]">{row.garage}</td>
                  <td className="px-5 py-4">
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${(s && statusColor[s]) ?? 'bg-[var(--bg-surface-hover)]/40 text-[var(--text-muted)] border-[var(--border-subtle)]'}`}>
                      {s ?? (row.status || '—')}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm text-[var(--text-faint)]">{row.since ? new Date(row.since).toLocaleDateString('en-GB') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
