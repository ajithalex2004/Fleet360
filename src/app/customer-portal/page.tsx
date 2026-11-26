'use client';

/** Customer Portal — dashboard: request counts and the active requests at a glance. */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, CheckCircle2, Wrench, PlusCircle, ArrowRight } from 'lucide-react';
import { Panel } from '@/components/ui/page-theme';
import { FormAlert } from '@/components/ui/form-kit';
import {
  fetchRequests, isActive, slaState, stageLabel, fmtDateTime, PRIORITY_LABEL, PRIORITY_TONE, SLA_LABEL, SLA_TONE,
  type CustomerRequest,
} from './portal-shared';
import { usePortal } from './portal-shell';

export default function CustomerPortalDashboard() {
  const me = usePortal();
  const [requests, setRequests] = useState<CustomerRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchRequests('?scope=all').then(setRequests).catch((e: Error) => setErr(e.message));
  }, []);

  const stats = useMemo(() => {
    const rs = requests ?? [];
    const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
    return {
      open: rs.filter((r) => isActive(r.status)).length,
      onSite: rs.filter((r) => r.status === 'In Progress').length,
      atRisk: rs.filter((r) => isActive(r.status) && ['at-risk', 'breached'].includes(slaState(r))).length,
      closed: rs.filter((r) => !isActive(r.status) && new Date(r.updatedAt) >= month).length,
    };
  }, [requests]);
  const active = (requests ?? []).filter((r) => isActive(r.status)).slice(0, 6);
  const tile = (label: string, value: number | string, Icon: typeof Activity, tone: string) => (
    <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
        <Icon className={`w-4 h-4 ${tone}`} />
      </div>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{requests ? value : '—'}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {err && <FormAlert>{err}</FormAlert>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tile('Open requests', stats.open, Activity, 'text-[var(--text-main)]')}
        {tile('Technician on site', stats.onSite, Wrench, 'text-blue-500')}
        {tile('SLA at risk', stats.atRisk, AlertTriangle, stats.atRisk ? 'text-amber-600' : 'text-[var(--text-main)]')}
        {tile('Closed this month', stats.closed, CheckCircle2, 'text-emerald-600')}
      </div>

      <Panel title="Active requests" subtitle={me ? `Open requests for ${me.customer.name}` : undefined} icon={Activity} accent="blue"
        actions={me?.user.roles.FSM !== 'VIEWER' ? (
          <Link href="/customer-portal/new-request" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500">
            <PlusCircle className="w-4 h-4" /> New request
          </Link>
        ) : undefined}>
        {requests && active.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">No open requests. Raise one with New request.</p>
        )}
        <div className="divide-y divide-[var(--border-subtle)]">
          {active.map((r) => {
            const sla = slaState(r);
            return (
              <Link key={r.id} href={`/customer-portal/requests?id=${r.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-[var(--bg-surface-hover)] px-2 rounded-lg">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] text-[var(--text-muted)]">{r.readableId}</p>
                  <p className="text-sm font-semibold truncate">{r.title}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{[r.siteName, r.assetName].filter(Boolean).join(' · ') || '—'} · {fmtDateTime(r.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${PRIORITY_TONE[r.priority] ?? ''}`}>{PRIORITY_LABEL[r.priority] ?? r.priority}</span>
                  <span className="font-semibold">{stageLabel(r.status)}</span>
                  <span className={`font-semibold ${SLA_TONE[sla]}`}>{SLA_LABEL[sla]}</span>
                  <ArrowRight className="w-4 h-4 text-[var(--text-muted)]" />
                </div>
              </Link>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
