'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileText, RefreshCw, Send, WalletCards } from 'lucide-react';
import { PageHeader, KpiCard } from '@/components/ui/page-theme';
import LogisticsDataGrid, { type DataGridColumn } from '@/components/logistics/LogisticsDataGrid';

interface SettlementRow {
  shipmentOrderId: string;
  shipmentNo: string;
  customerName: string | null;
  status: string;
  currency: string;
  customerCharges: number;
  carrierCharges: number;
  accessorialTotal: number;
  postedCustomerInvoiceTotal: number;
  postedCarrierPayableTotal: number;
  activePostingCount: number;
  reversedPostingCount: number;
  customerReconciled: boolean;
  carrierReconciled: boolean;
}

interface SettlementResponse {
  summary: {
    shipments: number;
    customerChargeTotal: number;
    carrierChargeTotal: number;
    unreconciledCustomer: number;
    unreconciledCarrier: number;
    reversedPostings: number;
  };
  shipments: SettlementRow[];
}

function money(currency: string, amount: number) {
  return `${currency || 'AED'} ${amount.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function LogisticsSettlementsPage() {
  const [data, setData] = useState<SettlementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/logistics/settlements?limit=300', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setData(body);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const post = async (shipmentOrderId: string) => {
    setPostingId(shipmentOrderId);
    setMessage(null);
    try {
      const res = await fetch('/api/logistics/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipmentOrderId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to post settlement');
      setMessage(`Posted ${body.shipmentNo ?? 'shipment'} to Finance.`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to post settlement');
    } finally {
      setPostingId(null);
    }
  };

  const rows = data?.shipments ?? [];
  const summary = data?.summary;

  const columns = useMemo<DataGridColumn<SettlementRow>[]>(() => [
    {
      key: 'shipment', header: 'Shipment', accessor: r => r.shipmentNo,
      render: r => <div><div className="font-mono text-xs text-white">{r.shipmentNo}</div><div className="text-xs text-slate-500">{r.customerName ?? '-'}</div></div>,
    },
    { key: 'status', header: 'Status', accessor: r => r.status, filter: 'select' },
    { key: 'customer', header: 'Customer charges', accessor: r => r.customerCharges, align: 'right', render: r => <span className="font-mono text-slate-200">{money(r.currency, r.customerCharges)}</span> },
    { key: 'carrier', header: 'Carrier payable', accessor: r => r.carrierCharges, align: 'right', render: r => <span className="font-mono text-slate-200">{money(r.currency, r.carrierCharges)}</span> },
    {
      key: 'reconcile', header: 'Reconciliation', accessor: r => `${r.customerReconciled}-${r.carrierReconciled}`,
      render: r => (
        <div className="flex flex-wrap gap-1">
          <Status ok={r.customerReconciled} label="AR" />
          <Status ok={r.carrierReconciled} label="AP" />
        </div>
      ),
    },
    {
      key: 'actions', header: '', accessor: r => r.shipmentOrderId, sortable: false, filter: false, align: 'right',
      render: r => (
        <button type="button" disabled={postingId === r.shipmentOrderId || (r.customerReconciled && r.carrierReconciled)} onClick={() => void post(r.shipmentOrderId)} className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-45">
          <Send className="h-3.5 w-3.5" /> {postingId === r.shipmentOrderId ? 'Posting...' : 'Post'}
        </button>
      ),
    },
  ], [postingId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Freight settlements"
        subtitle="Move awarded loads through customer invoice, carrier payable, driver payout, commission, and reconciliation."
        icon={WalletCards}
        accent="amber"
        actions={<button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5"><RefreshCw className="h-4 w-4" /> Refresh</button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Shipments" value={summary?.shipments ?? 0} sub="Settlement scope" icon={FileText} accent="amber" />
        <KpiCard label="Customer charges" value={money('AED', summary?.customerChargeTotal ?? 0)} sub="Billable" icon={WalletCards} accent="emerald" />
        <KpiCard label="Carrier payable" value={money('AED', summary?.carrierChargeTotal ?? 0)} sub="Cost side" icon={WalletCards} accent="cyan" />
        <KpiCard label="Unreconciled" value={(summary?.unreconciledCustomer ?? 0) + (summary?.unreconciledCarrier ?? 0)} sub="Needs posting" icon={CheckCircle2} accent="rose" />
      </div>

      {message && <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200">{message}</div>}

      <LogisticsDataGrid rows={rows} columns={columns} getRowId={r => r.shipmentOrderId} loading={loading} emptyMessage="No settlement rows found" initialSort={{ key: 'shipment', dir: 'desc' }} toolbar={{ exportName: 'logistics-settlements' }} />
    </div>
  );
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ok ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' : 'border-amber-500/30 bg-amber-500/15 text-amber-300'}`}>{label} {ok ? 'posted' : 'open'}</span>;
}
