'use client';

/**
 * Customer Portal — Logistics shipments: the company's shipments (job orders)
 * and the shipping requests still being reviewed, from the Logistics module.
 * Replaces the Shipper portal's Shipments page.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PackageOpen, PlusCircle, Clock } from 'lucide-react';
import SmartDataGrid, { type SmartDataGridColumn } from '@/components/ui/SmartDataGrid';
import { Panel } from '@/components/ui/page-theme';
import { FormAlert } from '@/components/ui/form-kit';
import { usePortal } from '../../portal-shell';
import { fmtDateTime } from '../transport-shared';
import {
  fmtMoney, shipmentStatusLabel, shipmentStatusTone, type ShipmentListItem, type ShippingRequestItem,
} from './shipments-shared';

export default function CustomerShipmentsPage() {
  const me = usePortal();
  const router = useRouter();
  const [shipments, setShipments] = useState<ShipmentListItem[] | null>(null);
  const [requests, setRequests] = useState<ShippingRequestItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/shipper-portal/shipments?limit=200', { cache: 'no-store' });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error ?? 'Could not load your shipments'); setShipments([]); return; }
      setShipments(d?.shipments ?? []); setRequests(d?.requests ?? []);
    })();
  }, []);

  const columns = useMemo<SmartDataGridColumn<ShipmentListItem>[]>(() => [
    { key: 'no', header: 'Shipment', accessor: (s) => s.shipmentNo ?? '', render: (s) => <span className="font-mono text-[11px] whitespace-nowrap">{s.shipmentNo ?? '—'}</span> },
    { key: 'from', header: 'From', accessor: (s) => s.origin?.name ?? '—' },
    { key: 'to', header: 'To', accessor: (s) => s.destination?.name ?? '—' },
    { key: 'pickup', header: 'Pickup', filter: false, accessor: (s) => s.pickupWindowFrom ?? '', render: (s) => <span className="text-xs whitespace-nowrap">{fmtDateTime(s.pickupWindowFrom)}</span> },
    { key: 'delivery', header: 'Delivery', filter: false, accessor: (s) => s.deliveryWindowFrom ?? '', render: (s) => <span className="text-xs whitespace-nowrap">{fmtDateTime(s.deliveryWindowFrom)}</span> },
    {
      key: 'status', header: 'Status', filter: 'select', accessor: (s) => shipmentStatusLabel(s.status),
      render: (s) => <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${shipmentStatusTone(s.status)}`}>{shipmentStatusLabel(s.status)}</span>,
    },
    { key: 'rate', header: 'Rate', align: 'right', filter: false, accessor: (s) => s.customerRateAmount ?? 0, render: (s) => <span className="text-xs tabular-nums">{fmtMoney(s.customerRateAmount, s.currency)}</span> },
  ], []);

  const canBook = me?.user.roles.TRANSPORT !== 'VIEWER';

  return (
    <div className="space-y-4">
      {err && <FormAlert>{err}</FormAlert>}
      {requests.length > 0 && (
        <Panel title="Shipping requests under review" subtitle="Our team turns these into shipments" icon={Clock} accent="amber">
          <div className="divide-y divide-[var(--border-subtle)]">
            {requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <span className="font-mono text-[11px]">{r.requestNo}</span>
                <span className="flex-1 min-w-0 truncate">{[r.origin?.name, r.destination?.name].filter(Boolean).join(' → ')}</span>
                <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${shipmentStatusTone(r.status)}`}>{shipmentStatusLabel(r.status)}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <SmartDataGrid<ShipmentListItem>
        rows={shipments ?? []} columns={columns} getRowId={(s) => s.id} loading={!shipments}
        onRowClick={(s) => router.push(`/customer-portal/transport/shipments/${s.id}`)}
        emptyMessage="No shipments yet."
        toolbar={{
          title: 'Shipments', exportName: 'shipments',
          actions: canBook ? (
            <Link href="/customer-portal/transport/new?category=LOGISTICS"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500">
              <PlusCircle className="w-3.5 h-3.5" /> New shipment
            </Link>
          ) : undefined,
        }}
      />
      <p className="text-[11px] text-[var(--text-muted)] inline-flex items-center gap-1"><PackageOpen className="w-3.5 h-3.5" /> Open a shipment for its tracking and proof of delivery.</p>
    </div>
  );
}
