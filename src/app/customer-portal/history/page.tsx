'use client';

/** Customer Portal — service history in the Smart Data Grid, with period / site filters. */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { History } from 'lucide-react';
import SmartDataGrid, { type SmartDataGridColumn } from '@/components/ui/SmartDataGrid';
import { FormAlert, SelectInput } from '@/components/ui/form-kit';
import {
  fetchRequests, slaState, stageLabel, fmtDateTime, ENTITLEMENT_LABEL, PRIORITY_LABEL, PRIORITY_TONE, SLA_LABEL, SLA_TONE,
  STATUS_TONE, type CustomerRequest,
} from '../portal-shared';

const PERIODS = [
  { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' }, { value: 'all', label: 'All time' },
];

export default function CustomerPortalHistory() {
  const router = useRouter();
  const [period, setPeriod] = useState('90');
  const [siteId, setSiteId] = useState('');
  const [sites, setSites] = useState<Array<{ id: string; name: string }>>([]);
  const [rows, setRows] = useState<CustomerRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/customer-portal/fsm/assets', { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (data?.ok) setSites(data.sites ?? []);
    })();
  }, []);

  useEffect(() => {
    const q = new URLSearchParams({ scope: 'all' });
    if (period !== 'all') q.set('from', new Date(Date.now() - Number(period) * 86_400_000).toISOString());
    if (siteId) q.set('siteId', siteId);
    setRows(null);
    fetchRequests(`?${q.toString()}`).then(setRows).catch((e: Error) => setErr(e.message));
  }, [period, siteId]);

  const columns = useMemo<SmartDataGridColumn<CustomerRequest>[]>(() => [
    { key: 'id', header: 'Request ID', accessor: (r) => r.readableId ?? '', render: (r) => <span className="font-mono text-[11px] whitespace-nowrap">{r.readableId}</span> },
    { key: 'title', header: 'Subject', accessor: (r) => r.title, render: (r) => <span className="text-xs font-semibold">{r.title}</span> },
    { key: 'site', header: 'Site', filter: 'select', accessor: (r) => r.siteName ?? '—' },
    { key: 'asset', header: 'Asset', accessor: (r) => [r.assetNo, r.assetName].filter(Boolean).join(' · ') || '—' },
    {
      key: 'priority', header: 'Priority', filter: 'select', accessor: (r) => PRIORITY_LABEL[r.priority] ?? r.priority,
      render: (r) => <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${PRIORITY_TONE[r.priority] ?? ''}`}>{PRIORITY_LABEL[r.priority] ?? r.priority}</span>,
    },
    {
      key: 'status', header: 'Status', filter: 'select', accessor: (r) => stageLabel(r.status),
      render: (r) => <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${STATUS_TONE(r.status)}`}>{stageLabel(r.status)}</span>,
    },
    {
      key: 'sla', header: 'SLA', filter: 'select', accessor: (r) => SLA_LABEL[slaState(r)],
      render: (r) => { const s = slaState(r); return <span className={`text-xs font-semibold ${SLA_TONE[s]}`}>{SLA_LABEL[s]}</span>; },
    },
    { key: 'entitlement', header: 'Entitlement', filter: 'select', accessor: (r) => (r.entitlementType ? ENTITLEMENT_LABEL[r.entitlementType] ?? r.entitlementType : '—') },
    { key: 'created', header: 'Raised', filter: false, accessor: (r) => r.createdAt, render: (r) => <span className="text-xs whitespace-nowrap">{fmtDateTime(r.createdAt)}</span> },
  ], []);

  return (
    <div className="space-y-3">
      {err && <FormAlert>{err}</FormAlert>}
      <div className="flex flex-wrap gap-3 items-end rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <label className="text-xs font-semibold min-w-[180px]">Period
          <SelectInput value={period} onChange={(e) => setPeriod(e.target.value)} className="mt-1">
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </SelectInput>
        </label>
        <label className="text-xs font-semibold min-w-[200px]">Entity / site
          <SelectInput value={siteId} onChange={(e) => setSiteId(e.target.value)} className="mt-1">
            <option value="">All sites</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectInput>
        </label>
        <span className="text-[11px] text-[var(--text-muted)] inline-flex items-center gap-1 ml-auto"><History className="w-3.5 h-3.5" /> Status, priority, SLA and entitlement filters are in the grid</span>
      </div>
      <SmartDataGrid<CustomerRequest>
        rows={rows ?? []}
        columns={columns}
        getRowId={(r) => r.id}
        loading={!rows}
        onRowClick={(r) => router.push(`/customer-portal/requests?id=${r.id}`)}
        emptyMessage="No requests in this period."
        toolbar={{ title: 'Service history', exportName: 'service-history' }}
      />
    </div>
  );
}
