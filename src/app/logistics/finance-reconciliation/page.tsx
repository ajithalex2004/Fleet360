'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, CircleAlert, FileCheck2, RefreshCcw, Scale } from 'lucide-react';
import { KpiCard, KpiGrid, PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';

type SessionMe = { tenantId: string };
type ReconciliationShipment = {
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
  reversedTotal: number;
  activePostingCount: number;
  reversedPostingCount: number;
  customerReconciled: boolean;
  carrierReconciled: boolean;
};
type ReconciliationPayload = {
  summary: {
    shipments: number;
    customerChargeTotal: number;
    carrierChargeTotal: number;
    accessorialTotal: number;
    unreconciledCustomer: number;
    unreconciledCarrier: number;
    reversedPostings: number;
  };
  shipments: ReconciliationShipment[];
};

function useTenantQuery(tenantId: string | null) {
  return useCallback((path: string, extra?: Record<string, string | number | null | undefined>) => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    Object.entries(extra ?? {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
    });
    const query = params.toString();
    return `${path}${query ? `?${query}` : ''}`;
  }, [tenantId]);
}

export default function LogisticsFinanceReconciliationPage() {
  const [me, setMe] = useState<SessionMe | null>(null);
  const [payload, setPayload] = useState<ReconciliationPayload | null>(null);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const tenantId = me?.tenantId ?? null;
  const url = useTenantQuery(tenantId);

  const shipments = useMemo(() => {
    const rows = payload?.shipments ?? [];
    if (filter === 'UNRECONCILED') return rows.filter(row => !row.customerReconciled || !row.carrierReconciled);
    if (filter === 'RECONCILED') return rows.filter(row => row.customerReconciled && row.carrierReconciled);
    return rows;
  }, [filter, payload]);

  const loadSession = useCallback(async () => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!res.ok) throw new Error('Please sign in before opening Logistics Finance Reconciliation.');
    setMe(await res.json());
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(url('/api/logistics/finance-reconciliation', { limit: 200 }), { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      setPayload(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reconciliation');
    } finally {
      setLoading(false);
    }
  }, [tenantId, url]);

  useEffect(() => {
    loadSession().catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load session');
      setLoading(false);
    });
  }, [loadSession]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const summary = payload?.summary ?? {
    shipments: 0,
    customerChargeTotal: 0,
    carrierChargeTotal: 0,
    accessorialTotal: 0,
    unreconciledCustomer: 0,
    unreconciledCarrier: 0,
    reversedPostings: 0,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logistics Finance Reconciliation"
        subtitle="Reconcile customer invoice charges, carrier payables, accessorial charges, reversals, and posted Finance records shipment by shipment."
        icon={Scale}
        accent="emerald"
        actions={<button onClick={loadData} className="btn-secondary inline-flex items-center gap-2"><RefreshCcw className="h-4 w-4" /> Refresh</button>}
      />
      {error && <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm font-semibold text-rose-100">{error}</div>}
      <KpiGrid>
        <KpiCard label="Shipments" value={summary.shipments} icon={Scale} accent="blue" />
        <KpiCard label="Customer" value={`AED ${summary.customerChargeTotal.toLocaleString()}`} icon={BadgeDollarSign} accent="emerald" />
        <KpiCard label="Carrier" value={`AED ${summary.carrierChargeTotal.toLocaleString()}`} icon={BadgeDollarSign} accent="amber" />
        <KpiCard label="Accessorial" value={`AED ${summary.accessorialTotal.toLocaleString()}`} icon={FileCheck2} accent="cyan" />
        <KpiCard label="Open Issues" value={summary.unreconciledCustomer + summary.unreconciledCarrier} icon={CircleAlert} accent="rose" />
      </KpiGrid>

      <Panel
        title="Shipment Reconciliation"
        subtitle={loading ? 'Loading posting status...' : `${shipments.length} shipment(s)`}
        icon={Scale}
        accent="emerald"
        actions={(
          <div className="flex gap-2">
            {['ALL', 'UNRECONCILED', 'RECONCILED'].map(item => (
              <button key={item} onClick={() => setFilter(item)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${filter === item ? 'border-emerald-300 bg-emerald-100 text-emerald-900' : 'border-white/10 bg-white/5 text-slate-300'}`}>
                {item}
              </button>
            ))}
          </div>
        )}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.12em] text-slate-400">
              <tr>
                <th className="px-3 py-3">Shipment</th>
                <th className="px-3 py-3">Customer</th>
                <th className="px-3 py-3">Carrier</th>
                <th className="px-3 py-3">Accessorials</th>
                <th className="px-3 py-3">Posted</th>
                <th className="px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map(row => (
                <tr key={row.shipmentOrderId} className="border-t border-white/8">
                  <td className="px-3 py-4">
                    <div className="font-semibold text-white">{row.shipmentNo}</div>
                    <div className="text-xs text-slate-400">{row.customerName ?? 'Customer'} · {row.status}</div>
                  </td>
                  <td className="px-3 py-4 text-slate-300">{row.currency} {row.customerCharges.toLocaleString()}</td>
                  <td className="px-3 py-4 text-slate-300">{row.currency} {row.carrierCharges.toLocaleString()}</td>
                  <td className="px-3 py-4 text-slate-300">{row.currency} {row.accessorialTotal.toLocaleString()}</td>
                  <td className="px-3 py-4 text-slate-300">
                    Customer {row.currency} {row.postedCustomerInvoiceTotal.toLocaleString()}<br />
                    Carrier {row.currency} {row.postedCarrierPayableTotal.toLocaleString()}
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex flex-wrap gap-2">
                      <StatusPill status={row.customerReconciled ? 'active' : 'warning'} label={row.customerReconciled ? 'Customer OK' : 'Customer Open'} />
                      <StatusPill status={row.carrierReconciled ? 'active' : 'warning'} label={row.carrierReconciled ? 'Carrier OK' : 'Carrier Open'} />
                      {row.reversedPostingCount > 0 && <StatusPill status="danger" label={`${row.reversedPostingCount} reversed`} />}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && shipments.length === 0 && <tr><td colSpan={6} className="px-3 py-12 text-center text-slate-500">No reconciliation records found.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
