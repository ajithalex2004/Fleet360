'use client';

/** Customer Portal — Transport request history in the Smart Data Grid, with period and service filters. */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { History } from 'lucide-react';
import SmartDataGrid, { type SmartDataGridColumn } from '@/components/ui/SmartDataGrid';
import { FormAlert, SelectInput } from '@/components/ui/form-kit';
import { usePortal } from '../../portal-shell';
import { fetchTransportRequests, fmtDateTime, fmtService, STATUS_LABEL, STATUS_TONE, type TransportRequest } from '../transport-shared';

const PERIODS = [
  { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' }, { value: 'all', label: 'All time' },
];

function HistoryView() {
  const me = usePortal();
  const router = useRouter();
  const params = useSearchParams();
  const [period, setPeriod] = useState('90');
  const [category, setCategory] = useState(params.get('category') ?? '');
  const [rows, setRows] = useState<TransportRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams({ scope: 'all' });
    if (period !== 'all') q.set('from', new Date(Date.now() - Number(period) * 86_400_000).toISOString());
    if (category) q.set('category', category);
    setRows(null);
    fetchTransportRequests(`?${q.toString()}`).then(setRows).catch((e: Error) => setErr(e.message));
  }, [period, category]);

  const columns = useMemo<SmartDataGridColumn<TransportRequest>[]>(() => [
    { key: 'no', header: 'Request ID', accessor: (r) => r.requestNo, render: (r) => <span className="font-mono text-[11px] whitespace-nowrap">{r.requestNo}</span> },
    { key: 'cat', header: 'Service', filter: 'select', accessor: (r) => r.categoryTitle, render: (r) => <span className="text-xs font-semibold">{r.categoryTitle}</span> },
    { key: 'route', header: 'Pickup → drop-off', accessor: (r) => [r.pickup, r.dropoff].filter(Boolean).join(' → ') || '—' },
    { key: 'when', header: 'Service date', filter: false, accessor: (r) => r.serviceDate ?? '', render: (r) => <span className="text-xs whitespace-nowrap">{fmtService(r)}</span> },
    { key: 'vehicle', header: 'Vehicle type', filter: 'select', accessor: (r) => r.vehicleCategory ?? '—' },
    {
      key: 'status', header: 'Status', filter: 'select', accessor: (r) => STATUS_LABEL[r.status],
      render: (r) => <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>,
    },
    { key: 'driver', header: 'Driver', accessor: (r) => r.driver?.name ?? '—' },
    { key: 'by', header: 'Requested by', filter: 'select', accessor: (r) => r.requestedByName ?? '—' },
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
        <label className="text-xs font-semibold min-w-[200px]">Service
          <SelectInput value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1">
            <option value="">All services</option>
            {me?.transportCategories.map((c) => <option key={c.category} value={c.category}>{c.title}</option>)}
          </SelectInput>
        </label>
        <span className="text-[11px] text-[var(--text-muted)] inline-flex items-center gap-1 ml-auto"><History className="w-3.5 h-3.5" /> Status, vehicle and requester filters are in the grid</span>
      </div>
      <SmartDataGrid<TransportRequest>
        rows={rows ?? []} columns={columns} getRowId={(r) => r.id} loading={!rows}
        onRowClick={(r) => router.push(`/customer-portal/transport/requests?id=${r.id}`)}
        emptyMessage="No requests in this period." toolbar={{ title: 'Transport history', exportName: 'transport-history' }}
      />
    </div>
  );
}

export default function TransportHistoryPage() {
  return <Suspense fallback={null}><HistoryView /></Suspense>;
}
