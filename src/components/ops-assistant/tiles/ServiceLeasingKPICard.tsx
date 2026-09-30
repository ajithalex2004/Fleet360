'use client';
import React from 'react';
import KpiTileShell, { fetchJson, fmtAed, fmtInt, useTileData } from './KpiTileShell';

interface LeasingAnalytics {
  kpis?: {
    activeContracts?: number;
    monthlyRevenue?: number;
    overdueAmount?: number;
    renewalsPending?: number;
  };
  topContracts?: Array<{ contractId: string; contractNumber: string | null; revenue: number }>;
}

/** Leasing portfolio from the tenant's lease contracts and payments. */
export default function ServiceLeasingKPICard() {
  const data = useTileData(() => fetchJson<LeasingAnalytics>('/api/leasing/analytics'));
  const k = data?.kpis;

  return (
    <KpiTileShell
      icon="🔑"
      title="Corporate Leasing"
      subtitle="Active leases, monthly run-rate, overdue receivables and renewals"
      accent="bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20"
      headerLink={{ href: '/leasing', label: 'Leasing' }}
      loading={data === undefined}
      unavailable={data === null}
      metrics={[
        { label: 'Active Leases', value: fmtInt(k?.activeContracts), tone: 'text-cyan-400' },
        { label: 'Monthly Run-Rate', value: k?.activeContracts ? fmtAed(k.monthlyRevenue) : null, tone: 'text-emerald-400' },
        { label: 'Overdue Receivables', value: k ? fmtAed(k.overdueAmount) : null, tone: 'text-rose-400' },
        { label: 'Renewals Pending', value: fmtInt(k?.renewalsPending), tone: 'text-amber-400' },
      ]}
      listTitle="Top active contracts by revenue collected"
      listRows={(data?.topContracts ?? []).slice(0, 3).map((c) => ({
        key: c.contractId,
        title: c.contractNumber ?? 'Contract',
        value: fmtAed(c.revenue) ?? undefined,
      }))}
      emptyText="No active lease contracts yet."
      footerLinks={[{ href: '/leasing', label: 'Contracts' }, { href: '/reports/revenue', label: 'Revenue report' }]}
    />
  );
}
