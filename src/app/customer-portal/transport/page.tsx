'use client';

/** Customer Portal — Transport dashboard: request counts and the company's Transport services. */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Truck, PlusCircle, Activity, Clock, CheckCircle2, ListChecks } from 'lucide-react';
import { KpiCard, StatGrid, Panel } from '@/components/ui/page-theme';
import { FormAlert } from '@/components/ui/form-kit';
import { usePortal } from '../portal-shell';
import { fetchTransportRequests, fmtService, isOpen, STATUS_LABEL, STATUS_TONE, type TransportRequest } from './transport-shared';

const COMMON_MENU = ['New request', 'Active requests', 'History'];

export default function TransportDashboard() {
  const me = usePortal();
  const [rows, setRows] = useState<TransportRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetchTransportRequests('?scope=all').then(setRows).catch((e: Error) => setErr(e.message)); }, []);

  const k = useMemo(() => {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const list = rows ?? [];
    return {
      open: list.filter((r) => isOpen(r.status)).length,
      approval: list.filter((r) => r.status === 'PENDING_APPROVAL').length,
      moving: list.filter((r) => r.status === 'ASSIGNED' || r.status === 'IN_PROGRESS').length,
      done: list.filter((r) => r.status === 'COMPLETED' && new Date(r.updatedAt) >= monthStart).length,
    };
  }, [rows]);

  const canRequest = me?.user.roles.TRANSPORT !== 'VIEWER';
  const cats = me?.transportCategories ?? [];
  const recent = (rows ?? []).filter((r) => isOpen(r.status)).slice(0, 6);

  return (
    <div className="space-y-5">
      {err && <FormAlert>{err}</FormAlert>}
      <StatGrid cols={4}>
        <KpiCard label="Open requests" value={rows ? k.open : '—'} icon={Activity} accent="blue" />
        <KpiCard label="Awaiting approval" value={rows ? k.approval : '—'} icon={Clock} accent="amber" />
        <KpiCard label="Driver assigned / on the way" value={rows ? k.moving : '—'} icon={Truck} accent="violet" />
        <KpiCard label="Completed this month" value={rows ? k.done : '—'} icon={CheckCircle2} accent="emerald" />
      </StatGrid>

      <Panel title="Your Transport services" subtitle="The request types available to your company" icon={ListChecks} accent="blue">
        {cats.length === 0 && <p className="text-sm text-[var(--text-muted)]">No Transport services are available yet. Contact your service provider.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {cats.map((c) => (
            <div key={c.category} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-3 space-y-2">
              <div>
                <p className="text-sm font-bold">{c.title}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{c.description}{c.approvalRequired ? ' · needs approval' : ''}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {canRequest && (
                  <Link href={`/customer-portal/transport/new?category=${c.category}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 text-white text-[11px] font-bold hover:bg-blue-500">
                    <PlusCircle className="w-3 h-3" /> New request
                  </Link>
                )}
                <Link href={`/customer-portal/transport/history?category=${c.category}`}
                  className="inline-flex items-center px-2.5 py-1 rounded-lg border border-[var(--border-subtle)] text-[11px] font-semibold hover:bg-[var(--bg-surface-hover)]">
                  Requests
                </Link>
                {c.menu.filter((m) => !COMMON_MENU.includes(m)).map((m) => (
                  <span key={m} title="Coming soon" className="inline-flex items-center px-2.5 py-1 rounded-lg border border-dashed border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)]">
                    {m} · soon
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Open requests" icon={Activity} accent="blue">
        {!rows && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
        {rows && recent.length === 0 && <p className="text-sm text-[var(--text-muted)]">No open requests.</p>}
        <div className="divide-y divide-[var(--border-subtle)]">
          {recent.map((r) => (
            <Link key={r.id} href={`/customer-portal/transport/requests?id=${r.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-[var(--bg-surface-hover)] rounded-lg px-2">
              <div className="min-w-0">
                <p className="font-mono text-[10px] text-[var(--text-muted)]">{r.requestNo} · {r.categoryTitle}</p>
                <p className="text-xs font-semibold truncate">{[r.pickup, r.dropoff].filter(Boolean).join(' → ') || r.categoryTitle}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{fmtService(r)}</p>
              </div>
              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}
